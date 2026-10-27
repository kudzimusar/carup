import type { AccidentDisclosure, FinanceDisclosure, InsuranceDisclosure } from '@/lib/vehicleHistoryDisclosures'

/**
 * T11-CAP-LR01-R3 (Moderator D-1) — VIEW != EDIT in the Seller Studio.
 *
 * Opening a listing the seller already has must not write to it. Before this module, the Studio PATCHed the
 * unchanged form back to the vehicle row 1200 ms after it loaded, and the server stamped
 * `seller_listing_recorded_at` / `listing_location_recorded_at` on that PATCH: merely LOOKING at a vehicle
 * recorded that the seller had "entered" a listing. That is how a never-listed import (the Honda Vezel)
 * acquired Seller business state with no Seller action.
 *
 * The rule is a comparison, not a flag. The form is saved only when its autosave payload differs from the payload
 * the server is KNOWN to hold. It is not "skip the first save", not "wait N seconds", not "has the draft loaded":
 * those say something about the page, and the question is about the data.
 *
 *   baseline  = the payload the server held when the draft was loaded, and thereafter the payload of the last
 *               PATCH the server acknowledged for the current revision;
 *   in flight = a PATCH has been sent and its outcome is not known. The server MAY now hold it, so while one is
 *               outstanding nothing is clean: reverting an edit whose PATCH is still travelling must itself be
 *               saved, or the edit would outlive its own undo.
 *
 * Pure, so the policy is testable without a browser.
 */

export type SellerAutosavePayload = {
  description?: string
  features?: string[]
  body_style?: string
  seller_stated_condition?: string
  price?: number
  currency?: string
  location?: string
  province?: string
  listing_country?: string
  location_visibility?: 'withheld' | 'province_only' | 'public'
  public_seller_display_enabled?: boolean
  accident_disclosure?: AccidentDisclosure
  insurance_disclosure?: InsuranceDisclosure
  finance_disclosure?: FinanceDisclosure
}

/** The Studio form fields an autosave payload is built from — nothing else in the form is ever sent. */
export interface SellerAutosaveFields {
  description: string
  features: string[]
  category: string
  condition: string
  price: string
  currency: string
  location: string
  province: string
  locationVisibility: string
  publicSellerDisplay: boolean
  accidentDisclosure: AccidentDisclosure | null
  insuranceDisclosure: InsuranceDisclosure | null
  financeDisclosure: FinanceDisclosure | null
}

/**
 * What an autosave sends for this form. Unchanged from the shape the Studio has always sent:
 *   - `price` and `currency` travel only when stated (a zero or missing price is "not stated", never a price);
 *   - only ANSWERED disclosures travel, so an autosave can never silently retract a stored answer the seller
 *     did not change.
 */
export function buildAutosavePayload(form: SellerAutosaveFields): SellerAutosavePayload {
  return {
    description: form.description,
    features: form.features,
    body_style: form.category,
    seller_stated_condition: form.condition,
    ...(form.price && Number.isFinite(Number(form.price)) && Number(form.price) > 0 ? { price: Number(form.price) } : {}),
    ...(form.currency ? { currency: form.currency } : {}),
    location: form.location,
    province: form.province,
    location_visibility: form.locationVisibility as 'withheld' | 'province_only' | 'public',
    public_seller_display_enabled: form.publicSellerDisplay,
    ...(form.accidentDisclosure ? { accident_disclosure: form.accidentDisclosure } : {}),
    ...(form.insuranceDisclosure ? { insurance_disclosure: form.insuranceDisclosure } : {}),
    ...(form.financeDisclosure ? { finance_disclosure: form.financeDisclosure } : {}),
  }
}

/** Keys sorted at every depth, so the same statement has the same text however it was built. (JSON itself omits `undefined` keys.) */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

/** The canonical text of a payload. Array ORDER is kept: the order of a seller's features is part of what they wrote. */
export const autosavePayloadKey = (payload: SellerAutosavePayload): string => JSON.stringify(canonical(payload))

export interface AutosaveLedger {
  /** The draft was just loaded: the server holds exactly this. */
  seed(payload: SellerAutosavePayload): void
  /** True only when nothing is in flight and the server is known to hold exactly this payload. */
  isClean(payload: SellerAutosavePayload): boolean
  /** A PATCH is about to be sent. Until one is acknowledged for the current revision, nothing is clean. */
  issue(): void
  /** The server acknowledged this payload for the current revision. It is now the baseline. */
  confirm(payload: SellerAutosavePayload): void
}

export function createAutosaveLedger(): AutosaveLedger {
  let baseline: string | null = null
  let inFlight = false
  return {
    seed(payload) {
      baseline = autosavePayloadKey(payload)
      inFlight = false
    },
    isClean(payload) {
      // Never seeded (a new listing, a guest draft): `baseline` is null, which no payload's text can equal, so nothing is clean.
      return !inFlight && baseline === autosavePayloadKey(payload)
    },
    issue() {
      inFlight = true
    },
    confirm(payload) {
      baseline = autosavePayloadKey(payload)
      inFlight = false
    },
  }
}
