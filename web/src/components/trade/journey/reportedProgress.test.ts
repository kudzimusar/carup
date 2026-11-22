/** RX06-LR05 — the reported-progress summary shared by Journey & arrival and the Vehicle Passport card. Fictional. */
import { describe, expect, it } from 'vitest'
import type { JourneyProgress } from './journeyTypes'
import { reportedLine, reportedSummary } from './reportedProgress'

const row = (seq: number, origin: 'external_report' | 'carup', dated: boolean) => ({
  sequence: seq, action_taker: { label: 'x', kind: 'x', display_label: 'X' }, text: 't', status: 'completed', status_label: 'Completed',
  time: dated ? { value: '2026-11-10T00:00:00Z', basis: 'reported' } : null, time_note: null, origin, source_label: 'S', verification: 'reported',
})
function progress(sourceLabel: string, reportedRows = 3): JourneyProgress {
  return {
    availability: 'composed',
    groups: [
      { code: 'BOOKING', title: 'Booking', state: 'reported_completed', reported_count: 2, carup_count: 0, rows: [row(1, 'external_report', true), row(2, 'external_report', false)] },
      { code: 'DEPARTURE', title: 'Departure', state: 'reported_in_progress', reported_count: 1, carup_count: 0, rows: [row(1, 'external_report', false)] },
      { code: 'DISPATCH', title: 'Dispatch', state: 'carup_recorded', reported_count: 0, carup_count: 1, rows: [row(1, 'carup', true)] },
    ],
    totals: { reported_rows: reportedRows, carup_rows: 1 },
    sources: [{ origin: 'external_report', source_label: sourceLabel, observed_at: '2026-11-20T00:00:00Z', row_count: 3 }],
    note: 'n',
  }
}

describe('reportedSummary', () => {
  it('counts stages reported complete, names the reporter as the data does, and counts undated REPORTED steps only', () => {
    expect(reportedSummary(progress('Example Exporter'))).toEqual({
      complete: 1, total: 3, completedTitles: ['Booking'], source: 'Example Exporter', sourceSentence: 'Example Exporter',
      asOf: '2026-11-20T00:00:00Z', rows: 3, undated: 2,
    })
  })
  it('never invents a reporter: an unnamed source reads "An external record"', () => {
    expect(reportedSummary(progress('an external record'))?.sourceSentence).toBe('An external record')
    expect(reportedSummary(progress('  '))?.source).toBeNull()
  })
  it('nothing reported → no summary; withheld or missing progress → no summary', () => {
    expect(reportedSummary(progress('S', 0))).toBeNull()
    expect(reportedSummary(undefined)).toBeNull()
    expect(reportedSummary({ availability: 'withheld', note: 'n' })).toBeNull()
  })
  it('the card line always says CarUp has not confirmed it', () => {
    expect(reportedLine(reportedSummary(progress('Example Exporter')))).toBe('Example Exporter reports 1 of 3 stages complete. CarUp has not confirmed them.')
    expect(reportedLine(null)).toBeNull()
  })
})
