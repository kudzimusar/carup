import { describe, expect, it } from 'vitest'
import { JOURNEY_STATE_UI } from './journeyDisplay'
import { progressRowTone, progressStateBadge } from './capDisplay'
import { toneFromClasses } from './journeyTone'

describe('RX06-LR04 CAP S1 — CAP badge colours map onto StatusTone', () => {
  it('maps each colour family the ported files use', () => {
    expect(toneFromClasses('border-emerald-300 bg-emerald-50 text-emerald-900')).toBe('success')
    expect(toneFromClasses('border-amber-300 bg-amber-50 text-amber-900')).toBe('warning')
    expect(toneFromClasses('border-orange-300 bg-orange-50 text-orange-900')).toBe('warning')
    expect(toneFromClasses('border-red-300 bg-red-50 text-red-900')).toBe('danger')
    expect(toneFromClasses('border-sky-300 bg-sky-50 text-sky-900')).toBe('info')
    expect(toneFromClasses('border-slate-300 bg-slate-50 text-slate-700')).toBe('neutral')
  })

  it('never turns an unknown or empty colour into success', () => {
    for (const c of ['', null, undefined, 'border-unknown-300', 'emerald', 'text-emeraldish']) {
      expect(toneFromClasses(c)).toBe('neutral')
    }
  })

  it('reads an arrival as success and an exception as a warning, never the other way round', () => {
    expect(toneFromClasses(JOURNEY_STATE_UI.ARRIVED.tone)).toBe('success')
    expect(toneFromClasses(JOURNEY_STATE_UI.EXCEPTION.tone)).toBe('warning')
    expect(toneFromClasses(JOURNEY_STATE_UI.IN_TRANSIT.tone)).toBe('info')
    for (const state of ['NO_TRANSACTION', 'NOT_LOADED', 'LOADED', 'NO_SHIPMENT', 'SHIPMENT_CREATED']) {
      expect(toneFromClasses(JOURNEY_STATE_UI[state].tone), state).toBe('neutral')
    }
  })

  it('keeps a reported completion and a cancelled step apart', () => {
    expect(toneFromClasses(progressStateBadge('reported_completed').tone)).toBe('success')
    expect(toneFromClasses(progressStateBadge('not_recorded').tone)).toBe('neutral')
    expect(toneFromClasses(progressStateBadge('something-new').tone)).toBe('neutral')
    expect(toneFromClasses(progressRowTone('cancelled'))).toBe('danger')
    expect(toneFromClasses(progressRowTone('in_progress'))).toBe('info')
  })
})
