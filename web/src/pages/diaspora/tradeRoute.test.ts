import { describe, expect, it } from 'vitest'
import { formatPlace, formatRoute } from './tradeRoute'

/**
 * Owner UAT round 1: "FROM Japan" beside "TO Harare, Zimbabwe" read as unfinished. Both sides must
 * be composed by the SAME rule, so a compact route is obviously about missing data rather than a
 * different layout for each half.
 */
describe('Trade OS route formatting', () => {
  it('composes city and country when both are known', () => {
    expect(formatPlace('Yokohama', 'Japan')).toBe('Yokohama, Japan')
  })

  it('falls back symmetrically when only one part is known', () => {
    expect(formatPlace(null, 'Japan')).toBe('Japan')
    expect(formatPlace('Harare', null)).toBe('Harare')
  })

  it('never renders an empty side — unknown says so', () => {
    expect(formatPlace(null, null)).toBe('Not recorded')
    expect(formatPlace('   ', '')).toBe('Not recorded')
  })

  it('applies the identical rule to both halves of a route', () => {
    expect(formatRoute({ country: 'Japan' }, { city: 'Harare', country: 'Zimbabwe' }))
      .toBe('Japan → Harare, Zimbabwe')
    expect(formatRoute({ city: 'Yokohama', country: 'Japan' }, {}))
      .toBe('Yokohama, Japan → Not recorded')
  })
})
