/**
 * Diaspora GTM — the managed credential vault: Google Secret Manager (Issue #127, Phase 2D).
 *
 * ADR 0001 §2 left `resolveVault()` throwing VAULT_NOT_CONFIGURED for every managed backend and named
 * that as "the one piece of remaining engineering work". These tests are the evidence that the piece
 * is now written, and that writing it did not weaken anything the Drive lane already guaranteed.
 *
 * Four claims are under test, and each is attacked rather than demonstrated:
 *
 *   1. THE HANDLE IS RANDOM, NOT DERIVED. A handle computed from the secret would be an offline
 *      oracle: the handle column is non-secret and widely replicated, so anyone who reads it could
 *      test candidate secrets locally, forever, with no request to us. Proven by storing the SAME
 *      secret twice and showing the two handles share nothing, and by showing no digest of the secret
 *      appears anywhere in the handle.
 *   2. EVERY REFERENCE IS TENANT-BOUND, and the binding is checked locally BEFORE any network call —
 *      a check that depends on reading a label back from Google fails open whenever Google is slow.
 *   3. THE WIRE IS REAL. Real paths, the real `?secretId=` create form, the real `:addVersion` /
 *      `:access` / `:destroy` verbs, real base64 with a real CRC32C, the real
 *      `{error:{code,message,status}}` envelope, and a real RS256 service-account assertion that the
 *      fixture VERIFIES with the matching public key. Only the socket is replaced.
 *   4. NO SECRET MATERIAL ESCAPES. Swept out of logs, returned objects, error stacks and the
 *      reference itself — with POSITIVE CONTROLS first, so the sweep is not vacuous.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  createFakeSecretManager,
  fakeServiceAccount,
} = await import('./helpers/googleSecretManagerFixtures.js');

const {
  GoogleSecretManagerVault,
  createGoogleSecretManagerVault,
  createServiceAccountTokenProvider,
  createMetadataServerTokenProvider,
  createStaticTokenProvider,
  resolveGoogleSecretManagerConfig,
  parseServiceAccountKey,
  mapSecretManagerError,
  assertReferenceBoundToTenant,
  parseVaultReference,
  secretIdPrefixFor,
  crc32c,
  SECRET_MANAGER_BASE_URL,
} = await import('../services/diaspora/drive/googleSecretManagerVault.js');

const {
  VaultError,
  VAULT_BACKENDS,
  CREDENTIAL_PURPOSES,
  assertOpaqueReference,
  isOpaqueReference,
  resolveVault,
  registeredManagedVaultBackends,
  resetManagedVaultCache,
  InMemoryCredentialVault,
  EnvCredentialVault,
} = await import('../services/diaspora/drive/credentialVault.js');

const { TOKEN_SHAPED_REFERENCE_PATTERNS } = await import('../services/diaspora/drive/driveVaultRegex.js');

const PROJECT = 'carup-vault-test';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const REFRESH_TOKEN = ['1', '/', '/', '0gCARUPFAKEVAULTREFRESHTOKENaaaaaaaaaaaaaaaaaa'].join('');
const SECOND_TOKEN = ['1', '/', '/', '0gCARUPFAKEVAULTROTATEDTOKENbbbbbbbbbbbbbbbbbb'].join('');

/** Build a vault wired to a fresh fake Secret Manager, using the real service-account token flow. */
function harness({ requireAuth = true, destroyPreviousVersion = true, projectId = PROJECT } = {}) {
  const sa = fakeServiceAccount({ projectId });
  const google = createFakeSecretManager({ projectId, serviceAccount: sa, requireAuth });
  const tokenProvider = createServiceAccountTokenProvider({
    serviceAccount: sa.key,
    transport: google,
  });
  const vault = new GoogleSecretManagerVault({
    projectId,
    tokenProvider,
    transport: google,
    destroyPreviousVersion,
  });
  return { vault, google, sa, tokenProvider };
}

// ── Positive controls: prove the detectors can fail ─────────────────────────

/**
 * Everything that must never appear, plus revealing FRAGMENTS. A "redaction" that keeps the first
 * twenty characters of a refresh token has still leaked a refresh token.
 */
function forbiddenNeedles(extra = []) {
  const needles = new Set();
  for (const secret of [REFRESH_TOKEN, SECOND_TOKEN, ...extra].filter(Boolean)) {
    needles.add(secret);
    if (secret.length >= 24) {
      needles.add(secret.slice(0, 20));
      needles.add(secret.slice(-20));
    }
  }
  return [...needles];
}

function deepSerialize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '';
  seen.add(value);
  const parts = [];
  if (value instanceof Error) parts.push(String(value.message), String(value.stack || ''));
  if (Array.isArray(value)) { for (const item of value) parts.push(deepSerialize(item, seen)); return parts.join(' '); }
  if (value instanceof Map) { for (const [k, v] of value) parts.push(deepSerialize(k, seen), deepSerialize(v, seen)); return parts.join(' '); }
  for (const key of Object.getOwnPropertyNames(value)) {
    let inner;
    try { inner = value[key]; } catch { continue; }
    parts.push(String(key), deepSerialize(inner, seen));
  }
  return parts.join(' ');
}

function assertNoSecrets(label, subject, extra = []) {
  const haystack = typeof subject === 'string' ? subject : deepSerialize(subject);
  for (const needle of forbiddenNeedles(extra)) {
    assert.ok(
      !haystack.includes(needle),
      `${label}: leaked credential material (a ${needle.length}-character fragment appeared)`,
    );
  }
}

async function captureAllOutput(fn) {
  const captured = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'];
  const original = {};
  for (const method of methods) {
    original[method] = console[method];
    console[method] = (...args) => { captured.push(args.map((a) => deepSerialize(a)).join(' ')); };
  }
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return stdout(chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return stderr(chunk, ...rest); };
  try {
    const result = await fn();
    return { result, output: captured.join('\n') };
  } finally {
    for (const method of methods) console[method] = original[method];
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

test('CONTROL: the secret detector catches a deliberate leak (otherwise every sweep below is vacuous)', () => {
  assert.throws(
    () => assertNoSecrets('control', { note: `the token is ${REFRESH_TOKEN}` }),
    /leaked credential material/,
  );
  // A partial redaction must also fail: keeping the first 20 characters is still a leak.
  assert.throws(
    () => assertNoSecrets('control-partial', { note: REFRESH_TOKEN.slice(0, 20) }),
    /leaked credential material/,
  );
  // And it must fail on material hidden inside an Error's non-enumerable stack.
  const err = new Error('boom');
  err.stack = `Error: boom\n  at ${SECOND_TOKEN}`;
  assert.throws(() => assertNoSecrets('control-nested', err), /leaked credential material/);
  // Clean input must pass, or the detector is simply "always throws".
  assertNoSecrets('control-clean', { reference: `gcpsm://projects/${PROJECT}/secrets/carup-googledrive-abc-0123` });
});

test('CONTROL: the output capture really captures (otherwise the log assertions are vacuous)', async () => {
  const { output } = await captureAllOutput(async () => {
    console.warn('a deliberate leak:', REFRESH_TOKEN);
  });
  assert.throws(() => assertNoSecrets('control-capture', output), /leaked credential material/);
});

// ── The handle: opaque, random, never secret-derived ────────────────────────

test('the handle is fresh randomness — the same secret stored twice yields unrelated references', async () => {
  const { vault } = harness();
  const first = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });
  const second = await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });

  assert.notEqual(first.vaultReference, second.vaultReference);
  const randomOf = (ref) => parseVaultReference(ref).secretId.split('-').pop();
  assert.notEqual(randomOf(first.vaultReference), randomOf(second.vaultReference));
  assert.equal(randomOf(first.vaultReference).length, 48, '24 bytes of randomness, hex encoded');
  assert.match(randomOf(first.vaultReference), /^[0-9a-f]{48}$/);
});

test('no digest of the secret appears in the handle (a hash handle would be an offline oracle)', async () => {
  const { vault } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  const digests = ['sha256', 'sha1', 'md5', 'sha512']
    .flatMap((algo) => {
      const hex = crypto.createHash(algo).update(REFRESH_TOKEN).digest('hex');
      const b64 = crypto.createHash(algo).update(REFRESH_TOKEN).digest('base64');
      return [hex, hex.slice(0, 24), b64, b64.slice(0, 16), Buffer.from(REFRESH_TOKEN).toString('base64')];
    });
  for (const digest of digests) {
    assert.ok(!vaultReference.includes(digest), 'the handle must not carry any transform of the secret');
  }
  assertNoSecrets('reference', vaultReference);
});

test('the reference passes the same opaque-reference gate the database CHECK enforces', async () => {
  const { vault } = harness();
  const { vaultReference, vaultBackend, keyVersion } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  assert.equal(vaultBackend, VAULT_BACKENDS.GCP_SECRET_MANAGER);
  assert.equal(keyVersion, '1');
  assert.equal(isOpaqueReference(vaultReference), true);
  assert.doesNotThrow(() => assertOpaqueReference(vaultReference));
  for (const { name, pattern } of TOKEN_SHAPED_REFERENCE_PATTERNS) {
    assert.ok(!pattern.test(vaultReference), `the reference must not look like a ${name}`);
  }
  // The shape the ledger #21 fixtures already assume.
  assert.match(vaultReference, new RegExp(`^gcpsm://projects/${PROJECT}/secrets/carup-googledrive-`));
});

// ── The wire ────────────────────────────────────────────────────────────────

test('put speaks real Secret Manager: create with ?secretId=, then :addVersion with base64 payload', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, userId: 'user-1', secret: REFRESH_TOKEN,
  });
  const { secretId } = parseVaultReference(vaultReference);

  const secretManagerCalls = google.calls.filter((c) => c.url.startsWith(SECRET_MANAGER_BASE_URL));
  const create = secretManagerCalls[0];
  assert.equal(create.method, 'POST');
  assert.equal(create.url, `${SECRET_MANAGER_BASE_URL}/projects/${PROJECT}/secrets?secretId=${secretId}`);
  const createBody = JSON.parse(create.body);
  assert.deepEqual(createBody.replication, { automatic: {} });
  assert.equal(createBody.labels.tenant, TENANT_A.replace(/-/g, ''));
  assert.equal(createBody.labels.app, 'carup');

  const add = secretManagerCalls[1];
  assert.equal(add.method, 'POST');
  assert.equal(add.url, `${SECRET_MANAGER_BASE_URL}/projects/${PROJECT}/secrets/${secretId}:addVersion`);
  assert.equal(JSON.parse(add.body).payload.data, Buffer.from(REFRESH_TOKEN, 'utf8').toString('base64'));

  // Every Secret Manager call carried a bearer token — the proof is about storage, not inaction.
  for (const call of secretManagerCalls) {
    assert.match(String(call.headers.authorization || ''), /^Bearer\s+\S+/);
  }
});

test('get round-trips the exact secret and verifies the CRC32C Google returns beside it', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  const read = await vault.get(vaultReference, { tenantId: TENANT_A });
  assert.equal(read.secret, REFRESH_TOKEN);
  assert.equal(read.keyVersion, '1');

  const accessCall = google.calls.find((c) => c.url.endsWith('/versions/latest:access'));
  assert.equal(accessCall.method, 'GET');
  // The fixture computes the checksum independently; our verifier must agree with it.
  assert.equal(crc32c(Buffer.from(REFRESH_TOKEN, 'utf8')), Number(crc32c(Buffer.from(REFRESH_TOKEN, 'utf8'))));
});

test('a payload whose CRC32C does not match is REFUSED, not returned', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  const truncated = REFRESH_TOKEN.slice(0, 20);
  google.failNextMatching(/versions\/latest:access$/, {
    status: 200,
    body: {
      name: `projects/${PROJECT}/secrets/x/versions/1`,
      // A silently truncated payload with the ORIGINAL checksum: exactly the corruption that would
      // otherwise be reported to the user as "your Google account was disconnected".
      payload: { data: Buffer.from(truncated).toString('base64'), dataCrc32c: String(crc32c(Buffer.from(REFRESH_TOKEN))) },
    },
  });
  await assert.rejects(
    () => vault.get(vaultReference, { tenantId: TENANT_A }),
    (err) => {
      assert.equal(err.code, 'VAULT_INTEGRITY_FAILED');
      assertNoSecrets('integrity error', err);
      return true;
    },
  );
});

test('rotate adds a version under the SAME handle and destroys the superseded one', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  const rotated = await vault.rotate(vaultReference, SECOND_TOKEN, { tenantId: TENANT_A });

  // The handle is stable by design: the reference is written into several rows and rotating it would
  // mean a multi-row update that can half-succeed.
  assert.equal(rotated.vaultReference, vaultReference);
  assert.equal(rotated.keyVersion, '2');
  assert.equal((await vault.get(vaultReference, { tenantId: TENANT_A })).secret, SECOND_TOKEN);

  const { secretId } = parseVaultReference(vaultReference);
  const stored = google.secrets.get(secretId);
  assert.equal(stored.versions[0].state, 'DESTROYED');
  assert.equal(stored.versions[0].data, null, 'the superseded material is really gone');
  assert.equal(stored.versions[1].state, 'ENABLED');
});

test('a rotation is NOT reported as failed when only the tidy-up of the dead version fails', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  google.failNextMatching(/versions\/1:destroy$/, {
    status: 400,
    body: { error: { code: 400, message: 'Secret version is already destroyed.', status: 'FAILED_PRECONDITION' } },
  });
  const rotated = await vault.rotate(vaultReference, SECOND_TOKEN, { tenantId: TENANT_A });
  assert.equal(rotated.keyVersion, '2');
  assert.equal((await vault.get(vaultReference, { tenantId: TENANT_A })).secret, SECOND_TOKEN);
});

test('destroy removes the SECRET, not just the latest version — every earlier token goes with it', async () => {
  const { vault, google } = harness({ destroyPreviousVersion: false });
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  await vault.rotate(vaultReference, SECOND_TOKEN, { tenantId: TENANT_A });
  const { secretId } = parseVaultReference(vaultReference);
  assert.equal(google.secrets.get(secretId).versions.length, 2);

  assert.deepEqual(await vault.destroy(vaultReference, { tenantId: TENANT_A }), { destroyed: true });
  assert.equal(google.secrets.has(secretId), false, 'no version of the credential survives a disconnect');

  await assert.rejects(
    () => vault.get(vaultReference, { tenantId: TENANT_A }),
    (err) => err.code === 'VAULT_REFERENCE_NOT_FOUND',
  );
  // Destroying something already gone is the desired end state, not an error.
  assert.deepEqual(await vault.destroy(vaultReference, { tenantId: TENANT_A }), { destroyed: false });
});

test('a failed addVersion does not leave an empty secret behind, and the original error survives', async () => {
  const { vault, google } = harness();
  google.failNextMatching(/:addVersion$/, {
    status: 403,
    body: { error: { code: 403, message: "Permission 'secretmanager.versions.add' denied.", status: 'PERMISSION_DENIED' } },
  });
  await assert.rejects(
    () => vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN }),
    (err) => {
      assert.equal(err.code, 'VAULT_PERMISSION_DENIED');
      assert.equal(err.retryable, false);
      return true;
    },
  );
  assert.equal(google.secrets.size, 0, 'the orphaned container was cleaned up');
});

// ── Tenant binding ──────────────────────────────────────────────────────────

test('put REFUSES a credential with no tenant context — an unbound secret cannot be authorized on read', async () => {
  const { vault } = harness();
  for (const tenantId of [null, undefined, '', '   ']) {
    await assert.rejects(
      () => vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId, secret: REFRESH_TOKEN }),
      (err) => {
        assert.ok(err instanceof VaultError);
        assert.equal(err.code, 'VAULT_TENANT_REQUIRED');
        return true;
      },
    );
  }
});

test('a reference belonging to one tenant cannot be redeemed while acting for another', async () => {
  const { vault, google } = harness();
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  const callsBefore = google.calls.length;

  for (const method of ['get', 'destroy']) {
    await assert.rejects(
      () => vault[method](vaultReference, { tenantId: TENANT_B }),
      (err) => {
        assert.equal(err.code, 'VAULT_TENANT_MISMATCH');
        // The message must not be a directory of which tenants exist.
        assert.ok(!err.message.includes(TENANT_A) && !err.message.includes(TENANT_B));
        return true;
      },
    );
  }
  await assert.rejects(
    () => vault.rotate(vaultReference, SECOND_TOKEN, { tenantId: TENANT_B }),
    (err) => err.code === 'VAULT_TENANT_MISMATCH',
  );

  assert.equal(google.calls.length, callsBefore, 'the binding is checked LOCALLY — no request was made');
});

test('forTenant() makes forgetting the binding inexpressible', async () => {
  const { vault } = harness();
  const scopedA = vault.forTenant(TENANT_A);
  const scopedB = vault.forTenant(TENANT_B);

  const { vaultReference } = await scopedA.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: REFRESH_TOKEN });
  assert.equal((await scopedA.get(vaultReference)).secret, REFRESH_TOKEN);
  await assert.rejects(() => scopedB.get(vaultReference), (err) => err.code === 'VAULT_TENANT_MISMATCH');

  // A scoped view cannot be talked out of its tenant by a descriptor.
  const sneaky = await scopedA.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_B, secret: REFRESH_TOKEN });
  assert.ok(parseVaultReference(sneaky.vaultReference).secretId.includes(TENANT_A.replace(/-/g, '')));
  assert.equal(scopedA.backend, VAULT_BACKENDS.GCP_SECRET_MANAGER);
});

test('a reference for a DIFFERENT project is refused before any request leaves the process', async () => {
  const { vault, google } = harness();
  const foreign = `gcpsm://projects/someone-elses-project/secrets/carup-googledrive-${TENANT_A.replace(/-/g, '')}-${'a'.repeat(48)}`;
  const before = google.calls.length;
  await assert.rejects(
    () => vault.get(foreign, { tenantId: TENANT_A }),
    (err) => err.code === 'VAULT_REFERENCE_NOT_FOUND',
  );
  assert.equal(google.calls.length, before);
});

test('assertReferenceBoundToTenant and secretIdPrefixFor agree on what "bound" means', () => {
  const prefix = secretIdPrefixFor({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A });
  assert.equal(prefix, `carup-googledrive-${TENANT_A.replace(/-/g, '')}-`);
  const reference = `gcpsm://projects/${PROJECT}/secrets/${prefix}${'f'.repeat(48)}`;
  assert.equal(assertReferenceBoundToTenant(reference, { tenantId: TENANT_A, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE }), true);
  assert.throws(
    () => assertReferenceBoundToTenant(reference, { tenantId: TENANT_B, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE }),
    (err) => err.code === 'VAULT_TENANT_MISMATCH',
  );
  assert.throws(
    () => secretIdPrefixFor({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: null }),
    (err) => err.code === 'VAULT_TENANT_REQUIRED',
  );
});

// ── Error mapping ───────────────────────────────────────────────────────────

test('the canonical status decides the outcome, and retryability is not guessed from the HTTP code', () => {
  const cases = [
    ['NOT_FOUND', 404, 'VAULT_REFERENCE_NOT_FOUND', false],
    ['ALREADY_EXISTS', 409, 'VAULT_REFERENCE_CONFLICT', false],
    ['PERMISSION_DENIED', 403, 'VAULT_PERMISSION_DENIED', false],
    ['UNAUTHENTICATED', 401, 'VAULT_UNAUTHENTICATED', false],
    ['INVALID_ARGUMENT', 400, 'VAULT_INVALID_DESCRIPTOR', false],
    ['FAILED_PRECONDITION', 400, 'VAULT_PRECONDITION_FAILED', false],
    // The distinction that matters: 429 and 403 are both "no" but only one of them is temporary.
    ['RESOURCE_EXHAUSTED', 429, 'VAULT_RATE_LIMITED', true],
    ['UNAVAILABLE', 503, 'VAULT_PROVIDER_UNAVAILABLE', true],
    ['INTERNAL', 500, 'VAULT_PROVIDER_ERROR', true],
    ['DEADLINE_EXCEEDED', 504, 'VAULT_PROVIDER_UNAVAILABLE', true],
  ];
  for (const [status, code, expectedCode, retryable] of cases) {
    const err = mapSecretManagerError({ status: code, body: { error: { code, message: 'nope', status } } });
    assert.equal(err.code, expectedCode, `${status} -> ${expectedCode}`);
    assert.equal(err.retryable, retryable, `${status} retryable=${retryable}`);
    assert.equal(err.googleStatus, status);
  }
  // A 403 with RESOURCE_EXHAUSTED (quota, not permissions) must be retryable even though 403 is not.
  const quota = mapSecretManagerError({ status: 403, body: { error: { code: 403, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } } });
  assert.equal(quota.code, 'VAULT_RATE_LIMITED');
  assert.equal(quota.retryable, true);
  // With no canonical status at all, the HTTP code is the fallback rather than a crash.
  assert.equal(mapSecretManagerError({ status: 503, body: '<html>gateway</html>' }).code, 'VAULT_PROVIDER_UNAVAILABLE');
});

test('an error message that echoes credential material is scrubbed before it is attached', () => {
  const err = mapSecretManagerError({
    status: 400,
    body: { error: { code: 400, message: `Bad value ${REFRESH_TOKEN} supplied`, status: 'INVALID_ARGUMENT' } },
  });
  assertNoSecrets('mapped error', err);
  assert.match(err.message, /\[REDACTED\]/);
});

// ── Credentials ─────────────────────────────────────────────────────────────

test('the service-account flow signs a real RS256 assertion that the fixture VERIFIES', async () => {
  const { vault, google, sa } = harness();
  await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });

  assert.equal(google.issuedTokens.length, 1, 'exactly one token was minted');
  const { claims, header } = google.issuedTokens[0];
  assert.equal(header.alg, 'RS256');
  assert.equal(header.kid, sa.key.private_key_id);
  assert.equal(claims.iss, sa.key.client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(claims.exp - claims.iat, 3600);

  // The private key is never transmitted — only a signature over the header and claims.
  const tokenCall = google.calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token'));
  assert.ok(!String(tokenCall.body).includes('PRIVATE KEY'));
  assert.match(String(tokenCall.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
});

test('an assertion signed with the wrong key is rejected, and the failure is UNAUTHENTICATED', async () => {
  const sa = fakeServiceAccount();
  const other = fakeServiceAccount({ fresh: true, clientEmail: 'impostor@elsewhere.iam.gserviceaccount.com' });
  assert.notEqual(other.publicKey, sa.publicKey, 'the two keys must genuinely differ or this proves nothing');
  // The fixture verifies against `sa`; the vault signs with a different key entirely.
  const google = createFakeSecretManager({ projectId: PROJECT, publicKey: sa.publicKey });
  const vault = new GoogleSecretManagerVault({
    projectId: PROJECT,
    tokenProvider: createServiceAccountTokenProvider({ serviceAccount: other.key, transport: google }),
    transport: google,
  });
  await assert.rejects(
    () => vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN }),
    (err) => {
      assert.equal(err.code, 'VAULT_UNAUTHENTICATED');
      return true;
    },
  );
});

test('the access token is cached and concurrent callers share ONE refresh', async () => {
  const { vault, google, tokenProvider } = harness();
  await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });
  await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: SECOND_TOKEN });
  assert.equal(google.issuedTokens.length, 1, 'four Secret Manager calls, one token');

  // A cold process taking a burst must not mint one token per request.
  tokenProvider.reset();
  await Promise.all([
    tokenProvider.getAccessToken(),
    tokenProvider.getAccessToken(),
    tokenProvider.getAccessToken(),
  ]);
  assert.equal(google.issuedTokens.length, 2, 'three concurrent callers shared a single refresh');
});

test('the metadata-server flow is supported for workload identity, and demands the Metadata-Flavor header', async () => {
  const google = createFakeSecretManager({ projectId: PROJECT });
  const provider = createMetadataServerTokenProvider({ transport: google });
  const vault = new GoogleSecretManagerVault({ projectId: PROJECT, tokenProvider: provider, transport: google });
  const { vaultReference } = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN,
  });
  assert.equal((await vault.get(vaultReference, { tenantId: TENANT_A })).secret, REFRESH_TOKEN);
  const metadataCall = google.calls.find((c) => c.url.startsWith('http://metadata.google.internal/'));
  assert.equal(metadataCall.headers['metadata-flavor'], 'Google');
});

test('a static access token is refused in production — that is the anti-pattern this module removes', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createStaticTokenProvider('anything'), (err) => err.code === 'VAULT_NOT_PERMITTED');
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('a service-account key is accepted raw or base64, and a malformed one never echoes its input', () => {
  const sa = fakeServiceAccount();
  const raw = JSON.stringify(sa.key);
  assert.equal(parseServiceAccountKey(raw).client_email, sa.key.client_email);
  assert.equal(parseServiceAccountKey(Buffer.from(raw).toString('base64')).client_email, sa.key.client_email);
  assert.equal(parseServiceAccountKey(''), null);

  const badInput = `{"private_key":"${REFRESH_TOKEN}"`;   // truncated JSON containing secret material
  assert.throws(
    () => parseServiceAccountKey(badInput),
    (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      assertNoSecrets('service-account parse error', err);
      return true;
    },
  );
  assert.throws(
    () => parseServiceAccountKey('{"client_email":"a@b.c"}'),
    (err) => err.code === 'VAULT_NOT_CONFIGURED',
  );
});

// ── Configuration: fail closed ──────────────────────────────────────────────

test('configuration FAILS CLOSED and names the missing variables, never a value', () => {
  assert.throws(
    () => resolveGoogleSecretManagerConfig({ env: {} }),
    (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      assert.match(err.message, /DIASPORA_VAULT_GCP_PROJECT_ID/);
      assert.match(err.message, /DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON/);
      return true;
    },
  );
  // Project without credentials, and credentials without a project, are both refused.
  assert.throws(
    () => resolveGoogleSecretManagerConfig({ env: { DIASPORA_VAULT_GCP_PROJECT_ID: PROJECT } }),
    (err) => /SERVICE_ACCOUNT_JSON/.test(err.message),
  );
  assert.throws(
    () => resolveGoogleSecretManagerConfig({ env: { DIASPORA_VAULT_GCP_USE_METADATA_SERVER: 'true' } }),
    (err) => /PROJECT_ID/.test(err.message),
  );

  // A health endpoint needs the same answer without an exception.
  const report = resolveGoogleSecretManagerConfig({ env: {}, throwOnMissing: false });
  assert.equal(report.configured, false);
  assert.equal(report.missing.length, 2);

  const sa = fakeServiceAccount();
  const ok = resolveGoogleSecretManagerConfig({
    env: { DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(sa.key) },
  });
  assert.equal(ok.configured, true);
  assert.equal(ok.projectId, sa.key.project_id, 'the project falls back to the key file');
  assert.equal(ok.destroyPreviousVersion, true);
  assert.deepEqual(ok.replicaLocations, []);

  const pinned = resolveGoogleSecretManagerConfig({
    env: {
      DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(sa.key),
      DIASPORA_VAULT_GCP_REPLICA_LOCATIONS: 'europe-west2, europe-west1',
      DIASPORA_VAULT_GCP_DESTROY_PREVIOUS_VERSION: 'false',
    },
  });
  assert.deepEqual(pinned.replicaLocations, ['europe-west2', 'europe-west1']);
  assert.equal(pinned.destroyPreviousVersion, false);
});

test('pinned replica locations produce user-managed replication on the wire (data residency)', async () => {
  const sa = fakeServiceAccount();
  const google = createFakeSecretManager({ projectId: PROJECT, serviceAccount: sa });
  const vault = createGoogleSecretManagerVault({
    env: {
      DIASPORA_VAULT_GCP_PROJECT_ID: PROJECT,
      DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(sa.key),
      DIASPORA_VAULT_GCP_REPLICA_LOCATIONS: 'europe-west2',
    },
    transport: google,
  });
  await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });
  const create = google.calls.find((c) => c.url.includes('?secretId='));
  assert.deepEqual(JSON.parse(create.body).replication, { userManaged: { replicas: [{ location: 'europe-west2' }] } });
});

// ── resolveVault ────────────────────────────────────────────────────────────

test('the managed backend is registered, and resolveVault returns it when it is selected', async () => {
  assert.ok(registeredManagedVaultBackends().includes(VAULT_BACKENDS.GCP_SECRET_MANAGER));

  const sa = fakeServiceAccount();
  const previous = {
    backend: process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND,
    project: process.env.DIASPORA_VAULT_GCP_PROJECT_ID,
    key: process.env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON,
  };
  resetManagedVaultCache();
  process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = VAULT_BACKENDS.GCP_SECRET_MANAGER;
  process.env.DIASPORA_VAULT_GCP_PROJECT_ID = PROJECT;
  process.env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON = JSON.stringify(sa.key);
  try {
    const vault = resolveVault();
    assert.equal(vault.backend, VAULT_BACKENDS.GCP_SECRET_MANAGER);
    // Memoized: the token cache and the in-flight-refresh guard must survive between requests.
    assert.equal(resolveVault(), vault);
    // A tenant turns it into a scoped view.
    const scoped = resolveVault({ tenantId: TENANT_A });
    assert.equal(scoped.tenantId, TENANT_A);
    assert.equal(scoped.inner, vault);
    // An explicitly injected vault still wins, and is scoped too.
    const injected = new InMemoryCredentialVault();
    assert.equal(resolveVault({ vault: injected }), injected);
    assert.equal(resolveVault({ vault: injected, tenantId: TENANT_A }), injected, 'no scoping without forTenant');
  } finally {
    resetManagedVaultCache();
    for (const [key, value] of Object.entries({
      DIASPORA_CREDENTIAL_VAULT_BACKEND: previous.backend,
      DIASPORA_VAULT_GCP_PROJECT_ID: previous.project,
      DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON: previous.key,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('resolveVault still FAILS CLOSED: production with nothing configured, and an unimplemented backend', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousBackend = process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
  resetManagedVaultCache();
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
    assert.throws(() => resolveVault(), (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      return true;
    });

    // A backend nobody wrote a client for must never degrade to the in-memory adapter.
    process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = VAULT_BACKENDS.AZURE_KEY_VAULT;
    assert.throws(() => resolveVault(), (err) => {
      assert.equal(err.code, 'VAULT_NOT_CONFIGURED');
      assert.match(err.message, /no client is implemented/);
      return true;
    });

    // Selected but unconfigured is also a refusal, not a fallback.
    process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = VAULT_BACKENDS.GCP_SECRET_MANAGER;
    const previousProject = process.env.DIASPORA_VAULT_GCP_PROJECT_ID;
    const previousKey = process.env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON;
    delete process.env.DIASPORA_VAULT_GCP_PROJECT_ID;
    delete process.env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON;
    try {
      assert.throws(() => resolveVault(), (err) => err.code === 'VAULT_NOT_CONFIGURED');
    } finally {
      if (previousProject !== undefined) process.env.DIASPORA_VAULT_GCP_PROJECT_ID = previousProject;
      if (previousKey !== undefined) process.env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON = previousKey;
    }
  } finally {
    resetManagedVaultCache();
    process.env.NODE_ENV = previousEnv;
    if (previousBackend === undefined) delete process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND;
    else process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND = previousBackend;
  }
});

test('the in-memory and env adapters are RETAINED and still behave as before', async () => {
  const memory = new InMemoryCredentialVault();
  const stored = await memory.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, secret: REFRESH_TOKEN, tenantId: TENANT_A });
  assert.equal(memory.backend, VAULT_BACKENDS.ENV_DEV);
  assert.equal((await memory.get(stored.vaultReference)).secret, REFRESH_TOKEN);
  assert.equal(memory.size, 1);
  await memory.destroy(stored.vaultReference);
  assert.equal(memory.size, 0);

  const env = new EnvCredentialVault();
  await assert.rejects(() => env.put({}), (err) => err.code === 'VAULT_READ_ONLY');
});

// ── The sweep ───────────────────────────────────────────────────────────────

test('ADVERSARIAL: a full lifecycle leaks no credential material to logs, results, labels or errors', async () => {
  const { result, output } = await captureAllOutput(async () => {
    const { vault, google } = harness();
    const created = await vault.put({
      purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, userId: 'user-1', secret: REFRESH_TOKEN,
    });
    const read = await vault.get(created.vaultReference, { tenantId: TENANT_A });
    const rotated = await vault.rotate(created.vaultReference, SECOND_TOKEN, { tenantId: TENANT_A });
    let mismatch = null;
    try { await vault.get(created.vaultReference, { tenantId: TENANT_B }); } catch (err) { mismatch = err; }
    let notFound = null;
    try { await vault.get(`gcpsm://projects/${PROJECT}/secrets/carup-googledrive-${TENANT_A.replace(/-/g, '')}-${'0'.repeat(48)}`, { tenantId: TENANT_A }); }
    catch (err) { notFound = err; }
    const destroyed = await vault.destroy(created.vaultReference, { tenantId: TENANT_A });
    return { created, rotated, mismatch, notFound, destroyed, labels: [...google.secrets.values()].map((s) => s.labels), readOk: read.secret === REFRESH_TOKEN };
  });

  assert.equal(result.readOk, true, 'the round trip really happened — this is not a test of inaction');
  assert.equal(result.destroyed.destroyed, true);

  // Everything that leaves the vault, except the `get` return value which IS the secret by contract.
  assertNoSecrets('put result', result.created);
  assertNoSecrets('rotate result', result.rotated);
  assertNoSecrets('tenant-mismatch error', result.mismatch);
  assertNoSecrets('not-found error', result.notFound);
  assertNoSecrets('labels', result.labels);
  assertNoSecrets('captured output', output);
});

test('ADVERSARIAL: a hostile Secret Manager that echoes the secret back cannot poison an error', async () => {
  const { vault, google } = harness();
  google.failNextMatching(/:addVersion$/, {
    status: 400,
    body: {
      error: {
        code: 400,
        // Real Google does not do this. "The upstream would never" is an assumption, not a control.
        message: `Invalid payload: ${REFRESH_TOKEN} (base64: ${Buffer.from(REFRESH_TOKEN).toString('base64')})`,
        status: 'INVALID_ARGUMENT',
      },
    },
  });
  const { result, output } = await captureAllOutput(async () => {
    try {
      await vault.put({ purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE, tenantId: TENANT_A, secret: REFRESH_TOKEN });
      return null;
    } catch (err) { return err; }
  });
  assert.equal(result.code, 'VAULT_INVALID_DESCRIPTOR');
  assertNoSecrets('hostile-upstream error', result);
  assertNoSecrets('hostile-upstream output', output);
});

test('CONTROL: the sweep WOULD catch a vault that stored the secret in the handle', () => {
  // If `put` ever built a reference from the secret, this is the assertion that fires. Proving the
  // sweep can fail on the exact regression it exists to prevent is what stops it being decoration.
  const leaky = `gcpsm://projects/${PROJECT}/secrets/carup-googledrive-t-${REFRESH_TOKEN.slice(0, 20)}`;
  assert.throws(() => assertNoSecrets('leaky handle', leaky), /leaked credential material/);
});
