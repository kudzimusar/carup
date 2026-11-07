import { describe, expect, it } from 'vitest'
import { dealerDate, dealerDateTime } from './dealerDates'

describe('Owner UAT D5 — unambiguous dealership dates', () => {
  it('writes the month as a word so 3 December can never read as 12 March', () => {
    expect(dealerDate('2026-12-03T12:00:00Z')).toBe('3 Dec 2026')
    expect(dealerDate(new Date(2027, 2, 12))).toBe('12 Mar 2027')
    expect(dealerDateTime(new Date(2026, 11, 3, 7, 2))).toMatch(/^3 Dec 2026,? 07:02$/)
  })
  it('never prints "Invalid Date"', () => {
    for (const value of [null, undefined, '', 'not-a-date']) {
      expect(dealerDate(value)).toBe('Not recorded')
      expect(dealerDateTime(value, '—')).toBe('—')
    }
  })
})
