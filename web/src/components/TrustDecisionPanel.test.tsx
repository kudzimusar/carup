import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrustDecisionPanel } from './TrustDecisionPanel'
import type { TrustDecision } from '@/types'

function decision(over: Partial<TrustDecision> = {}): TrustDecision {
  return {
    vin: 'V1', calculation_version: 'trust-decision-1.0.0', last_updated: null,
    overall_trust: { status: 'moderate', value: 55 },
    dimensions: {
      identity: { status: 'complete', value: 'identity_complete', reason_codes: [] },
      source_coverage: { status: 'demonstration_only', value: '0/5', reason_codes: [] },
      fraud_risk: { status: 'clear', value: 'clear', reason_codes: [] },
      dealer_compliance: { status: 'compliant', value: 'compliant', reason_codes: [] },
      publication_eligibility: { status: 'publishable', value: 'publishable', reason_codes: [] },
      insurance_eligibility: { status: 'conditionally_eligible', value: 'conditionally_eligible', reason_codes: [] },
      finance_eligibility: { status: 'manual_review', value: 'manual_review', reason_codes: [] },
      escrow_eligibility: { status: 'not_evaluated', value: null, reason_codes: [] },
    },
    known_limitations: ['No live government/partner source is connected for this vehicle yet.'],
    ...over,
  }
}

describe('TrustDecisionPanel', () => {
  it('renders separate dimension rows (not one verified badge)', () => {
    const html = renderToStaticMarkup(<TrustDecisionPanel vin="V1" initialData={decision()} />)
    expect(html).toContain('data-testid="decision-row-identity"')
    expect(html).toContain('data-testid="decision-row-source_coverage"')
    expect(html).toContain('data-testid="decision-row-fraud_risk"')
    expect(html).toContain('Vehicle trust breakdown')
  })
  it('hides the private finance dimension from the buyer', () => {
    const html = renderToStaticMarkup(<TrustDecisionPanel vin="V1" initialData={decision()} />)
    expect(html).not.toContain('decision-row-finance_eligibility')
  })
  it('shows insufficient-evidence honestly', () => {
    const html = renderToStaticMarkup(<TrustDecisionPanel vin="V1" initialData={decision({ overall_trust: { status: 'insufficient_evidence', value: 0 } })} />)
    expect(html).toContain('Insufficient evidence')
  })
  it('shows known limitations', () => {
    const html = renderToStaticMarkup(<TrustDecisionPanel vin="V1" initialData={decision()} />)
    expect(html).toContain('Known limitations')
    expect(html).toContain('No live government/partner source is connected')
  })
  it('shows not-evaluated dimensions explicitly', () => {
    const html = renderToStaticMarkup(<TrustDecisionPanel vin="V1" initialData={decision()} />)
    expect(html).toContain('Not evaluated')
  })
})
