import { describe, expect, it } from 'vitest'
import {
  documentActionLabel, originLabel, partyLines, progressGroupCounts, progressRowTone, progressStateBadge, progressTimeText, reportedProgressSummary, specRows,
} from './capDisplay'
import type { JourneyProgress } from '@/hooks/useTradeLogisticsApi'

const group = (code: string, title: string, state: string, reported = 1, carup = 0) => ({ code, title, state, reported_count: reported, carup_count: carup, rows: [] })
const progress = (groups: ReturnType<typeof group>[], over: Record<string, unknown> = {}): JourneyProgress => ({
  availability: 'composed', groups, totals: { reported_rows: groups.reduce((n, g) => n + g.reported_count, 0), carup_rows: groups.reduce((n, g) => n + g.carup_count, 0) },
  sources: [{ origin: 'external_report', source_label: 'Partner portal', observed_at: '2026-10-24T23:46:01Z', row_count: 14 }], note: 'n', ...over,
} as JourneyProgress)
const FIVE = [
  group('BOOKING', 'Booking', 'reported_completed', 7), group('DEPARTURE', 'Departure', 'reported_completed'), group('BILL_OF_LADING', 'B/L', 'reported_completed', 3),
  group('DISPATCH', 'Dispatch', 'reported_completed'), group('CLEARING_DELIVERY', 'Clearing & Delivery', 'reported_completed', 2),
]

describe('originLabel', () => {
  it('says who stands behind a record, taking a source\'s name from the data and never inventing one', () => {
    expect(originLabel('carup')).toBe('Recorded by CarUp')
    expect(originLabel('owner_declared')).toBe('Declared by you')
    expect(originLabel('external_report', 'Partner portal')).toBe('Reported by Partner portal')
    for (const none of [undefined, null, '', '  ', 'an external record']) expect(originLabel('external_report', none)).toBe('Reported by an external record')
    expect(originLabel('something_new', 'Partner portal')).toBe('Reported by Partner portal')
  })
})

describe('partyLines', () => {
  it('reads like a label and omits what is not recorded', () => {
    expect(partyLines({ address: 'Street 1', city: 'Harare', country: 'Zimbabwe', phone: '+1 555', email: 'a@example.test' })).toEqual(['Street 1', 'Harare, Zimbabwe', '+1 555', 'a@example.test'])
    expect(partyLines({ address: null, city: 'HARARE', country: 'Zimbabwe', phone: null, email: null })).toEqual(['HARARE, Zimbabwe'])
    expect(partyLines({ address: null, city: null, country: 'Zimbabwe', phone: ' ', email: '' })).toEqual(['Zimbabwe'])
    expect(partyLines({ address: null, city: null, country: null, phone: null, email: null })).toEqual([])
  })
})

describe('progress wording', () => {
  it('a stage badge never defaults to "completed" or "not started"', () => {
    expect(progressStateBadge('reported_completed').label).toBe('Completed (reported)')
    expect(progressStateBadge('reported_in_progress').label).toBe('In progress (reported)')
    expect(progressStateBadge('carup_recorded').label).toBe('Recorded by CarUp')
    expect(progressStateBadge('reported_to_carup').label).toBe('Reported to CarUp')
    expect(progressStateBadge('not_recorded').label).toBe('Nothing recorded')
    for (const odd of [undefined, null, '', 'finished', 'NOT_STARTED']) {
      expect(progressStateBadge(odd).label).toBe('Status not recognised')
    }
    expect(progressStateBadge('not_recorded').label).not.toMatch(/not started|pending/i)
  })

  it('a step chip is green only for completed or CarUp-recorded; anything else is neutral or in-flight', () => {
    expect(progressRowTone('completed')).toMatch(/emerald/)
    expect(progressRowTone('recorded')).toMatch(/emerald/)
    expect(progressRowTone('reported')).toMatch(/sky/)
    expect(progressRowTone('cancelled')).toMatch(/red/)
    expect(progressRowTone(undefined)).toMatch(/slate/)
    expect(progressRowTone('mystery')).toMatch(/slate/)
  })

  it('a time that was not supplied is said not to have been supplied', () => {
    const fmt = (iso: string) => `at ${iso}`
    expect(progressTimeText({ time: { value: '2026-09-01T00:00:00Z' }, time_note: null }, fmt)).toBe('at 2026-09-01T00:00:00Z')
    expect(progressTimeText({ time: null, time_note: 'The source did not supply a date for this step.' }, fmt)).toBe('The source did not supply a date for this step.')
    expect(progressTimeText({ time: null, time_note: null }, fmt)).toBe('No date recorded')
  })

  it('stage counts keep reported and CarUp-recorded apart', () => {
    expect(progressGroupCounts({ reported_count: 7, carup_count: 0 })).toBe('7 steps reported')
    expect(progressGroupCounts({ reported_count: 1, carup_count: 0 })).toBe('1 step reported')
    expect(progressGroupCounts({ reported_count: 1, carup_count: 2 })).toBe('1 step reported · 2 steps recorded by CarUp')
    expect(progressGroupCounts({ reported_count: 0, carup_count: 0 })).toBe('No steps recorded')
  })
})

describe('reportedProgressSummary — the top of the page when a sender reports progress', () => {
  it('says the sender reported every step AND that CarUp\'s own record has no departure — attributed apart, never "hasn\'t started"', () => {
    const s = reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: { progress: progress(FIVE) } })
    expect(s?.badge).toBe('All 5 steps reported complete')
    expect(s?.sentence).toMatch(/Partner portal reports every step of this journey as completed: Booking, Departure, B\/L, Dispatch, Clearing & Delivery\./)
    expect(s?.sentence).toMatch(/not CarUp's own observation/)
    expect(`${s?.badge} ${s?.sentence}`).not.toMatch(/hasn.t started|not started|nothing moving/i)
  })

  it('counts honestly when only some steps are reported complete', () => {
    const partial = [...FIVE.slice(0, 3), group('DISPATCH', 'Dispatch', 'reported_in_progress'), group('CLEARING_DELIVERY', 'Clearing & Delivery', 'not_recorded', 0)]
    const s = reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: { progress: progress(partial) } })
    expect(s?.badge).toBe('3 of 5 steps reported complete')
    expect(s?.sentence).toMatch(/reports 3 of 5 steps as completed/)
  })

  it('names no source when none is stated, and is absent when nothing was reported', () => {
    const anon = progress(FIVE, { sources: [{ origin: 'external_report', source_label: 'an external record', observed_at: null, row_count: 14 }] })
    expect(reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: { progress: anon } })?.sentence).toMatch(/^The source of this record reports every step/)
    expect(reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: { progress: progress([group('BOOKING', 'Booking', 'carup_recorded', 0, 2)]) } })).toBeNull()
    expect(reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: { progress: { availability: 'withheld', note: 'x' } } })).toBeNull()
    expect(reportedProgressSummary({ state: 'SHIPMENT_CREATED', sections: {} })).toBeNull()
    expect(reportedProgressSummary({ state: 'SHIPMENT_CREATED' })).toBeNull()
  })
})

describe('specRows / documentActionLabel', () => {
  it('marks exactly the rows the projection flagged as reported', () => {
    const rows = specRows([
      { key: 'a', label: 'A', value: '1', source: 'vehicle_record', reported: true, unit: null },
      { key: 'b', label: 'B', value: '2', source: 'recorded_observation', reported: false, unit: null },
    ])
    expect(rows.map((r) => r.marker)).toEqual([true, false])
    expect(specRows(undefined)).toEqual([])
  })

  it('action labels use T8\'s display name, never a type code', () => {
    expect(documentActionLabel('Bill of Lading', 'view')).toBe('View Bill of Lading')
    expect(documentActionLabel('Bill of Lading', 'download')).toBe('Download Bill of Lading')
    expect(documentActionLabel('  ', 'view')).toBe('View document')
    expect(documentActionLabel(null, 'download')).toBe('Download document')
  })
})
