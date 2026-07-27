/**
 * A deterministic, offline stand-in for Google Secret Manager and Google's OAuth token endpoint
 * (Issue #127, Phase 2D).
 *
 * This is NOT a mock vault. It is a fake SERVER: it speaks the real
 * `https://secretmanager.googleapis.com/v1` paths, the real `?secretId=` create form, the real
 * `:addVersion` / `:access` / `:destroy` custom verbs, real base64 payloads with a real CRC32C, and
 * the real `{ error: { code, message, status } }` envelope. It enforces the rules Google enforces —
 * bearer auth, ALREADY_EXISTS on a duplicate id, NOT_FOUND on a deleted secret, FAILED_PRECONDITION
 * on destroying an already-destroyed version — and it verifies the RS256 service-account assertion
 * with the matching public key rather than waving it through. The production vault runs against it
 * unmodified; only the socket is replaced.
 *
 * NOTHING TOKEN-SHAPED IS COMMITTED
 * ---------------------------------
 * Access tokens are minted at runtime with a `ya29.`-shaped prefix assembled from fragments, exactly
 * as `googleDriveFixtures.js` does and for the same reason: a literal `ya29.…` in a tracked file is
 * what the CR-1 scanner exists to catch, and allow-listing a test file carves a permanent hole
 * precisely where a real token will one day be pasted by accident.
 */
import crypto from 'crypto';

const join = (...parts) => parts.join('');

/**
 * Reused across the whole test run — RSA keygen costs a few hundred milliseconds and nothing depends
 * on a fresh key. `fresh: true` opts out, which the wrong-key test needs: sharing the cached pair
 * would make "signed with the wrong key" quietly become "signed with the right key", and the
 * rejection it asserts would never happen.
 */
let cachedKeyPair = null;
function keyPair(fresh = false) {
  const generate = () => crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  if (fresh) return generate();
  if (!cachedKeyPair) cachedKeyPair = generate();
  return cachedKeyPair;
}

/** A service-account key file with the real field names and a real RSA key. */
export function fakeServiceAccount({
  projectId = 'carup-vault-test',
  clientEmail = 'carup-vault@carup-vault-test.iam.gserviceaccount.com',
  fresh = false,
} = {}) {
  const { privateKey, publicKey } = keyPair(fresh);
  return {
    key: {
      type: 'service_account',
      project_id: projectId,
      private_key_id: 'fake-key-id-0001',
      private_key: privateKey,
      client_email: clientEmail,
      client_id: '000000000000000000000',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
    publicKey,
  };
}

/** Token-shaped, assembled at runtime so no token-shaped literal is committed. */
export function mintAccessToken(seq = 1) {
  return join('ya2', '9.', 'CARUPFAKEVAULTACCESSTOKEN', String(seq).padStart(4, '0'), 'aaaaaaaaaaaaaaaaaaaa');
}

const CRC32C_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
    table[i] = crc;
  }
  return table;
})();
function crc32c(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Mirror the production transport exactly: serialize, then re-parse, so the code sees the real path. */
function respond(status, body, headers = { 'content-type': 'application/json' }) {
  const rawBody = body === undefined || body === null ? '' : JSON.stringify(body);
  let parsed = null;
  if (rawBody) { try { parsed = JSON.parse(rawBody); } catch { parsed = rawBody; } }
  return { status, headers, body: parsed, rawBody };
}

function googleError(status, code, message) {
  return respond(code, { error: { code, message, status } });
}

/**
 * @param {object} options
 * @param {string} [options.projectId]
 * @param {object} [options.serviceAccount] the key whose public half verifies the JWT assertion
 * @param {boolean} [options.requireAuth=true]
 */
export function createFakeSecretManager({
  projectId = 'carup-vault-test',
  serviceAccount = null,
  publicKey = null,
  requireAuth = true,
} = {}) {
  /** secretId -> { labels, replication, versions: [{ number, data, state }] } */
  const secrets = new Map();
  const calls = [];
  const issuedTokens = [];
  let tokenSeq = 0;
  let failNext = null;   // { match: RegExp, response }
  let clockMs = Date.UTC(2026, 6, 31, 9, 0, 0);

  function verifyAssertion(assertion) {
    const parts = String(assertion || '').split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed assertion' };
    const [header, claims, signature] = parts;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    verifier.end();
    const pub = publicKey || serviceAccount?.publicKey;
    if (!pub) return { ok: false, reason: 'no public key configured in the fixture' };
    let valid = false;
    try { valid = verifier.verify(pub, Buffer.from(signature, 'base64url')); } catch { valid = false; }
    if (!valid) return { ok: false, reason: 'signature did not verify' };
    let decoded;
    try { decoded = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')); } catch {
      return { ok: false, reason: 'claims not JSON' };
    }
    return { ok: true, claims: decoded, header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) };
  }

  function bearerOf(headers) {
    const value = headers?.authorization || headers?.Authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(value));
    return match ? match[1] : null;
  }

  const api = {
    name: 'fake-secret-manager',
    calls,
    secrets,
    issuedTokens,
    /** Test seams. */
    advanceClock(ms) { clockMs += ms; return clockMs; },
    now() { return clockMs; },
    failNextMatching(match, response) { failNext = { match, response }; },
    /** Everything currently stored, decoded — used to prove what a leak WOULD look like. */
    storedPayloads() {
      const out = [];
      for (const [id, secret] of secrets) {
        for (const version of secret.versions) {
          out.push({ secretId: id, version: version.number, state: version.state, data: version.data });
        }
      }
      return out;
    },

    async request(request) {
      const { method = 'GET', url, headers = {}, body = null } = request;
      calls.push({ method, url, headers: { ...headers }, body });

      if (failNext && failNext.match.test(url)) {
        const response = failNext.response;
        failNext = null;
        if (response instanceof Error) throw response;
        return respond(response.status, response.body);
      }

      // ── Google's OAuth token endpoint (service-account JWT-bearer flow) ─────
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const form = new URLSearchParams(String(body || ''));
        if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
          return respond(400, { error: 'unsupported_grant_type' });
        }
        const verified = verifyAssertion(form.get('assertion'));
        if (!verified.ok) {
          return respond(400, { error: 'invalid_grant', error_description: `Invalid JWT: ${verified.reason}` });
        }
        tokenSeq += 1;
        const token = mintAccessToken(tokenSeq);
        issuedTokens.push({ token, claims: verified.claims, header: verified.header });
        return respond(200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
      }

      // ── The GCE metadata server ────────────────────────────────────────────
      if (url.startsWith('http://metadata.google.internal/')) {
        if (String(headers['metadata-flavor'] || '').toLowerCase() !== 'google') {
          return respond(403, { error: 'Metadata-Flavor header required' });
        }
        tokenSeq += 1;
        const token = mintAccessToken(tokenSeq);
        issuedTokens.push({ token, claims: { source: 'metadata' } });
        return respond(200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
      }

      // ── Secret Manager ─────────────────────────────────────────────────────
      if (requireAuth && !bearerOf(headers)) {
        return googleError('UNAUTHENTICATED', 401, 'Request had invalid authentication credentials.');
      }

      const parsed = new URL(url);
      const path = parsed.pathname;
      const secretIdParam = parsed.searchParams.get('secretId');
      const base = `/v1/projects/${projectId}/secrets`;

      if (!path.startsWith(`/v1/projects/${projectId}/`)) {
        return googleError('PERMISSION_DENIED', 403, 'Permission denied on resource project.');
      }

      // CREATE: POST /v1/projects/{p}/secrets?secretId=X
      if (method === 'POST' && path === base && secretIdParam) {
        if (secrets.has(secretIdParam)) {
          return googleError('ALREADY_EXISTS', 409, `Secret [${secretIdParam}] already exists.`);
        }
        if (!/^[A-Za-z0-9_-]{1,255}$/.test(secretIdParam)) {
          return googleError('INVALID_ARGUMENT', 400, 'Secret ID must match [A-Za-z0-9_-]{1,255}.');
        }
        secrets.set(secretIdParam, {
          labels: body ? JSON.parse(body).labels || {} : {},
          replication: body ? JSON.parse(body).replication || {} : {},
          versions: [],
        });
        return respond(200, {
          name: `projects/${projectId}/secrets/${secretIdParam}`,
          replication: secrets.get(secretIdParam).replication,
          labels: secrets.get(secretIdParam).labels,
          createTime: new Date(clockMs).toISOString(),
          etag: '"fake-etag"',
        });
      }

      const addVersion = new RegExp(`^${base}/([^/:]+):addVersion$`).exec(path);
      if (method === 'POST' && addVersion) {
        const id = decodeURIComponent(addVersion[1]);
        const secret = secrets.get(id);
        if (!secret) return googleError('NOT_FOUND', 404, `Secret [${id}] not found.`);
        const payload = JSON.parse(String(body || '{}')).payload || {};
        if (typeof payload.data !== 'string') {
          return googleError('INVALID_ARGUMENT', 400, 'payload.data is required and must be base64.');
        }
        const number = secret.versions.length + 1;
        secret.versions.push({ number, data: payload.data, state: 'ENABLED' });
        return respond(200, {
          name: `projects/${projectId}/secrets/${id}/versions/${number}`,
          createTime: new Date(clockMs).toISOString(),
          state: 'ENABLED',
          etag: '"fake-version-etag"',
        });
      }

      const access = new RegExp(`^${base}/([^/:]+)/versions/([^/:]+):access$`).exec(path);
      if (method === 'GET' && access) {
        const id = decodeURIComponent(access[1]);
        const secret = secrets.get(id);
        if (!secret) return googleError('NOT_FOUND', 404, `Secret [${id}] not found.`);
        const wanted = access[2];
        const enabled = secret.versions.filter((v) => v.state === 'ENABLED');
        const version = wanted === 'latest'
          ? enabled[enabled.length - 1]
          : secret.versions.find((v) => String(v.number) === String(wanted) && v.state === 'ENABLED');
        if (!version) return googleError('NOT_FOUND', 404, `Secret Version [${wanted}] not found.`);
        const bytes = Buffer.from(version.data, 'base64');
        return respond(200, {
          name: `projects/${projectId}/secrets/${id}/versions/${version.number}`,
          payload: { data: version.data, dataCrc32c: String(crc32c(bytes)) },
        });
      }

      const destroy = new RegExp(`^${base}/([^/:]+)/versions/([^/:]+):destroy$`).exec(path);
      if (method === 'POST' && destroy) {
        const id = decodeURIComponent(destroy[1]);
        const secret = secrets.get(id);
        if (!secret) return googleError('NOT_FOUND', 404, `Secret [${id}] not found.`);
        const version = secret.versions.find((v) => String(v.number) === String(destroy[2]));
        if (!version) return googleError('NOT_FOUND', 404, `Secret Version [${destroy[2]}] not found.`);
        if (version.state === 'DESTROYED') {
          return googleError('FAILED_PRECONDITION', 400, 'Secret version is already destroyed.');
        }
        version.state = 'DESTROYED';
        // Google really does drop the material on destroy — that is the point of the verb.
        version.data = null;
        return respond(200, {
          name: `projects/${projectId}/secrets/${id}/versions/${version.number}`,
          state: 'DESTROYED',
          destroyTime: new Date(clockMs).toISOString(),
        });
      }

      const del = new RegExp(`^${base}/([^/:]+)$`).exec(path);
      if (method === 'DELETE' && del) {
        const id = decodeURIComponent(del[1]);
        if (!secrets.has(id)) return googleError('NOT_FOUND', 404, `Secret [${id}] not found.`);
        secrets.delete(id);
        return respond(200, {});
      }

      return googleError('NOT_FOUND', 404, `Method not found for ${method} ${path}.`);
    },
  };

  return api;
}
