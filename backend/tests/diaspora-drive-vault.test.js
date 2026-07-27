/**
 * Diaspora GTM Drive lane — credential vault + `diaspora_credential_references` registry (Issue #127).
 *
 * The claim under test is narrow and total: the database may hold an OPAQUE HANDLE and nothing else.
 * These tests attack that claim from both ends — by trying to store real-shaped credentials through
 * every write path, and by checking that the registry's own lifecycle (supersede, refresh, error,
 * revoke) never widens what is stored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { FAKE, fakeJwt } = await import('./helpers/googleDriveFixtures.js');
const {
  InMemoryCredentialVault,
  EnvCredentialVault,
  CredentialVault,
  VaultError,
  assertOpaqueReference,
  isOpaqueReference,
  redactSecretMaterial,
  resolveVault,
  resetSharedTestVault,
  clearRegisteredSecrets,
  CREDENTIAL_PURPOSES,
  VAULT_BACKENDS,
} = await import('../services/diaspora/drive/credentialVault.js');
const { SQL_MIRROR_PATTERNS, REDACTION_PATTERNS } = await import('../services/diaspora/drive/driveVaultRegex.js');
const store = await import('../services/diaspora/drive/credentialReferenceStore.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEM_HEADER = ['-----', 'BEGIN', ' RSA PRIVATE KEY-----'].join('');

function client() {
  return createMockSupabase({ diaspora_credential_references: [] });
}

// ── The opaque-reference gate ────────────────────────────────────────────────

test('assertOpaqueReference refuses every credential shape the SQL CHECK refuses', () => {
  const candidates = [
    FAKE.refreshToken,          // 1//…
    FAKE.accessToken,           // ya29.…
    FAKE.apiKey,                // AIza…
    FAKE.clientSecret,          // GOCSPX-…
    fakeJwt(),                  // ey….….…
    `${PEM_HEADER}\nMIIEvQ...`, // PEM block
    'sk_live_0123456789abcdef',
    'sk_test_0123456789abcdef',
    'rk_live_0123456789abcdef',
    'pk_live_0123456789abcdef',
    'whsec_0123456789abcdef',
  ];
  for (const candidate of candidates) {
    assert.throws(
      () => assertOpaqueReference(candidate),
      (err) => {
        assert.ok(err instanceof VaultError);
        assert.equal(err.code, 'VAULT_REFERENCE_REJECTED');
        return true;
      },
      `expected refusal for a ${candidate.slice(0, 6)}… shaped value`,
    );
    assert.equal(isOpaqueReference(candidate), false);
  }
});

test('the rejection message names the credential CLASS and never echoes the value', () => {
  try {
    assertOpaqueReference(FAKE.refreshToken);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /google oauth refresh token/i);
    // The whole point: refusing to store a secret must not put the secret in a log line.
    assert.ok(!err.message.includes(FAKE.refreshToken));
    assert.ok(!err.stack.includes(FAKE.refreshToken));
  }
});

test('length bounds mirror ck_diaspora_credential_reference_len (3..512)', () => {
  assert.throws(() => assertOpaqueReference('ab'), /between 3 and 512/);
  assert.throws(() => assertOpaqueReference('x'.repeat(513)), /between 3 and 512/);
  assert.equal(assertOpaqueReference('x'.repeat(512)), 'x'.repeat(512));
  assert.throws(() => assertOpaqueReference(''), /non-empty/);
  assert.throws(() => assertOpaqueReference(null), /non-empty/);
  assert.throws(() => assertOpaqueReference({ toString: () => 'memvault://x' }), /non-empty/);
});

test('legitimate opaque handles are accepted', () => {
  for (const reference of [
    'memvault://google_drive/2f6c1b9a0e',
    'gcpsm://projects/carup/secrets/drive-refresh-user-1/versions/3',
    'aws-sm://arn:aws:secretsmanager:eu-west-1:1234:secret:drive/user-1',
    'env://GOOGLE_DRIVE_REFRESH_TOKEN_DEV',
    'vault:v1:kv/data/carup/drive/user-1',
  ]) {
    assert.equal(assertOpaqueReference(reference), reference);
  }
});

test('the JS mirror list still corresponds one-to-one with the SQL CHECK fragments', () => {
  // Guards against someone deleting a JS pattern and quietly widening what the service will write.
  const sqlFragments = SQL_MIRROR_PATTERNS.map((p) => p.sql);
  assert.deepEqual(sqlFragments, [
    '^1//', '^ya29\\.', '^sk_live_', '^sk_test_', '^rk_live_', '^pk_live_', '^whsec_', '^AIza',
    '^ey[A-Za-z0-9_-]+\\.', '-----BEGIN',
  ]);
});

// ── Redaction ────────────────────────────────────────────────────────────────

test('redactSecretMaterial scrubs token shapes but leaves ordinary prose intact', () => {
  clearRegisteredSecrets();
  const jwt = fakeJwt();
  const dirty = `upload failed for ${FAKE.accessToken} using ${FAKE.refreshToken} and ${jwt}`;
  const clean = redactSecretMaterial(dirty);
  assert.ok(!clean.includes(FAKE.accessToken));
  assert.ok(!clean.includes(FAKE.refreshToken));
  assert.ok(!clean.includes(jwt));
  assert.match(clean, /\[REDACTED\]/);

  // The classic false-positive trap: an unanchored JWT pattern eats "keyboard." and "monkey.".
  const prose = 'The keyboard. The monkey. A key: value. They. Survey. eye.';
  assert.equal(redactSecretMaterial(prose), prose);
});

test('every redaction pattern is anchored enough to leave English alone', () => {
  const prose = 'keyboard. monkey. survey. obey. bearer of bad news. beginning. skater. pkg_live news.';
  for (const { name, pattern } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    assert.equal(pattern.test(prose), false, `${name} matched ordinary prose`);
  }
});

test('a registered secret is scrubbed even in a shape no pattern anticipates', () => {
  clearRegisteredSecrets();
  const vault = new InMemoryCredentialVault();
  const weird = 'totally-unanticipated-secret-format-9182';
  return vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: weird }).then(() => {
    assert.ok(!redactSecretMaterial(`boom: ${weird}`).includes(weird));
    clearRegisteredSecrets();
  });
});

// ── The vault adapters ───────────────────────────────────────────────────────

test('the in-memory vault returns an opaque handle that carries nothing of the secret', async () => {
  const vault = new InMemoryCredentialVault();
  const { vaultReference, vaultBackend, keyVersion } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    secret: FAKE.refreshToken,
    tenantId: TENANT,
    userId: 'user-1',
  });
  assert.equal(vaultBackend, VAULT_BACKENDS.ENV_DEV);
  assert.ok(keyVersion);
  assert.ok(isOpaqueReference(vaultReference));
  assert.ok(!vaultReference.includes(FAKE.refreshToken));
  // Not even a hash of it — a hash of a low-entropy secret is an offline oracle.
  const crypto = await import('node:crypto');
  for (const algorithm of ['sha256', 'sha1', 'md5']) {
    const digest = crypto.createHash(algorithm).update(FAKE.refreshToken).digest('hex');
    assert.ok(!vaultReference.includes(digest.slice(0, 16)), `${algorithm} of the secret leaked into the handle`);
  }
  const { secret } = await vault.get(vaultReference);
  assert.equal(secret, FAKE.refreshToken);
});

test('two puts of the same secret produce different handles (handles are not deterministic)', async () => {
  const vault = new InMemoryCredentialVault();
  const a = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: FAKE.refreshToken });
  const b = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: FAKE.refreshToken });
  assert.notEqual(a.vaultReference, b.vaultReference);
});

test('rotate replaces the secret under the same handle and bumps the key version', async () => {
  const vault = new InMemoryCredentialVault();
  const { vaultReference, keyVersion } = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: FAKE.refreshToken });
  const rotated = await vault.rotate(vaultReference, FAKE.rotatedRefreshToken);
  assert.equal(rotated.vaultReference, vaultReference);
  assert.notEqual(rotated.keyVersion, keyVersion);
  assert.equal((await vault.get(vaultReference)).secret, FAKE.rotatedRefreshToken);
});

test('destroy really destroys — the secret is unrecoverable afterwards', async () => {
  const vault = new InMemoryCredentialVault();
  const { vaultReference } = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: FAKE.refreshToken });
  assert.equal(vault.size, 1);
  assert.deepEqual(await vault.destroy(vaultReference), { destroyed: true });
  assert.equal(vault.size, 0);
  await assert.rejects(() => vault.get(vaultReference), /No credential is stored/);
  assert.deepEqual(await vault.destroy(vaultReference), { destroyed: false });
});

test('the vault refuses a get/rotate/destroy on a token-shaped "reference"', async () => {
  const vault = new InMemoryCredentialVault();
  // An attacker who can influence the reference must not be able to turn the vault into an oracle
  // or smuggle a token through a code path that expects a handle.
  for (const call of [
    () => vault.get(FAKE.refreshToken),
    () => vault.rotate(FAKE.accessToken, 'x'),
    () => vault.destroy(fakeJwt()),
  ]) {
    await assert.rejects(call, (err) => err.code === 'VAULT_REFERENCE_REJECTED');
  }
});

test('the env vault is read-only and resolves only its own reference form', async () => {
  process.env.CARUP_TEST_VAULT_SECRET = FAKE.refreshToken;
  const vault = new EnvCredentialVault();
  assert.equal((await vault.get('env://CARUP_TEST_VAULT_SECRET')).secret, FAKE.refreshToken);
  await assert.rejects(() => vault.get('env://NOT_SET_ANYWHERE'), /No credential is stored/);
  await assert.rejects(() => vault.get('memvault://google_drive/abc'), /Not an env vault reference/);
  await assert.rejects(() => vault.put({ purpose: 'google_drive', secret: 'x' }), /read-only/);
  await assert.rejects(() => vault.rotate('env://CARUP_TEST_VAULT_SECRET', 'x'), /read-only/);
  delete process.env.CARUP_TEST_VAULT_SECRET;
});

test('the base interface refuses to be used directly', async () => {
  const base = new CredentialVault();
  await assert.rejects(() => base.put({}), /not implemented/);
  await assert.rejects(() => base.get('memvault://x/y'), /not implemented/);
  assert.throws(() => base.backend, /not implemented/);
});

// ── Fail-closed selection ────────────────────────────────────────────────────

test('production refuses the in-memory and env vaults outright', () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => new InMemoryCredentialVault(), (err) => err.code === 'VAULT_NOT_PERMITTED');
    assert.throws(() => new EnvCredentialVault(), (err) => err.code === 'VAULT_NOT_PERMITTED');
  } finally {
    process.env.NODE_ENV = original;
  }
});

test('resolveVault fails closed in production instead of degrading to a volatile store', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalBackend = process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
    assert.throws(() => resolveVault(), (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      assert.match(err.message, /No production credential vault is configured/);
      return true;
    });
    // Declaring a managed backend is not the same as having a client for it — say so, do not pretend.
    process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = 'aws_secrets_manager';
    assert.throws(() => resolveVault(), (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      assert.match(err.message, /no client is implemented/);
      return true;
    });
    // env_dev must never be honoured in production even when explicitly requested.
    process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = 'env_dev';
    assert.throws(() => resolveVault(), (err) => err.code === 'VAULT_NOT_CONFIGURED');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalBackend === undefined) delete process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
    else process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = originalBackend;
    resetSharedTestVault();
  }
});

test('resolveVault honours an injected vault ahead of everything else', () => {
  const injected = new InMemoryCredentialVault();
  assert.equal(resolveVault({ vault: injected }), injected);
});

// ── The registry table ───────────────────────────────────────────────────────

test('recording a reference persists the handle, the scopes and no secret', async () => {
  const db = client();
  const row = await store.recordCredentialReference(db, {
    tenantId: TENANT,
    userId: 'user-1',
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    vaultBackend: VAULT_BACKENDS.ENV_DEV,
    vaultReference: 'memvault://google_drive/abc123def456',
    keyVersion: 'v1',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    externalAccountLabel: FAKE.accountEmail,
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(row.status, 'active');
  assert.equal(row.vault_reference, 'memvault://google_drive/abc123def456');
  assert.deepEqual(row.scopes, ['https://www.googleapis.com/auth/drive.file']);
  const serialized = JSON.stringify(db._rows('diaspora_credential_references'));
  assert.ok(!serialized.includes(FAKE.refreshToken));
  assert.ok(!serialized.includes(FAKE.accessToken));
});

test('the registry refuses a token-shaped vault_reference before it can reach the driver', async () => {
  const db = client();
  for (const bad of [FAKE.refreshToken, FAKE.accessToken, FAKE.apiKey, fakeJwt(), `${PEM_HEADER}\nAAA`]) {
    await assert.rejects(
      () => store.recordCredentialReference(db, {
        tenantId: TENANT,
        userId: 'user-1',
        vaultBackend: VAULT_BACKENDS.ENV_DEV,
        vaultReference: bad,
      }),
      (err) => err.code === 'VAULT_REFERENCE_REJECTED',
    );
  }
  // Nothing was written on any of those attempts.
  assert.equal(db._rows('diaspora_credential_references').length, 0);
});

test('a missing tenant is refused rather than filled in with a placeholder', async () => {
  const db = client();
  await assert.rejects(
    () => store.recordCredentialReference(db, {
      tenantId: null,
      vaultBackend: VAULT_BACKENDS.ENV_DEV,
      vaultReference: 'memvault://google_drive/abc123',
    }),
    /tenant context is required/,
  );
  assert.equal(db._rows('diaspora_credential_references').length, 0);
});

test('purpose and backend are constrained to the CHECK-constraint vocabularies', async () => {
  const db = client();
  await assert.rejects(() => store.recordCredentialReference(db, {
    tenantId: TENANT, purpose: 'dropbox', vaultBackend: VAULT_BACKENDS.ENV_DEV, vaultReference: 'memvault://x/y',
  }), /Unsupported credential purpose/);
  await assert.rejects(() => store.recordCredentialReference(db, {
    tenantId: TENANT, vaultBackend: 'sticky_note', vaultReference: 'memvault://x/y',
  }), /Unsupported credential vault backend/);
});

test('reconnecting supersedes the previous active row rather than deleting the history', async () => {
  const db = client();
  const first = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: VAULT_BACKENDS.ENV_DEV, vaultReference: 'memvault://google_drive/first-handle',
  });
  const second = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: VAULT_BACKENDS.ENV_DEV, vaultReference: 'memvault://google_drive/second-handle',
  });
  const rows = db._rows('diaspora_credential_references');
  assert.equal(rows.length, 2, 'history is kept');
  const previous = rows.find((r) => r.id === first.id);
  assert.equal(previous.status, 'revoked');
  assert.ok(previous.revoked_at);
  assert.equal(rows.find((r) => r.id === second.id).status, 'active');
  // Exactly one active row for the (tenant, user, purpose) triple — the partial unique index's rule.
  assert.equal(rows.filter((r) => r.status === 'active').length, 1);
  const active = await store.findActiveCredentialReference(db, { tenantId: TENANT, userId: 'user-1', purpose: 'google_drive' });
  assert.equal(active.id, second.id);
});

test('a different user in the same tenant keeps their own active row', async () => {
  const db = client();
  await store.recordCredentialReference(db, { tenantId: TENANT, userId: 'user-1', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/u1' });
  await store.recordCredentialReference(db, { tenantId: TENANT, userId: 'user-2', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/u2' });
  const rows = db._rows('diaspora_credential_references');
  assert.equal(rows.filter((r) => r.status === 'active').length, 2);
});

test('a provider error is recorded as a sanitized code + message, never the raw token', async () => {
  const db = client();
  const row = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/handle-1',
  });
  await store.markCredentialError(db, row.id, {
    code: 'REVOKED',
    // The adversarial case: an upstream error string that carries the token.
    message: `invalid_grant for refresh_token=${FAKE.refreshToken} (access ${FAKE.accessToken})`,
    status: 'revoked',
  });
  const stored = db._rows('diaspora_credential_references').find((r) => r.id === row.id);
  assert.equal(stored.status, 'revoked');
  assert.equal(stored.last_error_code, 'REVOKED');
  assert.ok(!stored.last_error.includes(FAKE.refreshToken));
  assert.ok(!stored.last_error.includes(FAKE.accessToken));
  assert.match(stored.last_error, /\[REDACTED\]/);
  assert.ok(stored.revoked_at);
});

test('an oversized error message is redacted first, then truncated', async () => {
  const db = client();
  const row = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/handle-2',
  });
  // Truncating first could slice a token in half and leave the front of it in the column.
  await store.markCredentialError(db, row.id, { code: 'X', message: `${'a'.repeat(500)}${FAKE.refreshToken}` });
  const stored = db._rows('diaspora_credential_references').find((r) => r.id === row.id);
  assert.ok(stored.last_error.length <= 401);
  assert.ok(!stored.last_error.includes(FAKE.refreshToken.slice(0, 12)));
});

test('marking refreshed clears the error and records the new expiry', async () => {
  const db = client();
  const row = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/handle-3',
  });
  await store.markCredentialError(db, row.id, { code: 'PROVIDER_UNAVAILABLE', message: 'Backend Error' });
  await store.markCredentialRefreshed(db, row.id, { expiresAt: '2026-09-01T00:00:00.000Z', keyVersion: 'v9' });
  const stored = db._rows('diaspora_credential_references').find((r) => r.id === row.id);
  assert.equal(stored.status, 'active');
  assert.equal(stored.last_error_code, null);
  assert.equal(stored.expires_at, '2026-09-01T00:00:00.000Z');
  assert.equal(stored.key_version, 'v9');
});

test('the sanitized projection never exposes the vault handle', async () => {
  const db = client();
  const row = await store.recordCredentialReference(db, {
    tenantId: TENANT, userId: 'user-1', vaultBackend: 'env_dev', vaultReference: 'memvault://google_drive/handle-4', keyVersion: 'v1',
  });
  const projected = store.sanitizeCredentialReference(row);
  const json = JSON.stringify(projected);
  assert.ok(!json.includes('memvault://google_drive/handle-4'));
  assert.ok(!json.includes('vault_reference'));
  assert.equal(projected.status, 'active');
  assert.equal(projected.vaultBackend, 'env_dev');
});
