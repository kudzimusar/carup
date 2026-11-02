/**
 * CA-K3-01 tests G, H, I, J (presentation contract) — the truth-state grammar.
 */
import { describe, it, expect } from 'vitest'
import { ALL_TRUTH_STATES, TRUTH_STATES, presentSlot, type MetricSlot } from './truthState'

const REQUIRED = [
  'GOVERNED_ACTUAL', 'GOVERNED_DERIVED', 'GOVERNED_RATE_OR_RATIO', 'ADVISORY', 'TECHNICAL_OPERATIONAL',
  'PENDING_K2B_CONSUMPTION', 'PENDING_CA_FIN', 'INSUFFICIENT_DATA', 'UNAVAILABLE_NO_SOURCE',
  'UNAVAILABLE_NOT_SEPARABLE', 'DUPLICATED_OR_CONFLICTING', 'UNKNOWN_AUTHORITY', 'DEGRADED', 'FORBIDDEN',
  'MEASURED_ZERO', 'NO_DATA',
]

describe('truth-state grammar', () => {
  it('implements every mandated state, each with its own badge+statement presentation', () => {
    expect([...ALL_TRUTH_STATES].sort()).toEqual([...REQUIRED].sort())
    // No two statement states read the same.
    const statements = ALL_TRUTH_STATES.map((s) => TRUTH_STATES[s].statement).filter(Boolean)
    expect(new Set(statements).size).toBe(statements.length)
  })

  it('G · measured zero renders the number 0; unavailable never renders 0', () => {
    const zero = presentSlot({ state: 'MEASURED_ZERO' })
    expect(zero.primary).toBe('0')
    expect(zero.isValue).toBe(true)
    expect(zero.badge).toBe('Actual')
    expect(zero.detail).toMatch(/complete read/i)
    for (const state of ['UNAVAILABLE_NO_SOURCE', 'UNAVAILABLE_NOT_SEPARABLE'] as const) {
      const p = presentSlot({ state } as MetricSlot)
      expect(p.isValue).toBe(false)
      expect(p.primary).not.toMatch(/\d/)
    }
  })

  it('H · NO DATA is distinct from 0 and from unavailable', () => {
    const noData = presentSlot({ state: 'NO_DATA' })
    expect(noData.primary).toBe('No data for this period')
    expect(noData.isValue).toBe(false)
    expect(noData.primary).not.toBe(presentSlot({ state: 'MEASURED_ZERO' }).primary)
    expect(noData.primary).not.toBe(presentSlot({ state: 'UNAVAILABLE_NO_SOURCE' }).primary)
    expect(noData.badge).not.toBe(presentSlot({ state: 'UNAVAILABLE_NO_SOURCE' }).badge)
  })

  it('0 ≠ NO DATA ≠ UNAVAILABLE ≠ NOT SEPARABLE ≠ FORBIDDEN — five different readings', () => {
    const readings = (['MEASURED_ZERO', 'NO_DATA', 'UNAVAILABLE_NO_SOURCE', 'UNAVAILABLE_NOT_SEPARABLE', 'FORBIDDEN'] as const)
      .map((state) => presentSlot({ state } as MetricSlot))
    expect(new Set(readings.map((r) => r.primary)).size).toBe(5)
    expect(new Set(readings.map((r) => r.badge)).size).toBe(5)
    expect(new Set(readings.map((r) => r.tone)).size).toBeGreaterThanOrEqual(4)
  })

  it('I · FORBIDDEN never exposes a value, even one smuggled in at runtime', () => {
    const smuggled = { state: 'FORBIDDEN', value: 987654, lastKnownValue: 123 } as unknown as MetricSlot
    const p = presentSlot(smuggled, 'Recognized revenue')
    expect(p.isValue).toBe(false)
    expect(p.primary).toBe('You do not have access to this data.')
    expect(`${p.primary} ${p.detail ?? ''} ${p.accessibleText}`).not.toMatch(/987|654|123/)
    expect(p.primary).not.toBe(presentSlot({ state: 'UNAVAILABLE_NO_SOURCE' }).primary) // never masquerades as unavailable
  })

  it('J · PENDING_K2B_CONSUMPTION is never presented as an Actual', () => {
    const smuggled = { state: 'PENDING_K2B_CONSUMPTION', value: 2 } as unknown as MetricSlot
    const p = presentSlot(smuggled, 'Operational accounts')
    expect(p.isValue).toBe(false)
    expect(p.badge).not.toBe('Actual')
    expect(p.primary).toBe('Operational provenance integration not certified for this source')
    expect(p.primary).not.toMatch(/\d/)
  })

  it('statement states never render digits; value states require their value', () => {
    for (const s of ALL_TRUTH_STATES) {
      if (TRUTH_STATES[s].rendersValue !== 'never') continue
      const p = presentSlot({ state: s, value: 42 } as unknown as MetricSlot)
      expect(p.isValue, s).toBe(false)
      expect(p.primary, s).not.toMatch(/42/)
    }
    expect(presentSlot({ state: 'GOVERNED_ACTUAL', value: 1234 }).primary).toBe('1,234')
  })

  it('a rate always carries its denominator', () => {
    const p = presentSlot({ state: 'GOVERNED_RATE_OR_RATIO', value: 12.5, unit: '%', denominator: 400, denominatorLabel: 'linked inquiries' })
    expect(p.detail).toBe('of 400 linked inquiries')
    expect(p.badge).toBe('Rate')
  })

  it('degraded shows a last known value only where policy permits, with its computed time', () => {
    expect(presentSlot({ state: 'DEGRADED', lastKnownValue: 9 }).isValue).toBe(false)
    const ok = presentSlot({ state: 'DEGRADED', lastKnownValue: 9, lastComputedAt: '2026-10-13T00:00Z', lastKnownPermitted: true })
    expect(ok.primary).toBe('9')
    expect(ok.detail).toMatch(/Last known value, computed 2026-10-13T00:00Z/)
  })

  it('PENDING_CA_FIN shows no zero and no placeholder currency', () => {
    const p = presentSlot({ state: 'PENDING_CA_FIN' }, 'Gross profit')
    expect(p.primary).toBe('Not available — accounting authority not yet established')
    expect(p.primary).not.toMatch(/[$€£]|\bUSD\b|\b0\b/)
  })

  it('no tone implies good/bad business performance', () => {
    const tones = new Set(ALL_TRUTH_STATES.map((s) => TRUTH_STATES[s].tone))
    expect([...tones].some((t) => /good|bad|positive|negative|success|danger/.test(t))).toBe(false)
  })
})
