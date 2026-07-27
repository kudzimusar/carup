/**
 * Diaspora GTM — Google OAuth 2.0 authorization-code client with PKCE (Issue #127, Drive lane).
 *
 * Implements the real Google endpoints and payload shapes:
 *   authorize  GET  https://accounts.google.com/o/oauth2/v2/auth
 *   token      POST https://oauth2.googleapis.com/token          (application/x-www-form-urlencoded)
 *   revoke     POST https://oauth2.googleapis.com/revoke         (application/x-www-form-urlencoded)
 *
 * Every network call goes through the injected transport, so the whole file is exercised offline and
 * deterministically by tests while remaining the exact code that would run against Google.
 *
 * PKCE (RFC 7636) is applied even though CarUp is a confidential client with a client secret. The
 * reason is concrete rather than ceremonial: the authorization code travels back through the user's
 * browser, and PKCE is what stops a code intercepted there (a malicious extension, a shared machine,
 * a leaked Referer) from being redeemable by anyone who does not also hold the verifier we kept
 * server-side. The client secret alone does not protect against that, because the attacker attacks
 * the code in flight, not the token endpoint.
 *
 * REDIRECT URI HANDLING is exact-match only — see `assertExactRedirectUri`. Prefix matching,
 * trailing-slash tolerance and "startsWith" checks are the classic open-redirect route to account
 * takeover, so none of them exist here.
 */
import crypto from 'crypto';
import { redactSecretMaterial } from './credentialVault.js';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Recognised OAuth failure classes, mapped from Google's `error` field. */
export const OAUTH_ERROR_CODES = Object.freeze({
  INVALID_GRANT: 'REVOKED',
  UNAUTHORIZED_CLIENT: 'NOT_CONFIGURED',
  INVALID_CLIENT: 'NOT_CONFIGURED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_SCOPE: 'INVALID_SCOPE',
  ACCESS_DENIED: 'ACCESS_DENIED',
  UNSUPPORTED_GRANT_TYPE: 'INVALID_REQUEST',
});

export class OAuthClientError extends Error {
  constructor(message, code = 'OAUTH_ERROR', { retryable = false, status = null } = {}) {
    // Message is always built from a status/known error class — never from raw response text, and
    // scrubbed regardless.
    super(redactSecretMaterial(message));
    this.name = 'OAuthClientError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a PKCE verifier/challenge pair.
 * Verifier: 32 random bytes base64url-encoded → 43 chars, inside RFC 7636's 43–128 range.
 */
export function createPkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

/** Recompute the challenge for a verifier — used to prove a stored pair still corresponds. */
export function deriveCodeChallenge(codeVerifier) {
  return base64url(crypto.createHash('sha256').update(String(codeVerifier)).digest());
}

/**
 * Validate a redirect URI against the configured allow-list with EXACT string equality.
 *
 * Also rejects structurally unsafe URIs up front, so a misconfiguration is caught at authorize time
 * rather than becoming a live redirector:
 *   - must be absolute http(s)
 *   - plaintext http is allowed ONLY for loopback (localhost / 127.0.0.1 / [::1]) development
 *   - no fragment (Google refuses these; so do we, before the round trip)
 *   - no wildcard characters
 */
export function assertExactRedirectUri(candidate, allowedUris = []) {
  if (typeof candidate !== 'string' || !candidate) {
    throw new OAuthClientError('A redirect URI is required', 'REDIRECT_URI_INVALID');
  }
  if (candidate.includes('*')) {
    throw new OAuthClientError('Wildcard redirect URIs are not permitted', 'REDIRECT_URI_INVALID');
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new OAuthClientError('The redirect URI is not an absolute URL', 'REDIRECT_URI_INVALID');
  }
  if (parsed.hash) {
    throw new OAuthClientError('The redirect URI must not contain a fragment', 'REDIRECT_URI_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) {
    throw new OAuthClientError('A plaintext http redirect URI is only permitted for loopback development', 'REDIRECT_URI_INVALID');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new OAuthClientError('The redirect URI must use http(s)', 'REDIRECT_URI_INVALID');
  }
  const allowed = (Array.isArray(allowedUris) ? allowedUris : [allowedUris]).filter(Boolean);
  if (!allowed.length) {
    throw new OAuthClientError('No redirect URI is configured for Google Drive', 'NOT_CONFIGURED');
  }
  // Byte-for-byte. Not normalized, not case-folded, no trailing-slash tolerance: Google matches
  // exactly, and anything looser here is a hole Google would not have.
  if (!allowed.includes(candidate)) {
    throw new OAuthClientError('The redirect URI does not exactly match a configured redirect URI', 'REDIRECT_URI_MISMATCH');
  }
  return candidate;
}

/** Read the configured allow-list. `GOOGLE_DRIVE_REDIRECT_URIS` (comma separated) extends the single value. */
export function configuredRedirectUris(env = process.env) {
  const list = [];
  if (env.GOOGLE_DRIVE_REDIRECT_URI) list.push(env.GOOGLE_DRIVE_REDIRECT_URI.trim());
  if (env.GOOGLE_DRIVE_REDIRECT_URIS) {
    for (const uri of String(env.GOOGLE_DRIVE_REDIRECT_URIS).split(',')) {
      const trimmed = uri.trim();
      if (trimmed && !list.includes(trimmed)) list.push(trimmed);
    }
  }
  return list;
}

function formBody(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  return search.toString();
}

/**
 * Map a token-endpoint failure onto our own vocabulary.
 * Google returns `{ error, error_description }` with a 4xx; 5xx has no envelope at all.
 */
function mapTokenError(response) {
  const status = response.status;
  const envelope = response.body && typeof response.body === 'object' ? response.body : {};
  const rawError = String(envelope.error || '').toUpperCase().replace(/-/g, '_');
  if (status >= 500) {
    return new OAuthClientError('Google rejected the request with a server error', 'PROVIDER_UNAVAILABLE', { retryable: true, status });
  }
  if (status === 429) {
    return new OAuthClientError('Google is rate limiting token requests', 'RATE_LIMITED', { retryable: true, status });
  }
  const code = OAUTH_ERROR_CODES[rawError] || 'OAUTH_ERROR';
  // `error_description` is Google-authored and short. It is still scrubbed before it becomes a
  // message, because "the upstream would never echo my token" is an assumption, not a control.
  const detail = envelope.error_description ? `: ${String(envelope.error_description).slice(0, 160)}` : '';
  const message = code === 'REVOKED'
    ? 'Google Drive access has been revoked or the authorization expired'
    : `Google refused the token request (${rawError || status})${detail}`;
  return new OAuthClientError(message, code, { retryable: false, status });
}

export class GoogleOAuthClient {
  /**
   * @param {{clientId:string, clientSecret:string, redirectUris:string[], transport:object}} config
   */
  constructor({ clientId, clientSecret, redirectUris = [], transport } = {}) {
    this.clientId = clientId || null;
    // The secret is held only in this instance and is never returned, logged or persisted.
    this._clientSecret = clientSecret || null;
    this.redirectUris = redirectUris.filter(Boolean);
    this.transport = transport;
  }

  get configured() {
    return Boolean(this.clientId && this._clientSecret && this.redirectUris.length);
  }

  assertConfigured() {
    if (!this.clientId || !this._clientSecret) {
      throw new OAuthClientError(
        'Google Drive is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are required)',
        'NOT_CONFIGURED',
      );
    }
    if (!this.redirectUris.length) {
      throw new OAuthClientError('Google Drive is not configured (GOOGLE_DRIVE_REDIRECT_URI is required)', 'NOT_CONFIGURED');
    }
    if (!this.transport) {
      throw new OAuthClientError('No HTTP transport was provided to the Google OAuth client', 'NOT_CONFIGURED');
    }
  }

  /**
   * Build the consent URL.
   *
   * `access_type=offline` + `prompt=consent` is what makes Google return a refresh token; without
   * both, a re-authorizing user gets an access token only and the connection silently dies in an hour.
   */
  buildAuthorizationUrl({ state, scopes, codeChallenge, codeChallengeMethod = 'S256', redirectUri = null, loginHint = null } = {}) {
    if (!this.clientId) {
      throw new OAuthClientError('Google Drive is not configured (GOOGLE_CLIENT_ID is required)', 'NOT_CONFIGURED');
    }
    if (!state) throw new OAuthClientError('An OAuth state value is required', 'INVALID_REQUEST');
    if (!codeChallenge) throw new OAuthClientError('A PKCE code challenge is required', 'INVALID_REQUEST');
    if (!Array.isArray(scopes) || !scopes.length) {
      throw new OAuthClientError('At least one scope is required', 'INVALID_SCOPE');
    }
    const target = assertExactRedirectUri(redirectUri || this.redirectUris[0], this.redirectUris);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: target,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    });
    if (loginHint) params.set('login_hint', loginHint);
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * @returns {{accessToken:string, refreshToken:string|null, expiresAt:string, scopes:string[], tokenType:string}}
   *   Raw token material — for the caller to hand straight to the vault. Nothing else may hold it.
   */
  async exchangeAuthorizationCode({ code, codeVerifier, redirectUri = null } = {}) {
    this.assertConfigured();
    if (!code) throw new OAuthClientError('Missing authorization code', 'INVALID_REQUEST');
    if (!codeVerifier) throw new OAuthClientError('Missing PKCE code verifier', 'INVALID_REQUEST');
    const target = assertExactRedirectUri(redirectUri || this.redirectUris[0], this.redirectUris);

    const response = await this.transport.request({
      method: 'POST',
      url: GOOGLE_TOKEN_ENDPOINT,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: formBody({
        code,
        client_id: this.clientId,
        client_secret: this._clientSecret,
        redirect_uri: target,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });

    if (response.status < 200 || response.status >= 300) throw mapTokenError(response);
    const payload = response.body && typeof response.body === 'object' ? response.body : {};
    if (!payload.access_token) {
      throw new OAuthClientError('Google returned no access token', 'OAUTH_ERROR', { status: response.status });
    }
    if (!payload.refresh_token) {
      // Without a refresh token the connection would break within the hour. Fail here, truthfully,
      // rather than persist a connection that is already doomed.
      throw new OAuthClientError(
        'Google returned no refresh token; re-authorize with offline access (the account may already be linked)',
        'NO_REFRESH_TOKEN',
        { status: response.status },
      );
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type || 'Bearer',
      expiresAt: expiryFromSeconds(payload.expires_in),
      scopes: payload.scope ? String(payload.scope).split(' ').filter(Boolean) : [],
    };
  }

  /**
   * Redeem a refresh token for a new access token.
   * Google does not return a new refresh token on this call unless it rotates one.
   */
  async refreshAccessToken({ refreshToken } = {}) {
    this.assertConfigured();
    if (!refreshToken) throw new OAuthClientError('Missing refresh token', 'INVALID_REQUEST');

    const response = await this.transport.request({
      method: 'POST',
      url: GOOGLE_TOKEN_ENDPOINT,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: formBody({
        client_id: this.clientId,
        client_secret: this._clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (response.status < 200 || response.status >= 300) throw mapTokenError(response);
    const payload = response.body && typeof response.body === 'object' ? response.body : {};
    if (!payload.access_token) {
      throw new OAuthClientError('Google returned no access token on refresh', 'OAUTH_ERROR', { status: response.status });
    }
    return {
      accessToken: payload.access_token,
      // Present only when Google rotates the refresh token; the caller must re-vault it if so.
      rotatedRefreshToken: payload.refresh_token || null,
      tokenType: payload.token_type || 'Bearer',
      expiresAt: expiryFromSeconds(payload.expires_in),
      scopes: payload.scope ? String(payload.scope).split(' ').filter(Boolean) : [],
    };
  }

  /**
   * Revoke a token at Google. A 400 `invalid_token` means it was already invalid, which is the state
   * we wanted — so it is reported as success rather than an error the user has to act on.
   */
  async revokeToken({ token } = {}) {
    if (!token) throw new OAuthClientError('Missing token to revoke', 'INVALID_REQUEST');
    if (!this.transport) throw new OAuthClientError('No HTTP transport was provided to the Google OAuth client', 'NOT_CONFIGURED');
    const response = await this.transport.request({
      method: 'POST',
      url: GOOGLE_REVOKE_ENDPOINT,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: formBody({ token }),
    });
    if (response.status >= 200 && response.status < 300) return { revoked: true, alreadyInvalid: false };
    const envelope = response.body && typeof response.body === 'object' ? response.body : {};
    if (response.status === 400 && String(envelope.error || '') === 'invalid_token') {
      return { revoked: true, alreadyInvalid: true };
    }
    if (response.status >= 500) {
      throw new OAuthClientError('Google could not process the revocation right now', 'PROVIDER_UNAVAILABLE', { retryable: true, status: response.status });
    }
    throw new OAuthClientError('Google refused the revocation request', 'REVOKE_FAILED', { status: response.status });
  }
}

/** `expires_in` (seconds) → absolute ISO expiry. Defaults to Google's standard hour when absent. */
export function expiryFromSeconds(expiresIn, now = Date.now()) {
  const seconds = Number.isFinite(Number(expiresIn)) ? Number(expiresIn) : 3600;
  return new Date(now + seconds * 1000).toISOString();
}

export const __testables = { mapTokenError, formBody };
