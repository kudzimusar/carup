/**
 * Diaspora GTM — credential vault interface (Issue #127, Drive lane).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * A Google refresh token is a long-lived bearer credential for a user's Drive. It must live in a
 * secret store, and the CarUp database must hold nothing but an OPAQUE HANDLE that points at it.
 * `diaspora_credential_references` already encodes that rule in SQL (ledger #21):
 *
 *     CONSTRAINT ck_diaspora_credential_reference_not_a_secret CHECK (
 *       vault_reference !~ '^(1//|ya29\.|sk_live_|sk_test_|rk_live_|pk_live_|whsec_|AIza)'
 *       AND vault_reference !~ '^ey[A-Za-z0-9_-]+\.'
 *       AND vault_reference !~ '-----BEGIN')
 *
 * A CHECK constraint is the last line of defence, not the only one: it fires after the value has
 * already been marshalled into a query, possibly logged by a driver. So the same rule is mirrored
 * here, in `assertOpaqueReference`, and every write path calls it BEFORE the value reaches the
 * database. The two implementations are deliberately redundant; `driveVaultRegex.js` documents the
 * exact SQL each JS pattern mirrors so drift is visible.
 *
 * WHAT A VAULT IS HERE
 * --------------------
 * `CredentialVault` is a four-method interface — put / get / rotate / destroy. `put` takes secret
 * material and returns an opaque reference; `get` is the ONLY way back to the secret and is callable
 * only from provider transport code. Nothing else in the system ever holds token material, and
 * nothing at all persists it.
 *
 * BACKENDS
 * --------
 *  - `InMemoryCredentialVault` (backend id `env_dev`): process-local, test/dev only. Refuses to be
 *    constructed in production unless a caller explicitly opts in for a unit test.
 *  - Managed backends REGISTER themselves through `registerManagedVaultBackend`. `gcp_secret_manager`
 *    ships — see `googleSecretManagerVault.js` and docs/adr/0002-…. Any backend that has not
 *    registered still fails closed with NOT_CONFIGURED rather than silently degrading to the
 *    in-memory adapter, which would lose every user's Drive connection on restart while reporting
 *    success.
 */
import crypto from 'crypto';
import {
  TOKEN_SHAPED_REFERENCE_PATTERNS,
  REDACTION_PATTERNS,
  VAULT_REFERENCE_MIN_LENGTH,
  VAULT_REFERENCE_MAX_LENGTH,
} from './driveVaultRegex.js';

/** Vault backends the `ck_diaspora_credential_backend` CHECK constraint accepts. */
export const VAULT_BACKENDS = Object.freeze({
  ENV_DEV: 'env_dev',
  AWS_KMS: 'aws_kms',
  AWS_SECRETS_MANAGER: 'aws_secrets_manager',
  GCP_SECRET_MANAGER: 'gcp_secret_manager',
  AZURE_KEY_VAULT: 'azure_key_vault',
  HASHICORP_VAULT: 'hashicorp_vault',
  SUPABASE_VAULT: 'supabase_vault',
});

/** Purposes the `ck_diaspora_credential_purpose` CHECK constraint accepts. */
export const CREDENTIAL_PURPOSES = Object.freeze({
  GOOGLE_DRIVE: 'google_drive',
  BILLING_PROVIDER: 'billing_provider',
  SAFETRADE_PROVIDER: 'safetrade_provider',
});

export class VaultError extends Error {
  constructor(message, code = 'VAULT_ERROR') {
    // Message text is caller-supplied and sanitized at every construction site. Secret material must
    // never be interpolated into it — see `redactSecretMaterial` for the outbound scrubber.
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

/**
 * Reject anything that has the SHAPE of a real credential.
 *
 * This is the JS mirror of `ck_diaspora_credential_reference_not_a_secret` plus
 * `ck_diaspora_credential_reference_len`. It is called on every path that is about to write a
 * `vault_reference`, so a mistake is caught in the service layer with a clear error instead of
 * surfacing as an opaque 23514 from Postgres after the value has already travelled.
 *
 * @throws {VaultError} code VAULT_REFERENCE_REJECTED
 */
export function assertOpaqueReference(reference, { field = 'vault_reference' } = {}) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new VaultError(`${field} must be a non-empty opaque string`, 'VAULT_REFERENCE_REJECTED');
  }
  if (reference.length < VAULT_REFERENCE_MIN_LENGTH || reference.length > VAULT_REFERENCE_MAX_LENGTH) {
    throw new VaultError(
      `${field} must be between ${VAULT_REFERENCE_MIN_LENGTH} and ${VAULT_REFERENCE_MAX_LENGTH} characters`,
      'VAULT_REFERENCE_REJECTED',
    );
  }
  for (const { name, pattern } of TOKEN_SHAPED_REFERENCE_PATTERNS) {
    if (pattern.test(reference)) {
      // Report the CLASS only. Echoing the offending value would put the very credential we are
      // refusing to store into an error message, which is where it would then be logged.
      throw new VaultError(
        `${field} looks like a real credential (${name}); only an opaque vault handle may be stored`,
        'VAULT_REFERENCE_REJECTED',
      );
    }
  }
  return reference;
}

/** True when `assertOpaqueReference` would accept the value. Never throws. */
export function isOpaqueReference(reference) {
  try {
    assertOpaqueReference(reference);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrub known-secret substrings out of any string before it is logged, returned or persisted.
 *
 * Belt-and-braces for provider error text: Google's own error bodies do not echo bearer tokens, but
 * "the upstream never does that" is not a control. Callers register the live secret values for the
 * duration of a request (see `withSecretRedaction`) and every outbound string passes through here.
 */
const registeredSecrets = new Set();
/**
 * Bounded, FIFO. A long-lived process refreshes access tokens for every connected user forever, so an
 * unbounded set would both leak memory and make every redaction pass slower over time. Evicting the
 * oldest is safe: shape-based redaction still covers anything that ages out, and a token that old has
 * expired anyway.
 */
const MAX_REGISTERED_SECRETS = 256;

export function registerSecretForRedaction(secret) {
  if (typeof secret !== 'string' || secret.length < 8) return;
  if (registeredSecrets.has(secret)) return;
  if (registeredSecrets.size >= MAX_REGISTERED_SECRETS) {
    registeredSecrets.delete(registeredSecrets.values().next().value);
  }
  registeredSecrets.add(secret);
}

export function clearRegisteredSecrets() {
  registeredSecrets.clear();
}

export function redactSecretMaterial(value) {
  if (typeof value !== 'string' || !value) return value;
  let out = value;
  // 1. Exact match on secrets this process actually holds — the only complete defence, because a
  //    provider could hand back a token in a shape nobody anticipated.
  for (const secret of registeredSecrets) {
    if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  // 2. Shape-based sweep for secrets nobody registered (e.g. a value echoed by a misbehaving upstream).
  for (const { pattern } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0; // these are /g literals shared across calls
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/** The interface. A vault maps secret material <-> opaque reference and nothing else. */
export class CredentialVault {
  get backend() { throw new VaultError('backend not implemented', 'NOT_IMPLEMENTED'); }
  // eslint-disable-next-line no-unused-vars
  async put(_descriptor) { throw new VaultError('put not implemented', 'NOT_IMPLEMENTED'); }
  // eslint-disable-next-line no-unused-vars
  async get(_reference) { throw new VaultError('get not implemented', 'NOT_IMPLEMENTED'); }
  // eslint-disable-next-line no-unused-vars
  async rotate(_reference, _secret) { throw new VaultError('rotate not implemented', 'NOT_IMPLEMENTED'); }
  // eslint-disable-next-line no-unused-vars
  async destroy(_reference) { throw new VaultError('destroy not implemented', 'NOT_IMPLEMENTED'); }
}

/**
 * Test/dev adapter. Secrets live in a process-local Map and die with the process — which is exactly
 * why it is refused in production: a restart would silently invalidate every Drive connection while
 * the database still reported them ACTIVE.
 */
export class InMemoryCredentialVault extends CredentialVault {
  constructor({ allowInProduction = false, referencePrefix = 'memvault' } = {}) {
    super();
    if (process.env.NODE_ENV === 'production' && !allowInProduction) {
      throw new VaultError('The in-memory credential vault must never be used in production', 'VAULT_NOT_PERMITTED');
    }
    this._entries = new Map();
    this._prefix = referencePrefix;
  }

  get backend() { return VAULT_BACKENDS.ENV_DEV; }

  /** Number of live secrets — a test seam for proving `destroy` really destroys. */
  get size() { return this._entries.size; }

  /**
   * @param {{purpose:string, secret:string, tenantId?:string, userId?:string, metadata?:object}} descriptor
   * @returns {{vaultReference:string, vaultBackend:string, keyVersion:string}}
   */
  async put({ purpose, secret, tenantId = null, userId = null, metadata = {} } = {}) {
    if (!purpose) throw new VaultError('purpose is required', 'VAULT_INVALID_DESCRIPTOR');
    if (typeof secret !== 'string' || !secret) throw new VaultError('secret material is required', 'VAULT_INVALID_DESCRIPTOR');
    // The handle is random and carries NO part of the secret — not a hash, not a prefix. A hash would
    // still be an offline-guessable oracle for short secrets.
    const handle = crypto.randomBytes(24).toString('hex');
    const vaultReference = `${this._prefix}://${purpose}/${handle}`;
    assertOpaqueReference(vaultReference);
    const keyVersion = `v${crypto.randomBytes(4).toString('hex')}`;
    this._entries.set(vaultReference, { secret, purpose, tenantId, userId, keyVersion, metadata: { ...metadata } });
    registerSecretForRedaction(secret);
    return { vaultReference, vaultBackend: this.backend, keyVersion };
  }

  async get(reference) {
    assertOpaqueReference(reference);
    const entry = this._entries.get(reference);
    if (!entry) throw new VaultError('No credential is stored for that reference', 'VAULT_REFERENCE_NOT_FOUND');
    return { secret: entry.secret, keyVersion: entry.keyVersion, metadata: { ...entry.metadata } };
  }

  async rotate(reference, secret) {
    assertOpaqueReference(reference);
    const entry = this._entries.get(reference);
    if (!entry) throw new VaultError('No credential is stored for that reference', 'VAULT_REFERENCE_NOT_FOUND');
    if (typeof secret !== 'string' || !secret) throw new VaultError('secret material is required', 'VAULT_INVALID_DESCRIPTOR');
    entry.secret = secret;
    entry.keyVersion = `v${crypto.randomBytes(4).toString('hex')}`;
    registerSecretForRedaction(secret);
    return { vaultReference: reference, vaultBackend: this.backend, keyVersion: entry.keyVersion };
  }

  async destroy(reference) {
    assertOpaqueReference(reference);
    const existed = this._entries.delete(reference);
    return { destroyed: existed };
  }
}

/**
 * Environment-backed adapter for local development: the secret is read from a named env var and the
 * reference is `env://VAR_NAME`. Useful for a single-operator dev loop without a cloud vault.
 * Read-only — `put` is refused, because writing to the process environment at runtime would make the
 * secret visible in `/proc` and in any child process.
 */
export class EnvCredentialVault extends CredentialVault {
  constructor({ allowInProduction = false } = {}) {
    super();
    if (process.env.NODE_ENV === 'production' && !allowInProduction) {
      throw new VaultError('The env credential vault must never be used in production', 'VAULT_NOT_PERMITTED');
    }
  }

  get backend() { return VAULT_BACKENDS.ENV_DEV; }

  async put() {
    throw new VaultError('The env vault is read-only; provision the secret out of band', 'VAULT_READ_ONLY');
  }

  async get(reference) {
    assertOpaqueReference(reference);
    const match = /^env:\/\/([A-Z0-9_]+)$/.exec(reference);
    if (!match) throw new VaultError('Not an env vault reference', 'VAULT_REFERENCE_NOT_FOUND');
    const secret = process.env[match[1]];
    if (!secret) throw new VaultError('No credential is stored for that reference', 'VAULT_REFERENCE_NOT_FOUND');
    registerSecretForRedaction(secret);
    return { secret, keyVersion: 'env', metadata: {} };
  }

  async rotate() {
    throw new VaultError('The env vault is read-only; rotate the secret out of band', 'VAULT_READ_ONLY');
  }

  async destroy() {
    throw new VaultError('The env vault is read-only; remove the secret out of band', 'VAULT_READ_ONLY');
  }
}

let sharedTestVault = null;
/** Process-shared in-memory vault, so a connect in one call is usable by an upload in a later call. */
export function getSharedTestVault() {
  if (!sharedTestVault) sharedTestVault = new InMemoryCredentialVault();
  return sharedTestVault;
}

/** Test seam — drops every stored secret and the shared instance. */
export function resetSharedTestVault() {
  sharedTestVault = null;
  clearRegisteredSecrets();
}

/**
 * Managed-backend registry.
 *
 * WHY A REGISTRY RATHER THAN AN IMPORT
 * ------------------------------------
 * `resolveVault` is synchronous — `GoogleDriveProvider.vault` is a getter, so it cannot await — which
 * rules out a dynamic import. A static `import './googleSecretManagerVault.js'` here would instead
 * create a cycle (core → backend → core) whose child evaluates `class … extends CredentialVault`
 * while that binding is still in its temporal dead zone. Whether that throws depends on which module
 * the process happened to load first, which is the worst possible property for the code path that
 * decides where refresh tokens live.
 *
 * Inverting the dependency removes the question: a backend module imports this one, never the
 * reverse, and announces itself on import. `installManagedVaultBackends()` is the single, explicit
 * place that pulls the shipped backends in.
 *
 * @type {Map<string, (overrides?:object) => CredentialVault>}
 */
const managedVaultFactories = new Map();

/** Called by a backend module at import time. */
export function registerManagedVaultBackend(backendId, factory) {
  if (!backendId || typeof factory !== 'function') {
    throw new VaultError('A managed vault backend needs an id and a factory', 'VAULT_INVALID_DESCRIPTOR');
  }
  managedVaultFactories.set(String(backendId), factory);
  return backendId;
}

/** Which managed backends this build can actually construct. Used by health reporting and tests. */
export function registeredManagedVaultBackends() {
  return [...managedVaultFactories.keys()].sort();
}

/** Test seam: forget a registration so the fail-closed path can be exercised. */
export function clearManagedVaultBackends() {
  managedVaultFactories.clear();
  cachedManagedVault = null;
}

let cachedManagedVault = null;
let cachedManagedVaultBackend = null;

/** Test seam: drop the memoized managed vault (and therefore its access-token cache). */
export function resetManagedVaultCache() {
  cachedManagedVault = null;
  cachedManagedVaultBackend = null;
}

function buildManagedVault(configured) {
  const factory = managedVaultFactories.get(configured);
  if (!factory) {
    throw new VaultError(
      `Credential vault backend "${configured}" is declared but no client is implemented in this build`,
      'VAULT_NOT_CONFIGURED',
    );
  }
  // Memoized per backend id: the vault owns an access-token cache and an in-flight-refresh guard, and
  // rebuilding it per request would throw both away and make every call mint a fresh token.
  if (cachedManagedVault && cachedManagedVaultBackend === configured) return cachedManagedVault;
  const vault = factory();
  cachedManagedVault = vault;
  cachedManagedVaultBackend = configured;
  return vault;
}

/**
 * Pick the vault for the current environment. FAILS CLOSED in production: an unset or `env_dev`
 * backend, or a managed backend with no registered client, raises NOT_CONFIGURED rather than falling
 * back to a volatile in-memory store.
 *
 * @param {{vault?:object, tenantId?:string}} [options]
 *   `tenantId` returns a TENANT-SCOPED view when the backend supports one, so the binding stops being
 *   a per-call-site discipline the caller can forget.
 */
export function resolveVault(options = {}) {
  if (options.vault) return scopeVault(options.vault, options.tenantId);
  const configured = String(process.env.DIASPORA_CREDENTIAL_VAULT_BACKEND || '').trim();

  if (configured && configured !== VAULT_BACKENDS.ENV_DEV && configured !== 'env') {
    // An explicitly named managed backend is honoured in EVERY environment, not just production:
    // staging must be able to exercise the real vault, and a dev machine pointed at a sandbox project
    // must not silently get the in-memory store instead.
    return scopeVault(buildManagedVault(configured), options.tenantId);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new VaultError(
      'No production credential vault is configured (set DIASPORA_CREDENTIAL_VAULT_BACKEND to a managed backend)',
      'VAULT_NOT_CONFIGURED',
    );
  }
  if (configured === 'env') return new EnvCredentialVault();
  return getSharedTestVault();
}

/** Apply a tenant scope when the backend offers one; otherwise hand back the vault unchanged. */
function scopeVault(vault, tenantId) {
  if (!tenantId || typeof vault?.forTenant !== 'function') return vault;
  return vault.forTenant(tenantId);
}
