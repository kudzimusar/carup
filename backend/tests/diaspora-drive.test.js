/**
 * Phase 7 backend tests — Drive provider abstraction + sync service with the mock provider.
 * Proves minimal scopes, signed-state validation, token material is never returned, tenant isolation,
 * revoked-token handling, sanitized errors, disconnect, and feature-disabled safety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_DRIVE_ENABLED = 'true';
process.env.DIASPORA_DRIVE_MOCK = 'true';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { MockDriveProvider } = await import('../services/diaspora/drive/driveProvider.js');
const drive = await import('../services/diaspora/diasporaDriveSyncService.js');
const { DRIVE_SCOPES } = await import('../constants/diaspora/diasporaDriveConstants.js');

const userA = { id: 'a', userId: 'a', role: 'dealer', platformRole: 'dealer', tenantId: null };
const userB = { id: 'b', userId: 'b', role: 'dealer', platformRole: 'dealer', tenantId: null };

function ctx() {
  const client = createMockSupabase({ diaspora_drive_connections: [], diaspora_drive_files: [], diaspora_import_audit_log: [] });
  const provider = new MockDriveProvider();
  return { client, provider, options: (c = client, p = provider) => ({ supabaseClient: c, driveProvider: p }) };
}

async function connect(user, env) {
  const auth = await drive.getAuthorizationUrl(user, env.options());
  const url = new URL(auth.url);
  // exchange the (mock) code; reuse the state issued for this user
  return drive.handleOAuthCallback({ code: 'mock-code', state: auth.state }, user, env.options());
}

test('authorization URL requests only the minimal drive.file scope', async () => {
  const env = ctx();
  const { url, scopes } = await drive.getAuthorizationUrl(userA, env.options());
  assert.deepEqual(scopes, DRIVE_SCOPES);
  assert.equal(DRIVE_SCOPES.length, 1);
  assert.match(decodeURIComponent(new URL(url).searchParams.get('scope')), /drive\.file/);
  assert.doesNotMatch(decodeURIComponent(new URL(url).searchParams.get('scope') || ''), /auth\/drive$/); // not full-drive
});

test('OAuth state is generated and validated; tampered/foreign state is rejected', async () => {
  const env = ctx();
  const { state } = await drive.getAuthorizationUrl(userA, env.options());
  // valid
  const conn = await drive.handleOAuthCallback({ code: 'mock-code', state }, userA, env.options());
  assert.equal(conn.connected, true);
  // tampered signature
  await assert.rejects(() => drive.handleOAuthCallback({ code: 'mock-code', state: `${state}tampered` }, userA, env.options()), /state/i);
  // foreign user cannot use A's state
  await assert.rejects(() => drive.handleOAuthCallback({ code: 'mock-code', state }, userB, env.options()), /does not belong/i);
});

test('token material is never returned to the frontend', async () => {
  const env = ctx();
  const conn = await connect(userA, env);
  const json = JSON.stringify(conn);
  assert.doesNotMatch(json, /credential_reference|credentialReference|accessToken|mock-access|mockref/i);
  // the persisted row keeps only the opaque reference, never a token
  const stored = env.client._rows('diaspora_drive_connections')[0];
  assert.ok(stored.credential_reference);
  assert.doesNotMatch(JSON.stringify(stored), /accessToken|mock-access-\d/);
});

test('status reports honest XLSX limitation and disabled OneDrive', async () => {
  const env = ctx();
  const status = await drive.getDriveStatus(userA, env.options());
  assert.equal(status.workbookExport.xlsx, false);
  assert.equal(status.onedrive.available, false);
});

test('a user cannot access another user connection', async () => {
  const env = ctx();
  await connect(userA, env);
  const bStatus = await drive.getDriveStatus(userB, env.options());
  assert.equal(bStatus.connection, null); // B sees no connection
  await assert.rejects(() => drive.disconnectDrive(userB, env.options()), /No Drive connection/i);
});

test('upload uses approved folder/link metadata and records a file', async () => {
  const env = ctx();
  await connect(userA, env);
  const { file } = await drive.uploadDriveFile({ fileName: 'order.json', content: '{"x":1}', linkedEntityType: 'buyer_order', linkedEntityId: 'ord-1' }, userA, env.options());
  assert.equal(file.linkedEntityType, 'buyer_order');
  assert.equal(file.linkedEntityId, 'ord-1');
  assert.ok(file.driveFileId && file.driveFileUrl);
  assert.ok(file.checksumSha256);
});

test('upload is idempotent on key', async () => {
  const env = ctx();
  await connect(userA, env);
  const a = await drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e1', idempotencyKey: 'k1' }, userA, env.options());
  const b = await drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e1', idempotencyKey: 'k1' }, userA, env.options());
  assert.equal(b.idempotentReplay, true);
  assert.equal(a.file.id, b.file.id);
  assert.equal(env.client._rows('diaspora_drive_files').length, 1);
});

test('revoked token surfaces a disconnected/reconnect state on sync', async () => {
  const env = ctx();
  await connect(userA, env);
  // revoke at the provider out-of-band
  const stored = env.client._rows('diaspora_drive_connections')[0];
  await env.provider.revoke(stored.credential_reference);
  const synced = await drive.syncDrive(userA, env.options());
  assert.equal(synced.accessStatus, 'REVOKED');
  assert.equal(synced.connected, false);
});

test('disconnect revokes and drops the local credential reference', async () => {
  const env = ctx();
  await connect(userA, env);
  const result = await drive.disconnectDrive(userA, env.options());
  assert.equal(result.accessStatus, 'DISCONNECTED');
  const stored = env.client._rows('diaspora_drive_connections')[0];
  assert.equal(stored.credential_reference, null);
});

test('provider errors are sanitized (no raw provider internals)', async () => {
  const env = ctx();
  await connect(userA, env);
  // revoke then attempt upload → ValidationError with a clean message
  const stored = env.client._rows('diaspora_drive_connections')[0];
  await env.provider.revoke(stored.credential_reference);
  await assert.rejects(() => drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e1' }, userA, env.options()), (err) => {
    assert.match(err.message, /revoked/i);
    assert.doesNotMatch(err.message, /stack|at Object|node_modules/i);
    return true;
  });
});

test('xlsx export is refused truthfully', async () => {
  const env = ctx();
  await connect(userA, env);
  await assert.rejects(() => drive.exportToDrive({ format: 'xlsx', linkedEntityType: 'export', linkedEntityId: 'e1' }, userA, env.options()), /xlsx export is not available/i);
});

test('feature-disabled authorize is safe', async () => {
  process.env.DIASPORA_DRIVE_ENABLED = 'false';
  const env = ctx();
  await assert.rejects(() => drive.getAuthorizationUrl(userA, env.options()), /disabled/i);
  const status = await drive.getDriveStatus(userA, env.options());
  assert.equal(status.enabled, false);
  process.env.DIASPORA_DRIVE_ENABLED = 'true';
});
