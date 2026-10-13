import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

/**
 * The one Sign Out used by every shell (dashboard sidebar, public drawer, account menu) — PC01-K1.
 *
 * It goes through AuthContext.logout, the canonical primitive: React's auth state AND the stored
 * session are cleared together, so a protected route re-evaluates as anonymous at once and Back can
 * no longer restore privileged content from client state. The dashboard used to run
 * `localStorage.clear()` and reload instead, which skipped the context and also wiped unrelated
 * stored state such as a guest's saved sell draft.
 *
 * PC01-K1-R1: logout also ends the session on the server. The person is moved to the public home at
 * once, whatever the network does; if the server could not confirm the session ended, they are told
 * so plainly rather than assured it did.
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

export const SIGN_OUT_UNCONFIRMED_MESSAGE =
  'Signed out on this device, but CarUp could not confirm your session ended on the server. It will expire on its own; sign in and out again when you are back online to end it now.'

export function useShellSignOut(onSignedOut?: () => void) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return useCallback(() => {
    signedOutAt = Date.now()
    const outcome = logout()
    onSignedOut?.()
    navigate('/', { replace: true })
    void Promise.resolve(outcome).then((result) => {
      if (result === 'unconfirmed') toast.warning(SIGN_OUT_UNCONFIRMED_MESSAGE, { id: 'sign-out-unconfirmed' })
    })
  }, [logout, onSignedOut, navigate])
}
