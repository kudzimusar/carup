/**
 * Issue #164 Phase 8, Cluster B — governed location convergence.
 *
 * On the physically-tested baseline `993c1179`, Vehicle Detail read `vehicle.location` /
 * `vehicle.province` — columns the canonical projection does not carry — and so rendered
 * "Location not recorded" for Golden A while the SAME passport response carried
 * Bulawayo / Bulawayo Metropolitan / Zimbabwe with `operator_recorded` provenance. Landing and
 * Marketplace, reading the composed summary field, printed the full line. One VIN, three surfaces,
 * two answers.
 */

import { describe, it, expect } from 'vitest'
import {
  composeGovernedLocation,
  deriveGovernedLocationState,
  governedLocationLine,
  summaryLocationLine,
  LOCATION_STATES,
} from './governedLocation'

const recorded = (value: string) => ({ value, state: LOCATION_STATES.RECORDED, source: 'operator_recorded' })
const notRecorded = () => ({ value: null, state: LOCATION_STATES.NOT_RECORDED, source: null })
const withheld = () => ({ value: null, state: LOCATION_STATES.WITHHELD, source: null })

/** Golden A exactly as canonical staging holds it. */
const GOLDEN_A_LOCATION = {
  city: recorded('Bulawayo'),
  province: recorded('Bulawayo Metropolitan'),
  country: recorded('Zimbabwe'),
}

describe('composeGovernedLocation', () => {
  // THE REGRESSION.
  it('composes Golden A the way the marketplace summary does', () => {
    expect(composeGovernedLocation(GOLDEN_A_LOCATION)).toBe('Bulawayo, Bulawayo Metropolitan, Zimbabwe')
  })

  it('joins only the RECORDED leaves, in city/province/country order', () => {
    expect(composeGovernedLocation({
      city: recorded('Harare'), province: notRecorded(), country: notRecorded(),
    })).toBe('Harare')
    expect(composeGovernedLocation({
      city: notRecorded(), province: notRecorded(), country: recorded('Zimbabwe'),
    })).toBe('Zimbabwe')
  })

  // The defect the whole programme is named for: a missing city must not become a country literal,
  // and a country must not be promoted into a city.
  it('invents nothing when nothing is recorded', () => {
    expect(composeGovernedLocation({ city: notRecorded(), province: notRecorded(), country: notRecorded() })).toBeNull()
    expect(composeGovernedLocation(null)).toBeNull()
    expect(composeGovernedLocation(undefined)).toBeNull()
    expect(composeGovernedLocation({})).toBeNull()
  })

  it('refuses a value whose state is not `recorded`, however tempting it looks', () => {
    // A leaf carrying a value with a non-recorded state is precisely an unattributed fact.
    expect(composeGovernedLocation({ city: { value: 'Harare', state: LOCATION_STATES.WITHHELD } })).toBeNull()
    expect(composeGovernedLocation({ city: { value: 'Harare' } })).toBeNull()
    expect(composeGovernedLocation({ city: { value: '   ', state: LOCATION_STATES.RECORDED } })).toBeNull()
  })
})

describe('deriveGovernedLocationState', () => {
  it('ranks recorded above withheld above not_recorded', () => {
    expect(deriveGovernedLocationState(GOLDEN_A_LOCATION)).toBe(LOCATION_STATES.RECORDED)
    expect(deriveGovernedLocationState({ city: withheld(), country: notRecorded() })).toBe(LOCATION_STATES.WITHHELD)
    expect(deriveGovernedLocationState({ city: notRecorded() })).toBe(LOCATION_STATES.NOT_RECORDED)
    expect(deriveGovernedLocationState(null)).toBe(LOCATION_STATES.NOT_RECORDED)
  })

  // Collapsing these would make "we hold nothing" and "you may not see it" render identically.
  it('never collapses withheld into not_recorded', () => {
    expect(deriveGovernedLocationState({ city: withheld() }))
      .not.toBe(deriveGovernedLocationState({ city: notRecorded() }))
  })
})

describe('governedLocationLine', () => {
  it('gives Detail the same line the cards print for Golden A', () => {
    expect(governedLocationLine(GOLDEN_A_LOCATION))
      .toEqual({ label: 'Bulawayo, Bulawayo Metropolitan, Zimbabwe', isRecorded: true })
  })

  it('states an absence in words rather than returning an empty label', () => {
    expect(governedLocationLine(null)).toEqual({ label: 'Location not recorded', isRecorded: false })
    expect(governedLocationLine({ city: withheld() })).toEqual({ label: 'Location withheld', isRecorded: false })
  })
})

describe('summaryLocationLine', () => {
  it('prints the server-composed line when the state says it is recorded', () => {
    expect(summaryLocationLine('Bulawayo, Bulawayo Metropolitan, Zimbabwe', 'recorded'))
      .toEqual({ label: 'Bulawayo, Bulawayo Metropolitan, Zimbabwe', isRecorded: true })
  })

  it('states the absence, and does so identically for every surface', () => {
    // The three surfaces used to say "Location unknown", "Location not recorded", and nothing at all.
    const marketplace = summaryLocationLine(null, 'not_recorded')
    const search = summaryLocationLine(undefined, 'not_recorded')
    const landing = summaryLocationLine('', 'not_recorded')
    expect(marketplace.label).toBe('Location not recorded')
    expect(search).toEqual(marketplace)
    expect(landing).toEqual(marketplace)
  })

  it('never publishes a line the state does not vouch for', () => {
    expect(summaryLocationLine('Harare', 'withheld')).toEqual({ label: 'Location withheld', isRecorded: false })
    // A missing state is treated as not recorded, never as permission to print the value.
    expect(summaryLocationLine('Harare', undefined).isRecorded).toBe(false)
  })
})
