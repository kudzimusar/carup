/**
 * Diaspora GTM — the `diaspora_credential_references` registry (Issue #127, Drive lane).
 *
 * Ledger #21 created this table as the single durable record of "this tenant/user has a credential
 * for this purpose, it lives at this vault handle, here is its lifecycle state". It stores no secret,
 * and every write path here calls `assertOpaqueReference` before the value can reach the driver.
 *
 * Lifecycle rules encoded here (the partial unique index
 * `uq_diaspora_credential_active (tenant_id, coalesce(user_id,''), purpose) WHERE status='active'`
 * enforces the first one in Postgres):
 *
 *   - At most ONE active reference per (tenant, user, purpose). Reconnecting supersedes the previous
 *     row rather than deleting it, so the audit trail of "when did this account's access change"
 *     survives.
 *   - Superseded/revoked rows keep their vault handle for forensics but are never used to mint access.
 *   - Errors are recorded as (code, sanitized message). `last_error` is scrubbed through
 *     `redactSecretMaterial` on the way in, because the most likely source of a leak into a database
 *     column is an upstream error string nobody inspected.
 */
import { ValidationError, DatabaseError } from '../../../utils/errors.js';
import {
  assertOpaqueReference,
  redactSecretMaterial,
  CREDENTIAL_PURPOSES,
  VAULT_BACKENDS,
} from './credentialVault.js';

export const CREDENTIAL_REFERENCES_TABLE = 'diaspora_credential_references';

export const CREDENTIAL_STATUS = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  ERROR: 'error',
  PENDING_ACTIVATION: 'pending_activation',
});

const VALID_BACKENDS = new Set(Object.values(VAULT_BACKENDS));
const VALID_PURPOSES = new Set(Object.values(CREDENTIAL_PURPOSES));
const VALID_STATUSES = new Set(Object.values(CREDENTIAL_STATUS));

/** Longest `last_error` we will persist. Truncation is applied AFTER redaction, never before. */
const MAX_ERROR_LENGTH = 400;

function sanitizeErrorText(text) {
  if (!text) return null;
  const redacted = redactSecretMaterial(String(text));
  return redacted.length > MAX_ERROR_LENGTH ? `${redacted.slice(0, MAX_ERROR_LENGTH)}…` : redacted;
}

/**
 * Project a registry row for any caller. Deliberately DOES NOT include `vault_reference`: an opaque
 * handle is not a secret, but it is also not something an API consumer has any use for, and the
 * cheapest way to guarantee a handle never reaches a browser is to never put it in a response.
 */
export function sanitizeCredentialReference(row) {
  if (!row) return null;
  return {
    id: row.id,
    purpose: row.purpose,
    vaultBackend: row.vault_backend,
    keyVersion: row.key_version || null,
    scopes: Array.isArray(row.scopes) ? [...row.scopes] : [],
    status: row.status,
    externalAccountLabel: row.external_account_label || null,
    expiresAt: row.expires_at || null,
    lastRefreshedAt: row.last_refreshed_at || null,
    lastErrorCode: row.last_error_code || null,
    revokedAt: row.revoked_at || null,
  };
}

function assertPersistableDescriptor({ tenantId, purpose, vaultBackend, vaultReference, status }) {
  if (!tenantId) {
    // tenant_id is NOT NULL on the table. Inventing a placeholder tenant would corrupt every
    // tenant-scoped query that follows, so refuse loudly instead.
    throw new ValidationError('A tenant context is required to record a credential reference');
  }
  if (!VALID_PURPOSES.has(purpose)) {
    throw new ValidationError(`Unsupported credential purpose: ${purpose}`);
  }
  if (!VALID_BACKENDS.has(vaultBackend)) {
    throw new ValidationError(`Unsupported credential vault backend: ${vaultBackend}`);
  }
  if (status && !VALID_STATUSES.has(status)) {
    throw new ValidationError(`Unsupported credential status: ${status}`);
  }
  // THE check. Everything else in this file is bookkeeping; this is the invariant.
  assertOpaqueReference(vaultReference);
}

/** The current active reference for a (tenant, user, purpose), or null. */
export async function findActiveCredentialReference(client, { tenantId, userId = null, purpose }) {
  const query = client
    .from(CREDENTIAL_REFERENCES_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('purpose', purpose)
    .eq('status', CREDENTIAL_STATUS.ACTIVE);
  const scoped = userId === null || userId === undefined ? query.is('user_id', null) : query.eq('user_id', userId);
  const { data, error } = await scoped.maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to read credential reference: ${sanitizeErrorText(error.message)}`);
  }
  return data || null;
}

/**
 * Record a new active reference, superseding any existing active one for the same
 * (tenant, user, purpose). Returns the persisted row.
 *
 * `supersededStatus` decides how the previous row is retired: `revoked` when the user disconnected
 * or reconnected a different account, `expired` when the credential simply aged out.
 */
export async function recordCredentialReference(client, {
  tenantId,
  userId = null,
  purpose = CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
  vaultBackend,
  vaultReference,
  keyVersion = null,
  scopes = [],
  externalAccountLabel = null,
  expiresAt = null,
  metadata = {},
  supersededStatus = CREDENTIAL_STATUS.REVOKED,
} = {}) {
  assertPersistableDescriptor({ tenantId, purpose, vaultBackend, vaultReference, status: CREDENTIAL_STATUS.ACTIVE });

  const existing = await findActiveCredentialReference(client, { tenantId, userId, purpose });
  if (existing) {
    // Retire first: the partial unique index would otherwise reject the insert, and a caller who
    // reconnects should not be told "duplicate key".
    const { error } = await client
      .from(CREDENTIAL_REFERENCES_TABLE)
      .update({ status: supersededStatus, revoked_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .maybeSingle();
    if (error) {
      throw new DatabaseError(`Failed to supersede credential reference: ${sanitizeErrorText(error.message)}`);
    }
  }

  const { data, error } = await client
    .from(CREDENTIAL_REFERENCES_TABLE)
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      purpose,
      vault_backend: vaultBackend,
      vault_reference: vaultReference,
      key_version: keyVersion,
      scopes: Array.isArray(scopes) ? scopes : [],
      status: CREDENTIAL_STATUS.ACTIVE,
      external_account_label: externalAccountLabel,
      expires_at: expiresAt,
      last_refreshed_at: new Date().toISOString(),
      last_error_code: null,
      last_error: null,
      revoked_at: null,
      metadata: metadata || {},
    })
    .select()
    .single();
  if (error) {
    throw new DatabaseError(`Failed to record credential reference: ${sanitizeErrorText(error.message)}`);
  }
  return data;
}

/** Mark a successful refresh: new expiry, cleared error, bumped key version. */
export async function markCredentialRefreshed(client, referenceId, { expiresAt = null, keyVersion = null } = {}) {
  const patch = {
    status: CREDENTIAL_STATUS.ACTIVE,
    last_refreshed_at: new Date().toISOString(),
    expires_at: expiresAt,
    last_error_code: null,
    last_error: null,
  };
  if (keyVersion) patch.key_version = keyVersion;
  const { data, error } = await client
    .from(CREDENTIAL_REFERENCES_TABLE)
    .update(patch)
    .eq('id', referenceId)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to mark credential refreshed: ${sanitizeErrorText(error.message)}`);
  return data || null;
}

/**
 * Record a provider failure against the reference. `status` distinguishes a transient error (the
 * credential is still usable, we just failed once) from a terminal one (revoked/expired), because
 * only the terminal states should make the UI say "reconnect required".
 */
export async function markCredentialError(client, referenceId, { code = 'PROVIDER_ERROR', message = null, status = CREDENTIAL_STATUS.ERROR } = {}) {
  if (!VALID_STATUSES.has(status)) throw new ValidationError(`Unsupported credential status: ${status}`);
  const patch = {
    status,
    last_error_code: String(code).slice(0, 64),
    last_error: sanitizeErrorText(message),
  };
  if (status === CREDENTIAL_STATUS.REVOKED) patch.revoked_at = new Date().toISOString();
  const { data, error } = await client
    .from(CREDENTIAL_REFERENCES_TABLE)
    .update(patch)
    .eq('id', referenceId)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to record credential error: ${sanitizeErrorText(error.message)}`);
  return data || null;
}

/** Retire a reference (disconnect / revocation). The row stays for audit; the handle stops being used. */
export async function revokeCredentialReference(client, referenceId, { status = CREDENTIAL_STATUS.REVOKED } = {}) {
  if (!VALID_STATUSES.has(status)) throw new ValidationError(`Unsupported credential status: ${status}`);
  const { data, error } = await client
    .from(CREDENTIAL_REFERENCES_TABLE)
    .update({ status, revoked_at: new Date().toISOString() })
    .eq('id', referenceId)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to revoke credential reference: ${sanitizeErrorText(error.message)}`);
  return data || null;
}

export const __testables = { sanitizeErrorText };
