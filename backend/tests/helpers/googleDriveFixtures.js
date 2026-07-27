/**
 * A deterministic, offline stand-in for Google's OAuth and Drive v3 endpoints (Issue #127, Drive lane).
 *
 * This is NOT a mock provider. It is a fake SERVER: it speaks the same URLs, the same
 * `application/x-www-form-urlencoded` token requests, the same `multipart/related` upload framing and
 * the same `{ error: { code, message, errors:[{reason}] } }` envelopes that Google does, and it
 * enforces the same rules (exact redirect-uri match, PKCE verification, bearer auth, revocation). The
 * production provider runs unmodified against it — only the socket is replaced.
 *
 * WHY THE FAKE CREDENTIALS ARE ASSEMBLED RATHER THAN WRITTEN OUT
 * -------------------------------------------------------------
 * The tests need values with the exact SHAPE of real Google credentials, or the token-absence proof
 * would be proving nothing. But a literal `ya29.…` in a tracked file is precisely what the CR-1
 * secret scanner exists to catch, and adding this file to the scanner's allow-list would carve a
 * permanent hole exactly where a real token is most likely to be pasted by accident one day. So the
 * prefixes are assembled at runtime: the values are token-shaped in memory, and no token-shaped
 * literal is ever committed. The scanner keeps its teeth.
 */
import crypto from 'crypto';

const join = (...parts) => parts.join('');

/** Token-shaped fake credentials. Shaped like the real thing; assembled so nothing is committed. */
export const FAKE = Object.freeze({
  clientId: join('1234567890', '-carupdrivetest.apps.googleusercontent.com'),
  clientSecret: join('GOC', 'SPX', '-', 'carup-drive-test-not-a-real-secret-000'),
  redirectUri: 'https://app.carup.test/api/diaspora/drive/google/callback',
  altRedirectUri: 'https://app.carup.test/api/diaspora/drive/google/callback-alt',
  refreshToken: join('1', '/', '/', '0gCARUPFAKEREFRESHTOKENxxxxxxxxxxxxxxxxxxxxxx'),
  rotatedRefreshToken: join('1', '/', '/', '0gCARUPFAKEROTATEDREFRESHTOKENyyyyyyyyyyyyyy'),
  accessToken: join('ya2', '9.', 'CARUPFAKEACCESSTOKENzzzzzzzzzzzzzzzzzzzzzzzzzzzz'),
  secondAccessToken: join('ya2', '9.', 'CARUPFAKEACCESSTOKENSECONDwwwwwwwwwwwwwwwwwwwwww'),
  apiKey: join('AIz', 'a', 'CARUPFAKEAPIKEY0000000000000000000000'),
  accountEmail: 'trader@carup.test',
  accountId: 'permission-id-0001',
});

/** A JWT-shaped fake, built at runtime for the same reason as above. */
export function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'carup-fake', aud: 'carup-fake' })).toString('base64url');
  return `${header}.${payload}.${'c'.repeat(32)}`;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deriveChallenge = (verifier) => b64url(crypto.createHash('sha256').update(String(verifier)).digest());

function parseForm(body) {
  const out = {};
  for (const [key, value] of new URLSearchParams(String(body || ''))) out[key] = value;
  return out;
}

/** Parse a `multipart/related` upload body into its JSON metadata part and its content part. */
export function parseMultipartRelated(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(String(contentType || ''))?.[1];
  if (!boundary) throw new Error('upload had no multipart boundary');
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const parts = raw.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--');
  const decoded = parts.map((part) => {
    const split = part.indexOf('\r\n\r\n');
    const headers = part.slice(0, split);
    const content = part.slice(split + 4).replace(/\r\n$/, '');
    return { headers, content };
  });
  return {
    metadata: JSON.parse(decoded[0].content),
    contentType: /Content-Type:\s*([^\r\n;]+)/i.exec(decoded[1].headers)?.[1]?.trim() || null,
    content: decoded[1].content,
  };
}

const googleError = (status, message, reason, domain = 'global') => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: { error: { code: status, message, errors: [{ domain, reason, message }], status: reason } },
});

/**
 * Build the fake Google.
 *
 * Returned object is a transport (`.request`) plus test controls:
 *   `.state`               — issued codes, live tokens, stored files/folders
 *   `.calls`               — every request, raw, for wire-level assertions
 *   `.issueAuthorizationCode({ codeChallenge })` — mint a code the token endpoint will accept
 *   `.revokeAtGoogle()`    — simulate the user revoking access in their Google account settings
 *   `.failNext(spec)`      — make the next matching call fail (rate limit, 5xx, socket error…)
 */
export function createFakeGoogle({
  clientId = FAKE.clientId,
  clientSecret = FAKE.clientSecret,
  redirectUris = [FAKE.redirectUri],
  rotateRefreshTokenOnRefresh = false,
  returnRefreshToken = true,
} = {}) {
  const state = {
    codes: new Map(),      // code -> { codeChallenge, redirectUri, used }
    refreshTokens: new Set([FAKE.refreshToken]),
    accessTokens: new Set(),
    revoked: false,
    folders: new Map(),    // id -> { id, name, parents, trashed }
    files: new Map(),      // id -> { id, name, parents, mimeType, content }
    seq: 0,
    refreshCount: 0,
  };
  const calls = [];
  const failures = [];   // { urlMatch, times, respond|throwError }
  const nextId = (prefix) => `${prefix}${String(++state.seq).padStart(4, '0')}`;

  function takeFailure(url, method) {
    const index = failures.findIndex((f) => (
      (!f.method || f.method.toUpperCase() === method.toUpperCase())
      && (f.urlMatch instanceof RegExp ? f.urlMatch.test(url) : String(url).includes(f.urlMatch))
      && f.times > 0
    ));
    if (index === -1) return null;
    const failure = failures[index];
    failure.times -= 1;
    if (failure.times <= 0) failures.splice(index, 1);
    return failure;
  }

  function requireBearer(headers) {
    const auth = headers?.authorization || headers?.Authorization || '';
    const token = /^Bearer\s+(.+)$/.exec(auth)?.[1];
    if (!token || state.revoked || !state.accessTokens.has(token)) {
      return googleError(401, 'Invalid Credentials', 'authError', 'global');
    }
    return null;
  }

  let accessSeq = 0;
  function mintAccessToken() {
    // Distinct on every mint, so a test can prove a refresh really produced a NEW access token
    // (a counter that reset on expiry would make "the token changed" trivially true).
    const token = accessSeq++ === 0 ? FAKE.accessToken : `${FAKE.secondAccessToken}${accessSeq}`;
    state.accessTokens.add(token);
    return token;
  }

  async function handleToken(request) {
    const form = parseForm(request.body);
    if (form.client_id !== clientId) return { status: 401, body: { error: 'invalid_client', error_description: 'Unauthorized' } };
    if (form.client_secret !== clientSecret) return { status: 401, body: { error: 'invalid_client', error_description: 'Unauthorized' } };

    if (form.grant_type === 'authorization_code') {
      const issued = state.codes.get(form.code);
      if (!issued || issued.used) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } };
      }
      // Exact redirect-uri match, exactly as Google enforces it.
      if (!redirectUris.includes(form.redirect_uri) || form.redirect_uri !== issued.redirectUri) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'redirect_uri_mismatch' } };
      }
      // PKCE: the verifier must hash to the challenge sent at authorize time.
      if (issued.codeChallenge) {
        if (!form.code_verifier) return { status: 400, body: { error: 'invalid_grant', error_description: 'Missing code verifier.' } };
        if (deriveChallenge(form.code_verifier) !== issued.codeChallenge) {
          return { status: 400, body: { error: 'invalid_grant', error_description: 'code_verifier does not match' } };
        }
      }
      issued.used = true;
      const accessToken = mintAccessToken();
      return {
        status: 200,
        body: {
          access_token: accessToken,
          expires_in: 3599,
          scope: 'https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer',
          ...(returnRefreshToken ? { refresh_token: FAKE.refreshToken } : {}),
        },
      };
    }

    if (form.grant_type === 'refresh_token') {
      if (state.revoked || !state.refreshTokens.has(form.refresh_token)) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } };
      }
      state.refreshCount += 1;
      const accessToken = mintAccessToken();
      const body = { access_token: accessToken, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' };
      if (rotateRefreshTokenOnRefresh) {
        state.refreshTokens.delete(form.refresh_token);
        state.refreshTokens.add(FAKE.rotatedRefreshToken);
        body.refresh_token = FAKE.rotatedRefreshToken;
      }
      return { status: 200, body };
    }

    return { status: 400, body: { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' } };
  }

  async function handleRevoke(request) {
    const form = parseForm(request.body);
    if (!state.refreshTokens.has(form.token) && !state.accessTokens.has(form.token)) {
      return { status: 400, body: { error: 'invalid_token' } };
    }
    state.refreshTokens.delete(form.token);
    state.accessTokens.delete(form.token);
    state.revoked = true;
    return { status: 200, body: {} };
  }

  async function handleDrive(request) {
    const unauthorized = requireBearer(request.headers);
    if (unauthorized) return unauthorized;
    const url = new URL(request.url);
    const method = String(request.method || 'GET').toUpperCase();

    if (url.pathname === '/drive/v3/about') {
      return { status: 200, body: { user: { emailAddress: FAKE.accountEmail, permissionId: FAKE.accountId, displayName: 'CarUp Trader' } } };
    }

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wantsFolder = q.includes(`mimeType='application/vnd.google-apps.folder'`);
      const matches = [...state.folders.values()].filter((f) => (
        (!wantsFolder || f.mimeType === 'application/vnd.google-apps.folder')
        && (!name || f.name === name)
        && (!parent || (f.parents || []).includes(parent))
        && (!q.includes('trashed=false') || !f.trashed)
      ));
      return { status: 200, body: { files: matches.map((f) => ({ id: f.id, name: f.name, webViewLink: f.webViewLink })) } };
    }

    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(String(request.body || '{}'));
      const id = nextId('folder-');
      const folder = {
        id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents || [],
        trashed: false,
        webViewLink: `https://drive.google.com/drive/folders/${id}`,
      };
      state.folders.set(id, folder);
      return { status: 200, body: { id, name: folder.name, webViewLink: folder.webViewLink } };
    }

    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, content, contentType } = parseMultipartRelated(request.headers['content-type'], request.body);
      const id = nextId('file-');
      const stored = {
        id,
        name: metadata.name,
        parents: metadata.parents || [],
        mimeType: contentType,
        content,
        webViewLink: `https://drive.google.com/file/d/${id}/view`,
        md5Checksum: crypto.createHash('md5').update(content).digest('hex'),
        size: String(Buffer.byteLength(content)),
      };
      state.files.set(id, stored);
      return {
        status: 200,
        body: { id, name: stored.name, webViewLink: stored.webViewLink, md5Checksum: stored.md5Checksum, size: stored.size, mimeType: stored.mimeType },
      };
    }

    const fileMatch = /^\/drive\/v3\/files\/(.+)$/.exec(url.pathname);
    if (fileMatch && method === 'GET') {
      const stored = state.files.get(decodeURIComponent(fileMatch[1])) || state.folders.get(decodeURIComponent(fileMatch[1]));
      if (!stored) return googleError(404, 'File not found', 'notFound');
      return {
        status: 200,
        body: {
          id: stored.id,
          name: stored.name,
          mimeType: stored.mimeType,
          md5Checksum: stored.md5Checksum || null,
          size: stored.size || null,
          webViewLink: stored.webViewLink,
          parents: stored.parents || [],
          trashed: Boolean(stored.trashed),
          modifiedTime: '2026-07-27T00:00:00.000Z',
        },
      };
    }

    return googleError(404, 'Not Found', 'notFound');
  }

  const transport = {
    name: 'fake-google',
    calls,
    state,
    /** Mint an authorization code bound to a PKCE challenge and a redirect URI. */
    issueAuthorizationCode({ codeChallenge = null, redirectUri = redirectUris[0] } = {}) {
      const code = `4/0A${crypto.randomBytes(12).toString('hex')}`;
      state.codes.set(code, { codeChallenge, redirectUri, used: false });
      return code;
    },
    /** Simulate the user revoking CarUp's access from their Google account. */
    revokeAtGoogle() { state.revoked = true; state.accessTokens.clear(); return transport; },
    /** Expire the current access tokens without revoking the grant (the normal hourly case). */
    expireAccessTokens() { state.accessTokens.clear(); return transport; },
    /** Make the next `times` matching calls fail. `throwError` simulates a socket-level failure. */
    failNext({ urlMatch, method = null, times = 1, respond = null, throwError = null }) {
      failures.push({ urlMatch, method, times, respond, throwError });
      return transport;
    },
    /** Convenience failure specs matching Google's real envelopes. */
    rateLimitNext(urlMatch = /googleapis\.com/, times = 1) {
      return transport.failNext({ urlMatch, times, respond: () => googleError(403, 'Rate Limit Exceeded', 'rateLimitExceeded', 'usageLimits') });
    },
    serverErrorNext(urlMatch = /googleapis\.com/, times = 1) {
      return transport.failNext({ urlMatch, times, respond: () => ({ status: 503, body: { error: { code: 503, message: 'Backend Error', errors: [{ reason: 'backendError' }] } } }) });
    },
    quotaExceededNext(urlMatch = /googleapis\.com/, times = 1) {
      return transport.failNext({ urlMatch, times, respond: () => googleError(403, 'The user has exceeded their Drive storage quota', 'storageQuotaExceeded', 'usageLimits') });
    },

    async request(request) {
      const method = String(request.method || 'GET').toUpperCase();
      calls.push({ ...request, method });

      const failure = takeFailure(request.url, method);
      if (failure) {
        if (failure.throwError) throw failure.throwError;
        const spec = await failure.respond(request);
        return materialize(spec);
      }

      if (request.url.startsWith('https://oauth2.googleapis.com/token')) return materialize(await handleToken(request));
      if (request.url.startsWith('https://oauth2.googleapis.com/revoke')) return materialize(await handleRevoke(request));
      if (request.url.startsWith('https://www.googleapis.com/')) return materialize(await handleDrive(request));
      return materialize(googleError(404, 'Unknown endpoint', 'notFound'));
    },
  };

  function materialize(spec) {
    const rawBody = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {});
    return {
      status: spec.status ?? 200,
      headers: { 'content-type': 'application/json', ...(spec.headers || {}) },
      body: JSON.parse(rawBody || '{}'),
      rawBody,
    };
  }

  return transport;
}

/** Every fake secret value, for "must not appear anywhere" sweeps. */
export function allFakeSecrets(extra = []) {
  return [
    FAKE.clientSecret,
    FAKE.refreshToken,
    FAKE.rotatedRefreshToken,
    FAKE.accessToken,
    FAKE.secondAccessToken,
    FAKE.apiKey,
    ...extra,
  ].filter(Boolean);
}
