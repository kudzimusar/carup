/**
 * CarUp Intelligence 1.0 — I7 display contract.
 *
 * This module is the only place a metric envelope is unwrapped, so it is the only
 * place a fake zero could be born. The I0 audit found a dozen CarUp surfaces
 * rendering a failed read as `0`, which reads to a seller as "nobody came". These
 * tests exist so that cannot happen again through this path.
 */
import { describe, it, expect } from 'vitest'
import {
  displayMetric,
  hasValue,
  metricQualifier,
  envelopeIsReadable,
  envelopeMessage,
  formatAsOf,
  coverageNote,
  displayTrust,
  type MetricEnvelope,
} from './intelligenceDisplay'

const value = (n: number, unit = 'count'): MetricEnvelope => ({ availability: 'value', value: n, unit })

describe('a measured number is shown', () => {
  it('renders a count, with thousands separated', () => {
    expect(displayMetric(value(0))).toBe('0')
    expect(displayMetric(value(42))).toBe('42')
    expect(displayMetric(value(1234))).toBe((1234).toLocaleString())
  })

  it('renders a percent with its unit', () => {
    expect(displayMetric(value(12.5, 'percent'))).toBe('12.5%')
  })

  it('treats a genuine zero as a real value, not as missing', () => {
    expect(hasValue(value(0))).toBe(true)
    expect(displayMetric(value(0))).toBe('0')
  })
})

describe('an unmeasured metric NEVER renders as zero', () => {
  it('says "Not available" when the backend could not read it', () => {
    const unavailable: MetricEnvelope = { availability: 'unavailable', value: null, reason: 'never_computed' }
    expect(displayMetric(unavailable)).toBe('Not available')
    expect(displayMetric(unavailable)).not.toBe('0')
    expect(hasValue(unavailable)).toBe(false)
  })

  it('says "Not enough activity yet" below the reporting floor', () => {
    const thin: MetricEnvelope = { availability: 'insufficient_data', value: null, reason: 'denominator_below_20' }
    expect(displayMetric(thin)).toBe('Not enough activity yet')
    expect(displayMetric(thin)).not.toBe('0')
  })

  it('says "Not applicable" when the metric does not apply', () => {
    expect(displayMetric({ availability: 'not_applicable', value: null })).toBe('Not applicable')
  })

  it('treats a MISSING metric as unavailable, never as zero', () => {
    // An absent metric is a thing we did not measure, not a thing that did not happen.
    expect(displayMetric(undefined)).toBe('Not available')
    expect(displayMetric(null)).toBe('Not available')
    expect(hasValue(undefined)).toBe(false)
  })

  it('does not show a number even if one is smuggled alongside a non-value state', () => {
    // Defensive: a backend bug must not become a displayed figure.
    expect(displayMetric({ availability: 'unavailable', value: 999 } as MetricEnvelope)).toBe('Not available')
  })
})

describe('qualifiers keep a number from implying more than CarUp knows', () => {
  it('explains a peak-day window unique', () => {
    expect(metricQualifier({ availability: 'value', value: 30, basis: 'peak_day' }))
      .toMatch(/busiest day/)
  })

  it('explains a capped conversion rate', () => {
    const capped: MetricEnvelope = {
      availability: 'value', value: 100, unit: 'percent', capped: true,
      note: 'More actions were recorded at this stage than at the one before it.',
    }
    expect(metricQualifier(capped)).toMatch(/More actions/)
  })

  it('adds nothing to an ordinary number', () => {
    expect(metricQualifier(value(10))).toBeNull()
    expect(metricQualifier({ availability: 'unavailable', value: null })).toBeNull()
  })
})

describe('the payload envelope', () => {
  it('is readable only when the backend says value AND supplies metrics', () => {
    expect(envelopeIsReadable({ availability: 'value', metrics: { views: value(1) } })).toBe(true)
    expect(envelopeIsReadable({ availability: 'value' })).toBe(false)
    expect(envelopeIsReadable({ availability: 'unavailable', reason: 'never_computed' })).toBe(false)
    expect(envelopeIsReadable(null)).toBe(false)
  })

  it('distinguishes "we could not read" from "you have nothing listed"', () => {
    // These call for completely different actions from the seller.
    const unreadable = envelopeMessage({ availability: 'unavailable', reason: 'never_computed' })
    expect(unreadable).toMatch(/NOT zero/)

    const noListings = envelopeMessage({
      availability: 'not_applicable',
      reason: 'no_listings',
      message: 'Publish a vehicle to start receiving Marketplace insights.',
    })
    expect(noListings).toMatch(/Publish a vehicle/)
    expect(noListings).not.toMatch(/NOT zero/)
  })

  it('never implies a quiet market when nothing was loaded at all', () => {
    expect(envelopeMessage(null)).toMatch(/NOT zero/)
  })
})

describe('provenance', () => {
  it('formats an as-of timestamp so staleness is visible', () => {
    expect(formatAsOf('2026-08-27T04:00:00.000Z')).toBeTruthy()
    expect(formatAsOf(null)).toBeNull()
    expect(formatAsOf('not-a-date')).toBeNull()
  })

  it('states partial coverage, because a gap and a zero look identical on a chart', () => {
    expect(coverageNote({ coverage: { days_with_data: 2, days_requested: 7 } }))
      .toBe('Measured on 2 of the last 7 days.')
  })

  it('says nothing when the window is fully measured', () => {
    expect(coverageNote({ coverage: { days_with_data: 7, days_requested: 7 } })).toBeNull()
    expect(coverageNote({})).toBeNull()
  })
})

describe('trust is never rendered as a low score', () => {
  it('shows the score only in the evaluated state', () => {
    expect(displayTrust({ state: 'evaluated', band: 'high', score: 92 })).toBe('92 · high')
  })

  it('keeps not_evaluated as words, never a number', () => {
    const text = displayTrust({ state: 'not_evaluated', band: null, score: null })
    expect(text).toBe('Not evaluated')
    expect(text).not.toMatch(/\d/)
  })

  it('distinguishes unavailable from not evaluated', () => {
    expect(displayTrust({ state: 'unavailable', band: null, score: null })).toBe('Evaluation unavailable')
    expect(displayTrust({ state: 'stale', band: null, score: null })).toBe('Evaluation out of date')
  })

  it('defaults to not evaluated rather than inventing a state', () => {
    expect(displayTrust(null)).toBe('Not evaluated')
    expect(displayTrust(undefined)).toBe('Not evaluated')
  })

  it('never shows a score the backend withheld', () => {
    // A stale or unavailable evaluation must not leak its number.
    expect(displayTrust({ state: 'stale', band: 'high', score: 88 })).not.toMatch(/88/)
    expect(displayTrust({ state: 'unavailable', band: 'low', score: 12 })).not.toMatch(/12/)
  })
})
