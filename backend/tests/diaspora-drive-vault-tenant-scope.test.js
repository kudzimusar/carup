/**
 * The Drive PROVIDER's vault must be tenant-scoped, not just the service's own (Issue #127).
 *
 * `resolveVault({tenantId})` returns a `forTenant()` view so the tenant binding travels with the
 * vault rather than being a discipline each call site must remember. That scoping reached the
 * service's direct vault calls — the PKCE verifier — but not the provider's, and the provider is
 * where the REFRESH TOKENS live. `getDriveProvider(…, options)` was handed raw options, so in
 * production `options.vault` was null and the provider resolved its own UNSCOPED default: every
 * token load, rotation and destroy ran unbound.
 *
 * WHY NO EXISTING TEST CAUGHT THIS
 * --------------------------------
 * Every Drive service test injects `driveProvider` — a whole provider — which `getDriveProvider`
 * returns immediately, before it ever looks at a vault. The suite therefore exercised the provider
 * and the vault separately and never the wiring between them, which is exactly the shape of the
 * three integration defects recorded in the progress document: both sides correct in isolation,
 * nothing asserting the join.
 *
 * These tests inject the `transport` seam instead, so the REAL provider is constructed and the vault
 * it is handed is observable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const drive = await import('../services/diaspora/diasporaDriveSyncService.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';

/**
 * A vault that records every `forTenant` it is asked for and refuses to serve an unscoped read.
 *
 * The refusal is the point. A spy that merely counts calls would still pass if the provider took the
 * unscoped vault and used it, so the unscoped `get` throws — the provider cannot quietly succeed
 * without the binding.
 */
function spyVault() {
  const scopedFor = [];
  const base = {
    scopedTenant: null,
    forTenant(tenantId) {
      scopedFor.push(tenantId);
      return { ...base, scopedTenant: tenantId, forTenant: base.forTenant };
    },
    async put() { return { vaultReference: 'vault_ref_spy', vaultBackend: 'spy', keyVersion: 1 }; },
    async get() {
      if (!this.scopedTenant) throw new Error('UNSCOPED_VAULT_READ: the provider was handed a vault with no tenant binding');
      return JSON.stringify({ refreshToken: 'spy-refresh-token', scopes: [] });
    },
    async rotate() { return { vaultReference: 'vault_ref_spy', keyVersion: 2 }; },
    async destroy() { return true; },
  };
  return { vault: base, scopedFor };
}

function connectionRow(tenantId, userId) {
  return {
    id: 'conn-1',
    tenant_id: tenantId,
    user_id: userId,
    provider: 'google',
    access_status: 'CONNECTED',
    credential_reference: 'vault_ref_spy',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const user = { id: 'user-a', tenantId: TENANT, role: 'diaspora_buyer' };

/** A transport that answers anything Google would be asked, so the provider reaches its vault. */
function stubTransport() {
  return async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ access_token: 'stub-access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }),
  });
}

test('the spy itself distinguishes scoped from unscoped (positive control)', async () => {
  const { vault } = spyVault();
  // Unscoped: refuses. If this ever stops throwing, every assertion below passes vacuously.
  await assert.rejects(() => vault.get('vault_ref_spy'), /UNSCOPED_VAULT_READ/);
  // Scoped: serves.
  const scoped = vault.forTenant(TENANT);
  assert.equal(typeof await scoped.get('vault_ref_spy'), 'string');
  assert.equal(scoped.scopedTenant, TENANT);
});

test('disconnectDrive hands the provider a vault scoped to the CALLER tenant', async () => {
  const { vault, scopedFor } = spyVault();
  const client = createMockSupabase({
    diaspora_drive_connections: [connectionRow(TENANT, user.id)],
    diaspora_drive_files: [],
  });

  await drive.disconnectDrive(user, { supabaseClient: client, vault, transport: stubTransport() });

  assert.ok(scopedFor.length > 0, 'the vault was never scoped — the provider received an unbound vault');
  assert.ok(
    scopedFor.every((t) => t === TENANT),
    `the vault was scoped to ${JSON.stringify(scopedFor)}, expected only ${TENANT}`,
  );
  assert.equal(scopedFor.includes(OTHER_TENANT), false, 'the vault was scoped to a tenant that is not the caller');
});

test('syncDrive hands the provider a vault scoped to the CALLER tenant', async () => {
  const { vault, scopedFor } = spyVault();
  const client = createMockSupabase({
    diaspora_drive_connections: [connectionRow(TENANT, user.id)],
    diaspora_drive_files: [],
    diaspora_credential_references: [],
  });

  // The outcome does not matter — a provider error is fine. What matters is that by the time the
  // provider touched the vault, the vault carried the tenant.
  await drive.syncDrive(user, { supabaseClient: client, vault, transport: stubTransport() }).catch(() => {});

  assert.ok(scopedFor.length > 0, 'the vault was never scoped — the provider received an unbound vault');
  assert.ok(
    scopedFor.every((t) => t === TENANT),
    `the vault was scoped to ${JSON.stringify(scopedFor)}, expected only ${TENANT}`,
  );
});

test('a caller with no tenant does not silently receive another tenant scope', async () => {
  const { vault, scopedFor } = spyVault();
  const untenanted = { id: 'user-a', tenantId: null, role: 'diaspora_buyer' };
  const client = createMockSupabase({
    diaspora_drive_connections: [connectionRow(null, untenanted.id)],
    diaspora_drive_files: [],
  });

  await drive.disconnectDrive(untenanted, { supabaseClient: client, vault, transport: stubTransport() }).catch(() => {});

  // No tenant means no scope is applied — never a scope borrowed from somewhere else.
  assert.equal(
    scopedFor.some((t) => t),
    false,
    `an untenanted caller produced tenant scopes ${JSON.stringify(scopedFor)}`,
  );
});
