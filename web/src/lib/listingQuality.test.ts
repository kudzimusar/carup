/**
 * Seller Journey 1.0 / S7 — Listing Quality is its own measurement.
 *
 * Invariant 6 forbids collapsing three different questions:
 *
 *   · Publication Readiness — MAY CarUp publish this? (governed evidence requirements)
 *   · Listing Quality       — is the COMMERCIAL listing strong? (the seller's own advertising)
 *   · Canonical Trust       — what has CarUp actually VERIFIED?
 *
 * Only Publication Readiness had a seller-facing surface. The risk in adding a second one is that a
 * quality score reads as a trust score: a seller who writes a long description and uploads ten
 * photos has a strong ADVERTISEMENT, and CarUp has verified exactly nothing more than before.
 *
 * These tests pin that separation as arithmetic, not as wording: a perfect Listing Quality score is
 * computed from seller-stated inputs alone and can never move a publication requirement or a Trust
 * position.
 */
import { describe, expect, it } from 'vitest'
import { assessListingQuality, LISTING_QUALITY_CHECKS } from './listingQuality'

const strongListing = {
  images: Array.from({ length: 8 }, (_, i) => `photo-${i}`),
  coverChosen: true,
  description: 'A'.repeat(400),
  features: ['Tow bar', 'Reverse camera', 'Leather seats'],
  discoverabilityFacets: ['Toyota', 'Hilux', 'Pickup', 'Diesel', 'Automatic', '4WD', 'Harare', '2021'],
}

const bareListing = {
  images: [] as string[],
  coverChosen: false,
  description: '',
  features: [] as string[],
  discoverabilityFacets: [] as string[],
}

describe('S7 listing quality', () => {
  it('scores a strong commercial listing highly', () => {
    const result = assessListingQuality(strongListing)
    expect(result.score).toBe(100)
    expect(result.suggestions).toEqual([])
  })

  it('scores a bare listing at zero and says exactly what would improve it', () => {
    const result = assessListingQuality(bareListing)
    expect(result.score).toBe(0)
    expect(result.suggestions.length).toBe(LISTING_QUALITY_CHECKS.length)
    // Every suggestion must be an action the seller can take, not a verdict on the vehicle.
    for (const suggestion of result.suggestions) {
      expect(suggestion.length).toBeGreaterThan(0)
      expect(suggestion.toLowerCase()).not.toMatch(/verified|trust|certified|approved|inspected/)
    }
  })

  it('never describes itself with verification language', () => {
    for (const check of LISTING_QUALITY_CHECKS) {
      expect(check.label.toLowerCase()).not.toMatch(/verified|trust|certified|approved|inspected|proof/)
      expect(check.suggestion.toLowerCase()).not.toMatch(/verified|trust|certified|approved|inspected|proof/)
    }
  })

  it('is computed from seller-stated inputs only — nothing governed reaches it', () => {
    // A perfect score is reachable with zero evidence, zero verification and no Trust position,
    // which is exactly why it must never be presented as any of those.
    const result = assessListingQuality(strongListing)
    expect(result.score).toBe(100)
    expect(Object.keys(strongListing).sort()).toEqual(
      ['coverChosen', 'description', 'discoverabilityFacets', 'features', 'images'],
    )
  })

  it('improves monotonically as the seller adds real content', () => {
    const steps = [
      bareListing,
      { ...bareListing, images: ['a', 'b', 'c', 'd'] },
      { ...bareListing, images: ['a', 'b', 'c', 'd'], coverChosen: true },
      { ...bareListing, images: ['a', 'b', 'c', 'd'], coverChosen: true, description: 'A'.repeat(400) },
      strongListing,
    ]
    const scores = steps.map(step => assessListingQuality(step).score)
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1])
    }
  })

  it('does not award a cover claim the seller has not made', () => {
    const withPhotosNoCover = { ...strongListing, coverChosen: false }
    const result = assessListingQuality(withPhotosNoCover)
    expect(result.score).toBeLessThan(100)
    // Asserted on the semantic result rather than the prose, so improving the copy cannot break it.
    expect(result.passed).not.toContain('A chosen cover photo')
    expect(result.suggestions).toContain(
      LISTING_QUALITY_CHECKS.find(check => check.key === 'cover_chosen')?.suggestion,
    )
  })

  it('bands the score without implying a governed grade', () => {
    expect(assessListingQuality(bareListing).band).toBe('Needs work')
    expect(assessListingQuality(strongListing).band).toBe('Strong')
    // "Strong" describes the advertisement. It must not borrow a Trust vocabulary.
    for (const listing of [bareListing, strongListing]) {
      expect(assessListingQuality(listing).band.toLowerCase()).not.toMatch(/verified|trusted|gold|certified/)
    }
  })
})
