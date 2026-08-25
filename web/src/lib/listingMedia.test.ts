import { describe, it, expect } from 'vitest'
import { primaryListingImageUrl, listingMediaState, unpublishableMediaCount } from './listingMedia'

/**
 * Issue #164 Phase 8, Run 4 — **D5**.
 *
 * The owner list surfaces read `vehicle.image_url`, a column `vehicles` does not have, so every card
 * rendered "Image unavailable" while the public listing published five real photographs of the same
 * vehicle. They now read the canonical `listing_media` block through this module, which exists so
 * the card, the listings row, the dashboard row and the detail header cannot disagree about which
 * photograph is the primary one.
 */

const item = (over: Partial<{ media_id: string; url: string; is_primary: boolean; position: number }> = {}) => ({
  media_id: over.media_id ?? '92980640-0e7f-4326-adb7-2c02faf1e865',
  url: over.url ?? 'https://x.supabase.co/storage/v1/object/public/vehicle-images/VIN/a.png',
  url_form: 'absolute_https',
  position: over.position ?? 0,
  is_primary: over.is_primary ?? false,
})

const block = (items: unknown[], state = 'published', unpublishable = 0) => ({
  state, items, unpublishable_count: unpublishable, empty_statement: null,
})

describe('primaryListingImageUrl', () => {
  it("honours the seller's primary claim over document order", () => {
    const b = block([
      item({ media_id: 'a', url: 'https://h/a.png', is_primary: false }),
      item({ media_id: 'b', url: 'https://h/b.png', is_primary: true }),
    ])
    expect(primaryListingImageUrl(b)).toBe('https://h/b.png')
  })

  it('falls back to the first item when nobody claimed primacy — the server already ordered them', () => {
    const b = block([
      item({ media_id: 'a', url: 'https://h/a.png' }),
      item({ media_id: 'b', url: 'https://h/b.png' }),
    ])
    expect(primaryListingImageUrl(b)).toBe('https://h/a.png')
  })

  it('returns null for an empty gallery rather than inventing a placeholder URL', () => {
    expect(primaryListingImageUrl(block([], 'none'))).toBeNull()
  })

  it('returns null — never throws — for absent, malformed or non-object input', () => {
    expect(primaryListingImageUrl(undefined)).toBeNull()
    expect(primaryListingImageUrl(null)).toBeNull()
    expect(primaryListingImageUrl('nonsense')).toBeNull()
    expect(primaryListingImageUrl({})).toBeNull()
    expect(primaryListingImageUrl({ items: 'not-an-array' })).toBeNull()
  })

  it('treats a blank or whitespace url as no url', () => {
    expect(primaryListingImageUrl(block([item({ url: '   ' })]))).toBeNull()
    expect(primaryListingImageUrl(block([item({ url: '' })]))).toBeNull()
  })
})

describe('listingMediaState — "we did not look" is not "there are none"', () => {
  it('reports the two real states', () => {
    expect(listingMediaState(block([item()]))).toBe('published')
    expect(listingMediaState(block([], 'none'))).toBe('none')
  })

  it('reports not_loaded for a missing block, and NEVER none', () => {
    // This is the safety property: claiming the seller published nothing is a statement we have not
    // earned when the read never happened.
    expect(listingMediaState(undefined)).toBe('not_loaded')
    expect(listingMediaState(null)).toBe('not_loaded')
    expect(listingMediaState(block([], 'not_loaded'))).toBe('not_loaded')
    expect(listingMediaState({ items: [], state: 'something_new' })).toBe('not_loaded')
  })
})

describe('unpublishableMediaCount', () => {
  it('surfaces items the projection counted but could not publish', () => {
    expect(unpublishableMediaCount(block([], 'none', 4))).toBe(4)
  })

  it('is 0 for absent, zero, negative or non-numeric values', () => {
    expect(unpublishableMediaCount(undefined)).toBe(0)
    expect(unpublishableMediaCount(block([], 'none', 0))).toBe(0)
    expect(unpublishableMediaCount({ items: [], unpublishable_count: -2 })).toBe(0)
    expect(unpublishableMediaCount({ items: [], unpublishable_count: 'many' })).toBe(0)
  })
})
