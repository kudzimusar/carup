import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

/**
 * The one Sign Out used by every shell (dashboard sidebar, public drawer, account menu) — PC01-K1.
 *
 * It goes through AuthContext.logout, the canonical primitive: React's auth state AND the stored
 * session are cleared together, so a protected route re-evaluates as anonymous at once and Back can
 * no longer restore privileged content from client state. The dashboard used to run
 * `localStorage.clear()` and reload instead, which skipped the context and also wiped unrelated
 * stored state such as a guest's saved sell draft.
 */

// React Router runs navigation as a transition, so clearing auth (urgent) renders BEFORE the move to
// "/" commits — and the dashboard's own guard would answer that render with
// /login?returnTo=<the page just signed out of>, handing the next person on a shared device a link
// back into the previous user's workspace. The guard reads this moment to send a sign-out home
// instead. Read-only during render, so it is safe under StrictMode's double render.
const SIGN_OUT_WINDOW_MS = 2000
let signedOutAt = 0

export function isRecentShellSignOut(now: number = Date.now()): boolean {
  return signedOutAt > 0 && now - signedOutAt < SIGN_OUT_WINDOW_MS
}

export function useShellSignOut(onSignedOut?: () => void) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return useCallback(() => {
    signedOutAt = Date.now()
    logout()
    onSignedOut?.()
    navigate('/', { replace: true })
  }, [logout, onSignedOut, navigate])
}
