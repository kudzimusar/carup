import { buildLoginRedirect } from './returnTo'

/**
 * RX03-AUTH — a "Sign In" link that keeps the person's place. From Home or an account route the link is
 * plain `/login` (the role home is the right landing); from anywhere else it carries the full current
 * path (query and fragment included) through the existing `buildLoginRedirect`. Safety stays where it
 * already lives: Login only follows a returnTo that `isSafeReturnTo` accepts, and the destination's own
 * guard decides access. Presentation only — no role, session or authority decision is made here.
 */
const PLAIN = new Set(['/', '/login', '/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'])

export function signInHrefFor(location: { pathname: string; search?: string; hash?: string }): string {
  if (PLAIN.has(location.pathname)) return '/login'
  return buildLoginRedirect(`${location.pathname}${location.search ?? ''}${location.hash ?? ''}`)
}
