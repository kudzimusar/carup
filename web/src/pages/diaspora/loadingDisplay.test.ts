/**
 * Trade OS T10 — the sentences a person reads about loading.
 *
 * Tested apart from any component because these are the part of T10 most likely to quietly become
 * untrue: a formatter that turns `null` into `0.000 CBM`, a pressure line that acquires a currency
 * symbol, or a vocabulary that starts implying the container has sailed.
 */
import { describe, expect, it } from 'vitest'
import {
  BLOCKER_UI,
  LEFT_BEHIND_UI,
  LOADED_IS_NOT_SAILED,
  PARTICIPANT_STATE_UI,
  cbm,
  describePressure,
  describeReadiness,
  describeSource,
  shortRef,
} from './loadingDisplay'
import type { LoadReadiness, PlanPressure } from '@/hooks/useTradeLogisticsApi'

const readiness = (over: Partial<LoadReadiness> = {}): LoadReadiness => ({
  ready: true,
  blockers: [],
  facts: { booking_approved: true, received: true, measured_volume_cbm: 3.8, condition: 'good', documents_present: 0 },
  disclaimer: 'Ready to load means the cargo is here, measured and booked. It is not a statement about customs, duties or any legal permission to travel.',
  ...over,
})

describe('unknown is never zero', () => {
  it('writes an unrecorded volume as not known', () => {
    expect(cbm(null)).toBe('Not known')
    expect(cbm(undefined)).toBe('Not known')
    expect(cbm(Number.NaN)).toBe('Not known')
    // A reader who sees a number believes somebody measured it.
    expect(cbm(null)).not.toContain('0')
    expect(cbm(3.6)).toBe('3.600 CBM')
  })
})

describe('readiness is never a bare boolean', () => {
  it('names every blocker AND whose problem it is', () => {
    const r = describeReadiness(readiness({
      ready: false,
      blockers: [
        { code: 'NOT_RECEIVED', reason: 'The warehouse has not received this cargo.' },
        { code: 'NOT_MEASURED', reason: 'Nobody has measured this cargo…' },
      ],
    }))
    expect(r.label).toBe('Not ready')
    expect(r.reasons).toHaveLength(2)
    // The owner is the actionable half: chase the warehouse, or the booking, or nobody.
    for (const reason of r.reasons) expect(reason).toContain('Warehouse')
  })

  it('says ready with no reasons when it is ready', () => {
    const r = describeReadiness(readiness())
    expect(r.label).toBe('Ready to load')
    expect(r.reasons).toEqual([])
  })

  it('maps an unknown blocker code to the server sentence rather than dropping it', () => {
    const r = describeReadiness(readiness({ ready: false, blockers: [{ code: 'SOMETHING_NEW', reason: 'A newly added reason.' }] }))
    expect(r.reasons).toEqual(['A newly added reason.'])
  })

  it('every blocker names a phase owner', () => {
    for (const [code, ui] of Object.entries(BLOCKER_UI)) {
      expect(ui.owner, `${code} must name whose problem it is`).toBeTruthy()
    }
  })
})

describe('planning provenance', () => {
  it('says when a plan is built on an estimate rather than a measurement', () => {
    expect(describeSource('WAREHOUSE_ACTUAL')).toContain('warehouse measurement')
    expect(describeSource('BOOKED_ESTIMATE')).toContain('not measured')
    expect(describeSource('UNKNOWN')).toBe('no figure')
  })
})

describe('capacity pressure is about volume, never money', () => {
  const over: PlanPressure = {
    container_total_cbm: 4, planned_in_cbm: 6.3, planned_in_lines: 2, lines_without_volume: 0,
    over_capacity: true, over_by_cbm: 1.3, headroom_cbm: 0, note: null,
  }

  it('states the overage and what to do', () => {
    const p = describePressure(over)!
    expect(p.headline).toContain('1.300 CBM too much')
    expect(p.detail).toContain('6.300')
    expect(p.detail).toMatch(/take something out.*with a reason/i)
    expect(p.tone).toBe('attention')
  })

  it('states headroom when the plan fits', () => {
    const p = describePressure({ ...over, over_capacity: false, over_by_cbm: 0, planned_in_cbm: 3.8, headroom_cbm: 0.2 })!
    expect(p.headline).toContain('0.200 CBM of room left')
    expect(p.tone).toBe('neutral')
  })

  it('carries the floor caveat when lines have no figure', () => {
    const p = describePressure({
      ...over, over_capacity: false, over_by_cbm: 0, planned_in_cbm: 3.8, headroom_cbm: 0.2,
      lines_without_volume: 2, note: '2 planned line(s) have no measured volume, so this total is a floor rather than the whole plan.',
    })!
    expect(p.detail).toContain('floor rather than the whole plan')
  })

  it('never mentions a commercial consequence in any branch', () => {
    for (const p of [over, { ...over, over_capacity: false, over_by_cbm: 0, headroom_cbm: 1 }]) {
      const d = describePressure(p)!
      const text = `${d.headline} ${d.detail}`.toLowerCase()
      for (const forbidden of ['refund', 'charge', 'price', 'surcharge', 'next sailing', 'rebook', '$']) {
        expect(text).not.toContain(forbidden)
      }
    }
  })

  it('returns nothing when there is no plan to talk about', () => {
    expect(describePressure(null)).toBeNull()
  })
})

describe('the participant vocabulary', () => {
  it('keeps "nothing recorded yet" distinct from "not loaded"', () => {
    // Collapsing these would tell a customer their goods were excluded when nobody has said
    // anything — or reassure them when the cargo is on the dock.
    expect(PARTICIPANT_STATE_UI.NOT_RECORDED.label).toBe('Nothing recorded yet')
    expect(PARTICIPANT_STATE_UI.LEFT_BEHIND.label).toBe('Not loaded')
    expect(PARTICIPANT_STATE_UI.NOT_RECORDED.label).not.toBe(PARTICIPANT_STATE_UI.LEFT_BEHIND.label)
  })

  it('never speaks a later phase\'s language', () => {
    const vocabulary = [
      ...Object.values(PARTICIPANT_STATE_UI).map((s) => s.label),
      ...Object.values(LEFT_BEHIND_UI),
      ...Object.values(BLOCKER_UI).flatMap((b) => [b.label, b.owner]),
    ].join(' ').toLowerCase()
    for (const later of ['departed', 'in transit', 'shipped', 'sailed', 'arrived', 'customs', 'delivered']) {
      expect(vocabulary).not.toContain(later)
    }
  })

  it('words NOT_PRESENTED without blaming the customer', () => {
    // The operational term invites a customer to think they did something wrong.
    expect(LEFT_BEHIND_UI.NOT_PRESENTED).toBe('Not brought to the container in time')
    expect(LEFT_BEHIND_UI.NOT_PRESENTED.toLowerCase()).not.toContain('failed')
  })

  it('states loaded-is-not-sailed as a whole sentence', () => {
    expect(LOADED_IS_NOT_SAILED).toMatch(/does not mean the container has sailed/i)
  })
})

describe('references', () => {
  it('shortens an id the same way the server does', () => {
    expect(shortRef('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('A1B2C3D4')
  })
})
