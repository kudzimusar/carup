import { describe, expect, it } from 'vitest'
import { TRADE_STILLS, usableTradeStill } from './tradeStills'

describe('RX-06 Trade stills', () => {
  it('records provenance, rights, a disclosure and hashed responsive sources for every still', () => {
    const all = Object.values(TRADE_STILLS).filter(s => s.key !== '__probe')
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

  it('serves Owner-approved stills in every build and never an unapproved one in production', () => {
    for (const s of Object.values(TRADE_STILLS)) expect(s.review).toBe('approved')
    expect(usableTradeStill('portDawn', true)?.key).toBe('portDawn')
    // The gate itself: an owner-review still is preview-only.
    const pending = { ...TRADE_STILLS.portDawn, review: 'owner-review' as const }
    TRADE_STILLS.__probe = pending
    try {
      expect(usableTradeStill('__probe', true)).toBeNull()
      expect(usableTradeStill('__probe', false)?.key).toBe('portDawn')
    } finally { delete TRADE_STILLS.__probe }
    expect(usableTradeStill('not-a-still', false)).toBeNull()
  })
})
