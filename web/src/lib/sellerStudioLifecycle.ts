/**
 * CARUP-MVP-STAB-01 F-006 / F-007 — which Seller Studio a listing gets, and what a failed save means.
 *
 * Seller Studio used to be a draft workspace whatever it opened: "Draft workspace · not public",
 * "Buyer Preview — not public" and an autosave that a published listing could only ever refuse
 * (409), which Studio then reported as an outage. The mode is now read from the account row itself:
 * the commerce `status` (backend/utils/vehicleStatus.js) and the publication lifecycle
 * (database CHECK on vehicles.publication_status, 20260624140000), of which only `published` is
 * public.
 */

export type SellerStudioMode = 'draft' | 'published' | 'sold'

/** A closed sale wins over everything; then only `published` is a public listing; else a draft. */
export function sellerStudioMode(
  listing?: { status?: unknown; publication_status?: unknown } | null,
): SellerStudioMode {
  if (!listing) return 'draft'
  if (String(listing.status ?? '').trim().toLowerCase() === 'sold') return 'sold'
  if (listing.publication_status === 'published') return 'published'
  return 'draft'
}

/** Structured refusals that mean "the listing moved on" (backend/server.js), never "broken". */
export const SELLER_LISTING_LIFECYCLE_CODES = Object.freeze([
  'SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED',
  'SELLER_LISTING_SOLD_READ_ONLY',
  'SELLER_LISTING_NOT_PUBLISHED',
  'SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE',
])

export type SellerSaveFailure =
  | { kind: 'lifecycle_changed'; publicationStatus: string | null; status: string | null }
  | { kind: 'session_ended' }
  | { kind: 'unavailable' }

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function classifySellerSaveFailure(error: unknown): SellerSaveFailure {
  const failure = (error && typeof error === 'object' ? error : {}) as {
    name?: unknown
    status?: unknown
    code?: unknown
    data?: unknown
  }
  // apiClient's SessionExpiredError (a 401 "Unauthorized…", client auth already cleared) carries no
  // status, only its name; any other 401 is the same answer.
  if (failure.name === 'SessionExpiredError' || failure.status === 401) return { kind: 'session_ended' }

  const data = (failure.data && typeof failure.data === 'object' ? failure.data : {}) as Record<string, unknown>
  const code = textOrNull(failure.code) ?? textOrNull(data.code)
  const publicationStatus = textOrNull(data.publication_status)
  const status = textOrNull(data.status)
  if (code !== null && SELLER_LISTING_LIFECYCLE_CODES.includes(code)) {
    return { kind: 'lifecycle_changed', publicationStatus, status }
  }
  // A backend that predates the codes still says why in its 409 body; read it, never guess.
  if (failure.status === 409 && (publicationStatus === 'published' || String(status ?? '').trim().toLowerCase() === 'sold')) {
    return { kind: 'lifecycle_changed', publicationStatus, status }
  }
  return { kind: 'unavailable' }
}
