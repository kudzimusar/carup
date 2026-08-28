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
  it('parses the shareable Marketplace discovery contract', () => {
    const state = paramsToState(p(
      'q=hilux&make=Toyota&category=recently_imported&fuel=Diesel&transmission=Automatic&location=Harare&minPrice=3000&maxPrice=20000&sort=trust',
    ))
    expect(state).toEqual({
      searchQuery: 'hilux',
      selectedMake: 'Toyota',
      selectedModel: 'All',
      selectedYear: 'All',
      selectedColor: 'All',
      selectedBodyStyle: 'All',
      selectedCategory: 'Recently Imported',
      selectedTags: [],
      selectedFuel: 'Diesel',
      selectedTransmission: 'Automatic',
      selectedLocation: 'Harare',
      priceRange: [3000, 20000],
      sortBy: 'trust',
    })
  })

  it('parses a single trust tag into the matching chip label', () => {
    expect(paramsToState(p('tag=passport_verified')).selectedTags).toEqual(['Passport Verified'])
    expect(paramsToState(p('tag=partsentry_checked')).selectedTags).toEqual(['PartSentry Checked'])
    expect(paramsToState(p('tag=dealer_verified')).selectedTags).toEqual(['Dealer Verified'])
  })

  it('keeps category AND trust tags together', () => {
    const state = paramsToState(p('category=brand_new&tag=passport_verified'))
    expect(state.selectedCategory).toBe('Brand New')
    expect(state.selectedTags).toEqual(['Passport Verified'])
  })

  it('parses multiple stackable trust tags from repeated tag params', () => {
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

  it('canonicalizes catalogue aliases while preserving unknown makes as free text', () => {
    expect(paramsToState(p('make=vw')).selectedMake).toBe('Volkswagen')
    expect(paramsToState(p('make=Mercedes')).selectedMake).toBe('Mercedes-Benz')
    expect(paramsToState(p('make=Unknown%20Coachworks')).selectedMake).toBe('Unknown Coachworks')
  })

  it('returns defaults for an empty query string', () => {
    expect(paramsToState(p(''))).toEqual(DEFAULT_MARKETPLACE_STATE)
  })

  it('supports model/year/colour/body style while keeping condition taxonomy separate', () => {
    const state = paramsToState(p('make=Toyota&model=Hilux&year=2019&color=Silver&body=pickup&condition=New'))
    expect(state.selectedMake).toBe('Toyota')
    expect(state.selectedModel).toBe('Hilux')
    expect(state.selectedYear).toBe('2019')
    expect(state.selectedColor).toBe('Silver')
    expect(state.selectedBodyStyle).toBe('Pickup')
    expect(state.selectedCategory).toBe('All')
  })

  it('canonicalizes model aliases against the selected make', () => {
    const state = paramsToState(p('make=Honda&model=Jazz'))
    expect(state.selectedMake).toBe('Honda')
    expect(state.selectedModel).toBe('Fit')
  })

  it('rejects an invalid year facet without inventing one', () => {
    expect(paramsToState(p('year=1800')).selectedYear).toBe('All')
    expect(paramsToState(p('year=banana')).selectedYear).toBe('All')
  })

  it('ignores an unknown slug rather than activating a phantom chip', () => {
    expect(paramsToState(p('tag=not_a_real_tag')).selectedTags).toEqual([])
    expect(paramsToState(p('category=not_a_real_category')).selectedCategory).toBe('All')
  })

  it('does not treat a trust slug in the category param as a condition', () => {
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

  it('emits all supported structural facets deterministically', () => {
    const state: MarketplaceUrlState = {
      ...DEFAULT_MARKETPLACE_STATE,
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedModel: 'Fit',
      selectedYear: '2019',
      selectedColor: 'Silver',
      selectedBodyStyle: 'Hatchback',
      selectedTags: ['Passport Verified'],
      selectedFuel: 'Hybrid',
      selectedTransmission: 'Automatic',
      selectedLocation: 'Harare',
      priceRange: [2000, 15000],
      sortBy: 'price-low',
    }
    const params = stateToParams(state)
    expect(params.get('make')).toBe('Honda')
    expect(params.get('model')).toBe('Fit')
    expect(params.get('year')).toBe('2019')
    expect(params.get('color')).toBe('Silver')
    expect(params.get('bodyStyle')).toBe('Hatchback')
    expect(params.get('q')).toBe('fit')
    expect(params.get('tag')).toBe('passport_verified')
    expect(params.get('fuel')).toBe('Hybrid')
    expect(params.get('transmission')).toBe('Automatic')
    expect(params.get('location')).toBe('Harare')
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

  it('does not emit the client-only Parts & Accessories pseudo-filter', () => {
    const params = stateToParams({ ...DEFAULT_MARKETPLACE_STATE, selectedCategory: 'Parts & Accessories' })
    expect(params.toString()).toBe('')
  })

  it('omits default facets, newest sort and full-range price', () => {
    expect(stateToParams(DEFAULT_MARKETPLACE_STATE).toString()).toBe('')
  })
})

describe('round-trip params <-> state', () => {
  const cases: MarketplaceUrlState[] = [
    DEFAULT_MARKETPLACE_STATE,
    { ...DEFAULT_MARKETPLACE_STATE, searchQuery: 'toyota', selectedMake: 'Toyota', selectedTags: ['Passport Verified'], priceRange: [0, 10000], sortBy: 'trust' },
    { ...DEFAULT_MARKETPLACE_STATE, selectedMake: 'Mazda', selectedCategory: 'Brand New', priceRange: [5000, 100000] },
    { ...DEFAULT_MARKETPLACE_STATE, searchQuery: 'cab', selectedTags: ['PartSentry Checked'], selectedFuel: 'Diesel', selectedLocation: 'Bulawayo', priceRange: [0, 25000], sortBy: 'price-high' },
    { ...DEFAULT_MARKETPLACE_STATE, selectedMake: 'Toyota', selectedCategory: 'Brand New', selectedTags: ['Passport Verified', 'Low Mileage'], selectedTransmission: 'Manual' },
    { ...DEFAULT_MARKETPLACE_STATE, selectedMake: 'Honda', selectedModel: 'Fit', selectedYear: '2019', selectedColor: 'Silver' },
  ]
  it.each(cases)('paramsToState(stateToParams(s)) === s', (state) => {
    expect(paramsToState(stateToParams(state))).toEqual(state)
  })
})

describe('stateToApiFilters', () => {
  it('emits only supported, non-default keys including full-population facets', () => {
    const filters = stateToApiFilters({
      ...DEFAULT_MARKETPLACE_STATE,
      searchQuery: 'toyota',
      selectedMake: 'Toyota',
      selectedModel: 'Hilux',
      selectedYear: '2019',
      selectedColor: 'Silver',
      selectedBodyStyle: 'Pickup',
      selectedTags: ['Passport Verified'],
      selectedFuel: 'Diesel',
      selectedTransmission: 'Manual',
      selectedLocation: 'Gweru',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(filters).toEqual({
      q: 'toyota',
      make: 'Toyota',
      model: 'Hilux',
      year: 2019,
      color: 'Silver',
      bodyStyle: 'Pickup',
      tag: 'passport_verified',
      fuel: 'Diesel',
      transmission: 'Manual',
      location: 'Gweru',
      maxPrice: 10000,
      sort: 'trust',
    })
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
  it('produces removable chips for every active Marketplace facet', () => {
    const chips = getActiveFilterChips({
      ...DEFAULT_MARKETPLACE_STATE,
      searchQuery: 'fit',
      selectedMake: 'Honda',
      selectedModel: 'Fit',
      selectedYear: '2019',
      selectedColor: 'Silver',
      selectedBodyStyle: 'Hatchback',
      selectedCategory: 'Brand New',
      selectedTags: ['Passport Verified', 'Fresh Import'],
      selectedFuel: 'Hybrid',
      selectedTransmission: 'Automatic',
      selectedLocation: 'Harare',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })
    expect(chips.map(chip => chip.key)).toEqual([
      'make', 'model', 'year', 'color', 'bodyStyle', 'q', 'category', 'tag', 'tag', 'fuel', 'transmission', 'location', 'price', 'sort',
    ])
    expect(chips.filter(chip => chip.key === 'tag').map(chip => chip.value)).toEqual(['Passport Verified', 'Fresh Import'])
    expect(chips.find(chip => chip.key === 'price')?.label).toBe('Under $10,000')
  })

  it('returns nothing for a pristine state', () => {
    expect(getActiveFilterChips(DEFAULT_MARKETPLACE_STATE)).toEqual([])
  })
})

describe('getResultSummary', () => {
  it('describes category, trust, make and server-addressable facets', () => {
    expect(getResultSummary({
      ...DEFAULT_MARKETPLACE_STATE,
      selectedMake: 'Toyota',
      selectedModel: 'Hilux',
      selectedYear: '2019',
      selectedColor: 'Silver',
      selectedBodyStyle: 'Pickup',
      selectedTags: ['Passport Verified'],
      selectedFuel: 'Diesel',
      selectedTransmission: 'Automatic',
      selectedLocation: 'Harare',
      priceRange: [0, 10000],
      sortBy: 'trust',
    })).toBe('Showing Passport Verified Toyota Hilux 2019 Silver Pickup Diesel Automatic vehicles in Harare under $10,000, sorted by trust.')
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
    const coverage = { categories: { locally_used: { count: 3, active: true } } }
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', coverage)).toBe('/marketplace?category=locally_used')
  })
  it('keeps the deferred /marketplace href when coverage is below threshold / inactive / missing', () => {
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', { categories: { locally_used: { count: 2, active: false } } })).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', null)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', undefined)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Locally Used', '/marketplace', { categories: {} })).toBe('/marketplace')
  })
  it('leaves non-coverage-gated labels unchanged even when coverage is active', () => {
    const coverage = { categories: { locally_used: { count: 5, active: true } } }
    expect(resolveCoverageNavHref('Shop All Cars', '/marketplace', coverage)).toBe('/marketplace')
    expect(resolveCoverageNavHref('Dealer Verified Cars', '/marketplace?tag=dealer_verified', coverage)).toBe('/marketplace?tag=dealer_verified')
  })
})

describe('unsupported government-approval tags cannot round-trip', () => {
  it('an unsupported slug does not map back to a chip label', () => {
    const state = paramsToState(p('tag=duty_cleared&tag=zimra_verified&tag=cid_clear'))
    expect(state.selectedTags).toEqual([])
  })

  it('a governed tag alongside them still resolves', () => {
    const state = paramsToState(p('tag=duty_cleared&tag=low_mileage'))
    expect(state.selectedTags).toEqual(['Low Mileage'])
  })
})
