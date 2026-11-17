import { describe, expect, it } from 'vitest'
import { sellerReadiness, type SellerReadinessInput } from './sellerReadiness'
import { LISTING_QUALITY_CHECKS } from './listingQuality'

const empty: SellerReadinessInput = {
  make: '', model: '', year: '', vin: '', color: '', mileage: '', condition: '', category: '', fuelType: '',
  transmission: '', currency: '', price: '', location: '', description: '', features: [], images: [],
  coverChosen: false, discoverabilityFacets: [],
}

const complete: SellerReadinessInput = {
  ...empty,
  make: 'Toyota', model: 'Hilux', year: '2018', vin: 'AHTFR22G406012345', color: 'White', mileage: '120000',
  condition: 'used', category: 'pickup', fuelType: 'diesel', transmission: 'manual', currency: 'USD',
  price: '18500', location: 'Harare', description: 'One owner, full service history at the dealer, new tyres.',
}

describe('sellerReadiness', () => {
  it('starts with nothing done and never reports a score', () => {
    const r = sellerReadiness(empty, 'account')
    expect(r.requiredDone).toBe(0)
    expect(r.readyToSave).toBe(false)
    expect(Object.keys(r)).not.toContain('score')
  })

  it('is ready to save when every rule the signed-in page enforces is met', () => {
    const r = sellerReadiness(complete, 'account')
    expect(r.required.filter(item => !item.done)).toEqual([])
    expect(r.readyToSave).toBe(true)
  })

  it('mirrors the signed-in price floor (below 100 refused) but not the guest page', () => {
    expect(sellerReadiness({ ...complete, price: '99' }, 'account').readyToSave).toBe(false)
    expect(sellerReadiness({ ...complete, price: '99' }, 'guest').readyToSave).toBe(true)
  })

  it('mirrors each page description minimum (50 signed in, 30 trimmed as a guest)', () => {
    const forty = 'x'.repeat(40)
    expect(sellerReadiness({ ...complete, description: forty }, 'account').readyToSave).toBe(false)
    expect(sellerReadiness({ ...complete, description: forty }, 'guest').readyToSave).toBe(true)
    expect(sellerReadiness({ ...complete, description: ` ${'x'.repeat(28)} ` }, 'guest').readyToSave).toBe(false)
  })

  it('guest year must be a valid year; signed-in year only present', () => {
    expect(sellerReadiness({ ...complete, year: '1700' }, 'guest').readyToSave).toBe(false)
    expect(sellerReadiness({ ...complete, year: '1700' }, 'account').readyToSave).toBe(true)
  })

  it('holds the identifier item while the page reports an identity blocker, using its words', () => {
    const r = sellerReadiness({ ...complete, identityBlocker: 'Confirm that this is the existing CarUp vehicle' }, 'account')
    const vin = r.required.find(item => item.key === 'vin')!
    expect(vin.done).toBe(false)
    expect(vin.label).toBe('Confirm that this is the existing CarUp vehicle')
    expect(vin.step).toBe(0)
  })

  it('an incomplete identifier is not done', () => {
    expect(sellerReadiness({ ...complete, vin: 'ABC' }, 'guest').required.find(i => i.key === 'vin')!.done).toBe(false)
  })

  it('carries every existing listing-quality check unchanged, each mapped to a step', () => {
    const r = sellerReadiness({ ...complete, images: ['a', 'b', 'c', 'd'], coverChosen: true, features: ['a', 'b', 'c'] }, 'account')
    expect(r.stronger.map(item => item.key)).toEqual(LISTING_QUALITY_CHECKS.map(check => check.key))
    expect(r.stronger.find(i => i.key === 'photo_count')!.done).toBe(true)
    expect(r.stronger.find(i => i.key === 'photo_depth')!.done).toBe(false)
    expect(r.stronger.every(item => item.step >= 0 && item.step <= 2)).toBe(true)
  })

  it('uses no verification vocabulary in any label it adds', () => {
    const labels = sellerReadiness(empty, 'account').required.map(item => item.label).join(' ').toLowerCase()
    for (const word of ['verified', 'inspected', 'certified', 'trusted', 'approved']) expect(labels).not.toContain(word)
  })
})
