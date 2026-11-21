/**
 * RX-06 LR02 — preparing an import request while signed out.
 *
 * A guest may fill in the focused flow; the answers stay a draft in this browser tab (see the session
 * draft in importRequest.ts). Only a signed-in account sends the request, so a guest's "Send" opens a
 * sign-in boundary instead of calling the API. The routes below are the only ways out of that
 * boundary: the ordinary sign-in and the ordinary personal registration, both returning to the flow.
 */
import { buildLoginRedirect, isSafeReturnTo } from '@/lib/returnTo'

/** The flow's own path: where sign-in and registration bring the person back. */
export const IMPORT_REQUEST_PATH = '/diaspora/imports/new'

/** Sign in, then come back to the flow (built only with `buildLoginRedirect`). */
export function guestSignInHref(path: string = IMPORT_REQUEST_PATH): string {
  return buildLoginRedirect(isSafeReturnTo(path) ? path : IMPORT_REQUEST_PATH)
}

/**
 * The ordinary personal registration (never dealer or company onboarding), returning to the flow. Built
 * exactly the way the sign-in page builds its own registration link: a checked, encoded `returnTo`.
 */
export function guestRegisterHref(path: string = IMPORT_REQUEST_PATH): string {
  return isSafeReturnTo(path) ? `/register?returnTo=${encodeURIComponent(path)}` : '/register'
}

/** Where a guest leaves the flow to (the public Trade entry; the order ledger needs an account). */
export const GUEST_EXIT_TO = '/diaspora'

export const GUEST_REQUEST_COPY = {
  /** The page heading when no focused shell supplies one. */
  pageTitle: 'Start an import order',
  /** Beside the step counter on every step. */
  badge: 'Draft · not sent',
  /** First step: what a guest is doing, plainly. */
  intro: 'No account needed to prepare this. It stays a draft in this browser tab — nothing reaches CarUp or any seller until you sign in and press Send.',
  /** Review step: a draft is not a request. */
  reviewTitle: 'Draft — not sent.',
  reviewBody: 'Nothing reaches CarUp or any seller until you sign in and press Send.',
  footer: 'Your answers are kept in this browser tab only, until you send them, discard them or close the tab. Nothing reaches CarUp before you sign in and send.',
  boundaryTitle: 'Sign in to send your request',
  boundaryBody: 'Sending creates an import order in a CarUp account, so this is where you sign in. A free personal account is all you need — not a dealership or company account.',
  boundaryKept: [
    'Your draft is kept in this browser tab only. It is not in a CarUp account until you send it.',
    'Closing this tab discards it, and so do 12 hours without a change.',
    'Sign in from this tab and you come back to this review to press Send.',
  ],
  boundaryNotKept: 'This browser is not keeping drafts right now (private browsing or blocked storage), so you would need to enter these answers again after signing in.',
  signIn: 'Sign in',
  register: 'Create a free account',
  cancel: 'Cancel',
} as const

/** Shown once an account opens a draft that was prepared before signing in. */
export function restoredDraftNotice(complete: boolean): string {
  return complete
    ? 'We restored the draft you started before signing in — check it, then send.'
    : 'We restored the draft you started before signing in — finish it, then send.'
}
