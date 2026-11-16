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
