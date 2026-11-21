import { describe, expect, it } from 'vitest'
import { TRADE_STILLS, usableTradeStill } from './tradeStills'

describe('RX-06 Trade stills', () => {
  it('records provenance, rights, a disclosure and hashed responsive sources for every still', () => {
    const all = Object.values(TRADE_STILLS)
    expect(all).toHaveLength(10)
    for (const s of all) {
      expect(s.provenance.generator).toBe('Higgsfield')
      expect(s.provenance.jobId).toMatch(/^[0-9a-f-]{36}$/)
      expect(s.provenance.authorization).toMatch(/Stills, up to 10 credits/)
      expect(s.disclosure).toMatch(/not a vehicle, document or shipment record/)
      expect(s.sources.map(x => x.width)).toEqual([800, 1344])
      for (const src of s.sources) expect(src.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    // The whole set cost 7.5 credits, within the Owner's 10-credit authorization.
    expect(all.reduce((sum, s) => sum + s.provenance.credits, 0)).toBe(7.5)
  })

  it('never serves an unapproved still in a production build, and serves it (labelled) in the preview', () => {
    expect(TRADE_STILLS.portDawn.review).toBe('owner-review')
    expect(usableTradeStill('portDawn', true)).toBeNull()
    expect(usableTradeStill('portDawn', false)?.key).toBe('portDawn')
    expect(usableTradeStill('not-a-still', false)).toBeNull()
  })
})
