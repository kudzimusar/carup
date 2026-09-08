/**
 * Trade OS T11 — the sentences a person reads about where their cargo is.
 *
 * The two cases that carry the file are the ones a naive formatter gets wrong:
 *
 *   · a PLANNED departure in the past with nothing observed. The ship was *meant* to have left, and
 *     saying "departed" there invents the event;
 *   · an ETA in the past with no arrival. The same shape, and more tempting, because a customer
 *     looking at a past estimate will assume it arrived.
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOMS_IS_ELSEWHERE,
  REFERENCE_IS_NOT_MOVEMENT,
  STAGE_UI,
  TRACKING_STATE_UI,
  describeArrival,
  describeDeparture,
  estimated,
  when,
} from './trackingDisplay'

describe('unknown is never a date', () => {
  it('says not recorded rather than showing a dash beside a real date', () => {
    expect(when(null)).toBe('Not recorded')
    expect(when(undefined)).toBe('Not recorded')
    expect(when('2026-09-21T08:00:00Z')).not.toBe('Not recorded')
  })

  it('marks an estimate as an estimate', () => {
    expect(estimated('2026-10-01T00:00:00Z')).toMatch(/^Estimated /)
    expect(estimated(null)).toBe('No estimate given')
  })
})

describe('a plan is not a departure', () => {
  it('refuses to say "departed" when only a plan exists — even a past one', () => {
    // The dangerous case: the ship was MEANT to have left a week ago.
    const d = describeDeparture({ planned_departure: '2026-09-20T00:00:00Z', observed_departure: null })
    expect(d.observed).toBe(false)
    expect(d.headline).toBe('Not recorded as departed')
    expect(d.headline.toLowerCase()).not.toContain('departed ')
    expect(d.detail).toMatch(/that is a plan, not a record that it left/i)
    // …and the plan is still shown, so the operator's intention is not hidden either.
    expect(d.detail).toContain('planned to leave')
  })

  it('says departed only when a departure was observed', () => {
    const d = describeDeparture({ planned_departure: '2026-09-20T00:00:00Z', observed_departure: '2026-09-21T08:00:00Z' })
    expect(d.observed).toBe(true)
    expect(d.headline).toMatch(/^Departed /)
    expect(d.detail).toMatch(/actual departure/i)
  })

  it('says nothing was recorded when there is neither', () => {
    const d = describeDeparture({ planned_departure: null, observed_departure: null })
    expect(d.headline).toBe('Not recorded as departed')
    expect(d.detail).toBe('No departure has been recorded.')
  })

  it('handles an absent dates block without inventing anything', () => {
    expect(describeDeparture(null).headline).toBe('Not recorded')
  })
})

describe('an ETA is not an arrival', () => {
  it('refuses to say "arrived" for an ETA in the past', () => {
    const a = describeArrival({ estimated_arrival: '2026-09-01T00:00:00Z', observed_arrival: null })
    expect(a.observed).toBe(false)
    expect(a.headline).toBe('Not recorded as arrived')
    expect(a.detail).toMatch(/an estimate can move/i)
    expect(a.detail).toMatch(/not a record that anything arrived/i)
  })

  it('says arrived only when an arrival was observed', () => {
    const a = describeArrival({ estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: '2026-10-02T00:00:00Z' })
    expect(a.observed).toBe(true)
    expect(a.headline).toMatch(/^Arrived /)
  })

  it('never presents an estimate and an observation in the same words', () => {
    const est = describeArrival({ estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: null })
    const obs = describeArrival({ estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: '2026-10-02T00:00:00Z' })
    expect(est.headline).not.toBe(obs.headline)
    expect(est.observed).not.toBe(obs.observed)
  })
})

describe('a reference is not movement', () => {
  it('states it as a whole sentence', () => {
    expect(REFERENCE_IS_NOT_MOVEMENT).toMatch(/not a record that anything has moved/i)
  })
})

describe('the vocabulary stays inside T11', () => {
  it('words a customs hold as a place, not a decision', () => {
    // T11 knows where the goods are stuck. What customs decided is T12's.
    expect(STAGE_UI.CUSTOMS_HOLD).toBe('Held at customs')
    expect(STAGE_UI.CUSTOMS_HOLD.toLowerCase()).not.toContain('cleared')
    expect(STAGE_UI.CUSTOMS_HOLD.toLowerCase()).not.toContain('duty')
  })

  it('never claims a customs decision anywhere in the stage vocabulary', () => {
    const text = Object.values(STAGE_UI).join(' ').toLowerCase()
    for (const forbidden of ['cleared', 'duty', 'assessed', 'tax', 'declaration']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('says out loud that customs is recorded elsewhere', () => {
    expect(CUSTOMS_IS_ELSEWHERE).toMatch(/customs, duties and release are recorded separately/i)
  })

  it('keeps "loaded" visibly distinct from "sailed" in the participant labels', () => {
    expect(TRACKING_STATE_UI.LOADED.label).toBe('Loaded — not sailed')
    expect(TRACKING_STATE_UI.SHIPMENT_CREATED.label).toMatch(/nothing moving yet/i)
    // A shipment existing is not movement, and the label must not read like it is.
    expect(TRACKING_STATE_UI.SHIPMENT_CREATED.label).not.toBe(TRACKING_STATE_UI.IN_TRANSIT.label)
  })

  it('keeps "not loaded" distinct from "left behind"', () => {
    expect(TRACKING_STATE_UI.NOT_LOADED.label).toBe('Not loaded yet')
    expect(TRACKING_STATE_UI.LEFT_BEHIND.label).toBe('Not on this container')
    expect(TRACKING_STATE_UI.NOT_LOADED.label).not.toBe(TRACKING_STATE_UI.LEFT_BEHIND.label)
  })
})
