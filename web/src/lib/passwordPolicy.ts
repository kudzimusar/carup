/**
 * Client-side password policy for CarUp's own auth.
 *
 * Lives outside the page component because a module that exports both a component and plain values
 * breaks React Fast Refresh (`react-refresh/only-export-components`) — the component would no longer
 * hot-reload in development.
 *
 * This mirrors the server-side policy in `backend/utils/passwordAuth.js` and is deliberately only a
 * mirror: the server revalidates every reset, so this exists to give immediate feedback, never to be
 * the enforcement point.
 */

export const MIN_PASSWORD_LENGTH = 8

export function passwordPolicyError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
