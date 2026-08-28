/**
 * Seller Journey 1.0 / S6 — Actual Buyer Preview & Searchability Proof.
 *
 * S6's rule is blunt: "Reuse the actual Marketplace listing card… No separate approximate preview
 * model." The guest preview was exactly the thing that rule forbids — a bespoke layout that showed
 * the seller something no buyer would ever see.
 *
 * It was also not merely approximate, it was wrong: `Number(form.mileage || 0).toLocaleString()`
 * printed **"0 km"** for a seller who had not entered mileage yet. A fabricated zero for an unknown
 * fact is precisely what Invariant 8 forbids, and it is the same defect class the marketplace
 * summary already documents ("`numericValue(x, 0)` published a fabricated 0 … a $0, 0 km, year-0
 * listing that a shopper cannot tell from a real one").
 *
 * A preview built from a DRAFT also must not borrow authority the draft does not have: nothing here
 * is verified, published, Trust-scored, or plate-checked, and the preview must say so by carrying
 * those as absent rather than as favourable defaults.
 */
import { describe, expect, it } from 'vitest'
import { sellerDraftToCardModel, sellerDiscoverabilityFacets } from './sellerListingPreview'

const fullDraft = {
  make: 'Toyota', model: 'Hilux', year: '2021', color: 'White',
  mileage: '45000', condition: 'Used', category: 'Pickup',
  fuelType: 'Diesel', transmission: 'Automatic', drivetrain: '4WD',
  location: 'Harare', province: 'Harare',
  price: '28500', currency: 'USD',
  images: ['data:image/png;base64,front'],
}

const emptyDraft = {
  make: '', model: '', year: '', color: '', mileage: '', condition: '', category: '',
  fuelType: '', transmission: '', drivetrain: '', location: '', province: '',
  price: '', currency: '', images: [] as string[],
}

describe('S6 seller draft preview model', () => {
  it('builds the real card model from what the seller entered', () => {
    const card = sellerDraftToCardModel(fullDraft)
    expect(card.name).toBe('2021 Toyota Hilux')
    expect(card.price).toBe(28500)
    expect(card.currency).toBe('USD')
    expect(card.mileage).toBe(45000)
    expect(card.fuel).toBe('Diesel')
    expect(card.transmission).toBe('Automatic')
    expect(card.primaryImage).toBe('data:image/png;base64,front')
  })

  it('never fabricates a zero for a fact the seller has not entered', () => {
    const card = sellerDraftToCardModel(emptyDraft)
    // The defect this replaces printed "0 km" here. Unknown is null, and the card renders its own
    // honest missing state from that.
    expect(card.mileage).toBeNull()
    expect(card.price).toBeNull()
    expect(card.currency).toBeNull()
    expect(card.primaryImage).toBeNull()
  })

  it('treats a non-numeric or negative entry as unknown rather than coercing it', () => {
    expect(sellerDraftToCardModel({ ...fullDraft, mileage: 'abc' }).mileage).toBeNull()
    expect(sellerDraftToCardModel({ ...fullDraft, price: '' }).price).toBeNull()
    // A genuine zero survives: 0 km is a real reading a new vehicle can have.
    expect(sellerDraftToCardModel({ ...fullDraft, mileage: '0' }).mileage).toBe(0)
  })

  it('borrows no authority the draft does not have', () => {
    const card = sellerDraftToCardModel(fullDraft)
    // A draft is not verified, not Trust-scored, not plate-checked, not published and not reserved.
    expect(card.trust).toBeNull()
    expect(card.plateVerified).toBe(false)
    // The unchecked-plate sentence is the Marketplace's own, not one invented for the preview.
    expect(card.plateStatus).toBe('Plate status unknown')
    expect(card.partSentryChecked).toBe(false)
    expect(card.carupGold).toBe(false)
    expect(card.reserved).toBe(false)
    // The label must not read as a published, governed classification.
    expect(card.labels).toEqual(['Draft preview'])
    expect(card.sellerLabel).toBe('Seller identity not published')
  })

  it('states the location the seller entered without implying it is governed', () => {
    expect(sellerDraftToCardModel(fullDraft).locationLabel).toContain('Harare')
    // No location entered must not become a place.
    expect(sellerDraftToCardModel(emptyDraft).locationLabel).not.toContain('Harare')
  })
})

describe('S6 discoverability facets', () => {
  it('lists exactly the facets a buyer could search this listing by', () => {
    expect(sellerDiscoverabilityFacets(fullDraft)).toEqual([
      'Toyota', 'Hilux', 'Pickup', 'Diesel', 'Automatic', '4WD', 'Harare', '2021',
    ])
  })

  it('omits facets the seller has not supplied rather than padding the list', () => {
    // A facet the listing cannot be found by must not appear as though it can.
    expect(sellerDiscoverabilityFacets({ ...fullDraft, fuelType: '', drivetrain: '' }))
      .toEqual(['Toyota', 'Hilux', 'Pickup', 'Automatic', 'Harare', '2021'])
    expect(sellerDiscoverabilityFacets(emptyDraft)).toEqual([])
  })
})
