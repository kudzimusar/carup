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

/** Last-resort backend when no VITE_API_URL is configured and the host isn't local. */
export const DEFAULT_PRODUCTION_API_BASE_URL = 'https://carup-backend.vercel.app/api'
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0']

/**
 * Resolve the API base URL, with explicit configuration taking precedence so each environment
 * targets its own backend:
 *   1. `VITE_API_URL` (set per Vercel project — staging → staging backend, prod → prod backend)
 *   2. local dev on a localhost host with no override → same-origin `/api`
 *   3. any other host with no override → the production backend (safe default)
 *
 * Previously the non-localhost branch was hardcoded to production, so the staging frontend always
 * read the production backend and ignored `VITE_API_URL`. Honoring the env var lets staging call the
 * staging backend while leaving production behavior unchanged.
 */
export function resolveApiBaseUrl(configuredUrl?: string | null, hostname?: string): string {
  const configured = configuredUrl?.trim()
  if (configured) return normalizeApiBase(configured)
  if (hostname && LOCAL_HOSTS.includes(hostname)) return '/api'
  return DEFAULT_PRODUCTION_API_BASE_URL
}

/**
 * The backend mounts every route under `/api`. A configured base that omits the suffix (a common
 * misconfiguration, e.g. `https://host` instead of `https://host/api`) would 404 every request, so
 * normalize it: strip trailing slashes and append `/api` unless the path already targets it. This
 * makes the frontend resilient to an env var set to a bare backend origin.
 */
function normalizeApiBase(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return /\/api(\/|$)/.test(trimmed) ? trimmed : `${trimmed}/api`
}

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

/**
 * The backend reports errors in two shapes:
 *   - authMiddleware / direct route handlers: `{ error: "string" }`
 *   - errorMiddleware (thrown CarUpError, e.g. 400/404/500): `{ success: false, error: { code, message } }`
 * Extract a human message from either so callers (and the verification admin
 * client) surface an actionable string instead of "[object Object]".
 */
function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  const topMessage = (body as { message?: unknown }).message
  return typeof topMessage === 'string' ? topMessage : undefined
}

// Registered by AuthContext; invoked whenever a request fails with an invalid session so the app
// can clear its stored auth and redirect to login. Module-level so the framework-agnostic core can
// signal React without importing it.
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * Extract a human-readable STRING message from a backend error body, regardless of shape, so the
 * thrown Error never carries a non-string (which would render as "[object Object]"). Handles the
 * standard errorMiddleware shape `{ error: { message, code } }`, the authMiddleware shape
 * `{ error: 'string' }`, and a bare `{ message }`. Returns undefined when no message is present.
 */
export function extractApiErrorMessage(errorData: unknown): string | undefined {
  if (!errorData || typeof errorData !== 'object') return undefined
  const e = errorData as Record<string, unknown>
  if (e.error && typeof e.error === 'object') {
    const inner = e.error as Record<string, unknown>
    if (typeof inner.message === 'string' && inner.message) return inner.message
  }
  if (typeof e.error === 'string' && e.error) return e.error
  if (typeof e.message === 'string' && e.message) return e.message
  return undefined
}

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
    ...(authHeaders as Record<string, string>),
  }

  const method = options?.method?.toUpperCase() || 'GET'
  const fetchOptions: RequestInit = { ...options }
  let csrfToken: string | undefined
  
  if (!(fetchOptions.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (!SAFE_METHODS.includes(method)) {
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
    const errorData = await response.json().catch(() => ({}))
    const message = extractApiErrorMessage(errorData)

    if (response.status === 403 && !SAFE_METHODS.includes(method)) {
      // Stale CSRF token: bust cache and retry exactly once.
      cachedCsrfToken = null
      cachedCsrfIdentity = null
      try {
        csrfToken = await fetchCsrfToken(baseUrl, authHeaders, fetchImpl)
      } catch {
        throw new Error(CSRF_ERROR_MESSAGE)
      }
      headers['x-csrf-token'] = csrfToken
      const retryResponse = await fetchImpl(`${baseUrl}${path}`, {
        ...fetchOptions,
        headers: {
          ...headers,
          ...((fetchOptions.headers as Record<string, string>) || {}),
        },
      })
      if (retryResponse.ok) {
        return retryResponse.json() as Promise<T>
      }
      const retryErrorData = await retryResponse.json().catch(() => ({}))
      throw new Error(extractApiErrorMessage(retryErrorData) || `HTTP error! status: ${retryResponse.status}`)
    }

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
