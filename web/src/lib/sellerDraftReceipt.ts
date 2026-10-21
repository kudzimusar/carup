/**
 * CARUP-MVP-STAB-01 F-009 — when Seller Studio may say "saved".
 *
 * PATCH /api/vehicles/:vin/seller-draft answers with a receipt read back from the database, and
 * Studio may call an edit saved only when that receipt holds what the seller stated. The comparison
 * used exact string equality and JSON.stringify, so a save that HAD succeeded was reported as
 * "Account autosave is unavailable" whenever the server normalised the statement on the way in:
 * trimmed text, de-duplicated features, dropped blank disclosure details, and Postgres JSONB
 * reordering object keys ({state, finance_type, lender_name} comes back
 * {state, lender_name, finance_type}).
 *
 * The fix is ONE normaliser per field, applied to both sides, mirroring the server's write path
 * (backend/server.js `submittedText`, the features rule, the location-visibility vocabulary and
 * backend/services/seller/vehicleHistoryDisclosures.js). A genuine difference — another value,
 * a lost feature, an answer that was not stored — still fails the receipt.
 */
import {
  normalizeSellerDisclosure,
  type AccidentDisclosure,
  type FinanceDisclosure,
  type InsuranceDisclosure,
  type SellerDisclosureTopic,
} from './vehicleHistoryDisclosures'

export type SellerDraftLocationVisibility = 'withheld' | 'province_only' | 'public'

/** The seller-commercial statement Studio sends (autosave and the published-listing save). */
export interface SellerDraftPayload {
  description?: string
  features?: string[]
  body_style?: string
  seller_stated_condition?: string
  price?: number
  currency?: string
  location?: string
  province?: string
  listing_country?: string
  location_visibility?: SellerDraftLocationVisibility
  public_seller_display_enabled?: boolean
  accident_disclosure?: AccidentDisclosure
  insurance_disclosure?: InsuranceDisclosure
  finance_disclosure?: FinanceDisclosure
}

/** The `draft` receipt the server returns — what the database now stores, under API names. */
export interface SellerDraftReceipt {
  description?: string | null
  features?: unknown
  body_style?: string | null
  seller_stated_condition?: string | null
  price?: number | string | null
  currency?: string | null
  location?: string | null
  province?: string | null
  listing_country?: string | null
  location_visibility?: string | null
  public_seller_display_enabled?: boolean | null
  accident_disclosure?: AccidentDisclosure | null
  insurance_disclosure?: InsuranceDisclosure | null
  finance_disclosure?: FinanceDisclosure | null
}

const MAX_FEATURES = 50

/** Server `submittedText`: trimmed; blank is not a statement. */
export function normalizeDraftText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** Server features rule: trimmed, blanks dropped, first occurrence kept in order, capped at 50. */
export function normalizeDraftFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const kept: string[] = []
  for (const entry of value) {
    const text = normalizeDraftText(entry)
    if (text !== null && !kept.includes(text)) kept.push(text)
  }
  return kept.slice(0, MAX_FEATURES)
}

/** Server visibility vocabulary: anything but an exact `public` / `province_only` is withheld. */
export function normalizeDraftVisibility(value: unknown): SellerDraftLocationVisibility {
  const text = normalizeDraftText(value)
  return text === 'public' ? 'public' : text === 'province_only' ? 'province_only' : 'withheld'
}

const DISCLOSURE_TOPIC: Record<'accident_disclosure' | 'insurance_disclosure' | 'finance_disclosure', SellerDisclosureTopic> = {
  accident_disclosure: 'accident',
  insurance_disclosure: 'insurance',
  finance_disclosure: 'finance',
}

/**
 * The stored statement as canonical JSON. The normaliser REBUILDS the disclosure field by field in
 * one fixed key order (state first, then the vocabulary's own detail order, events field by field),
 * so the order Postgres JSONB returned the keys in cannot change the result.
 */
export function canonicalDisclosureJson(
  key: keyof typeof DISCLOSURE_TOPIC,
  value: unknown,
): string {
  return JSON.stringify(normalizeSellerDisclosure(DISCLOSURE_TOPIC[key], value))
}

/**
 * True only when the receipt holds the same statement as the payload, field by field, for every
 * field the payload actually sent. A key the request left out leaves the stored value untouched on
 * the server, so it cannot fail (or pass) the receipt.
 */
export function sellerDraftReceiptMatches(
  payload: SellerDraftPayload,
  receipt: SellerDraftReceipt | null | undefined,
): boolean {
  if (!receipt) return false
  const sent = (key: keyof SellerDraftPayload) => Object.prototype.hasOwnProperty.call(payload, key)
  const sameStrings = [
    ['description', 'description'],
    ['body_style', 'body_style'],
    ['seller_stated_condition', 'seller_stated_condition'],
    ['currency', 'currency'],
    ['location', 'location'],
    ['province', 'province'],
    ['listing_country', 'listing_country'],
  ] as const
  for (const [requestKey, receiptKey] of sameStrings) {
    if (sent(requestKey) && normalizeDraftText(payload[requestKey]) !== normalizeDraftText(receipt[receiptKey])) return false
  }
  if (sent('location_visibility')
    && normalizeDraftVisibility(payload.location_visibility) !== normalizeDraftVisibility(receipt.location_visibility)) return false
  if (sent('features')
    && JSON.stringify(normalizeDraftFeatures(payload.features)) !== JSON.stringify(normalizeDraftFeatures(receipt.features))) return false
  if (sent('price') && Number(payload.price) !== Number(receipt.price)) return false
  if (sent('public_seller_display_enabled')
    && (payload.public_seller_display_enabled === true) !== (receipt.public_seller_display_enabled === true)) return false
  // History disclosures (F18–F20): the same structured STATEMENT, compared as canonical JSON.
  const sameDisclosures = ['accident_disclosure', 'insurance_disclosure', 'finance_disclosure'] as const
  for (const key of sameDisclosures) {
    if (sent(key) && canonicalDisclosureJson(key, payload[key]) !== canonicalDisclosureJson(key, receipt[key])) return false
  }
  return true
}
