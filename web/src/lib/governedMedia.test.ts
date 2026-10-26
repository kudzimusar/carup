import { describe, expect, it } from 'vitest'
import {
  governedHeroItem, governedHeroUrl, governedMediaItems, governedMediaState, governedReviewLabel, governedTotal, governedUnavailable,
  type GovernedMediaItem,
} from './governedMedia'

const item = (rank: number, over: Partial<GovernedMediaItem> = {}): GovernedMediaItem => ({
  gallery_item_id: `g${rank}`, gallery_rank: rank, designated_primary: false, designation_basis: null, caption: null, review_status: 'pending',
  view: { href: `https://signed.example/p${rank}`, expires_at: '2026-10-26T06:00:00Z' }, ...over,
})
const block = (items: GovernedMediaItem[], over: Record<string, unknown> = {}) => ({ state: 'available', items, total_count: items.length, unavailable_count: 0, empty_statement: null, ...over })

describe('governedMedia', () => {
  it('an absent block is "absent" — never "none": nothing was sent to this viewer', () => {
    for (const v of [undefined, null, 'x', 3, [], {}, { state: 'available' }, { state: 'bogus', items: [] }, { state: 'none' }]) {
      expect(governedMediaState(v)).toBe('absent')
      expect(governedHeroItem(v)).toBeNull()
      expect(governedHeroUrl(v)).toBeNull()
      expect(governedTotal(v)).toBeNull()
    }
  })

  it('the three real states are reported as they are', () => {
    expect(governedMediaState(block([item(1)]))).toBe('available')
    expect(governedMediaState({ state: 'none', items: [], total_count: 0 })).toBe('none')
    expect(governedMediaState({ state: 'not_loaded', items: [] })).toBe('not_loaded')
  })

  it('photographs come back in gallery order and only those that can be drawn', () => {
    const b = block([item(3), item(1), item(2, { view: { href: 'http://insecure.example/p2', expires_at: null } }), item(4, { view: { href: 'javascript:alert(1)', expires_at: null } }), item(5, { view: { href: '/relative/path.jpg', expires_at: null } })])
    expect(governedMediaItems(b).map((i) => i.gallery_rank)).toEqual([1, 3])
  })

  it('the hero is the designated photograph, else the first by rank — and a window onto a gallery keeps its absolute rank', () => {
    expect(governedHeroItem(block([item(2), item(1)]))?.gallery_rank).toBe(1)
    expect(governedHeroItem(block([item(1), item(2, { designated_primary: true, designation_basis: 'SOURCE_FIRST_IMAGE' })]))?.gallery_rank).toBe(2)
    expect(governedHeroUrl(block([item(7)]))).toBe('https://signed.example/p7')
  })

  it('totals and unavailable counts are read, never invented', () => {
    expect(governedTotal(block([item(1)], { total_count: 50 }))).toBe(50)
    expect(governedTotal({ state: 'available', items: [item(1), item(2)] })).toBe(2)
    expect(governedUnavailable(block([item(1)], { unavailable_count: 3 }))).toBe(3)
    expect(governedUnavailable(block([item(1)], { unavailable_count: -1 }))).toBe(0)
    expect(governedUnavailable(undefined)).toBe(0)
  })

  it('a review state is worded as the asset\'s own; nothing becomes "verified" by being shown', () => {
    expect(governedReviewLabel('pending')).toBe('Awaiting review')
    expect(governedReviewLabel('verified')).toBe('Verified by CarUp')
    expect(governedReviewLabel('disputed')).toBe('Under dispute')
    for (const odd of [undefined, null, '', 'approved', 'VERIFIED?']) expect(governedReviewLabel(odd as string)).toBe('Review state not recorded')
  })
})
