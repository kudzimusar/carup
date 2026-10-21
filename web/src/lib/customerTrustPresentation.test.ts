import { describe, expect, it } from 'vitest'
import {
  customerTrustLimitation,
  customerTrustLimitations,
  presentTrustForCustomer,
} from '@shared/trust/customerTrustPresentation'

// The exact public Trust record staging served for Serena GFC27-027051 on 2026-10-21.
const SERENA = {
  vin: 'GFC27-027051',
  score: 60,
  band: 'moderate',
  evaluation_state: 'evaluated',
  confidence: 'low',
  evidence_basis: {
    governed_facts_total: 7,
    governed_facts_substantiated: 0,
    governed_facts_adverse: 0,
    connected_sources: 0,
    unbacked_legacy_claims: 0,
  },
  known_limitations: [
    'No live government/partner source is connected for this vehicle yet.',
    'Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding.',
    'dealer compliance has not been evaluated for this vehicle.',
    'insurance eligibility has not been evaluated for this vehicle.',
    'finance eligibility has not been evaluated for this vehicle.',
    'escrow eligibility has not been evaluated for this vehicle.',
    'No governed vehicle fact is backed by an authoritative record.',
  ],
}

const INTERNAL_TERMS = /canonical|governed|authoritative|provenance|calculation version|reason:|zimra_verified|police_verified|duty_paid|escrow|projection|backend/i

describe('presentTrustForCustomer — Serena GFC27-027051', () => {
  const presented = presentTrustForCustomer(SERENA)

  it('states confidence, evidence support and connected sources exactly as the record holds them', () => {
    expect(presented.evaluated).toBe(true)
    expect(presented.confidenceLevel).toBe('low')
    expect(presented.confidenceValue).toBe('Low')
    expect(presented.evidenceSupportValue).toBe('0 of 7 vehicle facts independently confirmed')
    expect(presented.substantiatedFacts).toBe(0)
    expect(presented.governedFactsTotal).toBe(7)
    expect(presented.connectedSourcesValue).toBe('0')
    expect(presented.rows.map(row => `${row.label}: ${row.value}`)).toEqual([
      'Confidence: Low',
      'Evidence support: 0 of 7 vehicle facts independently confirmed',
      'Connected official sources: 0',
    ])
  })

  it('words all seven limitations for a buyer, groups the four not-done checks, and keeps the count', () => {
    expect(presented.limitationCount).toBe(7)
    expect(presented.limitations).toEqual([
      'No government or partner record is connected for this vehicle yet.',
      'Zimbabwe registration is still in progress. This is not held against the vehicle.',
      'Dealer, insurance, finance and SafePay checks have not been done for this vehicle yet.',
      "None of this vehicle's facts has been confirmed against an official record yet.",
    ])
  })

  it('never surfaces internal implementation wording', () => {
    for (const line of presented.limitations) expect(line).not.toMatch(INTERNAL_TERMS)
    for (const row of presented.rows) expect(`${row.label} ${row.value}`).not.toMatch(INTERNAL_TERMS)
  })

  it('never claims verification', () => {
    const everything = [...presented.limitations, ...presented.rows.map(row => row.value)].join(' ')
    expect(everything).not.toMatch(/\bverified\b|evidence backed|government verified|\bclean\b|\btrusted\b/i)
  })
})

describe('presentTrustForCustomer — records without a score', () => {
  it('does not call a not-evaluated record evaluated and reports missing basis as not recorded', () => {
    const presented = presentTrustForCustomer({
      score: null,
      band: null,
      evaluation_state: 'not_evaluated',
      confidence: 'not_evaluated',
      evidence_basis: null,
      known_limitations: ['No canonical trust evaluation exists for this vehicle.'],
    })
    expect(presented.evaluated).toBe(false)
    expect(presented.confidenceValue).toBe('Not evaluated')
    expect(presented.evidenceSupportValue).toBe('Not recorded')
    expect(presented.connectedSourcesValue).toBe('Not recorded')
    expect(presented.limitations).toEqual(['CarUp has not evaluated Trust for this vehicle yet.'])
  })

  it('drops raw reason codes and never counts them as limitations', () => {
    const presented = presentTrustForCustomer({
      evaluation_state: 'unavailable',
      confidence: null,
      known_limitations: [
        'The canonical trust evaluation could not be produced for this vehicle, so no score is reported.',
        'reason:cache_read_failed',
      ],
    })
    expect(presented.limitations).toEqual(['CarUp could not produce a Trust result for this vehicle right now.'])
    expect(presented.limitationCount).toBe(1)
    expect(presented.confidenceValue).toBe('Not recorded')
  })

  it('a missing record is never treated as evaluated', () => {
    const presented = presentTrustForCustomer(null)
    expect(presented.evaluated).toBe(false)
    expect(presented.limitations).toEqual([])
    expect(presented.confidenceLevel).toBe('not_recorded')
  })
})

describe('customerTrustLimitation', () => {
  it('words a stored legacy flag without naming the column', () => {
    expect(customerTrustLimitation(
      "The stored 'zimra_verified' flag on this vehicle is not supported by any authoritative record and is not published.",
    )).toBe('A stored vehicle check is not backed by an official record, so CarUp does not show it.')
  })

  it('words a stale calculation version without naming versions', () => {
    expect(customerTrustLimitation(
      'The stored trust score was produced by calculation version trust-decision-v1; the current version is trust-decision-1.1.0. It is not published as canonical.',
    )).toBe("This vehicle's Trust result is out of date and is waiting to be refreshed.")
  })

  it('never echoes an unrecognised backend sentence', () => {
    expect(customerTrustLimitation('Some new internal canonical limitation we have not mapped.'))
      .toBe('Some checks for this vehicle are not complete yet.')
  })

  it('returns null for reason codes and blanks', () => {
    expect(customerTrustLimitation('reason:invalid_vin')).toBeNull()
    expect(customerTrustLimitation('   ')).toBeNull()
  })

  it('de-duplicates repeated sentences', () => {
    expect(customerTrustLimitations([
      "The stored 'zimra_verified' flag on this vehicle is not supported by any authoritative record and is not published.",
      "The stored 'police_verified' flag on this vehicle is not supported by any authoritative record and is not published.",
    ])).toEqual(['A stored vehicle check is not backed by an official record, so CarUp does not show it.'])
  })
})
