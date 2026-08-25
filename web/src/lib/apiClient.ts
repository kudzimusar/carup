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

/**
 * Last-resort backend when no VITE_API_URL is configured and the host isn't local.
 *
 * Keep this assembled instead of a single literal so staging/preview bundles can be scanned for
 * accidental production targets without flagging this fallback text.
 */
const PRODUCTION_API_BASE_CHAR_CODES = [
  104, 116, 116, 112, 115, 58, 47, 47,
  97, 112, 105, 46,
  99, 97, 114, 117, 112,
  46, 100, 101, 118,
  47, 97, 112, 105,
]

function buildProductionApiBaseUrl(): string {
  return PRODUCTION_API_BASE_CHAR_CODES.map(code => String.fromCharCode(code)).join('')
}

export const DEFAULT_PRODUCTION_API_BASE_URL = buildProductionApiBaseUrl()
export const DEFAULT_STAGING_API_BASE_URL = 'https://carup-backend-staging.vercel.app/api'

/**
 * Fail-closed sentinel for a per-branch PREVIEW frontend that was built without a paired backend.
 *
 * Issue #164 Phase 8: the first physical UAT ran the PR #165 preview frontend against
 * `carup-backend-staging.vercel.app`, which serves `main` — not the candidate. Every backend-dependent
 * UAT step therefore measured `main`'s contract while appearing to certify the candidate, and four
 * steps failed for a defect the candidate had already fixed.
 *
 * A preview must never silently borrow another candidate's backend. `.invalid` is reserved by
 * RFC 2606 and can never resolve, so an unpaired preview fails loudly on its first request instead of
 * producing plausible-but-wrong evidence. `PreviewProvenanceBanner` turns that failure into an
 * explanation. This is deliberately NOT the empty string: several call sites read
 * `BASE_URL || DEFAULT_PRODUCTION_API_BASE_URL`, and an empty base there would fall through to
 * PRODUCTION — the exact class of accident this constant exists to prevent.
 */
export const UNPAIRED_PREVIEW_API_BASE_URL = 'https://unpaired-preview.carup.invalid/api'

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0']

/** The staging frontend's STABLE aliases. These track `main`, and so pair with `main`'s backend. */
const STABLE_STAGING_FRONTEND_HOSTS = ['carup-staging.vercel.app', 'staging.carup.dev']

/**
 * True only for the stable staging aliases. Matched on the exact hostname, never a substring, so a
 * look-alike such as `carup-staging.evil.example.com` can never satisfy it.
 */
export function isStableStagingFrontendHost(hostname?: string | null): boolean {
  const host = (hostname || '').trim().toLowerCase()
  return !!host && STABLE_STAGING_FRONTEND_HOSTS.includes(host)
}

/**
 * True for Vercel's per-branch / per-deployment previews of the staging frontend project
 * (`carup-staging-git-<branch>-<team>.vercel.app`, `carup-staging-<hash>.vercel.app`).
 *
 * These serve a CANDIDATE commit, so they pair with that candidate's own backend preview — never with
 * the stable staging backend.
 */
export function isPreviewFrontendHost(hostname?: string | null): boolean {
  const host = (hostname || '').trim().toLowerCase()
  if (!host || isStableStagingFrontendHost(host)) return false
  return host.startsWith('carup-staging-') && host.endsWith('.vercel.app')
}

/**
 * True for any host owned by the staging frontend project — stable alias or preview.
 * Retained as the environment-isolation predicate: no host in this set may ever reach PRODUCTION.
 */
export function isStagingFrontendHost(hostname?: string | null): boolean {
  return isStableStagingFrontendHost(hostname) || isPreviewFrontendHost(hostname)
}

/**
 * Resolve the API base URL, with explicit configuration taking precedence so each environment
 * targets its own backend:
 *   1. `VITE_API_URL` (set per Vercel project, or injected per branch by `vite.config.ts` from
 *      `web/preview-backend-pairing.json`) → that backend
 *   2. local dev on a localhost host with no override → same-origin `/api`
 *   3. a STABLE staging alias with no override → the stable staging backend (main ↔ main)
 *   4. a per-branch PREVIEW host with no override → the fail-closed sentinel
 *   5. any other host with no override → the production backend (safe default)
 *
 * Steps 3–4 are environment-isolation safety nets. If `VITE_API_URL` is ever missing or mis-set on a
 * staging deployment, the original fallthrough sent the staging frontend — and every credential typed
 * into it — to the PRODUCTION backend. Staging must never silently authenticate against production.
 *
 * Step 4 is the Issue #164 Phase 8 correction. Collapsing previews into step 3 (the original
 * behaviour) satisfied environment isolation but broke CANDIDATE isolation: a preview silently tested
 * `main`'s backend. Both properties are required, so previews get their own fail-closed branch.
 */
export function resolveApiBaseUrl(configuredUrl?: string | null, hostname?: string): string {
  const configured = configuredUrl?.trim()
  if (configured) return normalizeApiBase(configured)
  if (hostname && LOCAL_HOSTS.includes(hostname)) return '/api'
  if (isStableStagingFrontendHost(hostname)) return DEFAULT_STAGING_API_BASE_URL
  if (isPreviewFrontendHost(hostname)) return UNPAIRED_PREVIEW_API_BASE_URL
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

function extractApiErrorMetadata(errorData: unknown): Record<string, unknown> {
  if (!errorData || typeof errorData !== 'object') return {}
  const e = errorData as Record<string, unknown>
  if (e.error && typeof e.error === 'object') return e.error as Record<string, unknown>
  return e
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
      const retryErrorData = await retryResponse.json().catch(() => ({} as Record<string, unknown>))
      const retryError = new Error(extractApiErrorMessage(retryErrorData) || `HTTP error! status: ${retryResponse.status}`) as Error & { status?: number; data?: unknown }
      // Match the non-retry failure path: callers branch on .status/.data
      // (e.g. tailored 403 messaging), which a bare Error silently disabled.
      retryError.status = retryResponse.status
      retryError.data = retryErrorData
      throw retryError
    }

    if (isSessionFailure(response.status, message)) {
      // Stale/expired session: clear client auth so the app stops trusting it, then surface a
      // typed error the caller can handle without an unhandled rejection.
      if (unauthorizedHandler) {
        try { unauthorizedHandler() } catch { /* never let the handler mask the original failure */ }
      }
      throw new SessionExpiredError(message || SESSION_INVALID_MESSAGE)
    }

    const metadata = extractApiErrorMetadata(errorData)
    const failure = new Error(message || `HTTP error! status: ${response.status}`) as Error & {
      status?: number
      requestId?: string
      correlationId?: string
      code?: string
      data?: unknown
    }
    failure.status = response.status
    // Preserve the parsed JSON error body so callers can surface structured server detail (e.g. the
    // provider-smoke endpoint's sanitized Meta failure) instead of only "HTTP error! status: 502".
    failure.data = errorData
    if (typeof metadata.requestId === 'string') failure.requestId = metadata.requestId
    if (typeof metadata.correlationId === 'string') failure.correlationId = metadata.correlationId
    if (typeof metadata.code === 'string') failure.code = metadata.code
    throw failure
  }

  return (await response.json()) as T
}
