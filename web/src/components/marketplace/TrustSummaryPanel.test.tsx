import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrustSummaryPanel } from './TrustSummaryPanel'
import type { MarketplaceTrustSummary } from '@/types'

/**
 * CARUP-MVP-STAB-01 F-013 — the Suspicion row never says "Clear" for a check with nothing to check.
 *
 * `deriveSuspicionLevel([])` answers 'clear' for ZERO PartSentry rows (marketplaceTrustSummaryService),
 * and 'clear' also covers rows whose suspicion status is missing. "Clear" reads as a check that ran and
 * passed; "No concerns recorded" is true in every one of those cases.
 */
function summary(overrides: Partial<MarketplaceTrustSummary> = {}): MarketplaceTrustSummary {
  return {
    trust_badges: [],
    public_badge_copy: [],
    evidence_status: 'none',
    vehicle_passport_available: false,
    identity_verified: false,
    dealer_verified: false,
    partsentry_public_status: 'not_applicable',
    suspicion_status: 'clear',
    risk_status: 'clear',
    risk_reasons: [],
    safe_public_copy: 'Trust signals are limited for this listing. Request an inspection and keep the conversation in CarUp messages.',
    ...overrides,
  } as MarketplaceTrustSummary
}

const suspicionRow = () => screen.getByTestId('marketplace-suspicion-status').textContent || ''

describe('TrustSummaryPanel — Suspicion', () => {
  it('ZERO PartSentry records: "No concerns recorded", never "Clear"', () => {
    render(<TrustSummaryPanel trust={summary()} />)
    expect(suspicionRow()).toContain('No concerns recorded')
    expect(suspicionRow()).not.toMatch(/\bclear\b/i)
  })

  it('records with no concern recorded read the same — still not an all-clear verdict', () => {
    render(<TrustSummaryPanel trust={summary({ partsentry_public_status: 'ineligible' })} />)
    expect(suspicionRow()).toContain('No concerns recorded')
    expect(suspicionRow()).not.toMatch(/\bclear\b/i)
  })

  it('an unread input is still "Not checked", and a concern is still named', () => {
    const { unmount } = render(<TrustSummaryPanel trust={summary({ suspicion_status: 'unavailable', risk_status: 'unavailable' })} />)
    expect(suspicionRow()).toContain('Not checked')
    unmount()
    render(<TrustSummaryPanel trust={summary({ suspicion_status: 'watch', risk_status: 'watch' })} />)
    expect(suspicionRow()).toMatch(/watch/i)
    expect(suspicionRow()).not.toContain('No concerns recorded')
  })
})
