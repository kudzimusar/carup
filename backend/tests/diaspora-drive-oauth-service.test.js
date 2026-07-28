/**
 * Diaspora GTM Drive lane — the service-level OAuth handshake and durable sync (Issue #127).
 *
 * These tests drive the whole path a user takes — authorize → callback → upload → sync → disconnect —
 * with the REAL Google provider behind a fake Google server. What they check is the join between the
 * layers, which is where the interesting failures live:
 *
 *   - is the PKCE verifier actually kept out of the state row and out of the browser?
 *   - is it destroyed after one use, win or lose?
 *   - does the tenant binding actually stop a cross-tenant landing?
 *   - does a rate limit leave the connection alone while a revocation disconnects it?
 *   - does a retried upload produce one file rather than two?
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_DRIVE_ENABLED = 'true';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { FAKE, createFakeGoogle } = await import('./helpers/googleDriveFixtures.js');
const { InMemoryCredentialVault, isOpaqueReference } = await import('../services/diaspora/drive/credentialVault.js');
const { GoogleDriveProvider } = await import('../services/diaspora/drive/googleDriveProvider.js');
const { deriveCodeChallenge } = await import('../services/diaspora/drive/googleOAuthClient.js');
const drive = await import('../services/diaspora/diasporaDriveSyncService.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const user = (id, tenantId) => ({ id, userId: id, role: 'dealer', platformRole: 'dealer', tenantId });

/** A full environment: mock database + fake Google + real provider + real vault. */
function env(googleOptions = {}) {
  const client = createMockSupabase({
    diaspora_drive_connections: [],
    diaspora_drive_files: [],
    diaspora_oauth_states: [],
    diaspora_credential_references: [],
    diaspora_drive_sync_attempts: [],
    diaspora_import_audit_log: [],
  });
  const google = createFakeGoogle(googleOptions);
  const vault = new InMemoryCredentialVault();
  const driveProvider = new GoogleDriveProvider({
    transport: google,
    vault,
    clientId: FAKE.clientId,
    clientSecret: FAKE.clientSecret,
    redirectUris: [FAKE.redirectUri],
  });
  const options = { supabaseClient: client, driveProvider, vault, redirectUri: FAKE.redirectUri };
  return { client, google, vault, driveProvider, options };
}

/** Authorize + callback, exactly as the routes would. */
async function connect(context, e) {
  const auth = await drive.getAuthorizationUrl(context, e.options);
  const stateRow = e.client._rows('diaspora_oauth_states').at(-1);
  const code = e.google.issueAuthorizationCode({
    codeChallenge: stateRow.metadata.pkce.challenge,
    redirectUri: stateRow.metadata.redirectUri,
  });
  const connection = await drive.handleOAuthCallback({ code, state: auth.state }, context, e.options);
  return { auth, stateRow, code, connection };
}

// ── PKCE plumbing ────────────────────────────────────────────────────────────

test('the state row holds the PKCE challenge and a vault HANDLE — never the verifier', async () => {
  const e = env();
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  const stateRow = e.client._rows('diaspora_oauth_states')[0];
  const pkce = stateRow.metadata.pkce;

  assert.equal(pkce.method, 'S256');
  assert.ok(pkce.challenge);
  assert.ok(isOpaqueReference(pkce.verifierReference));
  // The verifier is secret material; a column is not a vault.
  const verifier = (await e.vault.get(pkce.verifierReference)).secret;
  assert.equal(deriveCodeChallenge(verifier), pkce.challenge);
  assert.ok(!JSON.stringify(stateRow).includes(verifier), 'the verifier must not be persisted anywhere');
  assert.ok(!auth.url.includes(verifier), 'the verifier must not reach the browser');
  assert.ok(!JSON.stringify(auth).includes(verifier));
  assert.equal(new URL(auth.url).searchParams.get('code_challenge'), pkce.challenge);
});

test('the verifier is destroyed after a successful exchange', async () => {
  const e = env();
  const { stateRow } = await connect(user('u1', TENANT_A), e);
  await assert.rejects(
    () => e.vault.get(stateRow.metadata.pkce.verifierReference),
    /No credential is stored/,
    'a verifier that outlives its exchange is a replay primitive',
  );
});

test('the verifier is destroyed even when the exchange FAILS', async () => {
  const e = env();
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  const stateRow = e.client._rows('diaspora_oauth_states')[0];
  await assert.rejects(() => drive.handleOAuthCallback({ code: 'never-issued', state: auth.state }, user('u1', TENANT_A), e.options));
  await assert.rejects(() => e.vault.get(stateRow.metadata.pkce.verifierReference), /No credential is stored/);
});

test('a state row whose vaulted verifier is gone cannot complete the handshake', async () => {
  const e = env();
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  const stateRow = e.client._rows('diaspora_oauth_states')[0];
  await e.vault.destroy(stateRow.metadata.pkce.verifierReference);
  const code = e.google.issueAuthorizationCode({ codeChallenge: stateRow.metadata.pkce.challenge, redirectUri: FAKE.redirectUri });
  await assert.rejects(
    () => drive.handleOAuthCallback({ code, state: auth.state }, user('u1', TENANT_A), e.options),
    /Start the connection again/,
  );
});

test('a swapped verifier that no longer matches the challenge is refused before Google is called', async () => {
  const e = env();
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  const stateRow = e.client._rows('diaspora_oauth_states')[0];
  // Simulate the state row being pointed at a different (attacker-controlled) verifier.
  await e.vault.rotate(stateRow.metadata.pkce.verifierReference, 'a-different-verifier-value-000000000000000');
  const code = e.google.issueAuthorizationCode({ codeChallenge: stateRow.metadata.pkce.challenge, redirectUri: FAKE.redirectUri });
  const tokenCallsBefore = e.google.calls.length;
  await assert.rejects(
    () => drive.handleOAuthCallback({ code, state: auth.state }, user('u1', TENANT_A), e.options),
    /could not be verified/,
  );
  assert.equal(e.google.calls.length, tokenCallsBefore, 'the mismatch is caught locally, not by Google');
});

test('a failed authorization start leaves no orphan verifier in the vault', async () => {
  const e = env();
  // No redirect URI configured on the provider → buildAuthorizationUrl fails after the verifier was
  // vaulted. The vault must not accumulate abandoned secrets.
  e.options.driveProvider = new GoogleDriveProvider({
    transport: e.google, vault: e.vault, clientId: null, clientSecret: null, redirectUris: [],
  });
  await assert.rejects(() => drive.getAuthorizationUrl(user('u1', TENANT_A), e.options), /not configured/i);
  assert.equal(e.vault.size, 0);
});

// ── State binding ────────────────────────────────────────────────────────────

test('a state issued in one tenant cannot be redeemed in another', async () => {
  const e = env();
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  // Same human, same session, different active tenant. Landing the connection — and therefore every
  // document synced through it — in the wrong tenant is a data-boundary breach.
  await assert.rejects(
    () => drive.handleOAuthCallback({ code: 'x', state: auth.state }, user('u1', TENANT_B), e.options),
    /does not belong to the authenticated tenant/,
  );
});

test('a tenant-less state cannot be redeemed by a tenant-scoped context (and vice versa)', async () => {
  const e = env();
  const authNoTenant = await drive.getAuthorizationUrl(user('u1', null), e.options);
  await assert.rejects(
    () => drive.handleOAuthCallback({ code: 'x', state: authNoTenant.state }, user('u1', TENANT_A), e.options),
    /authenticated tenant/,
  );
  const authTenant = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  await assert.rejects(
    () => drive.handleOAuthCallback({ code: 'x', state: authTenant.state }, user('u1', null), e.options),
    /authenticated tenant/,
  );
});

test('a replayed callback is refused and does not consume a second authorization', async () => {
  const e = env();
  const { auth, code } = await connect(user('u1', TENANT_A), e);
  await assert.rejects(
    () => drive.handleOAuthCallback({ code, state: auth.state }, user('u1', TENANT_A), e.options),
    /already been used|unknown/i,
  );
});

// ── Connection persistence ──────────────────────────────────────────────────

test('a connection persists an opaque handle and a registry row, and no token anywhere', async () => {
  const e = env();
  const { connection } = await connect(user('u1', TENANT_A), e);
  assert.equal(connection.connected, true);
  assert.equal(connection.providerAccountEmail, FAKE.accountEmail);
  assert.deepEqual(connection.scopes, ['https://www.googleapis.com/auth/drive.file']);

  const stored = e.client._rows('diaspora_drive_connections')[0];
  assert.ok(isOpaqueReference(stored.credential_reference));

  const registry = e.client._rows('diaspora_credential_references');
  assert.equal(registry.length, 1);
  assert.equal(registry[0].status, 'active');
  assert.equal(registry[0].vault_reference, stored.credential_reference);
  assert.equal(registry[0].external_account_label, FAKE.accountEmail);
  assert.deepEqual(registry[0].scopes, ['https://www.googleapis.com/auth/drive.file']);

  const everything = JSON.stringify(e.client._tables);
  for (const secret of [FAKE.refreshToken, FAKE.accessToken, FAKE.clientSecret]) {
    assert.ok(!everything.includes(secret), 'no token may exist in any table');
  }
});

test('reconnecting supersedes the registry row and destroys the old vaulted credential', async () => {
  const e = env();
  const first = await connect(user('u1', TENANT_A), e);
  const firstHandle = e.client._rows('diaspora_drive_connections')[0].credential_reference;

  // Google will hand out a fresh grant on the second consent.
  e.google.state.refreshTokens.add(FAKE.refreshToken);
  e.google.state.revoked = false;
  const second = await connect(user('u1', TENANT_A), e);
  assert.equal(second.connection.connected, true);

  const connections = e.client._rows('diaspora_drive_connections');
  assert.equal(connections.length, 1, 'one connection per user/provider');
  assert.notEqual(connections[0].credential_reference, firstHandle);
  await assert.rejects(() => e.vault.get(firstHandle), /No credential is stored/, 'the superseded secret must not linger');

  const registry = e.client._rows('diaspora_credential_references');
  assert.equal(registry.length, 2, 'history is kept');
  assert.equal(registry.filter((r) => r.status === 'active').length, 1);
  assert.equal(registry.find((r) => r.vault_reference === firstHandle).status, 'revoked');
  void first;
});

test('a user with no tenant still connects, and the missing registry row is reported honestly', async () => {
  const e = env();
  const { connection } = await connect(user('u-solo', null), e);
  assert.equal(connection.connected, true);
  assert.equal(e.client._rows('diaspora_credential_references').length, 0);
  const audit = e.client._rows('diaspora_import_audit_log').find((a) => a.action === 'DRIVE_CONNECTED');
  // The audit says exactly why there is no registry row, rather than implying there is one.
  assert.deepEqual(audit.metadata.credentialRegistry, { recorded: false, reason: 'no_tenant_context' });
});

// ── Status ───────────────────────────────────────────────────────────────────

test('status reports activation truthfully when owner credentials are absent', async () => {
  const e = env();
  const status = await drive.getDriveStatus(user('u1', TENANT_A), e.options);
  assert.equal(status.activation.credentialsConfigured, false);
  assert.equal(status.activation.pending, true, 'a Connect button that can only fail is worse than saying "not yet activated"');
  assert.equal(status.workbookExport.xlsx, false);
  assert.equal(status.onedrive.available, false);
});

test('status surfaces the credential lifecycle without the handle', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const status = await drive.getDriveStatus(user('u1', TENANT_A), e.options);
  assert.equal(status.credential.status, 'active');
  assert.equal(status.credential.externalAccountLabel, FAKE.accountEmail);
  assert.ok(!JSON.stringify(status).includes(e.client._rows('diaspora_drive_connections')[0].credential_reference));
});

// ── Upload under durable tracking ───────────────────────────────────────────

test('an upload with a tenant is recorded as a durable attempt that succeeded', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const result = await drive.uploadDriveFile({
    fileName: 'order.json', content: '{"x":1}', linkedEntityType: 'buyer_order', linkedEntityId: 'ord-1', idempotencyKey: 'k-1',
  }, user('u1', TENANT_A), e.options);

  assert.equal(result.file.linkedEntityId, 'ord-1');
  assert.ok(result.file.driveFileId);
  assert.equal(result.attempt.state, 'succeeded');
  assert.equal(result.attempt.providerFileId, result.file.driveFileId);
  assert.ok(result.attempt.providerFolderId);
  assert.equal(result.attempt.contentChecksum, result.file.checksumSha256);
});

test('a retried upload produces ONE file and one Drive upload', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const payload = { fileName: 'o.json', content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-1', idempotencyKey: 'k-dup' };
  const first = await drive.uploadDriveFile(payload, user('u1', TENANT_A), e.options);
  const uploadsAfterFirst = e.google.calls.filter((c) => c.url.includes('/upload/drive/v3/files')).length;

  const second = await drive.uploadDriveFile(payload, user('u1', TENANT_A), e.options);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.file.id, first.file.id);
  assert.equal(e.client._rows('diaspora_drive_files').length, 1);
  assert.equal(
    e.google.calls.filter((c) => c.url.includes('/upload/drive/v3/files')).length,
    uploadsAfterFirst,
    'a replayed request must not put a second copy in the user\'s Drive',
  );
});

test('a rate-limited upload backs off and leaves the connection CONNECTED', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  e.google.rateLimitNext(/googleapis\.com/, 1);
  await assert.rejects(() => drive.uploadDriveFile({
    content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-2', idempotencyKey: 'k-rl',
  }, user('u1', TENANT_A), e.options), /rate limiting/i);

  const attempt = e.client._rows('diaspora_drive_sync_attempts')[0];
  assert.equal(attempt.state, 'failed', 'retryable, so not a dead letter');
  assert.ok(attempt.next_attempt_at, 'and scheduled for another go');
  // The account is fine. Disconnecting a user because Google was busy is the bug this guards.
  assert.equal(e.client._rows('diaspora_drive_connections')[0].access_status, 'ACTIVE');
  assert.equal(e.client._rows('diaspora_credential_references')[0].status, 'active');
});

test('a rate-limited upload succeeds on retry and settles the same attempt', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  e.google.rateLimitNext(/googleapis\.com/, 1);
  const payload = { content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-3', idempotencyKey: 'k-retry' };
  await assert.rejects(() => drive.uploadDriveFile(payload, user('u1', TENANT_A), e.options));
  const result = await drive.uploadDriveFile(payload, user('u1', TENANT_A), e.options);
  assert.equal(result.attempt.state, 'succeeded');
  assert.equal(result.attempt.attempts, 2);
  assert.equal(e.client._rows('diaspora_drive_sync_attempts').length, 1);
});

test('a revoked grant dead-letters the attempt AND disconnects the account', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  e.google.revokeAtGoogle();
  await assert.rejects(() => drive.uploadDriveFile({
    content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-4', idempotencyKey: 'k-rev',
  }, user('u1', TENANT_A), e.options), /revoked|reconnect/i);

  const attempt = e.client._rows('diaspora_drive_sync_attempts')[0];
  assert.equal(attempt.state, 'dead_lettered', 'waiting cannot fix a revocation');
  assert.equal(e.client._rows('diaspora_drive_connections')[0].access_status, 'REVOKED');
  assert.equal(e.client._rows('diaspora_credential_references')[0].status, 'revoked');
  const audit = e.client._rows('diaspora_import_audit_log').find((a) => a.action === 'DRIVE_SYNC_DEAD_LETTERED');
  assert.ok(audit, 'a file that will never arrive is exactly what the critical audit trail is for');
});

test('the entity sync history answers "did my document actually reach Drive?"', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  await drive.uploadDriveFile({
    content: '{}', linkedEntityType: 'buyer_order', linkedEntityId: 'ord-9', idempotencyKey: 'k-hist',
  }, user('u1', TENANT_A), e.options);
  const history = await drive.getEntitySyncAttempts({ entityType: 'buyer_order', entityId: 'ord-9' }, user('u1', TENANT_A), e.options);
  assert.equal(history.durableTracking, true);
  assert.equal(history.attempts.length, 1);
  assert.equal(history.attempts[0].state, 'succeeded');

  // Another tenant sees nothing of it.
  const other = await drive.getEntitySyncAttempts({ entityType: 'buyer_order', entityId: 'ord-9' }, user('u2', TENANT_B), e.options);
  assert.equal(other.attempts.length, 0);
});

test('a tenant-less upload still works and says its tracking is not durable', async () => {
  const e = env();
  await connect(user('u-solo', null), e);
  const result = await drive.uploadDriveFile({
    content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-5', idempotencyKey: 'k-solo',
  }, user('u-solo', null), e.options);
  assert.equal(result.durableTracking, false, 'the attempts table is tenant-scoped; do not imply otherwise');
  assert.equal(e.client._rows('diaspora_drive_sync_attempts').length, 0);

  const history = await drive.getEntitySyncAttempts({ entityType: 'export', entityId: 'e-5' }, user('u-solo', null), e.options);
  assert.equal(history.durableTracking, false);
  assert.equal(history.reason, 'no_tenant_context');
});

// ── Sync and disconnect ──────────────────────────────────────────────────────

test('sync refreshes through the vault and records the new expiry on the registry row', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const before = e.client._rows('diaspora_credential_references')[0].last_refreshed_at;
  const synced = await drive.syncDrive(user('u1', TENANT_A), e.options);
  assert.equal(synced.connected, true);
  assert.ok(synced.lastSyncAt);
  const after = e.client._rows('diaspora_credential_references')[0];
  assert.equal(after.status, 'active');
  assert.ok(after.expires_at);
  assert.notEqual(after.last_refreshed_at, undefined);
  void before;
});

test('sync on a revoked grant reports REVOKED rather than throwing at the user', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  e.google.revokeAtGoogle();
  const synced = await drive.syncDrive(user('u1', TENANT_A), e.options);
  assert.equal(synced.accessStatus, 'REVOKED');
  assert.equal(synced.connected, false);
  assert.equal(e.client._rows('diaspora_credential_references')[0].status, 'revoked');
});

test('disconnect revokes upstream, destroys the vault entry and retires the registry row', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const handle = e.client._rows('diaspora_drive_connections')[0].credential_reference;
  const result = await drive.disconnectDrive(user('u1', TENANT_A), e.options);
  assert.equal(result.accessStatus, 'DISCONNECTED');
  assert.equal(e.client._rows('diaspora_drive_connections')[0].credential_reference, null);
  assert.equal(e.vault.size, 0);
  await assert.rejects(() => e.vault.get(handle), /No credential is stored/);
  assert.equal(e.client._rows('diaspora_credential_references')[0].status, 'revoked');
  assert.ok(e.google.calls.some((c) => c.url.includes('/revoke')));
});

test('a disconnected connection cannot upload', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  await drive.disconnectDrive(user('u1', TENANT_A), e.options);
  await assert.rejects(
    () => drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e-6' }, user('u1', TENANT_A), e.options),
    /not active. Reconnect required/,
  );
});

test('one user cannot see or disconnect another user\'s connection', async () => {
  const e = env();
  await connect(user('u1', TENANT_A), e);
  const status = await drive.getDriveStatus(user('u2', TENANT_A), e.options);
  assert.equal(status.connection, null);
  await assert.rejects(() => drive.disconnectDrive(user('u2', TENANT_A), e.options), /No Drive connection/);
});
