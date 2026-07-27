/**
 * Diaspora GTM — the REAL Google Drive provider (Issue #127, Drive lane).
 *
 * This replaces the six `EXTERNAL_ACTIVATION_REQUIRED` stubs with a full implementation against the
 * actual Drive v3 API: real endpoints, real query syntax, real multipart upload framing, real error
 * envelopes. Everything goes through an injected HTTP transport, so the entire file is exercised
 * offline and deterministically — the tests replace the socket, not the logic.
 *
 * WHAT STILL GATES LIVE USE
 * -------------------------
 * Owner-provisioned OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / redirect URI) and a
 * production credential vault backend. Absent either, construction fails closed with NOT_CONFIGURED.
 * The gate is now a genuine configuration gate rather than unimplemented code.
 *
 * TOKEN HANDLING — the rule the whole design serves
 * -------------------------------------------------
 *   - The refresh token is handed to the vault the instant it arrives and is never seen again outside
 *     `_loadRefreshToken`.
 *   - The access token lives in a process-local Map with its expiry and is never persisted, never
 *     returned to a caller, never logged.
 *   - Every string that leaves this file — error messages included — passes through
 *     `redactSecretMaterial`.
 *   - Nothing here writes to the database. Persistence is the service's job, and the only credential
 *     value it is ever given is the opaque vault handle.
 */
import crypto from 'crypto';
import { DriveProvider, DriveProviderError } from './driveProvider.js';
import { DRIVE_PROVIDERS, DRIVE_SCOPES } from '../../../constants/diaspora/diasporaDriveConstants.js';
import { GoogleOAuthClient, configuredRedirectUris, assertExactRedirectUri, OAuthClientError } from './googleOAuthClient.js';
import { createFetchTransport } from './httpTransport.js';
import { resolveVault, redactSecretMaterial, CREDENTIAL_PURPOSES, registerSecretForRedaction } from './credentialVault.js';
// Side-effect import: registers the managed vault backends so `resolveVault()` can return one. See
// vaultBackends.js for why the core module must not import them itself.
import './vaultBackends.js';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/** Refresh this long before the access token actually expires, so an in-flight call cannot straddle it. */
const ACCESS_TOKEN_SKEW_MS = 60_000;

/**
 * Map a Drive API error response onto our own vocabulary, including whether a retry could help.
 *
 * Google's envelope:
 *   { "error": { "code": 403, "message": "...", "status": "PERMISSION_DENIED",
 *                "errors": [ { "domain": "usageLimits", "reason": "rateLimitExceeded", ... } ] } }
 *
 * The `reason` is what actually distinguishes "slow down" from "you will never be allowed to do
 * this", and conflating them is how a rate limit turns into a wrongly-disconnected account.
 */
export function mapDriveError(response) {
  const status = response?.status ?? 0;
  const envelope = response?.body && typeof response.body === 'object' ? response.body : {};
  const error = envelope.error && typeof envelope.error === 'object' ? envelope.error : {};
  const reason = String(error.errors?.[0]?.reason || '').toLowerCase();
  const retryAfter = Number(response?.headers?.['retry-after']) || null;

  const make = (message, code, retryable) => {
    const err = new DriveProviderError(redactSecretMaterial(message), code, { retryable, status });
    if (retryAfter) err.retryAfterMs = retryAfter * 1000;
    return err;
  };

  if (status === 401) {
    return make('Google Drive access has been revoked or expired. Reconnect required.', 'REVOKED', false);
  }
  if (status === 403) {
    if (reason === 'ratelimitexceeded' || reason === 'userratelimitexceeded' || reason === 'sharingratelimitexceeded') {
      return make('Google Drive is rate limiting this account; the operation will be retried.', 'RATE_LIMITED', true);
    }
    if (reason === 'storagequotaexceeded') {
      return make('The connected Google Drive account is out of storage.', 'QUOTA_EXCEEDED', false);
    }
    if (reason === 'insufficientfilepermissions' || reason === 'insufficientpermissions' || reason === 'forbidden') {
      return make('The Drive authorization does not grant permission for this operation. Reconnect required.', 'INSUFFICIENT_SCOPE', false);
    }
    if (reason === 'appnotauthorizedtofile') {
      return make('This file was not created by CarUp, so the drive.file scope cannot access it.', 'INSUFFICIENT_SCOPE', false);
    }
    return make('Google Drive refused the operation.', 'FORBIDDEN', false);
  }
  if (status === 404) return make('The requested Drive item does not exist.', 'NOT_FOUND', false);
  if (status === 409) return make('The Drive item already exists.', 'CONFLICT', false);
  if (status === 429) return make('Google Drive is rate limiting this account; the operation will be retried.', 'RATE_LIMITED', true);
  if (status >= 500) return make('Google Drive is temporarily unavailable; the operation will be retried.', 'PROVIDER_UNAVAILABLE', true);
  if (status === 400) return make('Google Drive rejected the request as malformed.', 'INVALID_REQUEST', false);
  return make(`Google Drive returned an unexpected status (${status}).`, 'DRIVE_PROVIDER_ERROR', false);
}

/** Escape a value for use inside a Drive `q=` string literal (single-quoted). */
export function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveProvider extends DriveProvider {
  /**
   * @param {object} options
   * @param {object} [options.transport] injected HTTP transport (tests supply a deterministic stub)
   * @param {object} [options.vault]     injected credential vault
   * @param {boolean} [options.requireCredentials] when false, allows construction for URL-building only
   */
  constructor({
    transport = null,
    vault = null,
    clientId = process.env.GOOGLE_CLIENT_ID || null,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUris = null,
    now = () => Date.now(),
  } = {}) {
    super();
    this.transport = transport || createFetchTransport();
    // The vault is resolved LAZILY. `resolveVault` fails closed in production, and constructing a
    // provider merely to report "Drive is not configured" must not itself explode.
    this._vault = vault || null;
    this.redirectUris = redirectUris || configuredRedirectUris();
    this.clientId = clientId;
    this._now = now;
    this.oauth = new GoogleOAuthClient({
      clientId,
      clientSecret,
      redirectUris: this.redirectUris,
      transport: this.transport,
    });
    // Access tokens: process-local, expiring, never persisted.
    this._accessTokens = new Map();
  }

  get name() { return DRIVE_PROVIDERS.GOOGLE; }

  /** True when owner credentials are present. The service uses this to report activation state. */
  get configured() { return this.oauth.configured; }

  /** Resolve the vault on first use so an unconfigured environment fails at USE, not at construction. */
  get vault() {
    if (!this._vault) this._vault = resolveVault();
    return this._vault;
  }

  set vault(value) { this._vault = value; }

  // ── OAuth ──────────────────────────────────────────────────────────────────

  /**
   * @param {string} state signed one-time state
   * @param {string[]} scopes
   * @param {{codeChallenge:string, codeChallengeMethod?:string, redirectUri?:string, loginHint?:string}} pkce
   */
  buildAuthorizationUrl(state, scopes = DRIVE_SCOPES, pkce = {}) {
    if (!pkce || !pkce.codeChallenge) {
      throw new DriveProviderError('A PKCE code challenge is required to start Drive authorization', 'INVALID_REQUEST');
    }
    try {
      return this.oauth.buildAuthorizationUrl({
        state,
        scopes,
        codeChallenge: pkce.codeChallenge,
        codeChallengeMethod: pkce.codeChallengeMethod || 'S256',
        redirectUri: pkce.redirectUri || null,
        loginHint: pkce.loginHint || null,
      });
    } catch (err) {
      throw toDriveError(err);
    }
  }

  /**
   * Exchange the code, vault the refresh token, and return ONLY non-secret connection facts plus the
   * opaque vault handle. The caller (the service) persists the handle; it never sees a token.
   */
  async exchangeAuthorizationCode(code, context = {}) {
    const { codeVerifier, redirectUri = null, tenantId = null, userId = null } = context;
    let tokens;
    try {
      tokens = await this.oauth.exchangeAuthorizationCode({ code, codeVerifier, redirectUri });
    } catch (err) {
      throw toDriveError(err);
    }
    // Register both tokens for outbound redaction for the life of the process, so even an unexpected
    // echo of one in some later error string is scrubbed.
    registerSecretForRedaction(tokens.refreshToken);
    registerSecretForRedaction(tokens.accessToken);

    const grantedScopes = tokens.scopes.length ? tokens.scopes : [...DRIVE_SCOPES];
    assertScopesNotEscalated(grantedScopes);

    const { vaultReference, vaultBackend, keyVersion } = await this.vault.put({
      purpose: CREDENTIAL_PURPOSES.GOOGLE_DRIVE,
      tenantId,
      userId,
      secret: JSON.stringify({ refreshToken: tokens.refreshToken, scopes: grantedScopes }),
      metadata: { grantedAt: new Date(this._now()).toISOString() },
    });

    // Cache the access token we already hold rather than immediately spending a refresh on it.
    this._cacheAccessToken(vaultReference, tokens.accessToken, tokens.expiresAt);

    // With drive.file we cannot read the userinfo endpoint, but about.get IS permitted by that scope,
    // so the account label costs no extra scope.
    let account = { email: null, id: null };
    try {
      account = await this._fetchAccount(vaultReference);
    } catch { /* a missing label must not fail an otherwise good connection */ }

    return {
      providerAccountEmail: account.email,
      providerAccountId: account.id,
      credentialReference: vaultReference,
      vaultBackend,
      keyVersion,
      scopes: grantedScopes,
      expiresAt: tokens.expiresAt,
    };
  }

  /** Force a refresh and report the new expiry. Never returns the token. */
  async refreshAccessToken(credentialReference) {
    const refreshToken = await this._loadRefreshToken(credentialReference);
    let refreshed;
    try {
      refreshed = await this.oauth.refreshAccessToken({ refreshToken });
    } catch (err) {
      this._accessTokens.delete(credentialReference);
      throw toDriveError(err);
    }
    registerSecretForRedaction(refreshed.accessToken);
    if (refreshed.rotatedRefreshToken) {
      // Google rotated the refresh token. Re-vault it under the SAME handle so nothing downstream has
      // to change, and so the old value stops being usable.
      registerSecretForRedaction(refreshed.rotatedRefreshToken);
      const stored = await this._loadStoredPayload(credentialReference);
      await this.vault.rotate(credentialReference, JSON.stringify({
        ...stored,
        refreshToken: refreshed.rotatedRefreshToken,
      }));
    }
    this._cacheAccessToken(credentialReference, refreshed.accessToken, refreshed.expiresAt);
    return { credentialReference, expiresAt: refreshed.expiresAt, rotated: Boolean(refreshed.rotatedRefreshToken) };
  }

  /**
   * Revoke at Google and destroy the vault entry. Both are attempted; the vault entry is destroyed
   * even if Google is unreachable, because leaving a live refresh token in the vault after the user
   * pressed "disconnect" is the worse failure.
   */
  async revoke(credentialReference) {
    let refreshToken = null;
    try {
      refreshToken = await this._loadRefreshToken(credentialReference);
    } catch { /* already gone at the vault — nothing to revoke upstream */ }

    let remoteRevoked = false;
    let remoteError = null;
    if (refreshToken) {
      try {
        const result = await this.oauth.revokeToken({ token: refreshToken });
        remoteRevoked = result.revoked;
      } catch (err) {
        remoteError = toDriveError(err).code;
      }
    }
    this._accessTokens.delete(credentialReference);
    await this.vault.destroy(credentialReference).catch(() => {});
    return { revoked: true, remoteRevoked, remoteError };
  }

  // ── Drive API ──────────────────────────────────────────────────────────────

  /**
   * Find-or-create a folder by name under a parent.
   *
   * `trashed=false` matters: without it a folder the user deleted still matches, and every subsequent
   * upload lands in the trash while reporting success.
   */
  async ensureFolder(credentialReference, folderName, parentId = null) {
    if (!folderName) throw new DriveProviderError('A folder name is required', 'INVALID_REQUEST');
    const clauses = [
      `name='${escapeDriveQueryValue(folderName)}'`,
      `mimeType='${FOLDER_MIME_TYPE}'`,
      'trashed=false',
    ];
    if (parentId) clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
    const search = new URLSearchParams({
      q: clauses.join(' and '),
      fields: 'files(id,name,webViewLink)',
      spaces: 'drive',
      pageSize: '1',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    const found = await this._authorizedRequest(credentialReference, {
      method: 'GET',
      url: `${DRIVE_API_BASE}/files?${search.toString()}`,
    });
    const existing = found.body?.files?.[0];
    if (existing?.id) {
      return { folderId: existing.id, folderName: existing.name || folderName, parentId, folderUrl: existing.webViewLink || null, created: false };
    }

    const created = await this._authorizedRequest(credentialReference, {
      method: 'POST',
      url: `${DRIVE_API_BASE}/files?fields=id,name,webViewLink&supportsAllDrives=true`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: FOLDER_MIME_TYPE,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    return {
      folderId: created.body?.id,
      folderName: created.body?.name || folderName,
      parentId,
      folderUrl: created.body?.webViewLink || null,
      created: true,
    };
  }

  /**
   * Multipart upload (`uploadType=multipart`): one request carrying JSON metadata and the file bytes
   * as a `multipart/related` body. This is Google's documented path for payloads under 5 MB, which is
   * every artifact CarUp generates.
   */
  async uploadFile(credentialReference, file = {}) {
    const name = file.name;
    if (!name) throw new DriveProviderError('A file name is required', 'INVALID_REQUEST');
    const mimeType = file.mimeType || 'application/json';
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content ?? ''), 'utf8');
    const metadata = {
      name,
      ...(file.folderId ? { parents: [file.folderId] } : {}),
      ...(file.description ? { description: file.description } : {}),
      ...(file.appProperties ? { appProperties: file.appProperties } : {}),
    };

    const boundary = `carup-${crypto.randomBytes(16).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, 'utf8'),
      Buffer.from(JSON.stringify(metadata), 'utf8'),
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8'),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const response = await this._authorizedRequest(credentialReference, {
      method: 'POST',
      url: `${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,name,webViewLink,md5Checksum,size,mimeType&supportsAllDrives=true`,
      headers: {
        'content-type': `multipart/related; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      body,
    });

    const uploaded = response.body || {};
    return {
      fileId: uploaded.id,
      fileUrl: uploaded.webViewLink || (uploaded.id ? `https://drive.google.com/file/d/${uploaded.id}/view` : null),
      name: uploaded.name || name,
      mimeType: uploaded.mimeType || mimeType,
      // The DB column is checksum_sha256, so we compute our own over exactly the bytes we sent.
      // Google's md5 is kept alongside as an independent cross-check of what Drive stored.
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      providerMd5: uploaded.md5Checksum || null,
      bytes: Number(uploaded.size) || content.length,
    };
  }

  async getMetadata(credentialReference, fileId) {
    if (!fileId) throw new DriveProviderError('A file id is required', 'INVALID_REQUEST');
    const search = new URLSearchParams({
      fields: 'id,name,mimeType,md5Checksum,size,webViewLink,parents,trashed,modifiedTime',
      supportsAllDrives: 'true',
    });
    const response = await this._authorizedRequest(credentialReference, {
      method: 'GET',
      url: `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${search.toString()}`,
    });
    const meta = response.body || {};
    return {
      fileId: meta.id || fileId,
      name: meta.name || null,
      mimeType: meta.mimeType || null,
      providerMd5: meta.md5Checksum || null,
      bytes: Number(meta.size) || null,
      fileUrl: meta.webViewLink || null,
      parents: meta.parents || [],
      trashed: Boolean(meta.trashed),
      modifiedTime: meta.modifiedTime || null,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async _fetchAccount(credentialReference) {
    const response = await this._authorizedRequest(credentialReference, {
      method: 'GET',
      url: `${DRIVE_API_BASE}/about?fields=user(emailAddress,permissionId,displayName)`,
    });
    const user = response.body?.user || {};
    return { email: user.emailAddress || null, id: user.permissionId || null, displayName: user.displayName || null };
  }

  _cacheAccessToken(credentialReference, accessToken, expiresAt) {
    this._accessTokens.set(credentialReference, {
      accessToken,
      expiresAtMs: Date.parse(expiresAt) || (this._now() + 3600_000),
    });
  }

  async _loadStoredPayload(credentialReference) {
    let entry;
    try {
      entry = await this.vault.get(credentialReference);
    } catch (err) {
      throw new DriveProviderError(
        'The stored Drive credential is no longer available. Reconnect required.',
        'REVOKED',
        { retryable: false, cause: err.code },
      );
    }
    try {
      const parsed = JSON.parse(entry.secret);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      return parsed;
    } catch {
      throw new DriveProviderError('The stored Drive credential is unreadable. Reconnect required.', 'REVOKED');
    }
  }

  async _loadRefreshToken(credentialReference) {
    const payload = await this._loadStoredPayload(credentialReference);
    if (!payload.refreshToken) {
      throw new DriveProviderError('The stored Drive credential has no refresh token. Reconnect required.', 'REVOKED');
    }
    registerSecretForRedaction(payload.refreshToken);
    return payload.refreshToken;
  }

  /** A valid access token, refreshing through the vault when the cached one is missing or near expiry. */
  async _accessTokenFor(credentialReference, { force = false } = {}) {
    const cached = this._accessTokens.get(credentialReference);
    if (!force && cached && cached.expiresAtMs - ACCESS_TOKEN_SKEW_MS > this._now()) {
      return cached.accessToken;
    }
    await this.refreshAccessToken(credentialReference);
    const fresh = this._accessTokens.get(credentialReference);
    if (!fresh) throw new DriveProviderError('Could not obtain Drive access. Reconnect required.', 'REVOKED');
    return fresh.accessToken;
  }

  /**
   * Perform an authenticated Drive call.
   *
   * A 401 is retried EXACTLY once after a forced refresh: Google returns 401 both for "your access
   * token just expired" (recoverable) and "the user revoked you" (not). One retry distinguishes them
   * without becoming a loop — if the refresh itself fails, `refreshAccessToken` raises REVOKED and the
   * account is correctly marked as needing reconnection.
   */
  async _authorizedRequest(credentialReference, request, { allowRetry = true } = {}) {
    const accessToken = await this._accessTokenFor(credentialReference);
    let response;
    try {
      response = await this.transport.request({
        ...request,
        headers: { accept: 'application/json', ...(request.headers || {}), authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      // Transport-level failure (timeout, connection refused). Retryable, and carries no request body.
      throw new DriveProviderError(
        'Google Drive could not be reached; the operation will be retried.',
        'PROVIDER_UNAVAILABLE',
        { retryable: true, cause: err.code },
      );
    }
    if (response.status === 401 && allowRetry) {
      await this._accessTokenFor(credentialReference, { force: true });
      return this._authorizedRequest(credentialReference, request, { allowRetry: false });
    }
    if (response.status < 200 || response.status >= 300) throw mapDriveError(response);
    return response;
  }
}

/**
 * Refuse a grant that came back broader than we asked for.
 *
 * Google will not silently widen a grant, but a compromised or misconfigured client could send a
 * different scope list, and "we only ever ask for drive.file" is a claim worth actually enforcing at
 * the point the grant is accepted rather than only at the point it is requested.
 */
export function assertScopesNotEscalated(grantedScopes, allowed = DRIVE_SCOPES) {
  const permitted = new Set([...allowed, 'openid', 'email', 'profile']);
  const escalated = grantedScopes.filter((scope) => !permitted.has(scope));
  if (escalated.length) {
    throw new DriveProviderError(
      `Google granted broader Drive scopes than CarUp requested (${escalated.join(', ')}); the connection was refused.`,
      'SCOPE_ESCALATION',
    );
  }
  return grantedScopes;
}

/** Normalize an OAuth/transport error into a DriveProviderError without leaking internals. */
function toDriveError(err) {
  if (err instanceof DriveProviderError) return err;
  if (err instanceof OAuthClientError) {
    return new DriveProviderError(redactSecretMaterial(err.message), err.code, { retryable: Boolean(err.retryable), status: err.status });
  }
  return new DriveProviderError('Google Drive request failed.', 'DRIVE_PROVIDER_ERROR', { retryable: false });
}
