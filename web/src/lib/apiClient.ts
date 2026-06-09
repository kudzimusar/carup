/**
 * Framework-agnostic API request core for CarUp.
 *
 * Extracted from useCarUpApi so the CSRF flow can be unit-tested without rendering React.
 *
 * CSRF model (must mirror the backend):
 * - The backend issues a CSRF token bound to (userId, sessionToken) and, on every unsafe
 *   request, re-derives that identity from the x-user-id / x-session-token headers and rejects
 *   the request if the token is not bound to it.
 * - Therefore the token MUST be fetched with the SAME identity headers the unsafe request will
 *   send. Fetching it anonymously (the previous behaviour) yielded a guest-bound token that the
 *   server rejected once the authenticated POST carried the real user/session — the production
 *   "CSRF validation failed" error.
 */

export interface AuthHeaders {
  'x-session-token'?: string
  'x-user-id'?: string
  'x-stakeholder-role'?: string
  'x-tenant-id'?: string
}

type FetchLike = typeof fetch

export const CSRF_ERROR_MESSAGE =
  'Could not establish a secure session. Please refresh the page and try again.'

/** Backend message for a stale/expired/invalid session (see authMiddleware). */
export const SESSION_INVALID_MESSAGE = 'Unauthorized. Session is invalid or expired.'

/** Thrown when the backend rejects the request because the session is invalid/expired (401). */
export class SessionExpiredError extends Error {
  constructor(message: string = SESSION_INVALID_MESSAGE) {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

// A 401 from authMiddleware always carries an "Unauthorized. ..." message. Treat those as session
// failures that should clear client auth. (A 403 is a permission issue, NOT a session issue.)
function isSessionFailure(status: number, message?: string): boolean {
  return status === 401 && (!message || message.startsWith('Unauthorized'))
}

// Registered by AuthContext; invoked whenever a request fails with an invalid session so the app
// can clear its stored auth and redirect to login. Module-level so the framework-agnostic core can
// signal React without importing it.
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

// Module-level cache. Keyed by identity so a token bound to one user/session is never reused for
// another (e.g. after login/logout or a role switch).
let cachedCsrfToken: string | null = null
let cachedCsrfIdentity: string | null = null

function csrfIdentity(authHeaders: AuthHeaders): string {
  return `${authHeaders['x-user-id'] ?? 'guest'}|${authHeaders['x-session-token'] ?? 'none'}`
}

/** Test helper — clears the module-level CSRF cache. */
export function resetCsrfTokenCache(): void {
  cachedCsrfToken = null
  cachedCsrfIdentity = null
}

/**
 * Fetch (or reuse) a CSRF token bound to the given identity. Sends the identity headers and
 * credentials so the issued token is bound correctly. Throws if the token cannot be obtained.
 */
export async function fetchCsrfToken(
  baseUrl: string,
  authHeaders: AuthHeaders = {},
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const identity = csrfIdentity(authHeaders)
  if (cachedCsrfToken && cachedCsrfIdentity === identity) return cachedCsrfToken

  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/security/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      headers: { ...authHeaders },
    })
  } catch (e) {
    throw new Error(`CSRF token request failed: ${e instanceof Error ? e.message : 'network error'}`)
  }

  if (!res.ok) {
    throw new Error(`CSRF token request failed (status ${res.status})`)
  }

  const data = await res.json().catch(() => null)
  const token: unknown = data?.csrfToken
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('CSRF token missing from server response')
  }

  cachedCsrfToken = token
  cachedCsrfIdentity = identity
  return token
}

export interface ApiRequestConfig {
  baseUrl: string
  path: string
  options?: RequestInit
  authHeaders?: AuthHeaders
  fetchImpl?: FetchLike
}

/**
 * Perform an API request. For unsafe methods it first obtains a correctly-bound CSRF token and
 * attaches it as x-csrf-token (with credentials). If the token cannot be obtained it throws a
 * clear error BEFORE the unsafe request is sent, so the caller never fires a request the server
 * is guaranteed to reject.
 */
export async function apiRequest<T = any>({
  baseUrl,
  path,
  options,
  authHeaders = {},
  fetchImpl = fetch,
}: ApiRequestConfig): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authHeaders as Record<string, string>),
  }

  const method = options?.method?.toUpperCase() || 'GET'
  const fetchOptions: RequestInit = { ...options }

  if (!SAFE_METHODS.includes(method)) {
    let csrfToken: string
    try {
      csrfToken = await fetchCsrfToken(baseUrl, authHeaders, fetchImpl)
    } catch {
      throw new Error(CSRF_ERROR_MESSAGE)
    }
    headers['x-csrf-token'] = csrfToken
    fetchOptions.credentials = 'include'
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...((fetchOptions.headers as Record<string, string>) || {}),
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as { error?: string }))
    const message = (errorData as { error?: string }).error

    if (isSessionFailure(response.status, message)) {
      // Stale/expired session: clear client auth so the app stops trusting it, then surface a
      // typed error the caller can handle without an unhandled rejection.
      if (unauthorizedHandler) {
        try { unauthorizedHandler() } catch { /* never let the handler mask the original failure */ }
      }
      throw new SessionExpiredError(message || SESSION_INVALID_MESSAGE)
    }

    throw new Error(message || `HTTP error! status: ${response.status}`)
  }

  return (await response.json()) as T
}
