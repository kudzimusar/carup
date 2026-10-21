/**
 * CARUP-MVP-STAB-01 F-006 / F-007 — which Seller Studio a listing gets, and what a failed save
 * actually means.
 */
import { describe, expect, it } from 'vitest'
import { SessionExpiredError } from './apiClient'
import { classifySellerSaveFailure, sellerStudioMode } from './sellerStudioLifecycle'

function apiFailure(status: number, data: Record<string, unknown>) {
  return Object.assign(new Error(String(data.error || `HTTP ${status}`)), {
    status,
    data,
    ...(typeof data.code === 'string' ? { code: data.code } : {}),
  })
}

describe('sellerStudioMode — derived from the loaded account row', () => {
  it('a sold vehicle is closed, whatever its publication state (case-insensitive)', () => {
    for (const status of ['Sold', 'sold', 'SOLD', ' Sold ']) {
      expect(sellerStudioMode({ status, publication_status: 'published' })).toBe('sold')
      expect(sellerStudioMode({ status, publication_status: 'draft' })).toBe('sold')
    }
  })

  it('only `published` is a public listing', () => {
    expect(sellerStudioMode({ status: 'Available', publication_status: 'published' })).toBe('published')
    for (const publication of ['draft', 'identity_complete', 'documents_submitted', 'review_pending', 'publishable', undefined, null]) {
      expect(sellerStudioMode({ status: 'Available', publication_status: publication })).toBe('draft')
    }
  })

  it('a listing that is not loaded yet (a new one) is a draft', () => {
    expect(sellerStudioMode(null)).toBe('draft')
    expect(sellerStudioMode(undefined)).toBe('draft')
  })
})

describe('classifySellerSaveFailure — a live or closed listing is not an outage', () => {
  it('the structured lifecycle refusals mean "the listing moved on", with its state — as the server sends them', () => {
    // Bodies exactly as backend/server.js returns them, including the two NOT_PUBLISHED refusals
    // that name no published/sold state at all: only the CODE says the listing moved on.
    const cases: Array<[Record<string, unknown>, { publicationStatus: string | null; status: string | null }]> = [
      [{ code: 'SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED', publication_status: 'published', status: 'Available' }, { publicationStatus: 'published', status: 'Available' }],
      [{ code: 'SELLER_LISTING_SOLD_READ_ONLY', publication_status: 'publishable', status: 'Sold' }, { publicationStatus: 'publishable', status: 'Sold' }],
      [{ code: 'SELLER_LISTING_NOT_PUBLISHED', publication_status: 'publishable', status: 'Available' }, { publicationStatus: 'publishable', status: 'Available' }],
      [{ code: 'SELLER_LISTING_NOT_PUBLISHED' }, { publicationStatus: null, status: null }],
      [{ code: 'SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE', publication_status: 'published' }, { publicationStatus: 'published', status: null }],
    ]
    for (const [body, state] of cases) {
      expect(classifySellerSaveFailure(apiFailure(409, body)), JSON.stringify(body)).toEqual({ kind: 'lifecycle_changed', ...state })
    }
  })

  it('an older backend\'s uncoded 409 is still read for what it says', () => {
    expect(classifySellerSaveFailure(apiFailure(409, { error: 'Only an unpublished active Seller draft can be autosaved', publication_status: 'published', status: 'Available' })).kind)
      .toBe('lifecycle_changed')
    expect(classifySellerSaveFailure(apiFailure(409, { error: 'Only an unpublished active Seller draft can be autosaved', publication_status: 'draft', status: 'Sold' })).kind)
      .toBe('lifecycle_changed')
    // An uncoded 409 that names neither state is not guessed at.
    expect(classifySellerSaveFailure(apiFailure(409, { error: 'Only an unpublished active Seller draft can be autosaved', publication_status: null, status: null })).kind)
      .toBe('unavailable')
  })

  it('an ended session is its own answer', () => {
    expect(classifySellerSaveFailure(new SessionExpiredError())).toEqual({ kind: 'session_ended' })
    expect(classifySellerSaveFailure(apiFailure(401, { error: 'Unauthorized' }))).toEqual({ kind: 'session_ended' })
  })

  it('everything else keeps the existing "unavailable" answer', () => {
    expect(classifySellerSaveFailure(apiFailure(500, { error: 'boom' }))).toEqual({ kind: 'unavailable' })
    expect(classifySellerSaveFailure(apiFailure(403, { error: 'Seller draft is outside your vehicle scope' }))).toEqual({ kind: 'unavailable' })
    expect(classifySellerSaveFailure(new Error('Failed to fetch'))).toEqual({ kind: 'unavailable' })
    expect(classifySellerSaveFailure(undefined)).toEqual({ kind: 'unavailable' })
  })
})
