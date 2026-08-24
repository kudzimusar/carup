/**
 * Marketplace URL <-> state contract (CarUp Navigation Intelligence).
 *
 * Single source of truth for how `/marketplace?...` query params map to the Marketplace page's
 * filter state, the backend API filter object, and the human-readable active-filter chips / summary.
 * PURE (no React) so it can be unit-tested and reused by navbar/footer deep-links + the AI assistant.
 *
 * Filter model (QA Round 4): ONE mutually-exclusive condition/category (`category=`) PLUS many
 * stackable trust tags (`tag=` repeated), combined with AND semantics. A pristine page stays at a
 * clean `/marketplace`.
 */

export type MarketplaceSort = 'newest' | 'price-low' | 'price-high' | 'trust'

export const MARKETPLACE_SORTS: MarketplaceSort[] = ['newest', 'price-low', 'price-high', 'trust']

export const PRICE_MIN_DEFAULT = 0
export const PRICE_MAX_DEFAULT = 100000
export const SORT_DEFAULT: MarketplaceSort = 'newest'
export const ALL = 'All'

/** Filter state used by the Marketplace page (names mirror the component's useState). */
export interface MarketplaceUrlState {
  searchQuery: string
  selectedMake: string
  /** Single mutually-exclusive condition/category chip label (e.g. "Brand New"). 'All' = none. */
  selectedCategory: string
  /** Stackable trust-tag chip labels (e.g. ["Dealer Verified","Duty Cleared"]); AND semantics. [] = none. */
  selectedTags: string[]
  priceRange: [number, number]
  sortBy: MarketplaceSort
}

/** Filter object passed to fetchMarketplaceListings(). `tag` may be a CSV of multiple trust slugs. */
export interface MarketplaceApiFilters {
  q?: string
  make?: string
  category?: string
  tag?: string
  minPrice?: number
  maxPrice?: number
  sort?: MarketplaceSort
}

export type ActiveFilterKey = 'q' | 'make' | 'category' | 'tag' | 'price' | 'sort'

export interface ActiveFilterChip {
  key: ActiveFilterKey
  label: string
  /** For a 'tag' chip, the trust-chip label to remove (lets each tag be removed individually). */
  value?: string
}

export const DEFAULT_MARKETPLACE_STATE: MarketplaceUrlState = {
  searchQuery: '',
  selectedMake: ALL,
  selectedCategory: ALL,
  selectedTags: [],
  priceRange: [PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT],
  sortBy: SORT_DEFAULT,
}

/**
 * Chip label -> backend slug + kind. `kind` decides whether the chip is a mutually-exclusive
 * condition (`category`) or a stackable trust signal (`tag`).
 */
const CHIP_SLUG_KIND: Record<string, { slug: string; kind: 'category' | 'tag' }> = {
  'Brand New': { slug: 'brand_new', kind: 'category' },
  'Recently Imported': { slug: 'recently_imported', kind: 'category' },
  'Locally Used': { slug: 'locally_used', kind: 'category' },
  'Second Hand': { slug: 'second_hand', kind: 'category' },
  'Fresh Import': { slug: 'fresh_import', kind: 'tag' },
  'Dealer Verified': { slug: 'dealer_verified', kind: 'tag' },
  'Passport Verified': { slug: 'passport_verified', kind: 'tag' },
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

/** Chip labels grouped by kind, for the split single-category vs multi-trust UI. */
export const CATEGORY_CHIPS: string[] = Object.entries(CHIP_SLUG_KIND).filter(([, v]) => v.kind === 'category').map(([l]) => l)
export const TRUST_TAG_CHIPS: string[] = Object.entries(CHIP_SLUG_KIND).filter(([, v]) => v.kind === 'tag').map(([l]) => l)
export function isCategoryChip(label: string): boolean { return CHIP_SLUG_KIND[label]?.kind === 'category' }
export function isTrustChip(label: string): boolean { return CHIP_SLUG_KIND[label]?.kind === 'tag' }

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
 * Prominent quick filters surfaced above the full chip taxonomy. A mix of single-select condition
 * categories and stackable trust tags — the page routes each by its kind. testIds are stable.
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
  if (value && (MARKETPLACE_SORTS as string[]).includes(value)) return value as MarketplaceSort
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

  // ONE condition/category from `category=` (only category-kind chips qualify).
  const categorySlug = slugify(params.get('category'))
  const categoryChip = categorySlug ? SLUG_TO_CHIP[categorySlug] : undefined
  const selectedCategory = categoryChip && isCategoryChip(categoryChip) ? categoryChip : ALL

  // MANY trust tags from repeated `tag=` params (each may also be a CSV); dedupe; trust-kind only.
  const tagSlugs = params.getAll('tag').flatMap(v => v.split(',')).map(slugify).filter(Boolean)
  const selectedTags: string[] = []
  for (const slug of tagSlugs) {
    const label = SLUG_TO_CHIP[slug]
    if (label && isTrustChip(label) && !selectedTags.includes(label)) selectedTags.push(label)
  }

  let min = parsePrice(params.get('minPrice'))
  let max = parsePrice(params.get('maxPrice'))
  if (min === null) min = PRICE_MIN_DEFAULT
  if (max === null || max <= 0) max = PRICE_MAX_DEFAULT
  min = Math.min(Math.max(min, PRICE_MIN_DEFAULT), PRICE_MAX_DEFAULT)
  max = Math.min(Math.max(max, PRICE_MIN_DEFAULT), PRICE_MAX_DEFAULT)
  if (min > max) min = PRICE_MIN_DEFAULT

  return {
    searchQuery,
    selectedMake: make,
    selectedCategory,
    selectedTags,
    priceRange: [min, max],
    sortBy: parseSort(params.get('sort')),
  }
}

/**
 * Serialize state back to a URLSearchParams. Defaults are omitted. Deterministic order:
 * make, q, category, tag(s), minPrice, maxPrice, sort.
 */
export function stateToParams(state: MarketplaceUrlState): URLSearchParams {
  const params = new URLSearchParams()

  const make = state.selectedMake?.trim()
  if (make && make !== ALL) params.set('make', make)

  const q = state.searchQuery?.trim()
  if (q) params.set('q', q)

  if (state.selectedCategory && state.selectedCategory !== ALL) {
    const c = CHIP_SLUG_KIND[state.selectedCategory]
    if (c?.kind === 'category') params.set('category', c.slug)
  }

  for (const label of state.selectedTags || []) {
    const t = CHIP_SLUG_KIND[label]
    if (t?.kind === 'tag') params.append('tag', t.slug)
  }

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

  if (state.selectedCategory && state.selectedCategory !== ALL) {
    const c = CHIP_SLUG_KIND[state.selectedCategory]
    if (c?.kind === 'category') filters.category = c.slug
  }

  const tagSlugs = (state.selectedTags || []).map(l => CHIP_SLUG_KIND[l]?.slug).filter((s): s is string => Boolean(s))
  if (tagSlugs.length) filters.tag = tagSlugs.join(',')

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

/** Removable chips describing the currently active, URL-backed filters. Order: make, q, category, tags, price, sort. */
export function getActiveFilterChips(state: MarketplaceUrlState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []

  if (state.selectedMake && state.selectedMake !== ALL) chips.push({ key: 'make', label: state.selectedMake })
  if (state.searchQuery?.trim()) chips.push({ key: 'q', label: `“${state.searchQuery.trim()}”` })
  if (state.selectedCategory && state.selectedCategory !== ALL) chips.push({ key: 'category', label: state.selectedCategory })
  for (const tag of state.selectedTags || []) chips.push({ key: 'tag', label: tag, value: tag })

  const price = priceChipLabel(state.priceRange[0], state.priceRange[1])
  if (price) chips.push({ key: 'price', label: price })
  if (state.sortBy && state.sortBy !== SORT_DEFAULT) chips.push({ key: 'sort', label: `Sorted by ${SORT_LABELS[state.sortBy]}` })

  return chips
}

/** Human-readable summary, e.g. "Showing Brand New Dealer Verified Toyota vehicles under $10,000". */
export function getResultSummary(state: MarketplaceUrlState): string {
  const parts = [
    state.selectedCategory !== ALL ? state.selectedCategory : '',
    ...(state.selectedTags || []),
    state.selectedMake !== ALL ? state.selectedMake : '',
  ].filter(Boolean)
  const subject = parts.join(' ')

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

/**
 * Buy-menu items whose href is gated by LIVE marketplace coverage (label -> category slug).
 * Only `Locally Used` is coverage-gated for now; the rest stay deferred until supported.
 */
export const COVERAGE_GATED_NAV: Record<string, string> = {
  'Locally Used': 'locally_used',
}

/** Shape of the nav-coverage payload (counts + active flags per category/tag). */
export interface MarketplaceNavCoverage {
  threshold?: number
  categories?: Record<string, { count?: number; active?: boolean }>
  tags?: Record<string, { count?: number; active?: boolean }>
}

/**
 * Resolve a coverage-gated Buy-menu href: activate the category deep-link ONLY when live coverage
 * marks it active (>= threshold real listings). Otherwise keep the deferred `/marketplace` href.
 */
export function resolveCoverageNavHref(label: string, fallbackHref: string, coverage?: MarketplaceNavCoverage | null): string {
  const slug = COVERAGE_GATED_NAV[label]
  if (slug && coverage?.categories?.[slug]?.active) return `/marketplace?category=${slug}`
  return fallbackHref
}

/**
 * A query with no spaces and at least 6 characters is treated as a possible vehicle
 * identifier (VIN / chassis / plate / temporary ID) and tried against the passport
 * lookup endpoint before falling back to a plain marketplace search — the backend
 * listing search haystack also covers VIN/plate/chassis, so nothing is lost when the
 * lookup misses.
 */
export function looksLikeIdentifier(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.length >= 6 && !/\s/.test(trimmed)
}
