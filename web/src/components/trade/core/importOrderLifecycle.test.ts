import { describe, expect, it } from 'vitest'
import {
  IMPORT_ORDER_EXCEPTIONS, IMPORT_ORDER_LIFECYCLE, STATE_GUIDE, TRADE_PHASES, documentState, positionOf, statusLabel,
} from './importOrderLifecycle'

describe('RX-06 Import Order lifecycle (presentation over the canonical state machine)', () => {
  it('maps every one of the 20 canonical states to exactly one of seven phases, in canonical order', () => {
    expect(IMPORT_ORDER_LIFECYCLE).toHaveLength(20)
    expect(TRADE_PHASES).toHaveLength(7)
    const flattened = TRADE_PHASES.flatMap(p => p.states)
    expect(flattened).toEqual([...IMPORT_ORDER_LIFECYCLE])
    expect(new Set(flattened).size).toBe(20)
  })

  it('places each state on the rail consistently: earlier phases behind, its phase current, later upcoming', () => {
    for (const state of IMPORT_ORDER_LIFECYCLE) {
      const pos = positionOf(state)
      const pi = TRADE_PHASES.findIndex(p => p.states.includes(state))
      expect(pos.phaseIndex).toBe(pi)
      pos.phases.forEach((ph, i) => {
        if (i < pi) expect(ph.progress).toBe('passed')
        if (i > pi) expect(ph.progress).toBe('upcoming')
      })
      expect(pos.phases[pi].progress).toBe(state === 'COMPLETED' ? 'passed' : 'current')
      expect(pos.guide).toBe(STATE_GUIDE[state])
    }
  })

  it('never guesses progress for an exception or an unknown status', () => {
    for (const ex of IMPORT_ORDER_EXCEPTIONS) {
      const pos = positionOf(ex)
      expect(pos.exception).toBe(ex)
      expect(pos.phaseIndex).toBe(-1)
      expect(pos.phases.every(p => p.progress === 'unknown')).toBe(true)
    }
    expect(positionOf('FLAGGED_FOR_REVIEW').terminal).toBe(false)
    expect(positionOf('CANCELLED').terminal).toBe(true)
    const unknown = positionOf('SOMETHING_NEW')
    expect(unknown.known).toBe(false)
    expect(unknown.phases.every(p => p.progress === 'unknown')).toBe(true)
    expect(positionOf(null).known).toBe(false)
  })

  it('accepts lower-case statuses and labels anything without inventing meaning', () => {
    expect(positionOf('shipped').phaseIndex).toBe(3)
    expect(statusLabel('DUTY_PENDING')).toBe('Duty pending')
    expect(statusLabel('SOME_FUTURE_STATE')).toBe('Some future state')
    expect(statusLabel(undefined)).toBe('Status not recorded')
  })

  it('reports uploaded and verified as separate facts for every canonical document status', () => {
    expect(documentState('MISSING')).toMatchObject({ uploaded: false, verified: false })
    for (const s of ['UPLOADED', 'OCR_EXTRACTED', 'PENDING_REVIEW', 'REJECTED', 'FLAGGED']) {
      expect(documentState(s)).toMatchObject({ uploaded: true, verified: false })
    }
    expect(documentState('VERIFIED')).toMatchObject({ uploaded: true, verified: true, truth: 'verified' })
    expect(documentState('OCR_EXTRACTED').label).toMatch(/not verified/)
    expect(documentState('weird')).toMatchObject({ truth: 'unknown', verified: false })
  })
})
