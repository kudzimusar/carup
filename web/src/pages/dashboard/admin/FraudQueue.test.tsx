import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FraudCaseCard } from './FraudQueue'
import { DealerComplianceCard } from './DealerCompliance'

describe('FraudCaseCard', () => {
  const base = { id: 'c1', vin: '1HGBH41JXMN109186', status: 'open', highest_severity: 'critical', open_signal_count: 2, blocks_publication: true, created_at: '2026-06-26T00:00:00Z' }
  it('shows VIN, severity, and a publication-block marker', () => {
    const html = renderToStaticMarkup(<FraudCaseCard fraudCase={base} onResolve={vi.fn()} busy={false} />)
    expect(html).toContain('VIN 1HGBH41JXMN109186')
    expect(html).toContain('critical')
    expect(html).toContain('blocks publication')
  })
  it('offers false-positive and block actions for an open case', () => {
    const html = renderToStaticMarkup(<FraudCaseCard fraudCase={base} onResolve={vi.fn()} busy={false} />)
    expect(html).toContain('False positive')
    expect(html).toContain('Block listing')
  })
})

describe('DealerComplianceCard', () => {
  const dealer = { id: 'd1', legal_name: 'Croco Motors', identity_status: 'verified', business_evidence_status: 'complete', compliance_review_state: 'passed', active_state: 'active', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none', listing_limit: 10 }
  it('shows the eight separate statuses (not one verified flag)', () => {
    const html = renderToStaticMarkup(<DealerComplianceCard dealer={dealer} onDecision={vi.fn()} busy={false} />)
    expect(html).toContain('data-testid="dealer-status-identity_status"')
    expect(html).toContain('data-testid="dealer-status-suspension_state"')
    expect(html).toContain('data-testid="dealer-status-compliance_review_state"')
    expect(html).toContain('Croco Motors')
  })
  it('offers Suspend for an active dealer', () => {
    const html = renderToStaticMarkup(<DealerComplianceCard dealer={dealer} onDecision={vi.fn()} busy={false} />)
    expect(html).toContain('Suspend')
  })
  it('offers Reinstate for a suspended dealer', () => {
    const html = renderToStaticMarkup(<DealerComplianceCard dealer={{ ...dealer, suspension_state: 'suspended' }} onDecision={vi.fn()} busy={false} />)
    expect(html).toContain('Reinstate')
  })
})
