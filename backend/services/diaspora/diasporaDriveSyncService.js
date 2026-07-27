/**
 * Phase 7 / GTM Drive lane — Diaspora Drive sync service (Issue #127).
 *
 * Provider-abstracted, feature-flagged. Persists only connection/file metadata plus an OPAQUE vault
 * handle — never a token, in any column, in any log line, in any response.
 *
 * The OAuth handshake here is defended at four independent layers, because each one covers a hole the
 * others do not:
 *
 *   1. SIGNED STATE (HMAC over user + tenant + nonce + expiry) — proves the callback corresponds to
 *      an authorization WE started, and binds it to the user and tenant who started it.
 *   2. ONE-TIME NONCE, consumed by a conditional UPDATE ... WHERE consumed_at IS NULL — makes replay
 *      a database-enforced impossibility rather than a timing assumption.
 *   3. PKCE (RFC 7636) — the authorization CODE travels back through the user's browser. Signed state
 *      proves the request is ours; it does not stop an attacker who intercepted the code in that
 *      browser from redeeming it. Only the verifier, which never left the server, does that.
 *   4. EXACT REDIRECT-URI MATCH — enforced in the OAuth client against a configured allow-list.
 *
 * The PKCE verifier itself goes into the vault, not into a column: it is single-use secret material,
 * and `diaspora_oauth_states` holds only the handle to it alongside the public challenge.
 */
import crypto from 'crypto';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  DRIVE_PROVIDERS,
  DRIVE_SCOPES,
  DRIVE_CONNECTION_STATUS,
  DRIVE_FILE_SYNC_STATUS,
  DRIVE_FOLDER_STRUCTURE,
  OAUTH_STATE_TTL_MS,
  isDriveEnabled,
  driveStateSecret,
  driveCredentialsConfigured,
} from '../../constants/diaspora/diasporaDriveConstants.js';
import { requireUserContext, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendCriticalAudit } from './diasporaServiceUtils.js';
// Enforcement via the GUARD (no-op while DIASPORA_SUBSCRIPTION_ENFORCEMENT is off, which is default).
import { requireFeature } from './diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';
import { getDriveProvider, DriveProviderError } from './drive/driveProvider.js';
import { resolveVault, redactSecretMaterial, CREDENTIAL_PURPOSES } from './drive/credentialVault.js';
// Side-effect import: registers the managed vault backends so `resolveVault()` can return one.
import './drive/vaultBackends.js';
import { createPkcePair, deriveCodeChallenge, configuredRedirectUris } from './drive/googleOAuthClient.js';
import {
  recordCredentialReference,
  findActiveCredentialReference,
  markCredentialRefreshed,
  markCredentialError,
  revokeCredentialReference,
  sanitizeCredentialReference,
  CREDENTIAL_STATUS,
} from './drive/credentialReferenceStore.js';
import {
  runSyncAttempt,
  listSyncAttemptsForEntity,
  SYNC_ATTEMPT_OPERATION,
} from './drive/driveSyncQueue.js';

const CONNECTIONS = 'diaspora_drive_connections';
const FILES = 'diaspora_drive_files';
const OAUTH_STATES = 'diaspora_oauth_states';

const ENTITY_FOLDER = {
  buyer_order: 'Buyer Orders',
  import_order: 'Import Documents',
  stock_item: 'Seller Stock',
  supply_document: 'Seller Stock',
  trade_document: 'Import Documents',
  shipment: 'Import Documents',
  export: 'Export Documents',
};

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a signed OAuth state carrying user, tenant, issued-at, expiry and a one-time nonce.
 * Exported as a test seam so expiry/foreign-state cases can be constructed deterministically.
 */
export function buildOAuthState({ userId, tenantId = null, nonce, iat, exp }) {
  const payload = b64url(JSON.stringify({ userId, tenantId: tenantId || null, nonce, iat, exp }));
  const sig = crypto.createHmac('sha256', driveStateSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Verify signature, expiry and user/tenant binding (no DB). Throws on any failure. */
function parseAndVerifyState(state, expectedUserId, expectedTenantId = null) {
  if (!state || typeof state !== 'string' || !state.includes('.')) throw new ValidationError('Invalid OAuth state');
  const [payload, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', driveStateSecret()).update(payload).digest('hex');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new ValidationError('OAuth state signature is invalid');
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    throw new ValidationError('OAuth state payload is malformed');
  }
  if (normalizeId(decoded.userId) !== normalizeId(expectedUserId)) {
    throw new ForbiddenError('OAuth state does not belong to the authenticated user');
  }
  // Tenant binding. A user who belongs to two tenants must not be able to start authorization in one
  // and land the resulting connection — and therefore every document synced through it — in the other.
  if (normalizeId(decoded.tenantId) !== normalizeId(expectedTenantId)) {
    throw new ForbiddenError('OAuth state does not belong to the authenticated tenant');
  }
  if (!decoded.exp || Date.now() > Number(decoded.exp)) {
    throw new ValidationError('OAuth state has expired');
  }
  if (!decoded.nonce) throw new ValidationError('OAuth state is missing its nonce');
  return decoded;
}

/** Consume the nonce exactly once via a conditional update (consumed_at IS NULL). */
async function consumeNonce(client, decoded, userId) {
  const { data } = await client
    .from(OAUTH_STATES)
    .update({ consumed_at: new Date().toISOString() })
    .eq('nonce', decoded.nonce)
    .eq('user_id', userId)
    .is('consumed_at', null)
    .select()
    .maybeSingle();
  if (!data) throw new ValidationError('OAuth state has already been used or is unknown');
  return data;
}

/** Strip all credential/token material before returning a connection to any caller. */
function sanitizeConnection(connection) {
  if (!connection) return null;
  const { credential_reference, ...safe } = connection;
  void credential_reference;
  return {
    id: safe.id,
    provider: safe.provider,
    providerAccountEmail: safe.provider_account_email,
    rootFolderId: safe.root_folder_id,
    rootFolderUrl: safe.root_folder_url,
    scopes: safe.permission_scope ? String(safe.permission_scope).split(' ') : [],
    accessStatus: safe.access_status,
    lastSyncAt: safe.last_sync_at,
    revokedAt: safe.revoked_at,
    connected: safe.access_status === DRIVE_CONNECTION_STATUS.ACTIVE,
  };
}

function sanitizeFile(file) {
  if (!file) return null;
  return {
    id: file.id,
    provider: file.provider,
    driveFileId: file.drive_file_id,
    driveFileUrl: file.drive_file_url,
    fileName: file.file_name,
    mimeType: file.mime_type,
    checksumSha256: file.checksum_sha256,
    linkedEntityType: file.linked_entity_type,
    linkedEntityId: file.linked_entity_id,
    syncStatus: file.sync_status,
    lastSyncAt: file.last_sync_at,
  };
}

async function loadOwnConnection(client, context, { required = true } = {}) {
  const { data } = await client.from(CONNECTIONS).select('*').eq('user_id', context.id).eq('provider', DRIVE_PROVIDERS.GOOGLE).is('deleted_at', null).maybeSingle();
  if (!data && required) throw new NotFoundError('No Drive connection for this user');
  return data || null;
}

/**
 * Turn any provider failure into a user-facing ValidationError with a sanitized message.
 * The original code and retryability are preserved on the thrown error for the queue and for tests.
 */
function toUserFacingError(err, fallback) {
  const message = err instanceof DriveProviderError ? redactSecretMaterial(err.message) : fallback;
  const error = new ValidationError(message);
  if (err instanceof DriveProviderError) {
    error.providerCode = err.code;
    error.retryable = err.retryable;
  }
  return error;
}

export async function getDriveStatus(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context, { required: false });
  let credential = null;
  if (context.tenantId) {
    const row = await findActiveCredentialReference(client, {
      tenantId: context.tenantId, userId: context.id, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    });
    credential = sanitizeCredentialReference(row);
  }
  return {
    enabled: isDriveEnabled(),
    provider: DRIVE_PROVIDERS.GOOGLE,
    scopes: DRIVE_SCOPES,
    connection: sanitizeConnection(connection),
    credential,
    // Truthful activation reporting: the integration is code-complete, but a live connection needs
    // owner-provisioned OAuth credentials. Saying so beats a Connect button that can only fail.
    activation: {
      credentialsConfigured: driveCredentialsConfigured(),
      redirectUris: configuredRedirectUris().length,
      pending: !driveCredentialsConfigured(),
    },
    onedrive: { available: false, note: 'OneDrive is represented by the provider interface only in this phase.' },
    workbookExport: { xlsx: false, note: 'Binary XLSX export is not yet available; JSON/report export only.' },
  };
}

export async function getAuthorizationUrl(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  const client = await resolveClient(options);

  // diaspora.drive.connect — gated at the point authorization STARTS, before a PKCE verifier is put
  // in the vault or a nonce row is written, so a denied tenant leaves no state behind to clean up.
  // The callback below carries the same gate: the two halves are separately reachable HTTP routes,
  // and gating only the first would let a caller who already holds a state string finish the connect.
  await requireFeature(client, {
    tenantId: context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.DRIVE_CONNECT,
  });

  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);
  // Tenant-SCOPED when a tenant is known: a managed vault returns a view that carries the binding on
  // every call, so "remember to pass the tenant" stops being a per-call-site discipline. The
  // in-memory adapter has no scoping and is handed back unchanged.
  const vault = resolveVault({ ...options, tenantId: context.tenantId || null });

  // PKCE: the challenge is public and goes to Google; the verifier is secret and stays here, in the
  // vault, referenced from the state row by an opaque handle.
  const pkce = createPkcePair();
  const verifier = await vault.put({
    purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    tenantId: context.tenantId || null,
    userId: context.id,
    secret: pkce.codeVerifier,
    metadata: { kind: 'pkce_verifier' },
  });

  const redirectUri = options.redirectUri || configuredRedirectUris()[0] || null;

  // Issue a one-time, expiring nonce bound to the user; the signed state carries it.
  const nonce = crypto.randomBytes(16).toString('hex');
  const iat = Date.now();
  const exp = iat + OAUTH_STATE_TTL_MS;
  const { error } = await client.from(OAUTH_STATES).insert({
    nonce,
    provider: DRIVE_PROVIDERS.GOOGLE,
    user_id: context.id,
    tenant_id: context.tenantId || null,
    issued_at: new Date(iat).toISOString(),
    expires_at: new Date(exp).toISOString(),
    metadata: {
      pkce: {
        method: pkce.codeChallengeMethod,
        challenge: pkce.codeChallenge,          // public by design
        verifierReference: verifier.vaultReference, // opaque handle, never the verifier itself
        vaultBackend: verifier.vaultBackend,
      },
      redirectUri,
    },
  }).select().single();
  if (error) {
    await vault.destroy(verifier.vaultReference).catch(() => {});
    throw new ValidationError(`Failed to initialize Drive authorization: ${error.message}`);
  }

  const state = buildOAuthState({ userId: context.id, tenantId: context.tenantId, nonce, iat, exp });
  let url;
  try {
    // Throws NOT_CONFIGURED if the owner's Google credentials are absent (fail closed).
    url = provider.buildAuthorizationUrl(state, DRIVE_SCOPES, {
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
      redirectUri,
    });
  } catch (err) {
    await vault.destroy(verifier.vaultReference).catch(() => {});
    throw toUserFacingError(err, 'Drive authorization could not be started');
  }
  // The verifier is deliberately NOT returned. Only the challenge ever leaves this process.
  return { url, scopes: DRIVE_SCOPES, state, codeChallengeMethod: pkce.codeChallengeMethod };
}

export async function handleOAuthCallback({ code, state } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  if (!code) throw new ValidationError('Missing authorization code');

  const client = await resolveClient(options);

  // The second half of the diaspora.drive.connect gate. A state string issued while the tenant was
  // entitled must not still complete the connection after the plan changed — and this route is
  // reachable on its own, so it cannot rely on the authorize call having been checked.
  await requireFeature(client, {
    tenantId: context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.DRIVE_CONNECT,
  });

  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);
  // Same tenant scoping as `getAuthorizationUrl`: the verifier was stored under this tenant, so a
  // managed vault refuses to hand it back while acting for another one.
  const vault = resolveVault({ ...options, tenantId: context.tenantId || null });

  // Signature + expiry + user/tenant binding, then one-time nonce consumption (replay rejected).
  const decoded = parseAndVerifyState(state, context.id, context.tenantId);
  const stateRow = await consumeNonce(client, decoded, context.id);

  const pkceMeta = stateRow?.metadata?.pkce || {};
  let codeVerifier = null;
  if (pkceMeta.verifierReference) {
    try {
      codeVerifier = (await vault.get(pkceMeta.verifierReference)).secret;
    } catch {
      throw new ValidationError('Drive authorization could not be completed. Start the connection again.');
    }
    // The verifier must still hash to the challenge that was actually sent to Google. If a state row
    // were swapped for another user's, this is where it stops.
    if (pkceMeta.challenge && deriveCodeChallenge(codeVerifier) !== pkceMeta.challenge) {
      await vault.destroy(pkceMeta.verifierReference).catch(() => {});
      throw new ValidationError('Drive authorization could not be verified. Start the connection again.');
    }
  }

  let exchanged;
  try {
    exchanged = await provider.exchangeAuthorizationCode(code, {
      codeVerifier,
      expectedCodeChallenge: pkceMeta.challenge || null,
      redirectUri: stateRow?.metadata?.redirectUri || null,
      tenantId: context.tenantId || null,
      userId: context.id,
    });
  } catch (err) {
    throw toUserFacingError(err, 'Drive authorization failed');
  } finally {
    // Single use, win or lose. A verifier that outlives its exchange is a replay primitive.
    if (pkceMeta.verifierReference) await vault.destroy(pkceMeta.verifierReference).catch(() => {});
  }

  // Ensure the approved root folder exists (best effort) and persist ONLY the credential reference.
  let rootFolderId = null;
  let rootFolderUrl = null;
  try {
    const folder = await provider.ensureFolder(exchanged.credentialReference, DRIVE_FOLDER_STRUCTURE.root, null);
    rootFolderId = folder.folderId;
    rootFolderUrl = folder.folderUrl || null;
  } catch { /* folder creation is non-fatal for connection persistence */ }

  const existing = await loadOwnConnection(client, context, { required: false });
  const row = {
    tenant_id: context.tenantId || null,
    user_id: context.id,
    provider: DRIVE_PROVIDERS.GOOGLE,
    provider_account_email: exchanged.providerAccountEmail || null,
    provider_account_id: exchanged.providerAccountId || null,
    root_folder_id: rootFolderId,
    root_folder_url: rootFolderUrl,
    permission_scope: (exchanged.scopes || DRIVE_SCOPES).join(' '),
    credential_reference: exchanged.credentialReference, // opaque reference, not a token
    access_status: DRIVE_CONNECTION_STATUS.ACTIVE,
    revoked_at: null,
    metadata: { expiresAt: exchanged.expiresAt || null, vaultBackend: exchanged.vaultBackend || null },
    updated_by: context.id,
  };

  let saved;
  if (existing) {
    // Reconnecting: the previous vault entry becomes unreachable the moment we overwrite the handle,
    // so destroy it rather than leaving a live refresh token orphaned in the vault forever.
    if (existing.credential_reference && existing.credential_reference !== exchanged.credentialReference) {
      await provider.revoke(existing.credential_reference).catch(() => {});
    }
    const { data, error } = await client.from(CONNECTIONS).update(row).eq('id', existing.id).select().single();
    if (error) throw new ValidationError(`Failed to update Drive connection: ${error.message}`);
    saved = data;
  } else {
    const { data, error } = await client.from(CONNECTIONS).insert({ ...row, created_by: context.id }).select().single();
    if (error) throw new ValidationError(`Failed to create Drive connection: ${error.message}`);
    saved = data;
  }

  // The ledger #21 registry records the credential's lifecycle. It is tenant-scoped (tenant_id is
  // NOT NULL there), so a user with no tenant context gets the connection but no registry row — and
  // that is reported truthfully rather than papered over with a placeholder tenant.
  let credentialRegistry = { recorded: false, reason: 'no_tenant_context' };
  if (context.tenantId) {
    const registered = await recordCredentialReference(client, {
      tenantId: context.tenantId,
      userId: context.id,
      purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
      vaultBackend: exchanged.vaultBackend || 'env_dev',
      vaultReference: exchanged.credentialReference,
      keyVersion: exchanged.keyVersion || null,
      scopes: exchanged.scopes || [...DRIVE_SCOPES],
      externalAccountLabel: exchanged.providerAccountEmail || null,
      expiresAt: exchanged.expiresAt || null,
    });
    credentialRegistry = { recorded: true, id: registered.id };
  }

  await appendCriticalAudit(client, {
    actorId: context.id,
    tenantId: saved.tenant_id,
    action: 'DRIVE_CONNECTED',
    resourceType: 'diaspora_drive_connection',
    resourceId: saved.id,
    metadata: { provider: DRIVE_PROVIDERS.GOOGLE, scopes: exchanged.scopes || DRIVE_SCOPES, credentialRegistry },
  });
  return sanitizeConnection(saved);
}

export async function disconnectDrive(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  // Best effort at the provider; the local drop below happens regardless, because leaving a usable
  // credential behind after the user pressed "disconnect" is the worse failure.
  try { await provider.revoke(connection.credential_reference); } catch { /* revoke best-effort */ }

  const { data, error } = await client.from(CONNECTIONS).update({
    access_status: DRIVE_CONNECTION_STATUS.DISCONNECTED,
    revoked_at: new Date().toISOString(),
    credential_reference: null, // drop the reference locally on disconnect
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id).select().single();
  if (error) throw new ValidationError(`Failed to disconnect Drive: ${error.message}`);

  if (context.tenantId) {
    const active = await findActiveCredentialReference(client, {
      tenantId: context.tenantId, userId: context.id, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    });
    if (active) await revokeCredentialReference(client, active.id);
  }

  await appendCriticalAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'DRIVE_DISCONNECTED', resourceType: 'diaspora_drive_connection', resourceId: data.id });
  return sanitizeConnection(data);
}

export async function listDriveFiles(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context, { required: false });
  if (!connection) return [];
  const { data } = await client.from(FILES).select('*').eq('drive_connection_id', connection.id).is('deleted_at', null).order('created_at', { ascending: false });
  return (data || []).map(sanitizeFile);
}

async function activeConnectionOrThrow(client, context) {
  const connection = await loadOwnConnection(client, context);
  if (connection.access_status !== DRIVE_CONNECTION_STATUS.ACTIVE || !connection.credential_reference) {
    throw new ValidationError('Drive connection is not active. Reconnect required.');
  }
  return connection;
}

/**
 * Mark a connection (and its registry row) according to what the provider actually said.
 * Only terminal codes disconnect the account — a rate limit must NOT.
 */
async function applyProviderFailureToConnection(client, context, connection, err) {
  const code = err instanceof DriveProviderError ? err.code : null;
  const terminal = ['REVOKED', 'INSUFFICIENT_SCOPE', 'SCOPE_ESCALATION'].includes(code);
  if (!terminal) return;
  await client.from(CONNECTIONS)
    .update({ access_status: DRIVE_CONNECTION_STATUS.REVOKED, updated_at: new Date().toISOString() })
    .eq('id', connection.id).select().maybeSingle();
  if (context.tenantId) {
    const active = await findActiveCredentialReference(client, {
      tenantId: context.tenantId, userId: context.id, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    });
    if (active) {
      await markCredentialError(client, active.id, {
        code, message: err.message, status: CREDENTIAL_STATUS.REVOKED,
      });
    }
  }
}

/** The provider work for one upload, shared by the durable and the untracked path. */
async function performUpload(provider, connection, { linkedEntityType, fileName, payload }) {
  const folder = await provider.ensureFolder(
    connection.credential_reference,
    ENTITY_FOLDER[linkedEntityType] || DRIVE_FOLDER_STRUCTURE.root,
    connection.root_folder_id,
  );
  const uploaded = await provider.uploadFile(connection.credential_reference, {
    name: fileName,
    content: payload.content || '',
    folderId: folder.folderId,
    mimeType: payload.mimeType || 'application/json',
  });
  return { folder, uploaded };
}

export async function uploadDriveFile(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  const client = await resolveClient(options);

  // diaspora.drive.export — gated HERE, at the single funnel through which platform content leaves
  // for Drive, rather than on exportToDrive alone. exportToDrive adds no capability of its own: it
  // formats a payload and calls this function. A gate only there would be enforcement theatre,
  // because POST /drive/upload reaches the identical provider write with caller-chosen content.
  //
  // The entity type is deliberately NOT part of the decision. It arrives in the request body, and a
  // gate that branched on it would be a gate the client configures.
  await requireFeature(client, {
    tenantId: context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.DRIVE_EXPORT,
  });

  const connection = await activeConnectionOrThrow(client, context);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  const linkedEntityType = payload.linkedEntityType || 'export';
  const fileName = payload.fileName || `${linkedEntityType}-${Date.now()}.json`;
  const contentChecksum = crypto.createHash('sha256').update(String(payload.content ?? '')).digest('hex');

  const recordFile = async (uploaded) => {
    const { data, error } = await client.from(FILES).insert({
      tenant_id: connection.tenant_id || null,
      drive_connection_id: connection.id,
      provider: DRIVE_PROVIDERS.GOOGLE,
      drive_file_id: uploaded.fileId,
      drive_file_url: uploaded.fileUrl,
      file_name: fileName,
      mime_type: payload.mimeType || 'application/json',
      checksum_sha256: uploaded.checksum || null,
      linked_entity_type: linkedEntityType,
      linked_entity_id: String(payload.linkedEntityId || ''),
      sync_status: DRIVE_FILE_SYNC_STATUS.SYNCED,
      last_sync_at: new Date().toISOString(),
      metadata: { idempotencyKey: payload.idempotencyKey || null, providerMd5: uploaded.providerMd5 || null },
      created_by: context.id,
      updated_by: context.id,
    }).select().single();
    if (error) throw new ValidationError(`Failed to record Drive file: ${error.message}`);
    await appendCriticalAudit(client, {
      actorId: context.id,
      tenantId: data.tenant_id,
      action: 'DRIVE_FILE_UPLOADED',
      resourceType: 'diaspora_drive_file',
      resourceId: data.id,
      metadata: { linkedEntityType, linkedEntityId: data.linked_entity_id },
    });
    return data;
  };

  // ── Durable path: a tenant context means every attempt is a queue row with a truthful state ──
  if (context.tenantId && payload.idempotencyKey) {
    const descriptor = {
      tenantId: context.tenantId,
      userId: context.id,
      connectionId: connection.id,
      operation: SYNC_ATTEMPT_OPERATION.UPLOAD,
      entityType: linkedEntityType,
      entityId: payload.linkedEntityId || null,
      idempotencyKey: String(payload.idempotencyKey),
      contentChecksum,
      metadata: { fileName },
    };
    let outcome;
    try {
      outcome = await runSyncAttempt(client, descriptor, async () => {
        const { folder, uploaded } = await performUpload(provider, connection, { linkedEntityType, fileName, payload });
        const saved = await recordFile(uploaded);
        return {
          providerFileId: uploaded.fileId,
          providerFolderId: folder.folderId,
          bytes: uploaded.bytes ?? null,
          contentChecksum,
          result: saved,
        };
      }, { auditContext: { actorId: context.id } });
    } catch (err) {
      await applyProviderFailureToConnection(client, context, connection, err);
      if (err instanceof ValidationError) throw err;
      throw toUserFacingError(err, 'Drive upload failed');
    }
    if (outcome.replayed) {
      // The work already succeeded under this key. Return the file we recorded then — do NOT upload
      // a second copy just because the caller retried the HTTP request.
      const { data: existing } = await client.from(FILES).select('*')
        .eq('drive_connection_id', connection.id).eq('drive_file_id', outcome.attempt.providerFileId).is('deleted_at', null).maybeSingle();
      return { file: sanitizeFile(existing), idempotentReplay: true, attempt: outcome.attempt };
    }
    return { file: sanitizeFile(outcome.result), idempotentReplay: false, attempt: outcome.attempt };
  }

  // ── Untracked path: no tenant (tenant_id is NOT NULL on the attempts table) or no key ──
  // Idempotency here is best effort over the recorded files, and we say so rather than implying the
  // durable guarantee applies.
  if (payload.idempotencyKey) {
    const { data: existing } = await client.from(FILES).select('*').eq('drive_connection_id', connection.id).is('deleted_at', null);
    const dup = (existing || []).find((f) => f.metadata?.idempotencyKey === payload.idempotencyKey);
    if (dup) return { file: sanitizeFile(dup), idempotentReplay: true, durableTracking: false };
  }

  let uploaded;
  try {
    ({ uploaded } = await performUpload(provider, connection, { linkedEntityType, fileName, payload }));
  } catch (err) {
    await applyProviderFailureToConnection(client, context, connection, err);
    throw toUserFacingError(err, 'Drive upload failed');
  }
  const saved = await recordFile(uploaded);
  return { file: sanitizeFile(saved), idempotentReplay: false, durableTracking: false };
}

/** Truthful export: only artifacts the system can actually generate (JSON/report), never fake XLSX. */
export async function exportToDrive(payload = {}, userContext = {}, options = {}) {
  if (payload.format && String(payload.format).toLowerCase() === 'xlsx') {
    throw new ValidationError('Binary XLSX export is not available yet. Export JSON/report artifacts instead.');
  }
  const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content || {}, null, 2);
  return uploadDriveFile({
    ...payload,
    fileName: payload.fileName || `${payload.linkedEntityType || 'export'}-${payload.linkedEntityId || 'report'}.json`,
    mimeType: 'application/json',
    content,
    linkedEntityType: payload.linkedEntityType || 'export',
  }, userContext, options);
}

export async function syncDrive(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  if (!connection.credential_reference) return sanitizeConnection(connection);

  let refreshed;
  try {
    refreshed = await provider.refreshAccessToken(connection.credential_reference);
  } catch (err) {
    await applyProviderFailureToConnection(client, context, connection, err);
    if (err instanceof DriveProviderError && ['REVOKED', 'INSUFFICIENT_SCOPE'].includes(err.code)) {
      const { data } = await client.from(CONNECTIONS).select('*').eq('id', connection.id).maybeSingle();
      return sanitizeConnection(data);
    }
    throw toUserFacingError(err, 'Drive sync failed');
  }

  if (context.tenantId) {
    const active = await findActiveCredentialReference(client, {
      tenantId: context.tenantId, userId: context.id, purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
    });
    if (active) await markCredentialRefreshed(client, active.id, { expiresAt: refreshed?.expiresAt || null });
  }

  const { data } = await client.from(CONNECTIONS).update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', connection.id).select().single();
  return sanitizeConnection(data);
}

/**
 * Durable sync history for one entity — what an operator (or the UI) reads to answer "did my document
 * actually reach Drive?" with something other than optimism.
 */
export async function getEntitySyncAttempts({ entityType, entityId } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!entityType || !entityId) throw new ValidationError('entityType and entityId are required');
  if (!context.tenantId) return { attempts: [], durableTracking: false, reason: 'no_tenant_context' };
  const client = await resolveClient(options);
  const attempts = await listSyncAttemptsForEntity(client, { tenantId: context.tenantId, entityType, entityId });
  return { attempts, durableTracking: true };
}
