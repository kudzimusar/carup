/**
 * Trade OS T12 — the sentences a person reads about customs.
 *
 * The three cases that carry this file are the ones a naive formatter gets wrong:
 *
 *   · an unassessed duty. The obvious rendering is `0` or `—`, and both tell a customer something
 *     about their liability that nobody has determined;
 *   · the same amount from an authority document and from an agent typing it. A formatter that
 *     returns one string with a confidence flag has already lost, because nobody reads the flag;
 *   · a customs exchange rate with no source. The removed forgery hardcoded 13.5 with no date and
 *     no provenance, and the honest alternative to an unsourced rate is no rate.
 */
import { describe, expect, it } from 'vitest'
import {
  CARUP_IS_NOT_ZIMRA,
  GATEWAY_IS_NOT_DESTINATION,
  LICENCE_UNVERIFIED,
  NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED,
  RECORDABLE_CUSTOMS_EVENTS,
  SOURCE_OPTIONS,
  STEP_STATE_UI,
  STRENGTH_UI,
  describeAssessment,
  describeCustomsRate,
  describeHandoffs,
  when,
} from './customsDisplay'

const assessment = (over = {}) => ({
  assessed: true, amount: 900, currency: 'USD',
  headline: 'Assessment amount', detail: 'Taken from an assessment document attached to this case. CarUp did not calculate it.',
  source: null, source_strength: 'AUTHORITY_EVIDENCE' as const, assessment_date: '2026-09-20T10:00:00Z', customs_rate: null,
  ...over,
})

describe('unknown is never a number', () => {
  it('says "Not yet assessed" rather than showing zero', () => {
    const d = describeAssessment(null)
    expect(d.amount).toBe('Not yet assessed')
    expect(d.amount).not.toContain('0')
    expect(d.amount).not.toBe('—')
    expect(d.authoritative).toBe(false)
  })

  it('says so for an explicitly unassessed case too', () => {
    const d = describeAssessment({ ...assessment(), assessed: false, amount: null, detail: 'No assessment has been received. CarUp does not calculate duty or tax.' } as never)
    expect(d.amount).toBe('Not yet assessed')
    expect(d.detail).toMatch(/does not calculate duty or tax/i)
  })

  it('says "Not recorded" rather than putting a dash beside real dates', () => {
    expect(when(null)).toBe('Not recorded')
    expect(when(undefined)).toBe('Not recorded')
    expect(when('2026-09-20T10:00:00Z')).not.toBe('Not recorded')
  })
})

describe('a claim never reads stronger than its source', () => {
  it('gives the SAME amount two different headlines', () => {
    const evidenced = describeAssessment(assessment())
    const reported = describeAssessment(assessment({
      headline: 'Agent-reported amount', source_strength: 'REPORTED',
      detail: "Reported by the appointed clearing agent. No assessment document has been attached, so this is their figure, not the authority's.",
    }))
    expect(evidenced.amount).toBe(reported.amount)
    expect(evidenced.headline).not.toBe(reported.headline)
    expect(evidenced.authoritative).toBe(true)
    expect(reported.authoritative).toBe(false)
    expect(reported.detail).toMatch(/their figure, not the authority/i)
  })

  it('every strength has words a person can act on', () => {
    for (const [key, ui] of Object.entries(STRENGTH_UI)) {
      expect(ui.label.length).toBeGreaterThan(3)
      expect(ui.explains.length).toBeGreaterThan(20)
      expect(ui.label.toLowerCase()).not.toBe(key.toLowerCase())
    }
    // A report must READ as a caveat, not as a rank a skimming reader ignores.
    expect(STRENGTH_UI.REPORTED.label).toMatch(/no document/i)
  })

  it('a licence reference is always presented as unverified', () => {
    expect(LICENCE_UNVERIFIED).toMatch(/has not verified/i)
    expect(LICENCE_UNVERIFIED).toMatch(/what the appointing party supplied/i)
  })
})

describe('a customs rate travels with its provenance or not at all', () => {
  it('reports no rate rather than borrowing one', () => {
    const r = describeCustomsRate(assessment())
    expect(r.known).toBe(false)
    expect(r.headline).toMatch(/not recorded/i)
    expect(r.detail).toMatch(/only shown when its source and effective date come with it/i)
    expect(r.headline).not.toMatch(/13\.5/)
  })

  it('shows the rate with its source and its period', () => {
    const r = describeCustomsRate(assessment({
      customs_rate: {
        value: 26.4312, basis: 'USD/ZWG',
        source: 'ZIMRA rates of exchange for customs purposes, week commencing 2026-09-07',
        effective_from: '2026-09-07', effective_to: '2026-09-13',
        note: 'The customs exchange rate as stated by its source. It is never a market rate and never a reference rate.',
      },
    }))
    expect(r.known).toBe(true)
    expect(r.headline).toContain('26.4312')
    expect(r.detail).toContain('ZIMRA')
    expect(r.detail).toMatch(/effective/i)
    expect(r.detail).toMatch(/never a market rate/i)
  })
})

describe('a gateway is not a destination', () => {
  it('gives every handoff its own line', () => {
    const lines = describeHandoffs({
      gateway: { port: 'Beira', country: 'Mozambique', arrived_at: '2026-09-20T08:00:00Z', observed: true },
      transit_started_at: null,
      destination: { country: 'Zimbabwe', city: 'Harare', final_destination: 'Harare depot', arrived_at: null, observed: false },
      collected_at: null, delivered_at: null, note: GATEWAY_IS_NOT_DESTINATION,
    })
    expect(lines).toHaveLength(5)
    const gateway = lines.find((l) => l.key === 'gateway')!
    const destination = lines.find((l) => l.key === 'destination')!
    expect(gateway.observed).toBe(true)
    expect(destination.observed).toBe(false)
    expect(destination.value).toBe('Not recorded')
    // The whole point: arriving at Beira has not put anything in Harare.
    expect(gateway.label).not.toBe(destination.label)
  })

  it('states the boundary as a whole sentence', () => {
    expect(GATEWAY_IS_NOT_DESTINATION).toMatch(/not arriving in the destination country/i)
    expect(GATEWAY_IS_NOT_DESTINATION).toMatch(/released, collected or delivered/i)
  })

  it('handles an absent handoff block without inventing anything', () => {
    expect(describeHandoffs(null)).toEqual([])
  })
})

describe('the vocabulary stays inside what CarUp may say', () => {
  it('offers no way to declare the goods cleared', () => {
    const values = RECORDABLE_CUSTOMS_EVENTS.map((e) => e.value)
    for (const forbidden of ['CLEARED', 'CUSTOMS_CLEARED', 'DUTY_PAID', 'VEHICLE_REGISTRATION', 'RELEASED']) {
      expect(values).not.toContain(forbidden)
    }
    // …and release EVIDENCE is offered, because receiving a document is a thing that happened.
    expect(values).toContain('RELEASE_EVIDENCE_RECEIVED')
  })

  it('every option says what it WRITES, in the operator\'s terms', () => {
    for (const e of RECORDABLE_CUSTOMS_EVENTS) {
      expect(e.hint.length).toBeGreaterThan(20)
      expect(e.label).not.toBe(e.value)
    }
    expect(RECORDABLE_CUSTOMS_EVENTS.find((e) => e.value === 'RELEASE_EVIDENCE_RECEIVED')!.hint)
      .toMatch(/CarUp does not release goods/i)
    expect(RECORDABLE_CUSTOMS_EVENTS.find((e) => e.value === 'ASSESSMENT_EVIDENCE_RECEIVED')!.hint)
      .toMatch(/CarUp calculates nothing/i)
    expect(RECORDABLE_CUSTOMS_EVENTS.find((e) => e.value === 'PAYMENT_EVIDENCE_RECEIVED')!.hint)
      .toMatch(/not the authority confirming/i)
  })

  it('only the authority-document source claims the authority', () => {
    const authority = SOURCE_OPTIONS.find((s) => s.value === 'AUTHORITY_DOCUMENT')!
    expect(authority.hint).toMatch(/requires the document to be attached/i)
    expect(authority.hint).toMatch(/only this reads as the authority/i)
    const agent = SOURCE_OPTIONS.find((s) => s.value === 'AGENT_REPORT')!
    expect(agent.hint).toMatch(/not the authority/i)
  })

  it('says out loud that CarUp is not ZIMRA', () => {
    expect(CARUP_IS_NOT_ZIMRA).toMatch(/is not ZIMRA/i)
    expect(CARUP_IS_NOT_ZIMRA).toMatch(/does not assess duty/i)
  })

  it('an unrecorded step is three states, never two', () => {
    // A checkbox with two states turns an absence of evidence into a finding.
    expect(Object.keys(STEP_STATE_UI)).toHaveLength(3)
    expect(STEP_STATE_UI.NOT_RECORDED.label).toMatch(/not recorded/i)
    expect(STEP_STATE_UI.REPORTED.label).toMatch(/no document/i)
    expect(STEP_STATE_UI.NOT_RECORDED.label).not.toBe(STEP_STATE_UI.REPORTED.label)
    expect(NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED).toMatch(/not the same as it being nil, refused, or complete/i)
  })
})
