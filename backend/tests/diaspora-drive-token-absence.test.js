/**
 * Diaspora GTM Drive lane — TOKEN-ABSENCE PROOF (Issue #127).
 *
 * The claim: across the entire Drive lifecycle, no token material ever reaches a log line, an API
 * response, an audit row, an error message, an error stack, or a persisted column.
 *
 * A test that proved this only for the happy path would be close to worthless — leaks happen in error
 * handlers, in retries, in the code nobody looks at. So this file is deliberately adversarial:
 *
 *   - It monkey-patches EVERY console method and process.stdout/stderr.write for the whole run, so
 *     any incidental logging anywhere in the stack is captured, not just logging the tests expect.
 *   - It runs a hostile Google that echoes the caller's own bearer token back inside its error
 *     bodies, error descriptions, and even inside otherwise-successful responses.
 *   - It sweeps the ENTIRE mock database — every table, every row, every nested JSON value — rather
 *     than the columns the author happened to think of.
 *   - It walks returned objects recursively, including non-enumerable Error properties and stacks.
 *   - It asserts on substrings of the tokens too, so a truncated or partially-redacted token still
 *     fails the test.
 *   - It ends with a control case that deliberately leaks, proving the detector can actually fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_DRIVE_ENABLED = 'true';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { FAKE, createFakeGoogle, allFakeSecrets, fakeJwt } = await import('./helpers/googleDriveFixtures.js');
const { InMemoryCredentialVault } = await import('../services/diaspora/drive/credentialVault.js');
const { GoogleDriveProvider } = await import('../services/diaspora/drive/googleDriveProvider.js');
const drive = await import('../services/diaspora/diasporaDriveSyncService.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = { id: 'u1', userId: 'u1', role: 'dealer', platformRole: 'dealer', tenantId: TENANT };

/**
 * The values that must never appear, plus revealing FRAGMENTS of them.
 *
 * Fragments matter: a "redaction" that keeps the first 20 characters of a refresh token has still
 * leaked a refresh token. Anything shorter than 12 characters is excluded because it produces false
 * positives against legitimate content.
 */
function forbiddenNeedles(extra = []) {
  const needles = new Set();
  for (const secret of allFakeSecrets(extra)) {
    needles.add(secret);
    if (secret.length >= 24) {
      needles.add(secret.slice(0, 20));
      needles.add(secret.slice(-20));
      needles.add(secret.slice(8, 28));
    }
  }
  return [...needles];
}

/** Recursively stringify anything, including Error message/stack and non-enumerable properties. */
function deepSerialize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '';
  seen.add(value);

  const parts = [];
  if (value instanceof Error) {
    parts.push(String(value.message), String(value.stack || ''), String(value.name));
  }
  if (Array.isArray(value)) {
    for (const item of value) parts.push(deepSerialize(item, seen));
    return parts.join(' ');
  }
  if (value instanceof Map) {
    for (const [k, v] of value) parts.push(deepSerialize(k, seen), deepSerialize(v, seen));
    return parts.join(' ');
  }
  if (value instanceof Set) {
    for (const item of value) parts.push(deepSerialize(item, seen));
    return parts.join(' ');
  }
  // Own property names catches non-enumerables that JSON.stringify would silently skip.
  for (const key of Object.getOwnPropertyNames(value)) {
    let inner;
    try { inner = value[key]; } catch { continue; }
    parts.push(String(key), deepSerialize(inner, seen));
  }
  return parts.join(' ');
}

function assertNoSecrets(label, subject, extraSecrets = []) {
  const haystack = typeof subject === 'string' ? subject : deepSerialize(subject);
  for (const needle of forbiddenNeedles(extraSecrets)) {
    assert.ok(
      !haystack.includes(needle),
      `${label}: leaked token material (a ${needle.length}-character fragment of a fake credential appeared)`,
    );
  }
}

/** Capture EVERY console method and raw stream write for the duration of `fn`. */
async function captureAllOutput(fn) {
  const captured = [];
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'];
  const originalConsole = {};
  for (const method of consoleMethods) {
    originalConsole[method] = console[method];
    console[method] = (...args) => { captured.push(args.map((a) => deepSerialize(a)).join(' ')); };
  }
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  // node:test writes TAP through process.stdout; capture but pass through so the runner still reports.
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return originalStdout(chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return originalStderr(chunk, ...rest); };
  try {
    const result = await fn();
    return { result, output: captured.join('\n') };
  } finally {
    for (const method of consoleMethods) console[method] = originalConsole[method];
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

/**
 * A hostile Google: it echoes the caller's bearer token back in error bodies AND in successful
 * responses. Real Google does not do this. That is precisely why it is worth testing — "the upstream
 * would never do that" is an assumption, and this file is about what survives when assumptions fail.
 */
function hostileGoogle(options = {}) {
  const google = createFakeGoogle(options);
  const inner = google.request;
  google.request = async (request) => {
    const bearer = /^Bearer\s+(.+)$/.exec(request.headers?.authorization || '')?.[1] || null;
    const response = await inner(request);
    if (bearer) {
      const poison = { echoedToken: bearer, note: `served for ${bearer}`, clientSecret: FAKE.clientSecret };
      if (response.body && typeof response.body === 'object') Object.assign(response.body, poison);
      response.rawBody = JSON.stringify(response.body);
    }
    return response;
  };
  return google;
}

function env({ google = createFakeGoogle() } = {}) {
  const client = createMockSupabase({
    diaspora_drive_connections: [],
    diaspora_drive_files: [],
    diaspora_oauth_states: [],
    diaspora_credential_references: [],
    diaspora_drive_sync_attempts: [],
    diaspora_import_audit_log: [],
  });
  const vault = new InMemoryCredentialVault();
  const driveProvider = new GoogleDriveProvider({
    transport: google, vault, clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, redirectUris: [FAKE.redirectUri],
  });
  return { client, google, vault, driveProvider, options: { supabaseClient: client, driveProvider, vault, redirectUri: FAKE.redirectUri } };
}

async function connect(e, context = USER) {
  const auth = await drive.getAuthorizationUrl(context, e.options);
  const stateRow = e.client._rows('diaspora_oauth_states').at(-1);
  const code = e.google.issueAuthorizationCode({
    codeChallenge: stateRow.metadata.pkce.challenge,
    redirectUri: stateRow.metadata.redirectUri,
  });
  return drive.handleOAuthCallback({ code, state: auth.state }, context, e.options);
}

// ── The control: prove the detector can fail ────────────────────────────────

test('CONTROL: the detector catches a deliberate leak (otherwise every test below is vacuous)', () => {
  assert.throws(
    () => assertNoSecrets('control', { note: `token is ${FAKE.refreshToken}` }),
    /leaked token material/,
  );
  // …including a partial leak that a naive "does it contain the whole token" check would miss.
  assert.throws(
    () => assertNoSecrets('control-partial', { note: `token is ${FAKE.refreshToken.slice(0, 24)}` }),
    /leaked token material/,
  );
  // …and one hidden inside a nested Error's stack rather than its message.
  const err = new Error('generic failure');
  err.detail = { upstream: FAKE.accessToken };
  assert.throws(() => assertNoSecrets('control-nested', err), /leaked token material/);
  // A clean subject passes.
  assertNoSecrets('control-clean', { note: 'nothing to see here', tokenish: 'memvault://google_drive/abcdef' });
});

test('CONTROL: the output capture really captures (otherwise the log assertions are vacuous)', async () => {
  // Without this, "no token appeared in the captured output" could be true simply because nothing was
  // ever captured. Each channel is proven to reach the buffer.
  const { output } = await captureAllOutput(async () => {
    console.log(`log ${FAKE.accessToken}`);
    console.warn(`warn ${FAKE.refreshToken}`);
    console.error(`error ${FAKE.clientSecret}`);
    console.debug(`debug ${FAKE.apiKey}`);
    process.stderr.write(`stderr ${FAKE.secondAccessToken}\n`);
  });
  for (const secret of [FAKE.accessToken, FAKE.refreshToken, FAKE.clientSecret, FAKE.apiKey, FAKE.secondAccessToken]) {
    assert.ok(output.includes(secret), 'the capture must see every channel the code under test could use');
  }
  assert.throws(() => assertNoSecrets('control-capture', output), /leaked token material/);
});

// ── The full lifecycle, everything captured ─────────────────────────────────

test('ADVERSARIAL: a complete Drive lifecycle leaks nothing to logs, responses, audit or columns', async () => {
  const e = env({ google: hostileGoogle() });

  const { result: responses, output } = await captureAllOutput(async () => {
    const collected = [];
    collected.push(await drive.getDriveStatus(USER, e.options));
    collected.push(await drive.getAuthorizationUrl(USER, e.options));

    // Complete the handshake using the state we just issued.
    const stateRow = e.client._rows('diaspora_oauth_states').at(-1);
    const code = e.google.issueAuthorizationCode({
      codeChallenge: stateRow.metadata.pkce.challenge, redirectUri: stateRow.metadata.redirectUri,
    });
    const authState = collected[1].state;
    collected.push(await drive.handleOAuthCallback({ code, state: authState }, USER, e.options));

    collected.push(await drive.uploadDriveFile({
      fileName: 'order.json', content: '{"x":1}', linkedEntityType: 'buyer_order', linkedEntityId: 'ord-1', idempotencyKey: 'k1',
    }, USER, e.options));
    collected.push(await drive.exportToDrive({ linkedEntityType: 'export', linkedEntityId: 'e1', content: { a: 1 }, idempotencyKey: 'k2' }, USER, e.options));
    collected.push(await drive.listDriveFiles(USER, e.options));
    collected.push(await drive.syncDrive(USER, e.options));
    collected.push(await drive.getEntitySyncAttempts({ entityType: 'buyer_order', entityId: 'ord-1' }, USER, e.options));
    collected.push(await drive.getDriveStatus(USER, e.options));
    collected.push(await drive.disconnectDrive(USER, e.options));
    return collected;
  });

  // 1. Nothing was logged anywhere in the stack.
  assertNoSecrets('captured console/stdout/stderr output', output);
  // 2. No API-shaped response carries token material.
  assertNoSecrets('service responses', responses);
  // 3. No table, no row, no nested JSON value.
  assertNoSecrets('the entire database', e.client._tables);
  // 4. Audit rows specifically — they are long-lived and widely read.
  assertNoSecrets('audit log', e.client._rows('diaspora_import_audit_log'));

  // And the lifecycle really did happen (a test that leaked nothing because it did nothing is a lie).
  assert.equal(e.client._rows('diaspora_drive_files').length, 2);
  assert.equal(e.client._rows('diaspora_drive_connections')[0].access_status, 'DISCONNECTED');
  assert.ok(e.google.calls.some((c) => c.url.includes('/upload/drive/v3/files')));
});

test('ADVERSARIAL: the wire really did carry a bearer token (so the proof is about storage, not inaction)', async () => {
  const e = env();
  await connect(e);
  await drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e1', idempotencyKey: 'k' }, USER, e.options);
  const authorized = e.google.calls.filter((c) => c.headers?.authorization);
  assert.ok(authorized.length >= 3, 'real authenticated calls were made');
  assert.ok(authorized.some((c) => c.headers.authorization.includes(FAKE.accessToken)), 'with the real access token');
  // …and the token exists nowhere durable despite having been used.
  assertNoSecrets('database after authenticated calls', e.client._tables);
  assert.ok(!JSON.stringify(e.client._tables).includes('Bearer'));
});

// ── Error paths: where leaks actually happen ────────────────────────────────

test('ADVERSARIAL: every failure mode produces a sanitized error with no token in message or stack', async () => {
  const failures = [
    ['rate limit', (g) => g.rateLimitNext(/googleapis\.com/, 99)],
    ['quota exceeded', (g) => g.quotaExceededNext(/googleapis\.com/, 99)],
    ['server error', (g) => g.serverErrorNext(/googleapis\.com/, 99)],
    ['revocation', (g) => g.revokeAtGoogle()],
    ['socket failure', (g) => g.failNext({ urlMatch: /googleapis\.com/, times: 99, throwError: Object.assign(new Error(`ECONNRESET while sending ${FAKE.accessToken}`), { code: 'TRANSPORT_UNREACHABLE' }) })],
    ['hostile 500 echoing the token', (g) => g.failNext({
      urlMatch: /googleapis\.com/,
      times: 99,
      respond: () => ({ status: 500, body: { error: { code: 500, message: `crashed handling ${FAKE.accessToken} / ${FAKE.refreshToken}`, errors: [{ reason: 'backendError' }] } } }),
    })],
  ];

  for (const [label, arm] of failures) {
    const e = env({ google: hostileGoogle() });
    await connect(e);
    arm(e.google);

    const { result: caught, output } = await captureAllOutput(async () => {
      const errors = [];
      for (const call of [
        () => drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: `e-${label}`, idempotencyKey: `k-${label}` }, USER, e.options),
        () => drive.syncDrive(USER, e.options),
        () => drive.getDriveStatus(USER, e.options),
        () => drive.listDriveFiles(USER, e.options),
      ]) {
        try { errors.push(await call()); } catch (err) { errors.push(err); }
      }
      return errors;
    });

    assertNoSecrets(`${label}: thrown errors (message, stack, own properties)`, caught);
    assertNoSecrets(`${label}: captured output`, output);
    assertNoSecrets(`${label}: database`, e.client._tables);
  }
});

test('ADVERSARIAL: a hostile token endpoint cannot poison the persisted failure record', async () => {
  const e = env();
  await connect(e);
  // Google replies to the REFRESH with an error_description carrying the token back at us.
  e.google.failNext({
    urlMatch: 'https://oauth2.googleapis.com/token',
    times: 99,
    respond: () => ({ status: 400, body: { error: 'invalid_grant', error_description: `revoked: ${FAKE.refreshToken} (was ${FAKE.accessToken})` } }),
  });
  e.google.expireAccessTokens();

  const { result, output } = await captureAllOutput(async () => {
    try { return await drive.syncDrive(USER, e.options); } catch (err) { return err; }
  });

  assertNoSecrets('sync result/error', result);
  assertNoSecrets('output', output);
  assertNoSecrets('database', e.client._tables);
  const credential = e.client._rows('diaspora_credential_references')[0];
  assert.equal(credential.status, 'revoked');
  assert.ok(credential.last_error, 'the failure IS recorded — sanitized, not suppressed');
  assert.match(credential.last_error, /\[REDACTED\]|revoked|expired/i);
});

test('ADVERSARIAL: a PKCE verifier never reaches the state row, the URL, or a log', async () => {
  const e = env();
  const { result: auth, output } = await captureAllOutput(() => drive.getAuthorizationUrl(USER, e.options));
  const stateRow = e.client._rows('diaspora_oauth_states')[0];
  const verifier = (await e.vault.get(stateRow.metadata.pkce.verifierReference)).secret;

  assert.ok(verifier.length >= 43);
  for (const [label, subject] of [
    ['the state row', stateRow],
    ['the authorization response', auth],
    ['the authorization URL', auth.url],
    ['captured output', output],
    ['the whole database', e.client._tables],
  ]) {
    assert.ok(!deepSerialize(subject).includes(verifier), `${label} leaked the PKCE verifier`);
  }
  // The challenge, by contrast, is public and IS present — otherwise PKCE is not actually in use.
  assert.ok(auth.url.includes(stateRow.metadata.pkce.challenge));
});

test('ADVERSARIAL: no column anywhere holds a value with the SHAPE of a credential', async () => {
  const e = env({ google: hostileGoogle() });
  await connect(e);
  await drive.uploadDriveFile({ content: '{}', linkedEntityType: 'export', linkedEntityId: 'e1', idempotencyKey: 'k1' }, USER, e.options);

  // Independent of the known fake values: walk every scalar in every row and reject credential shapes.
  const { REDACTION_PATTERNS } = await import('../services/diaspora/drive/driveVaultRegex.js');
  const offenders = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      for (const { name, pattern } of REDACTION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(node)) offenders.push(`${path}: ${name}`);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
    if (node && typeof node === 'object') { for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`); }
  };
  for (const [table, rows] of Object.entries(e.client._tables)) walk(rows, table);
  assert.deepEqual(offenders, [], `credential-shaped values found in: ${offenders.join(', ')}`);
});

test('ADVERSARIAL: the vault handle itself is never a credential, even under a hostile provider', async () => {
  const e = env({ google: hostileGoogle() });
  await connect(e);
  const { isOpaqueReference } = await import('../services/diaspora/drive/credentialVault.js');
  const handle = e.client._rows('diaspora_drive_connections')[0].credential_reference;
  assert.ok(isOpaqueReference(handle));
  assert.equal(e.client._rows('diaspora_credential_references')[0].vault_reference, handle);
  // And the handle reveals nothing about the secret it points at.
  assert.ok(!handle.includes(FAKE.refreshToken.slice(4, 20)));
});

test('ADVERSARIAL: an operator-supplied token cannot be smuggled in as a credential reference', async () => {
  // The inverse attack: not "does a token leak out" but "can a token be pushed in", where it would
  // then be a real credential sitting in a plainly-readable column.
  const { InMemoryCredentialVault: Vault } = await import('../services/diaspora/drive/credentialVault.js');
  const store = await import('../services/diaspora/drive/credentialReferenceStore.js');
  const client = createMockSupabase({ diaspora_credential_references: [] });
  void new Vault();
  for (const smuggled of [FAKE.refreshToken, FAKE.accessToken, FAKE.clientSecret, FAKE.apiKey, fakeJwt()]) {
    await assert.rejects(
      () => store.recordCredentialReference(client, {
        tenantId: TENANT, userId: 'u1', vaultBackend: 'env_dev', vaultReference: smuggled,
      }),
      (err) => err.code === 'VAULT_REFERENCE_REJECTED',
    );
  }
  assert.equal(client._rows('diaspora_credential_references').length, 0);
});
