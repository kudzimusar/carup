import { describe, it, expect } from 'vitest'
import {
  paramsToState,
  stateToParams,
  stateToApiFilters,
  getActiveFilterChips,
  getResultSummary,
  canonicalParamString,
  resolveCoverageNavHref,
  CHIP_TO_SLUG,
  SLUG_TO_CHIP,
  CATEGORY_CHIPS,
  TRUST_TAG_CHIPS,
  isCategoryChip,
  isTrustChip,
  DEFAULT_MARKETPLACE_STATE,
  type MarketplaceUrlState,
} from './marketplaceParams'

const p = (s: string) => new URLSearchParams(s)

describe('paramsToState', () => {
  it('parses q, make, category, minPrice, maxPrice, sort', () => {
    const state = paramsToState(p('q=hilux&make=Toyota&category=recently_imported&minPrice=3000&maxPrice=20000&sort=trust'))
    expect(state.searchQuery).toBe('hilux')
    expect(state.selectedMake).toBe('Toyota')
    expect(state.selectedCategory).toBe('Recently Imported')
    expect(state.selectedTags).toEqual([])
    expect(state.priceRange).toEqual([3000, 20000])
    expect(state.sortBy).toBe('trust')
  })

  it('parses a single trust tag into the matching chip label', () => {
    expect(paramsToState(p('tag=passport_verified')).selectedTags).toEqual(['Passport Verified'])
    expect(paramsToState(p('tag=partsentry_checked')).selectedTags).toEqual(['PartSentry Checked'])
    expect(paramsToState(p('tag=dealer_verified')).selectedTags).toEqual(['Dealer Verified'])
  })

  // QA Round 4: a single condition/category and MANY trust tags now COEXIST (no precedence collapse).
  it('keeps category AND trust tags together', () => {
    const state = paramsToState(p('category=brand_new&tag=passport_verified'))
    expect(state.selectedCategory).toBe('Brand New')
    expect(state.selectedTags).toEqual(['Passport Verified'])
  })

  it('parses MULTIPLE stackable trust tags from repeated tag params (AND semantics)', () => {
    const state = paramsToState(p('tag=passport_verified&tag=fresh_import&tag=low_mileage'))
    expect(state.selectedTags).toEqual(['Passport Verified', 'Fresh Import', 'Low Mileage'])
  })

  it('also accepts a CSV tag value and dedupes', () => {
    const state = paramsToState(p('tag=passport_verified,fresh_import&tag=passport_verified'))
    expect(state.selectedTags).toEqual(['Passport Verified', 'Fresh Import'])
  })

  it('recovers make casing case-insensitively', () => {
    expect(paramsToState(p('make=toyota')).selectedMake).toBe('Toyota')
    expect(paramsToState(p('make=land%20rover')).selectedMake).toBe('Land Rover')
  })

  it('returns defaults for an empty query string', () => {
    expect(paramsToState(p(''))).toEqual(DEFAULT_MARKETPLACE_STATE)
  })

  it('ignores unknown params and unsupported/deferred filters', () => {
    const state = paramsToState(p('body=suv&location=Harare&condition=New&color=red'))
    expect(state).toEqual(DEFAULT_MARKETPLACE_STATE)
  })

  it('ignores an unknown slug rather than activating a phantom chip', () => {
    expect(paramsToState(p('tag=not_a_real_tag')).selectedTags).toEqual([])
    expect(paramsToState(p('category=not_a_real_category')).selectedCategory).toBe('All')
  })

  it('does not treat a trust slug in the category param as a condition', () => {
    // category only accepts condition-kind slugs; a trust slug there is ignored (it belongs in tag=).
    expect(paramsToState(p('category=passport_verified')).selectedCategory).toBe('All')
    expect(paramsToState(p('category=passport_verified')).selectedTags).toEqual([])
  })

  describe('invalid input is handled safely', () => {
    it('falls back to newest for an invalid sort', () => {
      expect(paramsToState(p('sort=banana')).sortBy).toBe('newest')
    })

    it('ignores non-numeric or negative prices', () => {
      expect(paramsToState(p('minPrice=abc&maxPrice=-5')).priceRange).toEqual([0, 100000])
    })

    it('drops an inverted price range instead of returning an empty grid', () => {
      expect(paramsToState(p('minPrice=50000&maxPrice=10000')).priceRange).toEqual([0, 10000])
    })

    it('clamps prices into the supported range', () => {
      expect(paramsToState(p('maxPrice=999999')).priceRange).toEqual([0, 100000])
    })
  })
})

describe('stateToParams', () => {
  it('omits all defaults for a pristine state', () => {
    expect(stateToParams(DEFAULT_MARKETPLACE_STATE).toString()).toBe('')
  })

  it('emits make, q, a single tag, price, and non-default sort', () => {
    const state: MarketplaceUrlState = {
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedCategory: 'All',
      selectedTags: ['Passport Verified'],
      priceRange: [2000, 15000],
      sortBy: 'price-low',
    }
    const params = stateToParams(state)
    expect(params.get('make')).toBe('Honda')
    expect(params.get('q')).toBe('fit')
    expect(params.get('tag')).toBe('passport_verified')
    expect(params.get('category')).toBeNull()
    expect(params.get('minPrice')).toBe('2000')
    expect(params.get('maxPrice')).toBe('15000')
    expect(params.get('sort')).toBe('price-low')
  })

  it('emits a category AND repeated tag params when both are active', () => {
    const params = stateToParams({
      ...DEFAULT_MARKETPLACE_STATE,
      selectedCategory: 'Brand New',
      selectedTags: ['Passport Verified', 'Fresh Import'],
    })
    expect(params.get('category')).toBe('brand_new')
    expect(params.getAll('tag')).toEqual(['passport_verified', 'fresh_import'])
  })

  it('serializes a condition chip as category, not tag', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, selectedCategory: 'Recently Imported' })
    expect(params.get('category')).toBe('recently_imported')
    expect(params.getAll('tag')).toEqual([])
  })

  it('does not emit the client-only "Parts & Accessories" pseudo-filter', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, selectedCategory: 'Parts & Accessories' })
    expect(params.toString()).toBe('')
  })

  it('omits a default (newest) sort and full-range price', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, sortBy: 'newest', priceRange: [0, 100000] })
    expect(params.toString()).toBe('')
  })
})

describe('round-trip params <-> state', () => {
  const cases: MarketplaceUrlState[] = [
    DEFAULT_MARKETPLACE_STATE,
    { searchQuery: 'toyota', selectedMake: 'Toyota', selectedCategory: 'All', selectedTags: ['Passport Verified'], priceRange: [0, 10000], sortBy: 'trust' },
    { searchQuery: '', selectedMake: 'Mazda', selectedCategory: 'Brand New', selectedTags: [], priceRange: [5000, 100000], sortBy: 'newest' },
    { searchQuery: 'cab', selectedMake: 'All', selectedCategory: 'All', selectedTags: ['PartSentry Checked'], priceRange: [0, 25000], sortBy: 'price-high' },
    { searchQuery: '', selectedMake: 'Toyota', selectedCategory: 'Brand New', selectedTags: ['Passport Verified', 'Low Mileage'], priceRange: [0, 100000], sortBy: 'newest' },
  ]
  it.each(cases)('paramsToState(stateToParams(s)) === s', (state) => {
    expect(paramsToState(stateToParams(state))).toEqual(state)
  })
})

describe('stateToApiFilters', () => {
  it('emits only supported, non-default keys', () => {
    const filters = stateToApiFilters({
      searchQuery: 'toyota',
      selectedMake: 'Toyota',
      selectedCategory: 'All',
      selectedTags: ['Passport Verified'],
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(filters).toEqual({ q: 'toyota', make: 'Toyota', tag: 'passport_verified', maxPrice: 10000, sort: 'trust' })
  })

  it('joins multiple trust tags into a CSV tag and keeps category separate', () => {
    const filters = stateToApiFilters({
      ...DEFAULT_MARKETPLACE_STATE,
      selectedCategory: 'Brand New',
      selectedTags: ['Passport Verified', 'Fresh Import'],
    })
    expect(filters).toEqual({ category: 'brand_new', tag: 'passport_verified,fresh_import' })
  })

  it('is empty for a pristine state', () => {
    expect(stateToApiFilters(DEFAULT_MARKETPLACE_STATE)).toEqual({})
  })

  it('uses category key for condition chips and never sends the parts pseudo-filter', () => {
    expect(stateToApiFilters({ ...DEFAULT_MARKETPLACE_STATE, selectedCategory: 'Locally Used' })).toEqual({ category: 'locally_used' })
    expect(stateToApiFilters({ ...DEFAULT_MARKETPLACE_STATE, selectedCategory: 'Parts & Accessories' })).toEqual({})
  })
})

describe('chip classification', () => {
  it('classifies condition chips and trust chips correctly', () => {
    expect(CATEGORY_CHIPS).toEqual(['Brand New', 'Recently Imported', 'Locally Used', 'Second Hand'])
    expect(TRUST_TAG_CHIPS).toContain('Passport Verified')
    expect(TRUST_TAG_CHIPS).toContain('Dealer Verified')
    expect(isCategoryChip('Brand New')).toBe(true)
    expect(isCategoryChip('Passport Verified')).toBe(false)
    expect(isTrustChip('Dealer Verified')).toBe(true)
    expect(isTrustChip('Brand New')).toBe(false)
  })

  it.each([
    ['Passport Verified', 'passport_verified'],
    ['Recently Imported', 'recently_imported'],
    ['PartSentry Checked', 'partsentry_checked'],
    ['Dealer Verified', 'dealer_verified'],
    ['Brand New', 'brand_new'],
    ['Locally Used', 'locally_used'],
  ])('maps %s <-> %s both ways', (label, slug) => {
    expect(CHIP_TO_SLUG[label]).toBe(slug)
    expect(SLUG_TO_CHIP[slug]).toBe(label)
  })
})

describe('getActiveFilterChips', () => {
  it('produces removable chips for make, q, category, and each tag', () => {
    const chips = getActiveFilterChips({
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedCategory: 'Brand New',
      selectedTags: ['Passport Verified', 'Fresh Import'],
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(chips.map(c => c.key)).toEqual(['make', 'q', 'category', 'tag', 'tag', 'price', 'sort'])
    expect(chips.filter(c => c.key === 'tag').map(c => c.value)).toEqual(['Passport Verified', 'Fresh Import'])
    expect(chips.find(c => c.key === 'price')?.label).toBe('Under $10,000')
  })

  it('returns nothing for a pristine state', () => {
    expect(getActiveFilterChips(DEFAULT_MARKETPLACE_STATE)).toEqual([])
  })
})

describe('getResultSummary', () => {
  it('describes the full active query (category + tags + make)', () => {
    expect(getResultSummary({
      searchQuery: '',
      selectedMake: 'Toyota',
      selectedCategory: 'All',
      selectedTags: ['Passport Verified'],
      priceRange: [0, 10000],
      sortBy: 'trust',
    })).toBe('Showing Passport Verified Toyota vehicles under $10,000, sorted by trust.')
  })

  it('joins a category and multiple trust tags', () => {
    expect(getResultSummary({
      ...DEFAULT_MARKETPLACE_STATE,
      selectedCategory: 'Brand New',
      selectedTags: ['Passport Verified', 'Low Mileage'],
      selectedMake: 'Toyota',
    })).toBe('Showing Brand New Passport Verified Low Mileage Toyota vehicles.')
  })

  it('falls back to a neutral summary with no filters', () => {
    expect(getResultSummary(DEFAULT_MARKETPLACE_STATE)).toBe('Showing all vehicles.')
  })
})

describe('canonicalParamString', () => {
  it('is stable and equal for equivalent states', () => {
    const a = canonicalParamString({ ...DEFAULT_MARKETPLACE_STATE, selectedMake: 'Toyota', sortBy: 'trust' })
    const b = canonicalParamString(paramsToState(p('make=Toyota&sort=trust')))
    expect(a).toBe(b)
  })
})

describe('resolveCoverageNavHref (data-driven nav gate)', () => {
  it('activates the category deep-link when coverage marks it active', () => {
    const cov = { categories: { locally_used: { count: 3, active: true } } }
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', cov)).toBe('/marketplace?category=locally_used')
  })
  it('keeps the deferred /marketplace href when coverage is below threshold / inactive / missing', () => {
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', { categories: { locally_used: { count: 2, active: false } } })).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', null)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', undefined)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', { categories: {} })).toBe('/marketplace')
  })
  it('leaves non-coverage-gated labels unchanged even when coverage is active', () => {
    const cov = { categories: { locally_used: { count: 5, active: true } } }
    expect(resolveCoverageNavHref('Shop All Cars', '/marketplace', cov)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Dealer Verified Cars', '/marketplace?tag=dealer_verified', cov)).toBe('/marketplace?tag=dealer_verified')
  })
})


// ── D1: the suppressed government-approval claims are no longer part of the vocabulary ───────────

describe('unsupported government-approval tags cannot round-trip', () => {
  // These fixtures previously used 'Duty Cleared' to exercise multi-tag parsing. The MECHANICS are
  // unchanged and now ride on 'Fresh Import'; what is asserted here is that the suppressed claim
  // cannot be expressed at all — it has no legitimate writer, so a URL naming it must not resolve
  // to a selectable chip.
  it('an unsupported slug does not map back to a chip label', () => {
    const state = paramsToState(p('tag=duty_cleared&tag=zimra_verified&tag=cid_clear'))
    expect(state.selectedTags).toEqual([])
  })

  it('a governed tag alongside them still resolves', () => {
    const state = paramsToState(p('tag=duty_cleared&tag=low_mileage'))
    expect(state.selectedTags).toEqual(['Low Mileage'])
  })
})
