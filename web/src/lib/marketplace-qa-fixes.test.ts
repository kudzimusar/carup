import { describe, it, expect } from 'vitest'
import { extractApiErrorMessage } from './apiClient'
import { getErrorMessage } from './errorMessage'
import { withMockFallback } from '../pages/Marketplace'

// QA blocker 1 — backend errors must never render as "[object Object]".
describe('API error message extraction (no [object Object])', () => {
  it('extracts message from the errorMiddleware shape { error: { code, message } }', () => {
    expect(
      extractApiErrorMessage({ success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to record inquiry.' } })
    ).toBe('Failed to record inquiry.')
  })
  it('extracts message from the authMiddleware shape { error: "string" }', () => {
    expect(extractApiErrorMessage({ error: 'Unauthorized. Session is invalid or expired.' })).toBe(
      'Unauthorized. Session is invalid or expired.'
    )
  })
  it('extracts a bare { message }', () => {
    expect(extractApiErrorMessage({ message: 'nope' })).toBe('nope')
  })
  it('returns undefined when no message (caller falls back to a status string)', () => {
    expect(extractApiErrorMessage({})).toBeUndefined()
    expect(extractApiErrorMessage(null)).toBeUndefined()
  })
})

describe('getErrorMessage never yields "[object Object]"', () => {
  it('handles object error shapes', () => {
    expect(getErrorMessage({ error: { message: 'boom' } })).toBe('boom')
    expect(getErrorMessage({ error: 'plain error' })).toBe('plain error')
  })
  it('falls back for unreadable objects and the literal bad string', () => {
    expect(getErrorMessage({ a: 1 }, 'fallback')).toBe('fallback')
    expect(getErrorMessage(new Error('[object Object]'), 'safe')).toBe('safe')
    expect(getErrorMessage({}, 'safe')).toBe('safe')
  })
  it('passes through Error.message and strings', () => {
    expect(getErrorMessage(new Error('real error'))).toBe('real error')
    expect(getErrorMessage('a string')).toBe('a string')
  })
})

// QA blocker 2/3 — staging must never render fake mock cards (they link to nonexistent detail pages).
describe('withMockFallback (fixture gating)', () => {
  const mock = [{ vin: 'MOCK1' }] as any[]
  it('returns real listings when present (mock irrelevant)', () => {
    expect(withMockFallback([{ vin: 'REAL1' }] as any[], mock, false)).toEqual([{ vin: 'REAL1' }])
  })
  it('returns an empty list when live is empty and mock is disabled (staging/prod)', () => {
    expect(withMockFallback([], mock, false)).toEqual([])
  })
  it('returns mock only when explicitly allowed (dev/demo)', () => {
    expect(withMockFallback([], mock, true)).toEqual(mock)
  })
})
