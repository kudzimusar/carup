/**
 * Diaspora GTM Drive lane — the REAL Google provider, driven offline (Issue #127).
 *
 * Every test here runs the production `GoogleDriveProvider` and `GoogleOAuthClient` unmodified. The
 * only substitution is the socket: `createFakeGoogle` speaks Google's actual URLs, form encodings,
 * multipart framing and error envelopes, and enforces Google's actual rules (exact redirect match,
 * PKCE verification, bearer auth, revocation). So these are not "does my mock return what I told it
 * to" tests — they are tests of the wire contract, made deterministic.
 *
 * A `createDenyNetworkTransport` case at the end proves the suite is genuinely offline rather than
 * accidentally hitting the network on some path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { FAKE, createFakeGoogle, parseMultipartRelated } = await import('./helpers/googleDriveFixtures.js');
const { InMemoryCredentialVault, clearRegisteredSecrets, isOpaqueReference } = await import('../services/diaspora/drive/credentialVault.js');
const { GoogleDriveProvider, mapDriveError, escapeDriveQueryValue, assertScopesNotEscalated, DRIVE_API_BASE } =
  await import('../services/diaspora/drive/googleDriveProvider.js');
const {
  GoogleOAuthClient, createPkcePair, deriveCodeChallenge, assertExactRedirectUri,
  configuredRedirectUris, expiryFromSeconds, GOOGLE_TOKEN_ENDPOINT, GOOGLE_AUTH_ENDPOINT,
} = await import('../services/diaspora/drive/googleOAuthClient.js');
const { createDenyNetworkTransport, createStubTransport, createFetchTransport, HttpTransportError } =
  await import('../services/diaspora/drive/httpTransport.js');
const { DriveProviderError } = await import('../services/diaspora/drive/driveProvider.js');
const { DRIVE_SCOPES } = await import('../constants/diaspora/diasporaDriveConstants.js');

/** A provider wired to a fresh fake Google and a fresh vault. */
function build(options = {}) {
  const google = createFakeGoogle(options.google || {});
  const vault = new InMemoryCredentialVault();
  const provider = new GoogleDriveProvider({
    transport: google,
    vault,
    clientId: FAKE.clientId,
    clientSecret: FAKE.clientSecret,
    redirectUris: [FAKE.redirectUri],
    ...options.provider,
  });
  return { google, vault, provider };
}

/** Run the full authorize → callback handshake and return the connection facts. */
async function connect(env, { redirectUri = FAKE.redirectUri } = {}) {
  const pkce = createPkcePair();
  const url = env.provider.buildAuthorizationUrl('signed-state', DRIVE_SCOPES, { codeChallenge: pkce.codeChallenge });
  const code = env.google.issueAuthorizationCode({ codeChallenge: pkce.codeChallenge, redirectUri });
  const connection = await env.provider.exchangeAuthorizationCode(code, {
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: 'user-1',
  });
  return { pkce, url, code, connection };
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

test('PKCE pairs are S256, RFC-7636 sized, and never repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = createPkcePair();
    assert.equal(codeChallengeMethod, 'S256');
    assert.ok(codeVerifier.length >= 43 && codeVerifier.length <= 128, `verifier length ${codeVerifier.length}`);
    assert.match(codeVerifier, /^[A-Za-z0-9._~-]+$/, 'verifier must be RFC 7636 unreserved characters');
    assert.match(codeChallenge, /^[A-Za-z0-9_-]+$/, 'challenge must be base64url with no padding');
    assert.equal(deriveCodeChallenge(codeVerifier), codeChallenge);
    assert.ok(!seen.has(codeVerifier), 'verifiers must never repeat');
    seen.add(codeVerifier);
  }
});

test('the authorization URL carries the challenge, offline access and only the minimal scope', () => {
  const env = build();
  const pkce = createPkcePair();
  const url = new URL(env.provider.buildAuthorizationUrl('state-abc', DRIVE_SCOPES, { codeChallenge: pkce.codeChallenge }));
  assert.equal(`${url.origin}${url.pathname}`, GOOGLE_AUTH_ENDPOINT);
  assert.equal(url.searchParams.get('code_challenge'), pkce.codeChallenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state-abc');
  // Both are required to receive a refresh token; without them the connection dies within the hour.
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('redirect_uri'), FAKE.redirectUri);
  // The client secret must never appear in a URL the browser will follow.
  assert.ok(!url.toString().includes(FAKE.clientSecret));
});

test('the verifier is never sent to the browser — only the challenge is', () => {
  const env = build();
  const pkce = createPkcePair();
  const url = env.provider.buildAuthorizationUrl('state-abc', DRIVE_SCOPES, { codeChallenge: pkce.codeChallenge });
  assert.ok(!url.includes(pkce.codeVerifier), 'a verifier in the authorization URL defeats PKCE entirely');
});

test('authorization without a PKCE challenge is refused', () => {
  const env = build();
  assert.throws(() => env.provider.buildAuthorizationUrl('state', DRIVE_SCOPES, {}), (err) => {
    assert.equal(err.code, 'INVALID_REQUEST');
    return true;
  });
});

test('Google refuses the exchange when the verifier does not match the challenge', async () => {
  const env = build();
  const pkce = createPkcePair();
  const code = env.google.issueAuthorizationCode({ codeChallenge: pkce.codeChallenge });
  // An attacker who stole the code from the browser does not have the verifier.
  await assert.rejects(
    () => env.provider.exchangeAuthorizationCode(code, { codeVerifier: createPkcePair().codeVerifier, redirectUri: FAKE.redirectUri }),
    (err) => {
      assert.equal(err.code, 'REVOKED');
      return true;
    },
  );
  assert.equal(env.vault.size, 0, 'a failed exchange must not vault anything');
});

test('an authorization code cannot be redeemed twice', async () => {
  const env = build();
  const { pkce, code } = await connect(env);
  await assert.rejects(
    () => env.provider.exchangeAuthorizationCode(code, { codeVerifier: pkce.codeVerifier, redirectUri: FAKE.redirectUri }),
    (err) => err.code === 'REVOKED',
  );
});

// ── Redirect URI ─────────────────────────────────────────────────────────────

test('redirect URIs are matched byte-for-byte, with no prefix or slash tolerance', () => {
  const allowed = ['https://app.carup.test/api/diaspora/drive/google/callback'];
  assert.equal(assertExactRedirectUri(allowed[0], allowed), allowed[0]);
  for (const attack of [
    'https://app.carup.test/api/diaspora/drive/google/callback/',          // trailing slash
    'https://app.carup.test/api/diaspora/drive/google/callback?next=x',    // extra query
    'https://app.carup.test/api/diaspora/drive/google/callback/../../evil',
    'https://app.carup.test.evil.com/api/diaspora/drive/google/callback',  // suffix domain
    'https://evil.com/api/diaspora/drive/google/callback',
    'https://APP.carup.test/api/diaspora/drive/google/callback',           // case
    'https://app.carup.test:443/api/diaspora/drive/google/callback',       // explicit port
    'https://user@app.carup.test/api/diaspora/drive/google/callback',      // userinfo
  ]) {
    assert.throws(() => assertExactRedirectUri(attack, allowed), (err) => {
      assert.equal(err.code, 'REDIRECT_URI_MISMATCH');
      return true;
    }, `expected refusal for ${attack}`);
  }
});

test('structurally unsafe redirect URIs are refused before any allow-list comparison', () => {
  const allowed = ['https://app.carup.test/cb'];
  assert.throws(() => assertExactRedirectUri('https://app.carup.test/*', allowed), /Wildcard/);
  assert.throws(() => assertExactRedirectUri('http://app.carup.test/cb', allowed), /loopback/);
  assert.throws(() => assertExactRedirectUri('https://app.carup.test/cb#frag', allowed), /fragment/);
  assert.throws(() => assertExactRedirectUri('/relative/cb', allowed), /absolute URL/);
  assert.throws(() => assertExactRedirectUri('javascript:alert(1)', allowed), /absolute URL|http/);
  assert.throws(() => assertExactRedirectUri('', allowed), /required/);
  // Loopback plaintext stays available for local development.
  assert.equal(assertExactRedirectUri('http://localhost:5173/cb', ['http://localhost:5173/cb']), 'http://localhost:5173/cb');
  assert.equal(assertExactRedirectUri('http://127.0.0.1:5173/cb', ['http://127.0.0.1:5173/cb']), 'http://127.0.0.1:5173/cb');
});

test('an empty allow-list is NOT_CONFIGURED rather than "anything goes"', () => {
  assert.throws(() => assertExactRedirectUri('https://app.carup.test/cb', []), (err) => {
    assert.equal(err.code, 'NOT_CONFIGURED');
    return true;
  });
});

test('the exchange refuses a redirect URI that is not on the allow-list', async () => {
  const env = build();
  const pkce = createPkcePair();
  const code = env.google.issueAuthorizationCode({ codeChallenge: pkce.codeChallenge });
  await assert.rejects(
    () => env.provider.exchangeAuthorizationCode(code, { codeVerifier: pkce.codeVerifier, redirectUri: 'https://evil.com/cb' }),
    (err) => err.code === 'REDIRECT_URI_MISMATCH',
  );
  // The request never left the process — the check happens before the token call.
  assert.equal(env.google.calls.filter((c) => c.url.startsWith(GOOGLE_TOKEN_ENDPOINT)).length, 0);
});

test('configuredRedirectUris merges the single and multi env forms without duplicates', () => {
  const uris = configuredRedirectUris({
    GOOGLE_DRIVE_REDIRECT_URI: 'https://a.test/cb',
    GOOGLE_DRIVE_REDIRECT_URIS: 'https://a.test/cb, https://b.test/cb ,',
  });
  assert.deepEqual(uris, ['https://a.test/cb', 'https://b.test/cb']);
  assert.deepEqual(configuredRedirectUris({}), []);
});

// ── Token exchange over the real wire shapes ────────────────────────────────

test('the token request is a real form POST carrying code, verifier, secret and exact redirect', async () => {
  const env = build();
  const { pkce, code } = await connect(env);
  const call = env.google.calls.find((c) => c.url.startsWith(GOOGLE_TOKEN_ENDPOINT));
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), code);
  assert.equal(form.get('code_verifier'), pkce.codeVerifier);
  assert.equal(form.get('client_id'), FAKE.clientId);
  assert.equal(form.get('client_secret'), FAKE.clientSecret);
  assert.equal(form.get('redirect_uri'), FAKE.redirectUri);
});

test('a successful exchange returns an opaque handle and connection facts, never a token', async () => {
  const env = build();
  const { connection } = await connect(env);
  assert.ok(isOpaqueReference(connection.credentialReference));
  assert.equal(connection.providerAccountEmail, FAKE.accountEmail);
  assert.equal(connection.providerAccountId, FAKE.accountId);
  assert.deepEqual(connection.scopes, ['https://www.googleapis.com/auth/drive.file']);
  assert.equal(connection.vaultBackend, 'env_dev');
  assert.ok(Date.parse(connection.expiresAt) > Date.now());
  const json = JSON.stringify(connection);
  for (const secret of [FAKE.refreshToken, FAKE.accessToken, FAKE.clientSecret]) {
    assert.ok(!json.includes(secret), 'the exchange result must carry no token material');
  }
  // The refresh token is in the vault, and only there.
  assert.equal(env.vault.size, 1);
  assert.equal(JSON.parse((await env.vault.get(connection.credentialReference)).secret).refreshToken, FAKE.refreshToken);
});

test('an exchange that returns no refresh token fails loudly instead of persisting a doomed connection', async () => {
  const env = build({ google: { returnRefreshToken: false } });
  const pkce = createPkcePair();
  const code = env.google.issueAuthorizationCode({ codeChallenge: pkce.codeChallenge });
  await assert.rejects(
    () => env.provider.exchangeAuthorizationCode(code, { codeVerifier: pkce.codeVerifier, redirectUri: FAKE.redirectUri }),
    (err) => {
      assert.equal(err.code, 'NO_REFRESH_TOKEN');
      assert.match(err.message, /re-authorize with offline access/i);
      return true;
    },
  );
  assert.equal(env.vault.size, 0);
});

test('a scope Google granted beyond drive.file is refused rather than silently accepted', () => {
  assert.doesNotThrow(() => assertScopesNotEscalated(['https://www.googleapis.com/auth/drive.file']));
  assert.doesNotThrow(() => assertScopesNotEscalated(['https://www.googleapis.com/auth/drive.file', 'openid']));
  assert.throws(() => assertScopesNotEscalated(['https://www.googleapis.com/auth/drive']), (err) => {
    assert.equal(err.code, 'SCOPE_ESCALATION');
    assert.match(err.message, /broader Drive scopes/);
    return true;
  });
});

test('a bad client secret is reported as NOT_CONFIGURED, not as a user problem', async () => {
  const env = build({ provider: { clientSecret: 'wrong-secret' } });
  const pkce = createPkcePair();
  const code = env.google.issueAuthorizationCode({ codeChallenge: pkce.codeChallenge });
  await assert.rejects(
    () => env.provider.exchangeAuthorizationCode(code, { codeVerifier: pkce.codeVerifier, redirectUri: FAKE.redirectUri }),
    (err) => err.code === 'NOT_CONFIGURED',
  );
});

test('an unconfigured client fails closed at every entry point', async () => {
  const bare = new GoogleOAuthClient({ transport: createDenyNetworkTransport() });
  assert.equal(bare.configured, false);
  assert.throws(() => bare.buildAuthorizationUrl({ state: 's', scopes: DRIVE_SCOPES, codeChallenge: 'c' }), /not configured/i);
  await assert.rejects(() => bare.exchangeAuthorizationCode({ code: 'x', codeVerifier: 'y' }), /not configured/i);
  await assert.rejects(() => bare.refreshAccessToken({ refreshToken: 'x' }), /not configured/i);
});

// ── Refresh, expiry, rotation, revocation ───────────────────────────────────

test('refresh redeems the vaulted refresh token and returns only a new expiry', async () => {
  const env = build();
  const { connection } = await connect(env);
  const result = await env.provider.refreshAccessToken(connection.credentialReference);
  assert.equal(result.credentialReference, connection.credentialReference);
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.equal(result.rotated, false);
  assert.ok(!JSON.stringify(result).includes(FAKE.refreshToken));
  assert.ok(!JSON.stringify(result).includes(FAKE.accessToken));
  const call = env.google.calls.filter((c) => c.url.startsWith(GOOGLE_TOKEN_ENDPOINT)).at(-1);
  assert.equal(new URLSearchParams(call.body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(call.body).get('refresh_token'), FAKE.refreshToken);
});

test('a rotated refresh token is re-vaulted under the same handle and the old one stops working', async () => {
  const env = build({ google: { rotateRefreshTokenOnRefresh: true } });
  const { connection } = await connect(env);
  const result = await env.provider.refreshAccessToken(connection.credentialReference);
  assert.equal(result.rotated, true);
  const stored = JSON.parse((await env.vault.get(connection.credentialReference)).secret);
  assert.equal(stored.refreshToken, FAKE.rotatedRefreshToken);
  assert.equal(env.vault.size, 1, 'rotation must not leave the superseded secret behind');
  // The next refresh uses the rotated value, proving the handle really was updated in place.
  await env.provider.refreshAccessToken(connection.credentialReference);
  const call = env.google.calls.filter((c) => c.url.startsWith(GOOGLE_TOKEN_ENDPOINT)).at(-1);
  assert.equal(new URLSearchParams(call.body).get('refresh_token'), FAKE.rotatedRefreshToken);
});

test('an expired access token is refreshed transparently mid-operation', async () => {
  const env = build();
  const { connection } = await connect(env);
  await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  const refreshesBefore = env.google.state.refreshCount;

  env.google.expireAccessTokens(); // Google now 401s the cached token, but the grant is still good
  const folder = await env.provider.ensureFolder(connection.credentialReference, 'Buyer Orders', null);
  assert.ok(folder.folderId, 'the operation should succeed after a transparent refresh');
  assert.equal(env.google.state.refreshCount, refreshesBefore + 1, 'exactly one refresh, not a loop');
});

test('a 401 retry happens at most once and then surfaces as REVOKED', async () => {
  const env = build();
  const { connection } = await connect(env);
  env.google.revokeAtGoogle(); // the user revoked in their Google account: refresh will fail too
  await assert.rejects(
    () => env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null),
    (err) => {
      assert.ok(err instanceof DriveProviderError);
      assert.equal(err.code, 'REVOKED');
      assert.match(err.message, /revoked|reconnect/i);
      return true;
    },
  );
});

test('revoke tells Google and destroys the vault entry', async () => {
  const env = build();
  const { connection } = await connect(env);
  const result = await env.provider.revoke(connection.credentialReference);
  assert.equal(result.revoked, true);
  assert.equal(result.remoteRevoked, true);
  assert.equal(env.vault.size, 0, 'a disconnect must not leave a live refresh token in the vault');
  const call = env.google.calls.find((c) => c.url.includes('/revoke'));
  assert.equal(new URLSearchParams(call.body).get('token'), FAKE.refreshToken);
});

test('revoke still destroys the local secret when Google is unreachable', async () => {
  const env = build();
  const { connection } = await connect(env);
  env.google.failNext({ urlMatch: /\/revoke/, throwError: new HttpTransportError('socket hang up', 'TRANSPORT_UNREACHABLE') });
  const result = await env.provider.revoke(connection.credentialReference);
  assert.equal(result.revoked, true);
  assert.equal(result.remoteRevoked, false);
  assert.ok(result.remoteError, 'the upstream failure is reported, not hidden');
  // Leaving a live refresh token behind after the user pressed disconnect is the worse failure.
  assert.equal(env.vault.size, 0);
});

test('revoking twice is safe and reports the already-invalid case as success', async () => {
  const env = build();
  const { connection } = await connect(env);
  await env.provider.revoke(connection.credentialReference);
  const second = await env.provider.revoke(connection.credentialReference);
  assert.equal(second.revoked, true);
});

test('a credential missing from the vault is REVOKED, not a crash', async () => {
  const env = build();
  await assert.rejects(
    () => env.provider.refreshAccessToken('memvault://google_drive/never-existed'),
    (err) => {
      assert.equal(err.code, 'REVOKED');
      assert.match(err.message, /Reconnect required/);
      return true;
    },
  );
});

// ── Drive API request shapes ────────────────────────────────────────────────

test('ensureFolder searches with a real Drive query, then creates only if missing', async () => {
  const env = build();
  const { connection } = await connect(env);
  const created = await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  assert.equal(created.created, true);
  assert.ok(created.folderId);
  assert.ok(created.folderUrl);

  const search = env.google.calls.find((c) => c.method === 'GET' && c.url.includes('/drive/v3/files?'));
  const q = new URL(search.url).searchParams.get('q');
  assert.match(q, /name='CarUp Trade'/);
  assert.match(q, /mimeType='application\/vnd\.google-apps\.folder'/);
  // Without trashed=false a deleted folder still matches and every upload lands in the bin.
  assert.match(q, /trashed=false/);

  const again = await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  assert.equal(again.created, false, 'a second call must find the existing folder');
  assert.equal(again.folderId, created.folderId);
  assert.equal(env.google.state.folders.size, 1, 'no duplicate folder was created');
});

test('a nested folder is scoped by parent in the query', async () => {
  const env = build();
  const { connection } = await connect(env);
  const root = await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  await env.provider.ensureFolder(connection.credentialReference, 'Buyer Orders', root.folderId);
  const search = env.google.calls.filter((c) => c.method === 'GET' && c.url.includes('/drive/v3/files?')).at(-1);
  assert.match(new URL(search.url).searchParams.get('q'), new RegExp(`'${root.folderId}' in parents`));
});

test("a folder name containing a quote cannot break out of the Drive query", () => {
  assert.equal(escapeDriveQueryValue("O'Brien"), "O\\'Brien");
  assert.equal(escapeDriveQueryValue("a\\b"), 'a\\\\b');
  // The injection attempt becomes an escaped literal rather than extra query clauses.
  assert.equal(escapeDriveQueryValue("x' or name!='"), "x\\' or name!=\\'");
});

test('upload sends a real multipart/related body Google can parse', async () => {
  const env = build();
  const { connection } = await connect(env);
  const folder = await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  const content = JSON.stringify({ order: 'ord-1', total: 1000 }, null, 2);
  const uploaded = await env.provider.uploadFile(connection.credentialReference, {
    name: 'order-ord-1.json', content, folderId: folder.folderId, mimeType: 'application/json',
  });

  assert.ok(uploaded.fileId);
  assert.equal(uploaded.name, 'order-ord-1.json');
  assert.equal(uploaded.bytes, Buffer.byteLength(content));
  assert.match(uploaded.fileUrl, /^https:\/\/drive\.google\.com\//);

  const call = env.google.calls.find((c) => c.url.includes('/upload/drive/v3/files'));
  assert.match(call.headers['content-type'], /^multipart\/related; boundary=/);
  assert.equal(new URL(call.url).searchParams.get('uploadType'), 'multipart');
  const parsed = parseMultipartRelated(call.headers['content-type'], call.body);
  assert.equal(parsed.metadata.name, 'order-ord-1.json');
  assert.deepEqual(parsed.metadata.parents, [folder.folderId]);
  assert.equal(parsed.content, content, 'the bytes on the wire must be exactly the bytes we were given');
});

test('the recorded sha256 is over the bytes actually sent, and Google md5 is kept as a cross-check', async () => {
  const env = build();
  const { connection } = await connect(env);
  const content = 'checksum-subject';
  const uploaded = await env.provider.uploadFile(connection.credentialReference, { name: 'c.json', content });
  const crypto = await import('node:crypto');
  assert.equal(uploaded.checksum, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(uploaded.providerMd5, crypto.createHash('md5').update(content).digest('hex'));
});

test('binary content survives the multipart framing byte-for-byte', async () => {
  const env = build();
  const { connection } = await connect(env);
  const content = Buffer.from('line1\r\n--not-a-boundary\r\nline2', 'utf8');
  const uploaded = await env.provider.uploadFile(connection.credentialReference, { name: 'b.txt', content, mimeType: 'text/plain' });
  assert.equal(env.google.state.files.get(uploaded.fileId).content, content.toString('utf8'));
});

test('getMetadata asks for the fields we actually use and maps them', async () => {
  const env = build();
  const { connection } = await connect(env);
  const uploaded = await env.provider.uploadFile(connection.credentialReference, { name: 'm.json', content: '{}' });
  const meta = await env.provider.getMetadata(connection.credentialReference, uploaded.fileId);
  assert.equal(meta.fileId, uploaded.fileId);
  assert.equal(meta.name, 'm.json');
  assert.equal(meta.trashed, false);
  const call = env.google.calls.filter((c) => c.url.includes(`/drive/v3/files/${uploaded.fileId}`)).at(-1);
  assert.match(new URL(call.url).searchParams.get('fields'), /md5Checksum/);
});

test('a missing file is NOT_FOUND rather than a generic failure', async () => {
  const env = build();
  const { connection } = await connect(env);
  await assert.rejects(
    () => env.provider.getMetadata(connection.credentialReference, 'no-such-file'),
    (err) => err.code === 'NOT_FOUND',
  );
});

test('every Drive call carries a bearer token and no other credential', async () => {
  const env = build();
  const { connection } = await connect(env);
  await env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null);
  const driveCalls = env.google.calls.filter((c) => c.url.startsWith('https://www.googleapis.com/'));
  assert.ok(driveCalls.length >= 2);
  for (const call of driveCalls) {
    assert.match(call.headers.authorization, /^Bearer ya2/, 'Drive calls must be bearer-authenticated');
    // The client secret belongs to the token endpoint only. It must never ride along on API calls.
    assert.ok(!JSON.stringify(call.headers).includes(FAKE.clientSecret));
    assert.ok(!call.url.includes(FAKE.clientSecret));
    assert.ok(!call.url.includes('access_token='), 'a token in a URL ends up in access logs');
  }
});

// ── Error mapping ────────────────────────────────────────────────────────────

test('Drive error statuses map to distinct codes with the right retryability', () => {
  const cases = [
    [{ status: 401, body: {} }, 'REVOKED', false],
    [{ status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } }, 'RATE_LIMITED', true],
    [{ status: 403, body: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } }, 'RATE_LIMITED', true],
    [{ status: 403, body: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } }, 'QUOTA_EXCEEDED', false],
    [{ status: 403, body: { error: { errors: [{ reason: 'insufficientFilePermissions' }] } } }, 'INSUFFICIENT_SCOPE', false],
    [{ status: 403, body: { error: { errors: [{ reason: 'appNotAuthorizedToFile' }] } } }, 'INSUFFICIENT_SCOPE', false],
    [{ status: 403, body: {} }, 'FORBIDDEN', false],
    [{ status: 404, body: {} }, 'NOT_FOUND', false],
    [{ status: 429, body: {} }, 'RATE_LIMITED', true],
    [{ status: 500, body: {} }, 'PROVIDER_UNAVAILABLE', true],
    [{ status: 503, body: {} }, 'PROVIDER_UNAVAILABLE', true],
    [{ status: 400, body: {} }, 'INVALID_REQUEST', false],
  ];
  for (const [response, code, retryable] of cases) {
    const err = mapDriveError(response);
    assert.equal(err.code, code, `status ${response.status} → ${code}`);
    assert.equal(err.retryable, retryable, `status ${response.status} retryable=${retryable}`);
  }
});

test('a rate limit is NOT treated as a revocation (the account must not be disconnected)', () => {
  const rateLimited = mapDriveError({ status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } });
  assert.notEqual(rateLimited.code, 'REVOKED');
  assert.equal(rateLimited.retryable, true);
});

test('Retry-After is carried through so backoff can honour the provider hint', () => {
  const err = mapDriveError({ status: 429, headers: { 'retry-after': '30' }, body: {} });
  assert.equal(err.retryAfterMs, 30_000);
});

test('provider errors never leak raw upstream text, stacks or tokens', async () => {
  const env = build();
  const { connection } = await connect(env);
  env.google.failNext({
    urlMatch: /drive\/v3/,
    // A hostile upstream that echoes the caller's own bearer token back in the error body.
    respond: () => ({ status: 403, body: { error: { code: 403, message: `denied for ${FAKE.accessToken}`, errors: [{ reason: 'forbidden' }] } } }),
  });
  await assert.rejects(
    () => env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null),
    (err) => {
      assert.ok(!err.message.includes(FAKE.accessToken));
      assert.ok(!err.message.includes(FAKE.refreshToken));
      assert.doesNotMatch(err.message, /node_modules|at Object|\/Users\//);
      return true;
    },
  );
});

test('a transport-level failure is retryable and carries no request material', async () => {
  const env = build();
  const { connection } = await connect(env);
  env.google.failNext({ urlMatch: /drive\/v3/, throwError: new HttpTransportError('ECONNRESET on 10.0.0.1:443', 'TRANSPORT_UNREACHABLE') });
  await assert.rejects(
    () => env.provider.ensureFolder(connection.credentialReference, 'CarUp Trade', null),
    (err) => {
      assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(err.retryable, true);
      assert.ok(!err.message.includes('10.0.0.1'));
      return true;
    },
  );
});

// ── The transport itself ─────────────────────────────────────────────────────

test('the fetch transport returns non-2xx as data and only throws on transport failure', async () => {
  const transport = createFetchTransport({
    fetchImpl: async () => ({ status: 503, headers: new Map([['content-type', 'application/json']]), text: async () => '{"error":"nope"}' }),
  });
  const response = await transport.request({ url: 'https://example.test' });
  assert.equal(response.status, 503, 'HTTP errors are data; the provider decides what they mean');
  assert.deepEqual(response.body, { error: 'nope' });

  const failing = createFetchTransport({ fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  await assert.rejects(() => failing.request({ url: 'https://example.test' }), (err) => {
    assert.equal(err.code, 'TRANSPORT_UNREACHABLE');
    assert.equal(err.retryable, true);
    return true;
  });
});

test('the fetch transport aborts rather than hanging forever', async () => {
  const transport = createFetchTransport({
    timeoutMs: 10,
    fetchImpl: (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  await assert.rejects(() => transport.request({ url: 'https://example.test' }), (err) => {
    assert.equal(err.code, 'TRANSPORT_TIMEOUT');
    return true;
  });
});

test('the stub transport refuses unmatched routes instead of inventing a response', async () => {
  const stub = createStubTransport([{ url: 'https://a.test', respond: { status: 200, body: { ok: true } } }]);
  assert.equal((await stub.request({ url: 'https://a.test/x' })).body.ok, true);
  await assert.rejects(() => stub.request({ url: 'https://b.test' }), /No stub route matched/);
});

test('this suite is genuinely offline: a deny transport proves no path reaches the network', async () => {
  const provider = new GoogleDriveProvider({
    transport: createDenyNetworkTransport(),
    vault: new InMemoryCredentialVault(),
    clientId: FAKE.clientId,
    clientSecret: FAKE.clientSecret,
    redirectUris: [FAKE.redirectUri],
  });
  const pkce = createPkcePair();
  // URL building is pure and must still work with no network at all.
  assert.match(provider.buildAuthorizationUrl('s', DRIVE_SCOPES, { codeChallenge: pkce.codeChallenge }), /^https:\/\/accounts\.google\.com/);
  await assert.rejects(
    () => provider.exchangeAuthorizationCode('code', { codeVerifier: pkce.codeVerifier, redirectUri: FAKE.redirectUri }),
    (err) => {
      assert.match(err.message, /Network access is not permitted|Drive request failed/);
      return true;
    },
  );
});

test('expiryFromSeconds defaults to Google\'s hour and honours what was returned', () => {
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  assert.equal(expiryFromSeconds(3599, now), '2026-07-27T00:59:59.000Z');
  assert.equal(expiryFromSeconds(undefined, now), '2026-07-27T01:00:00.000Z');
  assert.equal(expiryFromSeconds('not-a-number', now), '2026-07-27T01:00:00.000Z');
});

test('the Drive API base is the documented v3 endpoint', () => {
  assert.equal(DRIVE_API_BASE, 'https://www.googleapis.com/drive/v3');
  clearRegisteredSecrets();
});
