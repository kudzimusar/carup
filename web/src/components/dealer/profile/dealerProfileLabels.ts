/**
 * CARUP-DEALER-1.0 visual redesign — shared, presentation-only helpers for the public dealership
 * profile and the owner dashboard. Nothing here reads data or decides authority: it only turns the
 * canonical keys the APIs already return into human labels, and picks which already-returned media
 * item to show.
 */

/** Buyer-facing names for the dealer-declared storefront sections. */
const SECTION_LABELS: Record<string, string> = {
  BUSINESS_OVERVIEW: 'About the dealership',
  BUYER_ASSURANCE: 'Buyer assurance',
  FINANCE_TERMS: 'Finance & payment',
  SOURCING: 'Vehicle sourcing & imports',
  WARRANTY_AFTERSALES: 'Warranty & after-sales',
  SERVICE_CAPABILITIES: 'Services & support',
}

/** Buyer-facing names for the declared fields (see dealerOperationalDeclarationsService). */
const FIELD_LABELS: Record<string, string> = {
  public_description: 'About us',
  trading_name: 'Trading name',
  declared_contact_email: 'Contact email',
  opening_hours_note: 'Opening hours',
  inspection_rights: 'Inspection before you buy',
  cancellation_policy: 'Cancellations',
  refund_policy: 'Refunds',
  dispute_resolution: 'Complaints & disputes',
  deposit_terms: 'Deposits & balances',
  accepted_payment_methods: 'Payment methods',
  finance_partner_disclosure: 'Finance partners',
  currency_disclosure: 'Currencies & charges',
  sourcing_channels: 'Where vehicles come from',
  import_duty_disclosure: 'Import duty',
  customs_handling: 'Customs handling',
  warranty_scope: 'Warranty cover',
  warranty_exclusions: 'Warranty exclusions',
  repair_support: 'Repairs & after-sales',
  spare_parts_support: 'Spare parts',
  workshop_services: 'Workshop & maintenance',
  inspection_services: 'Inspections & diagnostics',
  buyer_support_hours: 'Buyer support hours',
}

const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  SHOWROOM_EXTERIOR: 'Showroom exterior',
  SHOWROOM_INTERIOR: 'Showroom interior',
  BRANCH_FACILITY: 'Branch facility',
  SERVICE_BAY: 'Service bay',
  COMPANY_PROFILE_IMAGE: 'Company profile image',
  COMPANY_COVER_IMAGE: 'Company cover image',
}

/** The two identity images shown in the hero; they never appear in the facility gallery. */
export const COMPANY_COVER_IMAGE = 'COMPANY_COVER_IMAGE'
export const COMPANY_PROFILE_IMAGE = 'COMPANY_PROFILE_IMAGE'
export const IDENTITY_MEDIA_CATEGORIES: ReadonlySet<string> = new Set([COMPANY_COVER_IMAGE, COMPANY_PROFILE_IMAGE])

/** "SOME_KEY_NAME" / "some_key" → "Some key name". */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

export function declaredSectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? humanizeKey(section)
}

export function declaredFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanizeKey(field)
}

export function mediaCategoryLabel(category: string): string {
  return MEDIA_CATEGORY_LABELS[category] ?? humanizeKey(category)
}

/** Up to two initials for the avatar placeholder ("UAT Fictional Motors" → "UF"). */
export function dealerInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]
  return letters.toUpperCase()
}

function timeOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Newest item of one category, by the given timestamp key. Items the caller passes in are already
 * the ones the API chose to return (e.g. only currently display-approved public media).
 */
export function newestMediaOf<T extends { media_category: string }>(
  items: readonly T[] | null | undefined,
  category: string,
  timestampKey: keyof T,
): T | null {
  let newest: T | null = null
  for (const item of items ?? []) {
    if (item.media_category !== category) continue
    if (!newest || timeOf(item[timestampKey]) > timeOf(newest[timestampKey])) newest = item
  }
  return newest
}

export function plural(count: number, singular: string, pluralForm = singular + 's'): string {
  return count === 1 ? singular : pluralForm
}
