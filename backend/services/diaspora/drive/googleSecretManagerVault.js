/**
 * Diaspora GTM — the managed credential vault: Google Secret Manager (Issue #127, Phase 2D).
 *
 * WHY THIS BACKEND
 * ----------------
 * ADR 0001 §2 left every managed backend unimplemented and made `resolveVault()` fail closed with
 * VAULT_NOT_CONFIGURED, explicitly because "it cannot be finished without knowing which vault the
 * owner will use". That question is now answerable from the repository itself rather than from a
 * preference: the credential this vault exists to hold is a **Google** OAuth refresh token, obtained
 * through a **Google Cloud** OAuth client that ADR 0001 §"What still gates live use" already requires
 * the owner to create, in a Google Cloud project that already has the Drive API enabled. Secret
 * Manager is a service of that same project, so it adds no new vendor, no new billing account and no
 * new identity boundary — it reuses one the programme has already committed to. It is also what the
 * existing real-PostgreSQL fixtures assume: `database/test/diaspora_gtm_migration_check.mjs` and
 * `diaspora_drive_vault_reference_check.mjs` both store `gcp_secret_manager` with `gcpsm://…`
 * references. This module makes those fixtures describe something real.
 *
 * No ADR contradicted this. ADR 0001 names five candidate backends without choosing; ADR-001
 * (subscriptions) is about payment providers and says nothing about secret storage. The alternatives
 * were considered and rejected in docs/adr/0002-…: AWS/Azure/HashiCorp each add a second cloud
 * identity boundary for one secret type, and Supabase Vault stores the material in the same database
 * whose compromise is the threat the handle indirection exists to survive.
 *
 * WHAT IS AND IS NOT IN THE DATABASE
 * ----------------------------------
 * The database gets `gcpsm://projects/{project}/secrets/{secretId}` and nothing else. `secretId` is
 *
 *     {prefix}-{purpose}-{tenant}-{48 hex characters of crypto.randomBytes(24)}
 *
 * The random tail is FRESH RANDOMNESS, never a hash or truncation of the secret. That is not a style
 * choice: a handle derived from the secret is an offline oracle — anyone who reads the (non-secret,
 * widely-replicated) handle column can test candidate secrets against it at whatever rate their
 * hardware allows, with no request to us and no rate limit. `putTwiceProducesDistinctHandles` in the
 * test suite is the standing proof that this property has not regressed.
 *
 * TENANT BINDING
 * --------------
 * `put` REFUSES to store a credential with no tenant context, and the tenant is part of the resource
 * name. `assertReferenceBoundToTenant` recomputes the expected prefix and compares — so a reference
 * belonging to tenant A cannot be redeemed while acting for tenant B, and this is checked BEFORE any
 * network call, in the same process, without trusting a label round-trip. `forTenant(tenantId)`
 * returns a scoped view whose every operation carries the binding, which is what `resolveVault({
 * tenantId })` hands to callers that know their tenant.
 *
 * A reference is also refused if its project does not match the configured project. Without that,
 * a reference row edited in the database could redirect a read at another project entirely.
 *
 * INJECTABLE TRANSPORT AND CREDENTIALS
 * ------------------------------------
 * Below the `transport` seam (shared with the Drive provider — `httpTransport.js`) this speaks real
 * Secret Manager: real `https://secretmanager.googleapis.com/v1` paths, the real `?secretId=` create
 * form, the real `:addVersion` / `:access` / `:destroy` custom verbs, real base64 payloads with
 * `dataCrc32c` verification, and the real `{ error: { code, message, status } }` envelope mapped by
 * its `status` rather than by HTTP code alone. Access tokens come from an injectable token provider,
 * so tests exercise the RS256 service-account JWT assertion flow and the metadata-server flow without
 * a socket. Nothing in this module logs.
 *
 * FAIL CLOSED
 * -----------
 * Missing project, missing credentials, an unparseable service-account key, a reference for another
 * project, a tenant mismatch, or a CRC32C mismatch are all errors. None of them degrade to a weaker
 * store, and none of them return partial material.
 */
import crypto from 'crypto';
import {
  CredentialVault,
  VaultError,
  VAULT_BACKENDS,
  assertOpaqueReference,
  registerSecretForRedaction,
  redactSecretMaterial,
  registerManagedVaultBackend,
} from './credentialVault.js';
import { createFetchTransport, DEFAULT_TIMEOUT_MS } from './httpTransport.js';

export const SECRET_MANAGER_BASE_URL = 'https://secretmanager.googleapis.com/v1';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const REFERENCE_SCHEME = 'gcpsm';
export const DEFAULT_SECRET_PREFIX = 'carup';

/** Refresh this far before the token actually expires, so a request never races the expiry. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// CRC32C (Castagnoli), the checksum Secret Manager returns beside every payload.
//
// Verifying it is not ceremony. `access` returns base64 over HTTPS through at least one proxy we do
// not control; a truncated or corrupted refresh token that is merely *shorter* would be stored,
// used, rejected by Google as invalid_grant, and reported to the user as "reconnect required" —
// indistinguishable from a genuine revocation. Checking the checksum turns that into a loud,
// correctly-attributed integrity error.
// ─────────────────────────────────────────────────────────────────────────────
const CRC32C_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

/** @returns {number} unsigned 32-bit CRC32C of `buffer`. */
export function crc32c(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error mapping.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Secret Manager error response onto a `VaultError`.
 *
 * Google's canonical `status` string is read FIRST and the HTTP code is only a fallback, because the
 * two are not interchangeable: a 403 is `PERMISSION_DENIED` (the service account lacks a role — an
 * operator problem, never retry) but it is *also* how a project with the API disabled and a
 * `RESOURCE_EXHAUSTED` quota rejection can surface. Retrying the first forever achieves nothing;
 * failing the second permanently loses a user's connection. They must not be the same outcome.
 *
 * Every message is redacted before it is attached, because a `message` echoed from an upstream is
 * exactly the string that later lands in an error log.
 */
export function mapSecretManagerError(response, { operation = 'secret manager request' } = {}) {
  const status = response?.status ?? 0;
  const body = response?.body;
  const googleStatus = String(body?.error?.status || '').toUpperCase();
  const rawMessage = body?.error?.message || (typeof body === 'string' ? body : '') || `HTTP ${status}`;
  const message = redactSecretMaterial(String(rawMessage)).slice(0, 300);

  const make = (code, retryable) => {
    const err = new VaultError(`${operation} failed: ${message}`, code);
    err.retryable = retryable;
    err.httpStatus = status;
    err.googleStatus = googleStatus || null;
    return err;
  };

  switch (googleStatus) {
    case 'NOT_FOUND': return make('VAULT_REFERENCE_NOT_FOUND', false);
    case 'ALREADY_EXISTS': return make('VAULT_REFERENCE_CONFLICT', false);
    case 'PERMISSION_DENIED': return make('VAULT_PERMISSION_DENIED', false);
    case 'UNAUTHENTICATED': return make('VAULT_UNAUTHENTICATED', false);
    case 'INVALID_ARGUMENT': return make('VAULT_INVALID_DESCRIPTOR', false);
    case 'FAILED_PRECONDITION': return make('VAULT_PRECONDITION_FAILED', false);
    case 'RESOURCE_EXHAUSTED': return make('VAULT_RATE_LIMITED', true);
    case 'DEADLINE_EXCEEDED': return make('VAULT_PROVIDER_UNAVAILABLE', true);
    case 'UNAVAILABLE': return make('VAULT_PROVIDER_UNAVAILABLE', true);
    case 'INTERNAL': return make('VAULT_PROVIDER_ERROR', true);
    default: break;
  }
  if (status === 400) return make('VAULT_INVALID_DESCRIPTOR', false);
  if (status === 401) return make('VAULT_UNAUTHENTICATED', false);
  if (status === 403) return make('VAULT_PERMISSION_DENIED', false);
  if (status === 404) return make('VAULT_REFERENCE_NOT_FOUND', false);
  if (status === 409) return make('VAULT_REFERENCE_CONFLICT', false);
  if (status === 429) return make('VAULT_RATE_LIMITED', true);
  if (status >= 500) return make('VAULT_PROVIDER_UNAVAILABLE', true);
  return make('VAULT_PROVIDER_ERROR', false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Access-token providers. Injectable; each one is a `() => Promise<string>`.
// ─────────────────────────────────────────────────────────────────────────────

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parse `DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON`, accepting raw JSON or base64-wrapped JSON.
 *
 * Base64 is accepted because a PEM private key inside a JSON string inside a platform environment
 * variable is routinely mangled by newline handling, and an operator who base64s it to work around
 * that should not silently get "credentials not configured".
 *
 * The parse error NEVER carries the input. A malformed key is still a key.
 */
export function parseServiceAccountKey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  let text = trimmed;
  if (!trimmed.startsWith('{')) {
    try { text = Buffer.from(trimmed, 'base64').toString('utf8'); } catch { text = trimmed; }
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw new VaultError(
      'The Google service-account key is not valid JSON (raw or base64). Refusing to continue.',
      'VAULT_NOT_CONFIGURED',
    );
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.client_email || !parsed.private_key) {
    throw new VaultError(
      'The Google service-account key is missing client_email or private_key.',
      'VAULT_NOT_CONFIGURED',
    );
  }
  // The private key is secret material that will be handed to crypto.createSign; register it so any
  // string that later quotes it — an OpenSSL error, for instance — is scrubbed on the way out.
  registerSecretForRedaction(parsed.private_key);
  return parsed;
}

/**
 * Service-account JWT-bearer flow (RFC 7523), the way Google documents it for server-to-server use.
 *
 * A self-signed assertion is exchanged for a short-lived access token. The private key never leaves
 * this process and never appears in a request body — only the signature does.
 *
 * Concurrent callers share ONE in-flight refresh (`pending`). Without that, a burst of ten uploads on
 * a cold process makes ten identical token requests, which is both wasteful and a good way to meet
 * Google's token-endpoint rate limit at exactly the worst moment.
 */
export function createServiceAccountTokenProvider({
  serviceAccount,
  transport,
  scope = CLOUD_PLATFORM_SCOPE,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!serviceAccount) throw new VaultError('A Google service-account key is required', 'VAULT_NOT_CONFIGURED');
  const tokenUri = serviceAccount.token_uri || GOOGLE_TOKEN_ENDPOINT;
  let cached = null;      // { token, expiresAtMs }
  let pending = null;

  function buildAssertion() {
    const issuedAt = Math.floor(now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    if (serviceAccount.private_key_id) header.kid = serviceAccount.private_key_id;
    const claims = {
      iss: serviceAccount.client_email,
      scope,
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(serviceAccount.private_key);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  async function fetchToken() {
    const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: buildAssertion() }).toString();
    const response = await transport.request({
      method: 'POST',
      url: tokenUri,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      // Google's token endpoint uses the OAuth error envelope, not the Cloud one.
      const detail = redactSecretMaterial(String(response.body?.error_description || response.body?.error || `HTTP ${response.status}`));
      const err = new VaultError(`Could not obtain a Google access token: ${detail}`.slice(0, 300), 'VAULT_UNAUTHENTICATED');
      err.retryable = response.status >= 500 || response.status === 429;
      throw err;
    }
    const token = response.body?.access_token;
    if (!token) throw new VaultError('Google returned no access token', 'VAULT_UNAUTHENTICATED');
    registerSecretForRedaction(token);
    const lifetimeMs = (Number(response.body.expires_in) || 3600) * 1000;
    cached = { token, expiresAtMs: now() + lifetimeMs - TOKEN_EXPIRY_SKEW_MS };
    return token;
  }

  return {
    name: 'service_account',
    /** Test seam: drop the cache so a rotation or expiry path can be exercised deterministically. */
    reset() { cached = null; pending = null; },
    async getAccessToken() {
      if (cached && cached.expiresAtMs > now()) return cached.token;
      if (!pending) {
        pending = fetchToken().finally(() => { pending = null; });
      }
      return pending;
    },
  };
}

/**
 * Workload-identity flow for GCE / GKE / Cloud Run, where no key file exists at all.
 *
 * Preferred over a downloaded key wherever the runtime supports it, for the obvious reason: there is
 * no long-lived private key to leak. Vercel's serverless runtime does NOT provide this, which is why
 * the service-account path above still exists.
 */
export function createMetadataServerTokenProvider({
  transport,
  url = GOOGLE_METADATA_TOKEN_URL,
  now = () => Date.now(),
  timeoutMs = 5_000,
} = {}) {
  let cached = null;
  let pending = null;

  async function fetchToken() {
    const response = await transport.request({
      method: 'GET',
      url,
      headers: { 'metadata-flavor': 'Google', accept: 'application/json' },
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300 || !response.body?.access_token) {
      const err = new VaultError('The GCE metadata server did not return an access token', 'VAULT_UNAUTHENTICATED');
      err.retryable = response.status >= 500;
      throw err;
    }
    const token = response.body.access_token;
    registerSecretForRedaction(token);
    cached = { token, expiresAtMs: now() + ((Number(response.body.expires_in) || 3600) * 1000) - TOKEN_EXPIRY_SKEW_MS };
    return token;
  }

  return {
    name: 'metadata_server',
    reset() { cached = null; pending = null; },
    async getAccessToken() {
      if (cached && cached.expiresAtMs > now()) return cached.token;
      if (!pending) pending = fetchToken().finally(() => { pending = null; });
      return pending;
    },
  };
}

/**
 * A fixed token. TEST ONLY — it refuses to exist in production, because a static bearer token in an
 * environment variable is the exact anti-pattern this whole module was written to remove.
 */
export function createStaticTokenProvider(token, { allowInProduction = false } = {}) {
  if (process.env.NODE_ENV === 'production' && !allowInProduction) {
    throw new VaultError('A static access token must never be used in production', 'VAULT_NOT_PERMITTED');
  }
  return { name: 'static', reset() {}, async getAccessToken() { return token; } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the backend's configuration from the environment, FAILING CLOSED.
 *
 * `missing` is returned rather than thrown when `throwOnMissing` is false, so a health endpoint can
 * report "not configured, and here is what is absent" without an exception — and so the report can
 * name variables without ever naming values.
 */
export function resolveGoogleSecretManagerConfig({ env = process.env, throwOnMissing = true } = {}) {
  const missing = [];
  const serviceAccountRaw = env.DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON || '';
  const useMetadataServer = String(env.DIASPORA_VAULT_GCP_USE_METADATA_SERVER || '').toLowerCase() === 'true';

  let serviceAccount = null;
  if (serviceAccountRaw) serviceAccount = parseServiceAccountKey(serviceAccountRaw);

  const projectId = String(
    env.DIASPORA_VAULT_GCP_PROJECT_ID
    || env.GOOGLE_CLOUD_PROJECT
    || env.GCLOUD_PROJECT
    || serviceAccount?.project_id
    || '',
  ).trim();

  if (!projectId) missing.push('DIASPORA_VAULT_GCP_PROJECT_ID');
  if (!serviceAccount && !useMetadataServer) {
    missing.push('DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON (or DIASPORA_VAULT_GCP_USE_METADATA_SERVER=true)');
  }

  if (missing.length && throwOnMissing) {
    // Naming the variables is safe and useful; naming values never is.
    throw new VaultError(
      `Google Secret Manager is selected but not configured. Missing: ${missing.join(', ')}`,
      'VAULT_NOT_CONFIGURED',
    );
  }

  const replicaLocations = String(env.DIASPORA_VAULT_GCP_REPLICA_LOCATIONS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const timeoutMs = Number(env.DIASPORA_VAULT_GCP_TIMEOUT_MS);

  return {
    configured: missing.length === 0,
    missing,
    projectId,
    serviceAccount,
    useMetadataServer,
    secretPrefix: sanitizeSegment(env.DIASPORA_VAULT_GCP_SECRET_PREFIX || DEFAULT_SECRET_PREFIX) || DEFAULT_SECRET_PREFIX,
    replicaLocations,
    // Destroying the superseded version is the default because a rotated Google refresh token is dead
    // anyway, and keeping dead credential material is pure liability. Operators who want a rollback
    // window can turn it off.
    destroyPreviousVersion: String(env.DIASPORA_VAULT_GCP_DESTROY_PREVIOUS_VERSION || 'true').toLowerCase() !== 'false',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference construction and parsing.
// ─────────────────────────────────────────────────────────────────────────────

/** Secret ids accept `[A-Za-z0-9_-]`; everything else is folded away rather than rejected. */
function sanitizeSegment(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const REFERENCE_PATTERN = new RegExp(
  `^${REFERENCE_SCHEME}://projects/([A-Za-z0-9][A-Za-z0-9._-]{2,62})/secrets/([A-Za-z0-9_-]{1,255})$`,
);

/** The deterministic, NON-secret part of a secret id: prefix + purpose + tenant. */
export function secretIdPrefixFor({ secretPrefix = DEFAULT_SECRET_PREFIX, purpose, tenantId }) {
  const purposeSlug = sanitizeSegment(purpose);
  const tenantSlug = sanitizeSegment(tenantId);
  if (!purposeSlug) throw new VaultError('purpose is required', 'VAULT_INVALID_DESCRIPTOR');
  if (!tenantSlug) {
    throw new VaultError(
      'A tenant context is required to store a credential; an unbound credential cannot be authorized on read',
      'VAULT_TENANT_REQUIRED',
    );
  }
  return `${secretPrefix}-${purposeSlug}-${tenantSlug}-`;
}

export function buildVaultReference({ projectId, secretId }) {
  const reference = `${REFERENCE_SCHEME}://projects/${projectId}/secrets/${secretId}`;
  // The same gate the database CHECK enforces, run before the value can reach a driver.
  assertOpaqueReference(reference);
  return reference;
}

export function parseVaultReference(reference) {
  assertOpaqueReference(reference);
  const match = REFERENCE_PATTERN.exec(reference);
  if (!match) {
    throw new VaultError('Not a Google Secret Manager vault reference', 'VAULT_REFERENCE_NOT_FOUND');
  }
  return { projectId: match[1], secretId: match[2] };
}

/**
 * Refuse a reference that is not bound to the tenant we are acting for.
 *
 * Checked locally, before any request: a check that depends on reading a label back from Google is a
 * check that fails open whenever Google is slow, and it costs an extra round trip on the hot path.
 */
export function assertReferenceBoundToTenant(reference, { tenantId, purpose, secretPrefix = DEFAULT_SECRET_PREFIX }) {
  const { secretId } = parseVaultReference(reference);
  const expected = secretIdPrefixFor({ secretPrefix, purpose, tenantId });
  if (!secretId.startsWith(expected)) {
    // The message names neither the expected nor the actual tenant: an authorization failure should
    // not be a directory of which tenants exist.
    throw new VaultError(
      'This credential reference is not bound to the acting tenant',
      'VAULT_TENANT_MISMATCH',
    );
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// The vault.
// ─────────────────────────────────────────────────────────────────────────────

export class GoogleSecretManagerVault extends CredentialVault {
  /**
   * @param {object} options
   * @param {string} options.projectId
   * @param {{getAccessToken:() => Promise<string>}} options.tokenProvider
   * @param {{request:Function}} [options.transport]  injectable; defaults to the real fetch transport
   * @param {string} [options.baseUrl]
   * @param {string} [options.secretPrefix]
   * @param {string[]} [options.replicaLocations] user-managed replication; empty = automatic
   * @param {boolean} [options.destroyPreviousVersion]
   */
  constructor({
    projectId,
    tokenProvider,
    transport = null,
    baseUrl = SECRET_MANAGER_BASE_URL,
    secretPrefix = DEFAULT_SECRET_PREFIX,
    replicaLocations = [],
    destroyPreviousVersion = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    randomBytes = (n) => crypto.randomBytes(n),
  } = {}) {
    super();
    if (!projectId) throw new VaultError('A Google Cloud project is required', 'VAULT_NOT_CONFIGURED');
    if (!tokenProvider || typeof tokenProvider.getAccessToken !== 'function') {
      throw new VaultError('A Google access-token provider is required', 'VAULT_NOT_CONFIGURED');
    }
    this.projectId = String(projectId);
    this.tokenProvider = tokenProvider;
    this.transport = transport || createFetchTransport({ timeoutMs });
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.secretPrefix = secretPrefix || DEFAULT_SECRET_PREFIX;
    this.replicaLocations = Array.isArray(replicaLocations) ? replicaLocations.filter(Boolean) : [];
    this.destroyPreviousVersion = destroyPreviousVersion !== false;
    this.timeoutMs = timeoutMs;
    this._randomBytes = randomBytes;
  }

  get backend() { return VAULT_BACKENDS.GCP_SECRET_MANAGER; }

  /**
   * A view of this vault that carries a tenant on every call.
   *
   * This is what `resolveVault({ tenantId })` returns. It exists so that "the caller remembered to
   * pass the tenant" stops being a per-call-site discipline: once you hold a scoped vault, forgetting
   * is not expressible.
   */
  forTenant(tenantId) {
    if (!sanitizeSegment(tenantId)) {
      throw new VaultError('A tenant id is required to scope the vault', 'VAULT_TENANT_REQUIRED');
    }
    const inner = this;
    return {
      get backend() { return inner.backend; },
      tenantId,
      inner,
      forTenant: (other) => inner.forTenant(other),
      put: (descriptor = {}) => inner.put({ ...descriptor, tenantId }),
      get: (reference, options = {}) => inner.get(reference, { ...options, tenantId }),
      rotate: (reference, secret, options = {}) => inner.rotate(reference, secret, { ...options, tenantId }),
      destroy: (reference, options = {}) => inner.destroy(reference, { ...options, tenantId }),
    };
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  async _request({ method, path, body = null, operation, query = null }) {
    const accessToken = await this.tokenProvider.getAccessToken();
    const search = query ? `?${new URLSearchParams(query).toString()}` : '';
    const headers = {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    };
    let payload = null;
    if (body !== null) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await this.transport.request({
      method,
      url: `${this.baseUrl}${path}${search}`,
      headers,
      body: payload,
      timeoutMs: this.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      throw mapSecretManagerError(response, { operation });
    }
    return response.body || {};
  }

  _secretPath(secretId) {
    return `/projects/${encodeURIComponent(this.projectId)}/secrets/${encodeURIComponent(secretId)}`;
  }

  /** Resolve a reference, refusing anything for another project or another tenant. */
  _resolveSecretId(reference, { tenantId = null, purpose = null } = {}) {
    const { projectId, secretId } = parseVaultReference(reference);
    if (projectId !== this.projectId) {
      // A row whose project column was tampered with must not become a read against someone else's
      // project. Reported as NOT_FOUND: from the caller's point of view it genuinely is not ours.
      throw new VaultError('That credential reference belongs to a different project', 'VAULT_REFERENCE_NOT_FOUND');
    }
    if (tenantId) {
      const purposes = purpose ? [purpose] : this._purposesFor(secretId);
      const bound = purposes.some((candidate) => {
        try {
          assertReferenceBoundToTenant(reference, { tenantId, purpose: candidate, secretPrefix: this.secretPrefix });
          return true;
        } catch { return false; }
      });
      if (!bound) {
        throw new VaultError('This credential reference is not bound to the acting tenant', 'VAULT_TENANT_MISMATCH');
      }
    }
    return secretId;
  }

  /**
   * Which purpose a secret id claims, when the caller did not say.
   *
   * The id is `{prefix}-{purpose}-{tenant}-{random}` and `purpose` may itself contain no separator
   * after sanitization, so the claimed purpose is simply the second segment. This is only ever used
   * to reconstruct the expected tenant prefix for comparison — it grants nothing on its own.
   */
  _purposesFor(secretId) {
    const withoutPrefix = secretId.startsWith(`${this.secretPrefix}-`)
      ? secretId.slice(this.secretPrefix.length + 1)
      : secretId;
    const claimed = withoutPrefix.split('-')[0];
    return claimed ? [claimed] : [];
  }

  // ── Interface ────────────────────────────────────────────────────────────

  /**
   * Create a secret and its first version.
   *
   * @param {{purpose:string, secret:string, tenantId:string, userId?:string, metadata?:object}} descriptor
   * @returns {{vaultReference:string, vaultBackend:string, keyVersion:string}}
   */
  async put({ purpose, secret, tenantId = null, userId = null, metadata = {} } = {}) {
    if (!purpose) throw new VaultError('purpose is required', 'VAULT_INVALID_DESCRIPTOR');
    if (typeof secret !== 'string' || !secret) throw new VaultError('secret material is required', 'VAULT_INVALID_DESCRIPTOR');

    // Throws VAULT_TENANT_REQUIRED when the tenant is absent — the fail-closed half of tenant binding.
    const prefix = secretIdPrefixFor({ secretPrefix: this.secretPrefix, purpose, tenantId });
    // 24 bytes of fresh randomness. NOT derived from `secret` in any way: see the module header.
    const handle = Buffer.from(this._randomBytes(24)).toString('hex');
    const secretId = `${prefix}${handle}`;
    const vaultReference = buildVaultReference({ projectId: this.projectId, secretId });

    const labels = {
      app: 'carup',
      purpose: sanitizeSegment(purpose),
      tenant: sanitizeSegment(tenantId),
    };
    // Labels are metadata visible to anyone with project read access, so only non-identifying values
    // go in. A user id is pseudonymous but still an identifier; it stays out.
    if (userId) labels.bound = 'user';

    await this._request({
      method: 'POST',
      path: `/projects/${encodeURIComponent(this.projectId)}/secrets`,
      query: { secretId },
      body: {
        replication: this.replicaLocations.length
          ? { userManaged: { replicas: this.replicaLocations.map((location) => ({ location })) } }
          : { automatic: {} },
        labels,
      },
      operation: 'create secret',
    });

    let version;
    try {
      version = await this._request({
        method: 'POST',
        path: `${this._secretPath(secretId)}:addVersion`,
        body: { payload: { data: Buffer.from(secret, 'utf8').toString('base64') } },
        operation: 'add secret version',
      });
    } catch (err) {
      // The container exists but holds nothing. Leaving it behind would accumulate empty secrets that
      // look like live credentials in the console; deleting it is best effort because the original
      // failure is the one worth reporting.
      await this._request({
        method: 'DELETE',
        path: this._secretPath(secretId),
        operation: 'delete empty secret',
      }).catch(() => {});
      throw err;
    }

    registerSecretForRedaction(secret);
    return {
      vaultReference,
      vaultBackend: this.backend,
      keyVersion: versionNumberOf(version?.name) || '1',
      metadata: { ...metadata },
    };
  }

  /**
   * Read the latest enabled version.
   *
   * @param {string} reference
   * @param {{tenantId?:string, purpose?:string}} [options] tenant binding, verified when supplied
   */
  async get(reference, { tenantId = null, purpose = null } = {}) {
    const secretId = this._resolveSecretId(reference, { tenantId, purpose });
    const accessed = await this._request({
      method: 'GET',
      path: `${this._secretPath(secretId)}/versions/latest:access`,
      operation: 'access secret version',
    });
    const data = accessed?.payload?.data;
    if (typeof data !== 'string') {
      throw new VaultError('No credential is stored for that reference', 'VAULT_REFERENCE_NOT_FOUND');
    }
    const bytes = Buffer.from(data, 'base64');
    const declared = accessed?.payload?.dataCrc32c;
    if (declared !== undefined && declared !== null && String(declared) !== String(crc32c(bytes))) {
      // Do NOT return the material. A payload that failed its own checksum is not a credential, it is
      // a corrupted string that will be reported as a revoked grant a moment later.
      throw new VaultError('The stored credential failed its integrity check', 'VAULT_INTEGRITY_FAILED');
    }
    const secretText = bytes.toString('utf8');
    registerSecretForRedaction(secretText);
    return {
      secret: secretText,
      keyVersion: versionNumberOf(accessed?.name) || 'latest',
      metadata: { project: this.projectId, secretId },
    };
  }

  /**
   * Replace the material under an existing handle.
   *
   * The handle is deliberately stable across rotation: `diaspora_credential_references.vault_reference`
   * and every `diaspora_drive_connections` row point at it, and rotating the handle would mean a
   * multi-row update that can half-succeed. A new VERSION is added instead, and the superseded one is
   * destroyed so dead credential material does not accumulate.
   */
  async rotate(reference, secret, { tenantId = null, purpose = null } = {}) {
    if (typeof secret !== 'string' || !secret) throw new VaultError('secret material is required', 'VAULT_INVALID_DESCRIPTOR');
    const secretId = this._resolveSecretId(reference, { tenantId, purpose });
    const version = await this._request({
      method: 'POST',
      path: `${this._secretPath(secretId)}:addVersion`,
      body: { payload: { data: Buffer.from(secret, 'utf8').toString('base64') } },
      operation: 'add secret version',
    });
    registerSecretForRedaction(secret);

    const keyVersion = versionNumberOf(version?.name) || null;
    if (this.destroyPreviousVersion && keyVersion) {
      const previous = Number(keyVersion) - 1;
      if (previous >= 1) {
        // Best effort, always. A rotation that succeeded must not be reported as failed because the
        // tidy-up of an already-dead version returned FAILED_PRECONDITION.
        await this._request({
          method: 'POST',
          path: `${this._secretPath(secretId)}/versions/${previous}:destroy`,
          body: {},
          operation: 'destroy superseded version',
        }).catch(() => {});
      }
    }
    return { vaultReference: reference, vaultBackend: this.backend, keyVersion: keyVersion || 'latest' };
  }

  /**
   * Delete the secret and every version of it.
   *
   * Deleting the SECRET rather than destroying the latest version matters: destroying one version of a
   * multi-version secret leaves the earlier refresh tokens intact and still accessible, which is
   * precisely the material a user pressing "disconnect" asked to be rid of.
   */
  async destroy(reference, { tenantId = null, purpose = null } = {}) {
    const secretId = this._resolveSecretId(reference, { tenantId, purpose });
    try {
      await this._request({
        method: 'DELETE',
        path: this._secretPath(secretId),
        operation: 'delete secret',
      });
      return { destroyed: true };
    } catch (err) {
      // Already gone is the desired end state, not a failure.
      if (err?.code === 'VAULT_REFERENCE_NOT_FOUND') return { destroyed: false };
      throw err;
    }
  }
}

/** `projects/p/secrets/s/versions/7` -> `'7'`. */
function versionNumberOf(name) {
  const match = /\/versions\/([^/]+)$/.exec(String(name || ''));
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory + registration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the vault from the environment. Throws VAULT_NOT_CONFIGURED when anything is missing.
 *
 * `overrides` exists for tests and for a future caller that already holds a transport; nothing in it
 * is read from the environment, so a test cannot accidentally depend on ambient configuration.
 */
export function createGoogleSecretManagerVault(overrides = {}) {
  const config = overrides.config || resolveGoogleSecretManagerConfig({ env: overrides.env || process.env });
  const transport = overrides.transport || createFetchTransport({ timeoutMs: config.timeoutMs });
  const tokenProvider = overrides.tokenProvider || (config.useMetadataServer && !config.serviceAccount
    ? createMetadataServerTokenProvider({ transport })
    : createServiceAccountTokenProvider({ serviceAccount: config.serviceAccount, transport, timeoutMs: config.timeoutMs }));

  return new GoogleSecretManagerVault({
    projectId: config.projectId,
    tokenProvider,
    transport,
    secretPrefix: config.secretPrefix,
    replicaLocations: config.replicaLocations,
    destroyPreviousVersion: config.destroyPreviousVersion,
    timeoutMs: config.timeoutMs,
    ...(overrides.randomBytes ? { randomBytes: overrides.randomBytes } : {}),
    ...(overrides.baseUrl ? { baseUrl: overrides.baseUrl } : {}),
  });
}

// Self-registration. `credentialVault.js` cannot import this module directly — it would be an import
// cycle, and a cycle whose child does `class X extends CredentialVault` at evaluation time fails with
// a temporal-dead-zone ReferenceError depending only on which module the process happened to load
// first. The registry inverts the dependency: this module imports the core, never the reverse.
registerManagedVaultBackend(VAULT_BACKENDS.GCP_SECRET_MANAGER, createGoogleSecretManagerVault);
