/**
 * Phase 7 — Drive provider abstraction.
 *
 * `DriveProvider` is the interface every provider implements. `MockDriveProvider` is a deterministic
 * in-memory implementation used by tests and by the feature when real credentials are absent. The
 * factory picks the provider; production Google access additionally requires real OAuth credentials
 * and the Google API client (an explicit external activation step).
 */
import crypto from 'crypto';
import { DRIVE_PROVIDERS, DRIVE_SCOPES } from '../../../constants/diaspora/diasporaDriveConstants.js';

export class DriveProviderError extends Error {
  constructor(message, code = 'DRIVE_PROVIDER_ERROR') {
    // Sanitized message only — never include tokens or raw provider stack traces.
    super(message);
    this.name = 'DriveProviderError';
    this.code = code;
  }
}

export class DriveProvider {
  get name() { return 'base'; }
  // eslint-disable-next-line no-unused-vars
  buildAuthorizationUrl(_state, _scopes) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async exchangeAuthorizationCode(_code) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async refreshAccessToken(_credentialReference) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async revoke(_credentialReference) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async ensureFolder(_credentialReference, _folderName, _parentId) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async uploadFile(_credentialReference, _file) { throw new DriveProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async getMetadata(_credentialReference, _fileId) { throw new DriveProviderError('not implemented'); }
}

/**
 * Deterministic in-memory provider. Holds token material only in memory keyed by an opaque
 * credentialReference; callers persist only the reference, never the token.
 */
export class MockDriveProvider extends DriveProvider {
  constructor() {
    super();
    this._tokens = new Map(); // credentialReference -> { accessToken, revoked }
    this._files = new Map();
    this._folders = new Map();
    this._seq = 0;
  }

  get name() { return DRIVE_PROVIDERS.GOOGLE; }

  buildAuthorizationUrl(state, scopes = DRIVE_SCOPES) {
    const params = new URLSearchParams({ response_type: 'code', scope: scopes.join(' '), state, access_type: 'offline' });
    return `https://mock-drive.local/o/oauth2/auth?${params.toString()}`;
  }

  async exchangeAuthorizationCode(code) {
    if (!code) throw new DriveProviderError('Missing authorization code', 'INVALID_CODE');
    const credentialReference = `mockref_${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 24)}`;
    this._tokens.set(credentialReference, { accessToken: `mock-access-${this._seq++}`, revoked: false });
    return {
      providerAccountEmail: 'mock-user@example.com',
      providerAccountId: 'mock-account-1',
      credentialReference,
      scopes: DRIVE_SCOPES,
      expiresAt: '2026-12-31T00:00:00.000Z',
    };
  }

  async refreshAccessToken(credentialReference) {
    const token = this._tokens.get(credentialReference);
    if (!token || token.revoked) throw new DriveProviderError('Drive access has been revoked', 'REVOKED');
    token.accessToken = `mock-access-${this._seq++}`;
    return { credentialReference, expiresAt: '2026-12-31T00:00:00.000Z' };
  }

  async revoke(credentialReference) {
    const token = this._tokens.get(credentialReference);
    if (token) token.revoked = true;
    return { revoked: true };
  }

  _assertActive(credentialReference) {
    const token = this._tokens.get(credentialReference);
    if (!token || token.revoked) throw new DriveProviderError('Drive access has been revoked', 'REVOKED');
  }

  async ensureFolder(credentialReference, folderName, parentId = null) {
    this._assertActive(credentialReference);
    const key = `${parentId || 'root'}/${folderName}`;
    if (!this._folders.has(key)) this._folders.set(key, `folder_${this._seq++}`);
    return { folderId: this._folders.get(key), folderName, parentId };
  }

  async uploadFile(credentialReference, file) {
    this._assertActive(credentialReference);
    const fileId = `file_${this._seq++}`;
    const checksum = crypto.createHash('sha256').update(String(file?.content || file?.name || fileId)).digest('hex');
    this._files.set(fileId, { name: file?.name, folderId: file?.folderId, checksum });
    return { fileId, fileUrl: `https://mock-drive.local/file/${fileId}`, checksum, name: file?.name };
  }

  async getMetadata(credentialReference, fileId) {
    this._assertActive(credentialReference);
    const file = this._files.get(fileId);
    if (!file) throw new DriveProviderError('File not found', 'NOT_FOUND');
    return { fileId, ...file };
  }
}

let sharedMock = null;
/** A process-shared mock so a connection made in one call is usable by a later upload call in tests. */
export function getSharedMockProvider() {
  if (!sharedMock) sharedMock = new MockDriveProvider();
  return sharedMock;
}

export async function getDriveProvider(providerName = DRIVE_PROVIDERS.GOOGLE, options = {}) {
  if (options.driveProvider) return options.driveProvider;
  const { shouldUseMockProvider } = await import('../../../constants/diaspora/diasporaDriveConstants.js');
  if (shouldUseMockProvider()) return getSharedMockProvider();
  const { GoogleDriveProvider } = await import('./googleDriveProvider.js');
  return new GoogleDriveProvider();
}
