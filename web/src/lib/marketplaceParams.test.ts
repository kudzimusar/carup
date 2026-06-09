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
  DEFAULT_MARKETPLACE_STATE,
  type MarketplaceUrlState,
} from './marketplaceParams'

const p = (s: string) => new URLSearchParams(s)

describe('paramsToState', () => {
  it('parses q, make, category, minPrice, maxPrice, sort', () => {
    const state = paramsToState(p('q=hilux&make=Toyota&category=recently_imported&minPrice=3000&maxPrice=20000&sort=trust'))
    expect(state.searchQuery).toBe('hilux')
    expect(state.selectedMake).toBe('Toyota')
    expect(state.selectedCategoryChip).toBe('Recently Imported')
    expect(state.priceRange).toEqual([3000, 20000])
    expect(state.sortBy).toBe('trust')
  })

  it('parses a trust tag into the matching chip label', () => {
    expect(paramsToState(p('tag=passport_verified')).selectedCategoryChip).toBe('Passport Verified')
    expect(paramsToState(p('tag=partsentry_checked')).selectedCategoryChip).toBe('PartSentry Checked')
    expect(paramsToState(p('tag=dealer_verified')).selectedCategoryChip).toBe('Dealer Verified')
  })

  // Phase 1 contract: exactly ONE category/tag chip per URL (single value). When both are present,
  // `tag` wins — navbar links and AI output must emit at most one category/tag per URL.
  it('lets tag take precedence over category when both present (one chip per URL)', () => {
    expect(paramsToState(p('category=brand_new&tag=passport_verified')).selectedCategoryChip).toBe('Passport Verified')
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
    expect(paramsToState(p('tag=not_a_real_tag')).selectedCategoryChip).toBe('All')
  })

  describe('invalid input is handled safely', () => {
    it('falls back to newest for an invalid sort', () => {
      expect(paramsToState(p('sort=banana')).sortBy).toBe('newest')
    })

    it('ignores non-numeric or negative prices', () => {
      expect(paramsToState(p('minPrice=abc&maxPrice=-5')).priceRange).toEqual([0, 100000])
    })

    it('drops an inverted price range instead of returning an empty grid', () => {
      // min > max would match nothing; lower bound is dropped.
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

  it('emits make, q, tag/category, price, and non-default sort', () => {
    const state: MarketplaceUrlState = {
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedCategoryChip: 'Passport Verified',
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

  it('serializes a condition chip as category, not tag', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, selectedCategoryChip: 'Recently Imported' })
    expect(params.get('category')).toBe('recently_imported')
    expect(params.get('tag')).toBeNull()
  })

  it('does not emit the client-only "Parts & Accessories" pseudo-filter', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, selectedCategoryChip: 'Parts & Accessories' })
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
    { searchQuery: 'toyota', selectedMake: 'Toyota', selectedCategoryChip: 'Passport Verified', priceRange: [0, 10000], sortBy: 'trust' },
    { searchQuery: '', selectedMake: 'Mazda', selectedCategoryChip: 'Brand New', priceRange: [5000, 100000], sortBy: 'newest' },
    { searchQuery: 'cab', selectedMake: 'All', selectedCategoryChip: 'PartSentry Checked', priceRange: [0, 25000], sortBy: 'price-high' },
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
      selectedCategoryChip: 'Passport Verified',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(filters).toEqual({ q: 'toyota', make: 'Toyota', tag: 'passport_verified', maxPrice: 10000, sort: 'trust' })
  })

  it('is empty for a pristine state', () => {
    expect(stateToApiFilters(DEFAULT_MARKETPLACE_STATE)).toEqual({})
  })

  it('uses category key for condition chips and never sends the parts pseudo-filter', () => {
    expect(stateToApiFilters({ ...DEFAULT_MARKETPLACE_STATE, selectedCategoryChip: 'Locally Used' })).toEqual({ category: 'locally_used' })
    expect(stateToApiFilters({ ...DEFAULT_MARKETPLACE_STATE, selectedCategoryChip: 'Parts & Accessories' })).toEqual({})
  })
})

describe('chip <-> slug maps', () => {
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
  it('produces removable chips for every active filter', () => {
    const chips = getActiveFilterChips({
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedCategoryChip: 'Passport Verified',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(chips.map(c => c.key)).toEqual(['make', 'q', 'chip', 'price', 'sort'])
    expect(chips.find(c => c.key === 'price')?.label).toBe('Under $10,000')
  })

  it('returns nothing for a pristine state', () => {
    expect(getActiveFilterChips(DEFAULT_MARKETPLACE_STATE)).toEqual([])
  })
})

describe('getResultSummary', () => {
  it('describes the full active query', () => {
    expect(getResultSummary({
      searchQuery: '',
      selectedMake: 'Toyota',
      selectedCategoryChip: 'Passport Verified',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })).toBe('Showing Passport Verified Toyota vehicles under $10,000, sorted by trust.')
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
