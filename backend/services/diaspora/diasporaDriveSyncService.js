/**
 * Phase 7 — Diaspora Drive sync service.
 *
 * Provider-abstracted, feature-flagged. Persists only connection/file metadata + an opaque
 * credential reference (never tokens). OAuth state is signed and bound to the initiating user; the
 * callback rejects tampered/foreign state. Token material is never returned to the frontend or logged.
 */
import crypto from 'crypto';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  DRIVE_PROVIDERS,
  DRIVE_SCOPES,
  DRIVE_CONNECTION_STATUS,
  DRIVE_FILE_SYNC_STATUS,
  DRIVE_FOLDER_STRUCTURE,
  isDriveEnabled,
  driveStateSecret,
} from '../../constants/diaspora/diasporaDriveConstants.js';
import { requireUserContext, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendCriticalAudit } from './diasporaServiceUtils.js';
import { getDriveProvider, DriveProviderError } from './drive/driveProvider.js';

const CONNECTIONS = 'diaspora_drive_connections';
const FILES = 'diaspora_drive_files';

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

function signState({ userId, tenantId }) {
  const payload = b64url(JSON.stringify({ userId, tenantId: tenantId || null, nonce: crypto.randomBytes(8).toString('hex') }));
  const sig = crypto.createHmac('sha256', driveStateSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyState(state, expectedUserId) {
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
  return decoded;
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

export async function getDriveStatus(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context, { required: false });
  return {
    enabled: isDriveEnabled(),
    provider: DRIVE_PROVIDERS.GOOGLE,
    scopes: DRIVE_SCOPES,
    connection: sanitizeConnection(connection),
    onedrive: { available: false, note: 'OneDrive is represented by the provider interface only in this phase.' },
    workbookExport: { xlsx: false, note: 'Binary XLSX export is not yet available; JSON/report export only.' },
  };
}

export async function getAuthorizationUrl(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);
  const state = signState({ userId: context.id, tenantId: context.tenantId });
  const url = provider.buildAuthorizationUrl(state, DRIVE_SCOPES);
  return { url, scopes: DRIVE_SCOPES, state };
}

export async function handleOAuthCallback({ code, state } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  if (!code) throw new ValidationError('Missing authorization code');
  verifyState(state, context.id); // binds the connection to the initiating user; rejects foreign/tampered state

  const client = await resolveClient(options);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  let exchanged;
  try {
    exchanged = await provider.exchangeAuthorizationCode(code);
  } catch (err) {
    throw new ValidationError(err instanceof DriveProviderError ? err.message : 'Drive authorization failed');
  }

  // Ensure the approved root folder exists (best effort) and persist ONLY the credential reference.
  let rootFolderId = null;
  try {
    const folder = await provider.ensureFolder(exchanged.credentialReference, DRIVE_FOLDER_STRUCTURE.root, null);
    rootFolderId = folder.folderId;
  } catch { /* folder creation is non-fatal for connection persistence */ }

  const existing = await loadOwnConnection(client, context, { required: false });
  const row = {
    tenant_id: context.tenantId || null,
    user_id: context.id,
    provider: DRIVE_PROVIDERS.GOOGLE,
    provider_account_email: exchanged.providerAccountEmail || null,
    provider_account_id: exchanged.providerAccountId || null,
    root_folder_id: rootFolderId,
    permission_scope: (exchanged.scopes || DRIVE_SCOPES).join(' '),
    credential_reference: exchanged.credentialReference, // opaque reference, not a token
    access_status: DRIVE_CONNECTION_STATUS.ACTIVE,
    revoked_at: null,
    metadata: { expiresAt: exchanged.expiresAt || null },
    updated_by: context.id,
  };

  let saved;
  if (existing) {
    const { data, error } = await client.from(CONNECTIONS).update(row).eq('id', existing.id).select().single();
    if (error) throw new ValidationError(`Failed to update Drive connection: ${error.message}`);
    saved = data;
  } else {
    const { data, error } = await client.from(CONNECTIONS).insert({ ...row, created_by: context.id }).select().single();
    if (error) throw new ValidationError(`Failed to create Drive connection: ${error.message}`);
    saved = data;
  }

  await appendCriticalAudit(client, { actorId: context.id, tenantId: saved.tenant_id, action: 'DRIVE_CONNECTED', resourceType: 'diaspora_drive_connection', resourceId: saved.id, metadata: { provider: DRIVE_PROVIDERS.GOOGLE } });
  return sanitizeConnection(saved);
}

export async function disconnectDrive(userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const connection = await loadOwnConnection(client, context);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  try { await provider.revoke(connection.credential_reference); } catch { /* revoke best-effort */ }

  const { data, error } = await client.from(CONNECTIONS).update({
    access_status: DRIVE_CONNECTION_STATUS.DISCONNECTED,
    revoked_at: new Date().toISOString(),
    credential_reference: null, // drop the reference locally on disconnect
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id).select().single();
  if (error) throw new ValidationError(`Failed to disconnect Drive: ${error.message}`);
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

export async function uploadDriveFile(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!isDriveEnabled()) throw new ValidationError('Drive integration is disabled');
  const client = await resolveClient(options);
  const connection = await activeConnectionOrThrow(client, context);
  const provider = await getDriveProvider(DRIVE_PROVIDERS.GOOGLE, options);

  const linkedEntityType = payload.linkedEntityType || 'export';
  const fileName = payload.fileName || `${linkedEntityType}-${Date.now()}.json`;

  // Idempotency: a prior file with the same key returns unchanged.
  if (payload.idempotencyKey) {
    const { data: existing } = await client.from(FILES).select('*').eq('drive_connection_id', connection.id).is('deleted_at', null);
    const dup = (existing || []).find((f) => f.metadata?.idempotencyKey === payload.idempotencyKey);
    if (dup) return { file: sanitizeFile(dup), idempotentReplay: true };
  }

  let uploaded;
  try {
    const folder = await provider.ensureFolder(connection.credential_reference, ENTITY_FOLDER[linkedEntityType] || DRIVE_FOLDER_STRUCTURE.root, connection.root_folder_id);
    uploaded = await provider.uploadFile(connection.credential_reference, { name: fileName, content: payload.content || '', folderId: folder.folderId, mimeType: payload.mimeType || 'application/json' });
  } catch (err) {
    if (err instanceof DriveProviderError && err.code === 'REVOKED') {
      await client.from(CONNECTIONS).update({ access_status: DRIVE_CONNECTION_STATUS.REVOKED, updated_at: new Date().toISOString() }).eq('id', connection.id).select().single();
    }
    throw new ValidationError(err instanceof DriveProviderError ? err.message : 'Drive upload failed');
  }

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
    metadata: { idempotencyKey: payload.idempotencyKey || null },
    created_by: context.id,
    updated_by: context.id,
  }).select().single();
  if (error) throw new ValidationError(`Failed to record Drive file: ${error.message}`);

  await appendCriticalAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'DRIVE_FILE_UPLOADED', resourceType: 'diaspora_drive_file', resourceId: data.id, metadata: { linkedEntityType, linkedEntityId: data.linked_entity_id } });
  return { file: sanitizeFile(data), idempotentReplay: false };
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

  try {
    await provider.refreshAccessToken(connection.credential_reference);
  } catch (err) {
    if (err instanceof DriveProviderError && err.code === 'REVOKED') {
      const { data } = await client.from(CONNECTIONS).update({ access_status: DRIVE_CONNECTION_STATUS.REVOKED, updated_at: new Date().toISOString() }).eq('id', connection.id).select().single();
      return sanitizeConnection(data);
    }
    throw new ValidationError('Drive sync failed');
  }

  const { data } = await client.from(CONNECTIONS).update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', connection.id).select().single();
  return sanitizeConnection(data);
}
