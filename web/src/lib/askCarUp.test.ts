import { describe, expect, it } from 'vitest'
import { marketplaceHrefFor, parseCarRequest, understoodChips, withoutChip } from './askCarUp'

describe('Ask CarUp — sentence to supported Marketplace filters', () => {
  it('reads body style, fuel, transmission, budget and purpose from plain English', () => {
    const r = parseCarRequest('An automatic diesel pickup under $25,000 for the farm')
    expect(r).toMatchObject({ bodyStyle: 'Pickup', fuel: 'Diesel', transmission: 'Automatic', maxPrice: 25000 })
    expect(r.purposes).toContain('farm and rough roads')
    expect(marketplaceHrefFor(r)).toBe('/marketplace?bodyStyle=Pickup&fuel=Diesel&transmission=Automatic&maxPrice=25000')
  })

  it('finds a model without its make, using the governed taxonomy', () => {
    const r = parseCarRequest('looking for a hilux in harare')
    expect(r.make).toBe('Toyota')
    expect(r.model).toBe('Hilux')
    expect(r.location).toBe('Harare')
  })

  it('treats a bare year as a year, never as a budget; k and $ are money', () => {
    expect(parseCarRequest('a 2019 sedan').maxPrice).toBeUndefined()
    expect(parseCarRequest('budget 12k hatchback').maxPrice).toBe(12000)
    expect(parseCarRequest('something around $8 500').maxPrice).toBe(8500)
  })

  it('never invents a filter: unknown words stay out of the URL', () => {
    const r = parseCarRequest('something reliable and comfortable')
    expect(marketplaceHrefFor(r)).toBe('/marketplace')
    expect(understoodChips(r)).toEqual([])
  })

  it('lets the visitor remove what CarUp understood', () => {
    const r = parseCarRequest('Toyota Hilux diesel')
    const make = understoodChips(r).find(c => c.key === 'make')!
    const next = withoutChip(r, make)
    expect(next.make).toBeUndefined()
    expect(next.model).toBeUndefined()
    expect(next.fuel).toBe('Diesel')
  })

  it('maps people-carrier words to the canonical MPV body style', () => {
    expect(parseCarRequest('a 7 seater for the family').bodyStyle).toBe('MPV')
  })
})

describe('RX03-P2-R4 — colour reaches the Marketplace colour filter', () => {
  it('maps catalogue colours (and the gray alias) to the canonical colour facet', async () => {
    const { parseCarRequest, marketplaceHrefFor, understoodChips } = await import('./askCarUp')
    const white = parseCarRequest('a white automatic Toyota SUV under $30,000 in Harare')
    expect(white.color).toBe('White')
    expect(marketplaceHrefFor(white)).toContain('color=White')
    expect(understoodChips(white).map(c => c.label)).toContain('White')
    expect(parseCarRequest('a gray hatchback').color).toBe('Grey')
  })
  it('never invents a colour, and "Other" is not a colour anyone asked for', async () => {
    const { parseCarRequest } = await import('./askCarUp')
    expect(parseCarRequest('a diesel pickup for the farm').color).toBeUndefined()
    expect(parseCarRequest('other options please').color).toBeUndefined()
  })
})

/* ── RX03-P2-R5 GUTU-01 — budgets are read from MONEY, not from the first number in the sentence ── */
describe('GUTU-01 — numeric budget extraction', () => {
  async function filtersFor(sentence: string) {
    const { parseCarRequest, marketplaceHrefFor } = await import('./askCarUp')
    const { paramsToState, stateToApiFilters } = await import('./marketplaceParams')
    const href = marketplaceHrefFor(parseCarRequest(sentence))
    const query = new URLSearchParams(href.split('?')[1] ?? '')
    return { href, query, api: stateToApiFilters(paramsToState(query)) as Record<string, unknown> }
  }
  it.each([
    ['Show me a 7 seater under $15k', 15000],
    ['2018 Toyota Hilux under $25,000', 25000],
    ['Automatic diesel pickup under $25,000', 25000],
    ['Red Toyota SUV under $15k', 15000],
    ['A 4x4 with 3 rows of seats, max USD 18,500', 18500],
    ['family car up to US$12k please', 12000],
    ['5 door hatchback below 9000 dollars', 9000],
    ['UNDER $15K for a 7-SEATER', 15000],
    ['about $8.5k, 4 doors', 8500],
  ])('%s → maxPrice %i (URL and API filter)', async (sentence, max) => {
    const { query, api } = await filtersFor(sentence)
    expect(query.get('maxPrice')).toBe(String(max))
    expect(api.maxPrice).toBe(max)
    expect(query.get('minPrice')).toBeNull()
  })
  it.each([
    ['Toyota 2018'],
    ['7 seats, automatic, diesel'],
    ['Mazda 3 or a BMW 320i'],
    ['Land Cruiser 200 with 150000 km'],
    ['under $ please'],
    ['budget 15'],
    ['$15kk'],
  ])('%s → no invented budget', async sentence => {
    const { query, api } = await filtersFor(sentence)
    expect(query.get('maxPrice')).toBeNull()
    expect(query.get('minPrice')).toBeNull()
    expect(api.maxPrice).toBeUndefined()
  })
  it('a model year is a year constraint (the Marketplace supports year), never a budget', async () => {
    const a = await filtersFor('2018 Toyota Hilux under $25,000')
    expect(a.query.get('year')).toBe('2018')
    expect(a.query.get('make')).toBe('Toyota')
    expect(a.query.get('model')).toBe('Hilux')
    const b = await filtersFor('Toyota 2018')
    expect(b.query.get('year')).toBe('2018')
  })
  it('minimum and range budgets use the Marketplace minPrice/maxPrice filters', async () => {
    const atLeast = await filtersFor('an SUV for at least $20k')
    expect(atLeast.query.get('minPrice')).toBe('20000')
    expect(atLeast.query.get('maxPrice')).toBeNull()
    const range = await filtersFor('a sedan between $8,000 and $12k')
    expect(range.query.get('minPrice')).toBe('8000')
    expect(range.query.get('maxPrice')).toBe('12000')
  })
  it('keeps colour and body style alongside the budget', async () => {
    const { query } = await filtersFor('Red Toyota SUV under $15k')
    expect(query.get('color')).toBe('Red')
    expect(query.get('bodyStyle')).toBe('SUV')
    expect(query.get('make')).toBe('Toyota')
  })
})
