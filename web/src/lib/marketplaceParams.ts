/**
 * Marketplace URL <-> state contract (CarUp Navigation Intelligence — Phase 1).
 *
 * This is the single source of truth for how `/marketplace?...` query params map to
 * the Marketplace page's filter state, to the backend API filter object, and to the
 * human-readable active-filter chips / result summary.
 *
 * It is intentionally PURE (no React, no runtime imports) so it can be unit-tested
 * in isolation and reused later by:
 *   - Phase 2: navbar/footer deep-links
 *   - Phase 4/5: the AI assistant (it will emit these same URLs)
 *
 * Supported Phase 1 params: q, make, category, tag, minPrice, maxPrice, sort.
 *
 * Deliberately NOT part of the public URL contract yet (they only narrow mock data,
 * not the live listing summary, so they would silently produce empty result grids):
 *   - body type (SUV/Sedan/...)  -> needs `body_type` column (Phase 6)
 *   - raw condition (New/Used/CPO) -> not present on the live summary (Phase 6)
 *   - city/location               -> live summary location is coarse "Zimbabwe" (Phase 6)
 *   - fuel / transmission         -> client-side refinement only, kept out of the contract until verified
 */

export type MarketplaceSort = 'newest' | 'price-low' | 'price-high' | 'trust'

export const MARKETPLACE_SORTS: MarketplaceSort[] = [
  'newest',
  'price-low',
  'price-high',
  'trust',
]

export const PRICE_MIN_DEFAULT = 0
export const PRICE_MAX_DEFAULT = 100000
export const SORT_DEFAULT: MarketplaceSort = 'newest'
export const ALL = 'All'

/** Filter state used by the Marketplace page (names mirror the component's useState). */
export interface MarketplaceUrlState {
  searchQuery: string
  selectedMake: string
  /**
   * Title-case chip label shared by condition + trust chips, e.g. "Passport Verified". 'All' = none.
   * Phase 1 contract supports exactly ONE category/tag chip per URL (a single value, not a list).
   * On parse, if both `category=` and `tag=` are present, `tag` wins. Future navbar links and AI
   * output must therefore emit at most one category/tag per URL.
   */
  selectedCategoryChip: string
  priceRange: [number, number]
  sortBy: MarketplaceSort
}

/** Filter object passed to fetchMarketplaceListings() — only backend-supported, live-data keys. */
export interface MarketplaceApiFilters {
  q?: string
  make?: string
  category?: string
  tag?: string
  minPrice?: number
  maxPrice?: number
  sort?: MarketplaceSort
}

export type ActiveFilterKey = 'q' | 'make' | 'chip' | 'price' | 'sort'

export interface ActiveFilterChip {
  key: ActiveFilterKey
  label: string
}

export const DEFAULT_MARKETPLACE_STATE: MarketplaceUrlState = {
  searchQuery: '',
  selectedMake: ALL,
  selectedCategoryChip: ALL,
  priceRange: [PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT],
  sortBy: SORT_DEFAULT,
}

/**
 * Chip label -> backend slug + kind. `kind` decides whether the chip serializes to
 * `category=` (condition/classification) or `tag=` (trust/marketplace signal).
 * Only chips backed by a real backend slug that narrows LIVE data are listed here.
 *
 * Design debt (deferred): "Parts & Accessories" is intentionally omitted — it is a client-only
 * pseudo-filter with no backend slug; a real parts marketplace is a separate, later phase. Do not
 * wire it into navigation until the parts backend exists.
 */
const CHIP_SLUG_KIND: Record<string, { slug: string; kind: 'category' | 'tag' }> = {
  'Brand New': { slug: 'brand_new', kind: 'category' },
  'Recently Imported': { slug: 'recently_imported', kind: 'category' },
  'Locally Used': { slug: 'locally_used', kind: 'category' },
  'Second Hand': { slug: 'second_hand', kind: 'category' },
  'Fresh Import': { slug: 'fresh_import', kind: 'tag' },
  'Dealer Verified': { slug: 'dealer_verified', kind: 'tag' },
  'Passport Verified': { slug: 'passport_verified', kind: 'tag' },
  'Duty Cleared': { slug: 'duty_cleared', kind: 'tag' },
  'Low Mileage': { slug: 'low_mileage', kind: 'tag' },
  'Evidence Available': { slug: 'evidence_available', kind: 'tag' },
  'PartSentry Checked': { slug: 'partsentry_checked', kind: 'tag' },
  'Repair History Available': { slug: 'repair_history_available', kind: 'tag' },
  'Verified Parts': { slug: 'verified_parts', kind: 'tag' },
}

export const CHIP_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CHIP_SLUG_KIND).map(([label, { slug }]) => [label, slug]),
)

export const SLUG_TO_CHIP: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [label, { slug }] of Object.entries(CHIP_SLUG_KIND)) {
    map[slug] = label
  }
  // Accept the condition-category alias that renders as the same "Dealer Verified" chip.
  map['certified_dealer'] = 'Dealer Verified'
  return map
})()

/** Canonical vehicle makes (mirrors Marketplace make selector) for case-insensitive URL recovery. */
const KNOWN_MAKES = [
  'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Mazda',
  'Volkswagen', 'Ford', 'Honda', 'Land Rover', 'Audi',
]

const SORT_LABELS: Record<MarketplaceSort, string> = {
  newest: 'Newest',
  'price-low': 'Price: Low to High',
  'price-high': 'Price: High to Low',
  trust: 'Trust',
}

/**
 * Prominent quick filters surfaced above the full chip taxonomy (a mix of trust tags and condition
 * categories — the UI row is labelled "Quick filters").
 *
 * Coverage guard: a trust tag must NOT be promoted as a navigation deep-link until it has real live
 * coverage (>= 3 listings). Current state: dealer_verified passed (wired in Phase 2.1);
 * passport_verified and partsentry_checked are 0 and stay deferred until a data backfill.
 */
export const TRUST_QUICK_FILTERS: Array<{ label: string; testId: string }> = [
  { label: 'Passport Verified', testId: 'marketplace-filter-passport-verified' },
  { label: 'PartSentry Checked', testId: 'marketplace-filter-partsentry-checked' },
  { label: 'Dealer Verified', testId: 'marketplace-filter-dealer-verified' },
  { label: 'Recently Imported', testId: 'marketplace-filter-recently-imported' },
  { label: 'Brand New', testId: 'marketplace-filter-brand-new' },
  { label: 'Locally Used', testId: 'marketplace-filter-locally-used' },
]

function canonicalizeMake(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ALL
  const match = KNOWN_MAKES.find(make => make.toLowerCase() === trimmed.toLowerCase())
  return match ?? trimmed
}

function parseSort(value: string | null): MarketplaceSort {
  if (value && (MARKETPLACE_SORTS as string[]).includes(value)) {
    return value as MarketplaceSort
  }
  return SORT_DEFAULT
}

/** Parse a price param: finite, >= 0 integer; otherwise null (ignored). */
function parsePrice(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function slugify(value: string | null): string {
  return (value || '').trim().toLowerCase()
}

function formatPrice(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}

/** Read supported params off a URLSearchParams into Marketplace filter state. */
export function paramsToState(params: URLSearchParams): MarketplaceUrlState {
  const searchQuery = (params.get('q') || '').trim()

  const make = params.has('make') ? canonicalizeMake(params.get('make') || '') : ALL

  // Trust tags take precedence over category if both are present.
  const chipSlug = slugify(params.get('tag')) || slugify(params.get('category'))
  const selectedCategoryChip = (chipSlug && SLUG_TO_CHIP[chipSlug]) || ALL

  let min = parsePrice(params.get('minPrice'))
  let max = parsePrice(params.get('maxPrice'))
  if (min === null) min = PRICE_MIN_DEFAULT
  if (max === null || max <= 0) max = PRICE_MAX_DEFAULT
  min = Math.min(Math.max(min, PRICE_MIN_DEFAULT), PRICE_MAX_DEFAULT)
  max = Math.min(Math.max(max, PRICE_MIN_DEFAULT), PRICE_MAX_DEFAULT)
  if (min > max) {
    // Invalid range: drop the lower bound rather than return an empty grid.
    min = PRICE_MIN_DEFAULT
  }

  return {
    searchQuery,
    selectedMake: make,
    selectedCategoryChip,
    priceRange: [min, max],
    sortBy: parseSort(params.get('sort')),
  }
}

/**
 * Serialize state back to a URLSearchParams. Defaults are omitted so a pristine
 * page stays at a clean `/marketplace`. Param order is deterministic for tests.
 */
export function stateToParams(state: MarketplaceUrlState): URLSearchParams {
  const params = new URLSearchParams()

  const make = state.selectedMake?.trim()
  if (make && make !== ALL) params.set('make', make)

  const q = state.searchQuery?.trim()
  if (q) params.set('q', q)

  const chip = CHIP_SLUG_KIND[state.selectedCategoryChip]
  if (chip) params.set(chip.kind, chip.slug)

  const [min, max] = state.priceRange
  if (Number.isFinite(min) && min > PRICE_MIN_DEFAULT) params.set('minPrice', String(Math.floor(min)))
  if (Number.isFinite(max) && max < PRICE_MAX_DEFAULT) params.set('maxPrice', String(Math.floor(max)))

  if (state.sortBy && state.sortBy !== SORT_DEFAULT) params.set('sort', state.sortBy)

  return params
}

/** Canonical query string for equality checks (URL <-> state sync without loops). */
export function canonicalParamString(state: MarketplaceUrlState): string {
  return stateToParams(state).toString()
}

/** Build the API filter object — only backend-supported, live-data keys, no defaults/empties. */
export function stateToApiFilters(state: MarketplaceUrlState): MarketplaceApiFilters {
  const filters: MarketplaceApiFilters = {}

  const q = state.searchQuery?.trim()
  if (q) filters.q = q

  const make = state.selectedMake?.trim()
  if (make && make !== ALL) filters.make = make

  const chip = CHIP_SLUG_KIND[state.selectedCategoryChip]
  if (chip?.kind === 'category') filters.category = chip.slug
  if (chip?.kind === 'tag') filters.tag = chip.slug

  const [min, max] = state.priceRange
  if (Number.isFinite(min) && min > PRICE_MIN_DEFAULT) filters.minPrice = Math.floor(min)
  if (Number.isFinite(max) && max < PRICE_MAX_DEFAULT) filters.maxPrice = Math.floor(max)

  if (state.sortBy && state.sortBy !== SORT_DEFAULT) filters.sort = state.sortBy

  return filters
}

function priceChipLabel(min: number, max: number): string | null {
  const hasMin = Number.isFinite(min) && min > PRICE_MIN_DEFAULT
  const hasMax = Number.isFinite(max) && max < PRICE_MAX_DEFAULT
  if (hasMin && hasMax) return `${formatPrice(min)} – ${formatPrice(max)}`
  if (hasMax) return `Under ${formatPrice(max)}`
  if (hasMin) return `From ${formatPrice(min)}`
  return null
}

/** Removable chips describing the currently active, URL-backed filters. */
export function getActiveFilterChips(state: MarketplaceUrlState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []

  if (state.selectedMake && state.selectedMake !== ALL) {
    chips.push({ key: 'make', label: state.selectedMake })
  }
  if (state.searchQuery?.trim()) {
    chips.push({ key: 'q', label: `“${state.searchQuery.trim()}”` })
  }
  if (state.selectedCategoryChip && state.selectedCategoryChip !== ALL) {
    chips.push({ key: 'chip', label: state.selectedCategoryChip })
  }
  const price = priceChipLabel(state.priceRange[0], state.priceRange[1])
  if (price) chips.push({ key: 'price', label: price })

  if (state.sortBy && state.sortBy !== SORT_DEFAULT) {
    chips.push({ key: 'sort', label: `Sorted by ${SORT_LABELS[state.sortBy]}` })
  }

  return chips
}

/** Human-readable summary of the active query, e.g. "Showing Passport Verified Toyota vehicles under $10,000". */
export function getResultSummary(state: MarketplaceUrlState): string {
  const chip = state.selectedCategoryChip !== ALL ? state.selectedCategoryChip : ''
  const make = state.selectedMake !== ALL ? state.selectedMake : ''
  const subject = [chip, make].filter(Boolean).join(' ')

  let sentence = subject ? `Showing ${subject} vehicles` : 'Showing all vehicles'

  const price = priceChipLabel(state.priceRange[0], state.priceRange[1])
  if (price) {
    if (price.startsWith('Under')) sentence += ` under ${formatPrice(state.priceRange[1])}`
    else if (price.startsWith('From')) sentence += ` from ${formatPrice(state.priceRange[0])}`
    else sentence += ` priced ${price}`
  }

  if (state.searchQuery?.trim()) sentence += ` matching “${state.searchQuery.trim()}”`
  if (state.sortBy !== SORT_DEFAULT) sentence += `, sorted by ${SORT_LABELS[state.sortBy].toLowerCase()}`

  return `${sentence}.`
}
