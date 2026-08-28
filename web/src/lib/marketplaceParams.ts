import { canonicalMake as canonicalTaxonomyMake, canonicalModel as canonicalTaxonomyModel, isValidVehicleYear, resolveBodyStyle } from '@/data/vehicleTaxonomy'

/**
 * Marketplace URL <-> state contract (CarUp Navigation Intelligence).
 *
 * Single source of truth for how `/marketplace?...` query params map to the Marketplace page's
 * filter state, the backend API filter object, and the human-readable active-filter chips / summary.
 * PURE (no React) so it can be unit-tested and reused by navbar/footer deep-links + the AI assistant.
 *
 * Reference-UX filter model:
 *   - one mutually-exclusive condition/category (`category=`),
 *   - many stackable trust tags (`tag=` repeated, AND semantics),
 *   - make / model / year / colour / body style / price / fuel / transmission / governed public location,
 *   - free text q and sort.
 *
 * Every user-visible filter represented here is shareable and server-addressable. A control that
 * exists only as local state can silently filter just the first returned page, so it does not belong
 * in the production facet rail. Body type is intentionally absent until Marketplace has a governed
 * body-style field in its public contract.
 */

export type MarketplaceSort = 'newest' | 'price-low' | 'price-high' | 'trust'

export const MARKETPLACE_SORTS: MarketplaceSort[] = ['newest', 'price-low', 'price-high', 'trust']
export const PRICE_MIN_DEFAULT = 0
export const PRICE_MAX_DEFAULT = 100000
export const SORT_DEFAULT: MarketplaceSort = 'newest'
export const ALL = 'All'

export interface MarketplaceUrlState {
  searchQuery: string
  selectedMake: string
  selectedModel: string
  selectedYear: string
  selectedColor: string
  selectedBodyStyle: string
  selectedCategory: string
  selectedTags: string[]
  selectedFuel: string
  selectedTransmission: string
  selectedLocation: string
  priceRange: [number, number]
  sortBy: MarketplaceSort
}

export interface MarketplaceApiFilters {
  q?: string
  make?: string
  model?: string
  year?: number
  color?: string
  bodyStyle?: string
  category?: string
  tag?: string
  fuel?: string
  transmission?: string
  location?: string
  minPrice?: number
  maxPrice?: number
  sort?: MarketplaceSort
}

export type ActiveFilterKey =
  | 'q'
  | 'make'
  | 'model'
  | 'year'
  | 'color'
  | 'bodyStyle'
  | 'category'
  | 'tag'
  | 'fuel'
  | 'transmission'
  | 'location'
  | 'price'
  | 'sort'

export interface ActiveFilterChip {
  key: ActiveFilterKey
  label: string
  value?: string
}

export const DEFAULT_MARKETPLACE_STATE: MarketplaceUrlState = {
  searchQuery: '',
  selectedMake: ALL,
  selectedModel: ALL,
  selectedYear: ALL,
  selectedColor: ALL,
  selectedBodyStyle: ALL,
  selectedCategory: ALL,
  selectedTags: [],
  selectedFuel: ALL,
  selectedTransmission: ALL,
  selectedLocation: ALL,
  priceRange: [PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT],
  sortBy: SORT_DEFAULT,
}

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
  for (const [label, { slug }] of Object.entries(CHIP_SLUG_KIND)) map[slug] = label
  map['certified_dealer'] = 'Dealer Verified'
  return map
})()

export const CATEGORY_CHIPS: string[] = Object.entries(CHIP_SLUG_KIND)
  .filter(([, value]) => value.kind === 'category')
  .map(([label]) => label)
export const TRUST_TAG_CHIPS: string[] = Object.entries(CHIP_SLUG_KIND)
  .filter(([, value]) => value.kind === 'tag')
  .map(([label]) => label)
export function isCategoryChip(label: string): boolean { return CHIP_SLUG_KIND[label]?.kind === 'category' }
export function isTrustChip(label: string): boolean { return CHIP_SLUG_KIND[label]?.kind === 'tag' }



const SORT_LABELS: Record<MarketplaceSort, string> = {
  newest: 'Newest',
  'price-low': 'Price: Low to High',
  'price-high': 'Price: High to Low',
  trust: 'Trust',
}

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
  return canonicalTaxonomyMake(trimmed)
}

function canonicalizeModel(make: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ALL
  return make && make !== ALL ? canonicalTaxonomyModel(make, trimmed) : trimmed
}

function parseYearFacet(value: string | null): string {
  const text = (value || '').trim()
  return isValidVehicleYear(text) ? String(Number(text)) : ALL
}

function canonicalizeBodyStyle(value: string | null): string {
  const text = (value || '').trim()
  if (!text) return ALL
  const resolved = resolveBodyStyle(text)
  return resolved.state === 'canonical' || resolved.state === 'alias_match' ? String(resolved.value) : text
}

function textFacet(value: string | null): string {
  const trimmed = (value || '').trim()
  return trimmed || ALL
}

function parseSort(value: string | null): MarketplaceSort {
  if (value && (MARKETPLACE_SORTS as string[]).includes(value)) return value as MarketplaceSort
  return SORT_DEFAULT
}

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

export function paramsToState(params: URLSearchParams): MarketplaceUrlState {
  const searchQuery = (params.get('q') || '').trim()
  const make = params.has('make') ? canonicalizeMake(params.get('make') || '') : ALL
  const model = params.has('model') ? canonicalizeModel(make, params.get('model') || '') : ALL
  const year = parseYearFacet(params.get('year'))
  const color = textFacet(params.get('color'))
  const bodyStyle = canonicalizeBodyStyle(params.get('bodyStyle') || params.get('body'))

  const categorySlug = slugify(params.get('category'))
  const categoryChip = categorySlug ? SLUG_TO_CHIP[categorySlug] : undefined
  const selectedCategory = categoryChip && isCategoryChip(categoryChip) ? categoryChip : ALL

  const tagSlugs = params.getAll('tag').flatMap(value => value.split(',')).map(slugify).filter(Boolean)
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
    selectedModel: model,
    selectedYear: year,
    selectedColor: color,
    selectedBodyStyle: bodyStyle,
    selectedCategory,
    selectedTags,
    selectedFuel: textFacet(params.get('fuel')),
    selectedTransmission: textFacet(params.get('transmission')),
    selectedLocation: textFacet(params.get('location')),
    priceRange: [min, max],
    sortBy: parseSort(params.get('sort')),
  }
}

/** Defaults are omitted. Deterministic order supports stable deep links and equality checks. */
export function stateToParams(state: MarketplaceUrlState): URLSearchParams {
  const params = new URLSearchParams()

  const make = state.selectedMake?.trim()
  if (make && make !== ALL) params.set('make', make)

  const model = state.selectedModel?.trim()
  if (model && model !== ALL) params.set('model', model)

  if (state.selectedYear && state.selectedYear !== ALL) params.set('year', state.selectedYear)
  if (state.selectedColor && state.selectedColor !== ALL) params.set('color', state.selectedColor)
  if (state.selectedBodyStyle && state.selectedBodyStyle !== ALL) params.set('bodyStyle', state.selectedBodyStyle)

  const q = state.searchQuery?.trim()
  if (q) params.set('q', q)

  if (state.selectedCategory && state.selectedCategory !== ALL) {
    const category = CHIP_SLUG_KIND[state.selectedCategory]
    if (category?.kind === 'category') params.set('category', category.slug)
  }

  for (const label of state.selectedTags || []) {
    const tag = CHIP_SLUG_KIND[label]
    if (tag?.kind === 'tag') params.append('tag', tag.slug)
  }

  if (state.selectedFuel && state.selectedFuel !== ALL) params.set('fuel', state.selectedFuel)
  if (state.selectedTransmission && state.selectedTransmission !== ALL) params.set('transmission', state.selectedTransmission)
  if (state.selectedLocation && state.selectedLocation !== ALL) params.set('location', state.selectedLocation)

  const [min, max] = state.priceRange
  if (Number.isFinite(min) && min > PRICE_MIN_DEFAULT) params.set('minPrice', String(Math.floor(min)))
  if (Number.isFinite(max) && max < PRICE_MAX_DEFAULT) params.set('maxPrice', String(Math.floor(max)))

  if (state.sortBy && state.sortBy !== SORT_DEFAULT) params.set('sort', state.sortBy)
  return params
}

export function canonicalParamString(state: MarketplaceUrlState): string {
  return stateToParams(state).toString()
}

/** Every filter emitted here is honored over the full eligible Marketplace population before limit. */
export function stateToApiFilters(state: MarketplaceUrlState): MarketplaceApiFilters {
  const filters: MarketplaceApiFilters = {}

  const q = state.searchQuery?.trim()
  if (q) filters.q = q

  const make = state.selectedMake?.trim()
  if (make && make !== ALL) filters.make = make

  const model = state.selectedModel?.trim()
  if (model && model !== ALL) filters.model = model

  if (state.selectedYear && state.selectedYear !== ALL) {
    const year = Number(state.selectedYear)
    if (Number.isInteger(year)) filters.year = year
  }
  if (state.selectedColor && state.selectedColor !== ALL) filters.color = state.selectedColor
  if (state.selectedBodyStyle && state.selectedBodyStyle !== ALL) filters.bodyStyle = state.selectedBodyStyle

  if (state.selectedCategory && state.selectedCategory !== ALL) {
    const category = CHIP_SLUG_KIND[state.selectedCategory]
    if (category?.kind === 'category') filters.category = category.slug
  }

  const tagSlugs = (state.selectedTags || [])
    .map(label => CHIP_SLUG_KIND[label]?.slug)
    .filter((slug): slug is string => Boolean(slug))
  if (tagSlugs.length) filters.tag = tagSlugs.join(',')

  if (state.selectedFuel && state.selectedFuel !== ALL) filters.fuel = state.selectedFuel
  if (state.selectedTransmission && state.selectedTransmission !== ALL) filters.transmission = state.selectedTransmission
  if (state.selectedLocation && state.selectedLocation !== ALL) filters.location = state.selectedLocation

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

export function getActiveFilterChips(state: MarketplaceUrlState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []

  if (state.selectedMake && state.selectedMake !== ALL) chips.push({ key: 'make', label: state.selectedMake })
  if (state.selectedModel && state.selectedModel !== ALL) chips.push({ key: 'model', label: state.selectedModel })
  if (state.selectedYear && state.selectedYear !== ALL) chips.push({ key: 'year', label: state.selectedYear })
  if (state.selectedColor && state.selectedColor !== ALL) chips.push({ key: 'color', label: state.selectedColor })
  if (state.selectedBodyStyle && state.selectedBodyStyle !== ALL) chips.push({ key: 'bodyStyle', label: state.selectedBodyStyle })
  if (state.searchQuery?.trim()) chips.push({ key: 'q', label: `“${state.searchQuery.trim()}”` })
  if (state.selectedCategory && state.selectedCategory !== ALL) chips.push({ key: 'category', label: state.selectedCategory })
  for (const tag of state.selectedTags || []) chips.push({ key: 'tag', label: tag, value: tag })
  if (state.selectedFuel !== ALL) chips.push({ key: 'fuel', label: state.selectedFuel })
  if (state.selectedTransmission !== ALL) chips.push({ key: 'transmission', label: state.selectedTransmission })
  if (state.selectedLocation !== ALL) chips.push({ key: 'location', label: state.selectedLocation })

  const price = priceChipLabel(state.priceRange[0], state.priceRange[1])
  if (price) chips.push({ key: 'price', label: price })
  if (state.sortBy && state.sortBy !== SORT_DEFAULT) chips.push({ key: 'sort', label: `Sorted by ${SORT_LABELS[state.sortBy]}` })
  return chips
}

export function getResultSummary(state: MarketplaceUrlState): string {
  const parts = [
    state.selectedCategory !== ALL ? state.selectedCategory : '',
    ...(state.selectedTags || []),
    state.selectedMake !== ALL ? state.selectedMake : '',
    state.selectedModel !== ALL ? state.selectedModel : '',
    state.selectedYear !== ALL ? state.selectedYear : '',
    state.selectedColor !== ALL ? state.selectedColor : '',
    state.selectedBodyStyle !== ALL ? state.selectedBodyStyle : '',
    state.selectedFuel !== ALL ? state.selectedFuel : '',
    state.selectedTransmission !== ALL ? state.selectedTransmission : '',
  ].filter(Boolean)
  const subject = parts.join(' ')

  let sentence = subject ? `Showing ${subject} vehicles` : 'Showing all vehicles'
  if (state.selectedLocation !== ALL) sentence += ` in ${state.selectedLocation}`

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

export const COVERAGE_GATED_NAV: Record<string, string> = {
  'Locally Used': 'locally_used',
}

export interface MarketplaceNavCoverage {
  threshold?: number
  categories?: Record<string, { count?: number; active?: boolean }>
  tags?: Record<string, { count?: number; active?: boolean }>
}

export function resolveCoverageNavHref(label: string, fallbackHref: string, coverage?: MarketplaceNavCoverage | null): string {
  const slug = COVERAGE_GATED_NAV[label]
  if (slug && coverage?.categories?.[slug]?.active) return `/marketplace?category=${slug}`
  return fallbackHref
}

/**
 * Identifier-shaped queries may be tried against the governed Passport lookup before ordinary
 * Marketplace discovery. This helper makes no claim that plate/chassis are public-searchable: the
 * anonymous listing endpoint deliberately excludes those identifiers from its search haystack.
 */
export function looksLikeIdentifier(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.length >= 6 && !/\s/.test(trimmed)
}
