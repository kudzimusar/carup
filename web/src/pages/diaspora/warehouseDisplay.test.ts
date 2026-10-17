/**
 * Trade OS T9 — the sentences a customer reads about their cargo.
 *
 * These are tested apart from any component because they are the part of T9 most likely to quietly
 * become untrue: a formatter that turns `null` into `0.000 CBM`, or a discrepancy line that acquires
 * a currency symbol, changes what the product CLAIMS without changing what it stores.
 */
import { describe, expect, it } from 'vitest'
import {
  CONDITION_UI,
  INTAKE_STATUS_UI,
  describeDiscrepancy,
  describeEstimate,
  formatDimensions,
  formatVolume,
  formatWeight,
  shortRef,
} from './warehouseDisplay'
import type { WarehouseDiscrepancy, WarehouseEstimate } from '@/hooks/useTradeLogisticsApi'

const complete = (volume: number | null, weight: number | null = null): WarehouseEstimate => ({
  volume_cbm: volume, weight_kg: weight, completeness: 'COMPLETE', items_total: 1, items_with_volume: 1,
  source: 'The volume this booking was approved against',
})

describe('unknown is never zero', () => {
  it('writes an unmeasured volume as not known', () => {
    expect(formatVolume(null)).toBe('Not known')
    expect(formatVolume(undefined)).toBe('Not known')
    expect(formatVolume(Number.NaN)).toBe('Not known')
    // The failure mode being guarded: a reader who sees a number believes somebody measured it.
    expect(formatVolume(null)).not.toContain('0')
  })

  it('writes an unmeasured weight as not known', () => {
    expect(formatWeight(null, 'kg')).toBe('Not known')
    expect(formatWeight(900, 'kg')).toBe('900.0 kg')
    expect(formatWeight(1.1, 't')).toBe('1.100 t')
  })

  it('says a consignment was not measured rather than showing empty dimensions', () => {
    expect(formatDimensions(null)).toBe('Not measured')
    expect(formatDimensions({ length_value: null, width_value: null, height_value: null, dimension_unit: null } as never)).toBe('Not measured')
    expect(formatDimensions({ length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm' } as never)).toBe('200 × 100 × 190 cm')
  })
})

describe('the estimate says how complete it is', () => {
  it('states a complete estimate plainly', () => {
    expect(describeEstimate(complete(3))).toEqual({ headline: '3.000 CBM', caveat: null })
  })

  it('calls a partial estimate a floor, and says how much is missing', () => {
    const partial: WarehouseEstimate = {
      volume_cbm: 3, weight_kg: null, completeness: 'PARTIAL', items_total: 5, items_with_volume: 3, source: 'x',
    }
    const described = describeEstimate(partial)
    // "3.000 CBM" for a request where two items were never measured is a number that reads as a
    // total. "At least 3.000 CBM" is the same data and a true sentence.
    expect(described.headline).toBe('At least 3.000 CBM')
    expect(described.caveat).toContain('2 of 5')
  })

  it('says there is no estimate rather than showing nothing', () => {
    const unknown: WarehouseEstimate = { volume_cbm: null, weight_kg: null, completeness: 'UNKNOWN', items_total: 0, items_with_volume: 0, source: 'x' }
    expect(describeEstimate(unknown).headline).toBe('No volume was estimated')
  })
})

describe('a discrepancy is a difference, never a cost', () => {
  const differs: WarehouseDiscrepancy = {
    status: 'DIFFERS',
    volume: { estimated_cbm: 3, actual_cbm: 3.8, difference_cbm: 0.8, direction: 'LARGER' },
    weight: null,
    commercial_effect: 'none',
    note: 'A difference between the estimate and the measurement is a record of what was found. It does not by itself change the price, the booking or the space reserved.',
  }

  it('states the 3.0 → 3.8 case as +0.8 against the estimate', () => {
    const d = describeDiscrepancy(differs)
    expect(d.headline).toBe('Larger than estimated')
    expect(d.detail).toContain('+0.800 CBM')
    expect(d.detail).toContain('estimate of 3.000')
    expect(d.tone).toBe('attention')
  })

  it('states a smaller actual just as plainly', () => {
    const d = describeDiscrepancy({ ...differs, volume: { estimated_cbm: 3, actual_cbm: 2, difference_cbm: -1, direction: 'SMALLER' } })
    expect(d.headline).toBe('Smaller than estimated')
    expect(d.detail).toContain('-1.000 CBM')
  })

  it('reports a weight difference in one unit', () => {
    const d = describeDiscrepancy({
      ...differs, volume: null,
      weight: { estimated_kg: 800, actual_kg: 1100, difference_kg: 300, direction: 'HEAVIER' },
    })
    expect(d.detail).toContain('+300.0 kg')
  })

  it('carries no money in any branch', () => {
    const cases: WarehouseDiscrepancy[] = [
      differs,
      { ...differs, status: 'MATCHES', volume: { estimated_cbm: 3, actual_cbm: 3, difference_cbm: 0, direction: 'SAME' } },
      { ...differs, status: 'NOT_MEASURED', volume: null },
      { ...differs, status: 'NOT_COMPARABLE', volume: null, reason: 'Only 2 of 3 cargo items were given a volume' },
    ]
    for (const c of cases) {
      const d = describeDiscrepancy(c)
      const text = `${d.headline} ${d.detail}`.toLowerCase()
      for (const forbidden of ['$', 'usd', 'charge', 'surcharge', 'invoice', 'fee', 'cost']) {
        expect(text).not.toContain(forbidden)
      }
    }
  })

  it('says why a comparison is impossible rather than showing a difference of zero', () => {
    const d = describeDiscrepancy({ ...differs, status: 'NOT_COMPARABLE', volume: null, reason: 'Only 2 of 3 cargo items were given a volume' })
    expect(d.headline).toBe('Cannot be compared')
    expect(d.detail).toContain('2 of 3')
    // The failure this prevents: an incomplete estimate silently compared as if it were complete,
    // producing a "difference" that is really just the unmeasured items.
    expect(d.detail).not.toContain('0.000')
  })

  it('distinguishes "not measured" from "matches"', () => {
    expect(describeDiscrepancy({ ...differs, status: 'NOT_MEASURED', volume: null }).headline).toBe('Not measured yet')
    expect(describeDiscrepancy({ ...differs, status: 'MATCHES', volume: { estimated_cbm: 3, actual_cbm: 3, difference_cbm: 0, direction: 'SAME' } }).headline).toBe('Matches the estimate')
  })
})

describe('vocabulary stays inside T9', () => {
  it('never speaks a later phase\'s language', () => {
    const vocabulary = [
      ...Object.values(INTAKE_STATUS_UI).map((s) => s.label),
      ...Object.values(CONDITION_UI).flatMap((c) => [c.label, c.detail]),
    ].join(' ').toLowerCase()
    for (const later of ['ready to load', 'loaded', 'shipped', 'departed', 'customs', 'in transit', 'delivered']) {
      expect(vocabulary).not.toContain(later)
    }
  })

  it('translates warehouse status into what actually happened', () => {
    // "CONDITIONALLY_RECEIVED" is warehouse language. What a person needs is that their goods are in
    // the building and somebody wrote something down.
    expect(INTAKE_STATUS_UI.CONDITIONALLY_RECEIVED.label).toBe('Received with a note')
    expect(INTAKE_STATUS_UI.EXPECTED.label).toBe('Expected — not arrived')
    expect(INTAKE_STATUS_UI.REFUSED.label).toBe('Not taken in')
  })

  it('keeps "could not be checked" distinct from "no problems"', () => {
    expect(CONDITION_UI.unverifiable.label).toBe('Could not be checked')
    expect(CONDITION_UI.good.label).toBe('No problems noted')
    expect(CONDITION_UI.unverifiable.label).not.toBe(CONDITION_UI.good.label)
  })

  it('describes a condition as a person\'s observation, never a verdict', () => {
    for (const c of Object.values(CONDITION_UI)) {
      expect(c.detail).toMatch(/the person receiving it/i)
    }
  })
})

describe('references', () => {
  it('shortens an id the same way the server does', () => {
    expect(shortRef('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('A1B2C3D4')
  })
})
