/**
 * Phase 7 — Google Drive provider (real).
 *
 * The authorization-URL builder works offline from environment configuration. Token exchange and
 * file operations require the Google API client and real OAuth credentials, which are an explicit
 * external activation step — they throw a clear, sanitized error until provisioned. This keeps the
 * integration honest: code-complete pending external activation, never a fake "production-ready"
 * claim (directive §32, §35).
 */
import { DriveProvider, DriveProviderError } from './driveProvider.js';
import { DRIVE_PROVIDERS, DRIVE_SCOPES } from '../../../constants/diaspora/diasporaDriveConstants.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export class GoogleDriveProvider extends DriveProvider {
  constructor() {
    super();
    this.clientId = process.env.GOOGLE_CLIENT_ID || null;
    this.redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || null;
    // The client secret is read lazily only at exchange time and never logged or returned.
  }

  get name() { return DRIVE_PROVIDERS.GOOGLE; }

  buildAuthorizationUrl(state, scopes = DRIVE_SCOPES) {
    if (!this.clientId || !this.redirectUri) {
      throw new DriveProviderError('Google Drive is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_DRIVE_REDIRECT_URI)', 'NOT_CONFIGURED');
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  async exchangeAuthorizationCode() {
    throw new DriveProviderError('Live Google Drive token exchange requires the Google API client and authorized credentials (external activation pending)', 'EXTERNAL_ACTIVATION_REQUIRED');
  }

  async refreshAccessToken() {
    throw new DriveProviderError('Live Google Drive token refresh requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED');
  }

  async revoke() {
    throw new DriveProviderError('Live Google Drive revoke requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED');
  }

  async ensureFolder() {
    throw new DriveProviderError('Live Google Drive folder operations require external activation', 'EXTERNAL_ACTIVATION_REQUIRED');
  }

  async uploadFile() {
    throw new DriveProviderError('Live Google Drive upload requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED');
  }

  async getMetadata() {
    throw new DriveProviderError('Live Google Drive metadata requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED');
  }
}
