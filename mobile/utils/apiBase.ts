/**
 * Canonical API base resolver (Milestone A).
 *
 * The SINGLE source of truth for the mobile backend origin. Moved here from
 * verificationApi.ts so every caller (verification, marketplace, referral,
 * auth, feature governance) routes through the same validated, localhost-safe
 * resolver — closing the hardcoded-localhost security blocker.
 *
 * Contract (unchanged from the original getVerificationApiBaseUrl):
 *  - EXPO_PUBLIC_API_URL is required.
 *  - Returns the ORIGIN (trailing slashes stripped); callers append `/api/...`.
 *  - On a physical device, a localhost/127.0.0.1 base is REJECTED unless
 *    EXPO_PUBLIC_ALLOW_LOCALHOST_API==='true' (simulator escape hatch).
 */

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

function detectPlatformOS(): string {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
    ? 'native'
    : 'web';
}

/**
 * Resolve and validate the backend origin. Throws ApiConfigurationError when
 * unset, or when targeting localhost from a device without the explicit opt-in.
 */
export function resolveApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
  platformOS: string = detectPlatformOS(),
): string {
  const baseUrl = env.EXPO_PUBLIC_API_URL?.trim();
  if (!baseUrl) {
    throw new ApiConfigurationError('EXPO_PUBLIC_API_URL is required for backend verification.');
  }

  const normalized = baseUrl.replace(/\/+$/, '');
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized);
  if (isLocalhost && platformOS !== 'web' && env.EXPO_PUBLIC_ALLOW_LOCALHOST_API !== 'true') {
    throw new ApiConfigurationError(
      'Physical devices cannot reach localhost. Set EXPO_PUBLIC_API_URL to your LAN, ngrok, or deployed backend URL.',
    );
  }

  return normalized;
}

/**
 * Join the resolved base origin with a path. The base is an origin (no `/api`),
 * so callers pass the full path including `/api/...` (matching marketplaceApi).
 */
export function apiUrl(
  path: string,
  env?: Record<string, string | undefined>,
  platformOS?: string,
): string {
  const base = resolveApiBaseUrl(env, platformOS);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
