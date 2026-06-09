/**
 * Safe post-login "return to" handling.
 *
 * When an unauthenticated user hits a protected page we send them to
 * `/login?returnTo=<path>` and, after a successful login, send them back. The returnTo value comes
 * from the URL, so it MUST be validated as a safe internal path to avoid open-redirect attacks.
 */

/**
 * A returnTo is safe only if it is a same-origin, absolute internal path:
 * - starts with "/"
 * - is NOT protocol-relative ("//host") or backslash-tricked ("/\\host")
 * - contains no "://" (absolute URL) and no backslashes
 * - contains no ASCII control characters
 */
export function isSafeReturnTo(value: string | null | undefined): value is string {
  if (!value || typeof value !== 'string') return false
  if (!value.startsWith('/')) return false
  if (value.startsWith('//') || value.startsWith('/\\')) return false
  if (value.includes('\\')) return false
  if (value.includes('://')) return false
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return false // control chars (newline, tab, etc.)
  }
  return true
}

/** Return `value` when it is a safe internal path, otherwise `fallback`. */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  return isSafeReturnTo(value) ? value : fallback
}

/** Build the `/login?returnTo=...` path for a protected route (path is URL-encoded). */
export function buildLoginRedirect(fullPath: string): string {
  return `/login?returnTo=${encodeURIComponent(fullPath)}`
}

/** Map a user role to its default dashboard route. */
export function getDashboardRoute(role: string): string {
  if (role === 'dealer') return '/dealer'
  if (role === 'mechanic') return '/mechanic'
  if (role === 'admin') return '/admin'
  return '/dashboard'
}

/**
 * Where to navigate after a successful login: the safe returnTo if present, otherwise the user's
 * role dashboard.
 */
export function resolvePostLoginRoute(returnTo: string | null | undefined, role: string): string {
  return safeReturnTo(returnTo, getDashboardRoute(role))
}
