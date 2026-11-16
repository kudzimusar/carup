/**
 * RX03-P2-R4 — honest guest-save wording.
 *
 * A signed-out "save" is written to this browser only (localStorage). It is NOT carried into a
 * CarUp account at sign-in yet (RX03-P2 negative case A-guest-save; the idempotent account
 * hand-off is RX-04 R4-02). So the confirmation must say where the car was saved, and offer the
 * one action that gives a durable, account-scoped save: signing in and saving again.
 */
import { toast } from 'sonner'
import { buildLoginRedirect } from '@/lib/returnTo'

export const GUEST_SAVE_DESCRIPTION =
  'Only this browser remembers it — it is not in a CarUp account. Sign in and save it again to keep it in My CarUp.'

/** Toast for a signed-out save; `navigate` sends the person to sign-in and back to this page. */
export function announceGuestSave(vehicleName: string, navigate: (to: string) => void) {
  const here = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}${window.location.hash}`
  toast.success(`${vehicleName.trim() || 'Car'} saved on this device`, {
    description: GUEST_SAVE_DESCRIPTION,
    action: { label: 'Sign in', onClick: () => navigate(buildLoginRedirect(here)) },
  })
}
