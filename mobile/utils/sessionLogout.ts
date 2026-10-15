import { apiUrl, resolveApiBaseUrl } from './apiBase';
import { csrfFetch } from './csrfFetch';

export type CurrentSessionLogoutResult =
  | { state: 'revoked' }
  | { state: 'failed'; statusCode: number | null }
  | { state: 'timed_out' }
  | { state: 'no_session' };

export const CURRENT_SESSION_LOGOUT_TIMEOUT_MS = 4000;

/**
 * Best-effort server termination of the presenting session.
 *
 * The credential exists only in memory long enough to authenticate the CSRF fetch
 * and POST /api/auth/logout. It is never logged, persisted here, returned, or put
 * into diagnostic state.
 */
export async function revokeCurrentServerSession(
  sessionToken: string | null,
  timeoutMs = CURRENT_SESSION_LOGOUT_TIMEOUT_MS,
): Promise<CurrentSessionLogoutResult> {
  if (!sessionToken) return { state: 'no_session' };

  const request = (async (): Promise<CurrentSessionLogoutResult> => {
    try {
      const baseUrl = resolveApiBaseUrl();
      const response = await csrfFetch(baseUrl, sessionToken, apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'x-session-token': sessionToken,
        },
      });
      return response.ok
        ? { state: 'revoked' }
        : { state: 'failed', statusCode: response.status };
    } catch {
      return { state: 'failed', statusCode: null };
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CurrentSessionLogoutResult>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'timed_out' }), timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
