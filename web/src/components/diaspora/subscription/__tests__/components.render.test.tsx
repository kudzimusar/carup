import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanComparison } from '../PlanComparison'
import { UsageDashboard } from '../UsageDashboard'
import { SubscriptionStatusCard } from '../SubscriptionStatusCard'
import { EntitlementDenialPanel } from '../EntitlementDenialPanel'
import { buildDenial } from '../entitlementDenial'
import type { Plan, SubscriptionStatus, UsageResponse } from '@/types'

const PLANS: Plan[] = [
  { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Browse only.', entitlements: { 'diaspora.workbook.download': true, 'diaspora.stock.create': false, 'diaspora.ai.execute_medium': 0 } },
  { planKey: 'seller', name: 'Seller / Supplier', tier: 'seller', sortOrder: 20, description: 'Sell stock.', entitlements: { 'diaspora.stock.create': true, 'diaspora.stock.max_items': 250, 'diaspora.ai.execute_medium': 25 } },
]

describe('PlanComparison (from MOCKED api shape; no hardcoded catalog)', () => {
  it('renders plan names + descriptions from the API in sortOrder and marks the current plan', () => {
    const html = renderToStaticMarkup(<PlanComparison plans={PLANS} currentPlanKey="seller" />)
    expect(html).toContain('Seller / Supplier')
    expect(html).toContain('Browse only.')
    expect(html).toContain('Current plan')
    expect(html).toContain('data-plan-key="seller"')
    expect(html).toContain('data-current="true"')
  })

  it('distinguishes unavailable vs included vs metered TRUTHFULLY', () => {
    const html = renderToStaticMarkup(<PlanComparison plans={PLANS} currentPlanKey="free" />)
    expect(html).toContain('Not included')      // boolean false / numeric 0
    expect(html).toContain('Included')          // boolean true
    expect(html).toContain('25 / month')        // metered quota on seller plan
    expect(html).toContain('Up to 250')         // fixed cap
    // No invented "Unlimited" for plan entitlements.
    expect(html).not.toContain('Unlimited on your plan')
  })

  it('renders an empty state when there are no plans', () => {
    const html = renderToStaticMarkup(<PlanComparison plans={[]} currentPlanKey={null} />)
    expect(html).toContain('data-testid="plan-comparison-empty"')
  })
})

describe('UsageDashboard (accessible, text-not-color)', () => {
  const usage: UsageResponse = {
    tenantId: 't1', periodStart: '2026-06-01T00:00:00.000Z',
    usage: [
      { featureKey: 'diaspora.ai.execute_medium', limit: 25, used: 10, remaining: 15 },
      { featureKey: 'diaspora.workbook.bulk_import', limit: 0, used: 0, remaining: 0 },
    ],
  }

  it('shows used/limit/remaining as TEXT and an accessible progressbar', () => {
    const html = renderToStaticMarkup(<UsageDashboard usage={usage} />)
    expect(html).toContain('10 of 25 used (15 remaining)')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('aria-valuemax="100"')
  })

  it('renders the unavailable state for a finite zero limit', () => {
    const html = renderToStaticMarkup(<UsageDashboard usage={usage} />)
    expect(html).toContain('Not available on your plan')
  })

  it('renders an unlimited state truthfully when limit is null', () => {
    const html = renderToStaticMarkup(<UsageDashboard usage={{ tenantId: 't', periodStart: '2026-06-01T00:00:00.000Z', usage: [{ featureKey: 'diaspora.x', limit: null, used: 3, remaining: null }] }} />)
    expect(html).toContain('Unlimited on your plan')
    // An unlimited row has no bounded progressbar.
    expect(html).not.toContain('aria-valuemax')
  })

  it('renders an empty state when there is no usage', () => {
    const html = renderToStaticMarkup(<UsageDashboard usage={{ tenantId: 't', periodStart: 'x', usage: [] }} />)
    expect(html).toContain('data-testid="usage-dashboard-empty"')
  })
})

describe('SubscriptionStatusCard', () => {
  const base: SubscriptionStatus = { tenantId: 't1', planKey: 'free', status: 'active', synthetic: true, currentPeriodStart: '2026-06-01T00:00:00.000Z', currentPeriodEnd: '2026-07-01T00:00:00.000Z', cancelAtPeriodEnd: false, active: true }

  it('shows synthetic Free, active state and period dates', () => {
    const html = renderToStaticMarkup(<SubscriptionStatusCard status={base} plan={PLANS[0]} />)
    expect(html).toContain('Free plan')
    expect(html).toContain('2026-06-01')
    expect(html).toContain('2026-07-01')
    expect(html).toContain('data-testid="subscription-status-card-active-badge"')
  })

  it('surfaces cancel-at-period-end', () => {
    const html = renderToStaticMarkup(<SubscriptionStatusCard status={{ ...base, synthetic: false, cancelAtPeriodEnd: true }} plan={PLANS[0]} />)
    expect(html).toContain('scheduled to cancel at the end of the current period')
  })
})

describe('EntitlementDenialPanel (safe rendering of every category)', () => {
  it('renders quota-exhausted with remaining + upgrade affordance metadata', () => {
    const html = renderToStaticMarkup(
      <EntitlementDenialPanel denial={buildDenial('quota-exhausted', { requestedOperation: 'run AI command', requiredFeature: 'diaspora.ai.execute_medium', currentPlan: 'free', requiredPlan: 'seller', remaining: 0 })} />,
    )
    expect(html).toContain('data-denial-category="quota-exhausted"')
    expect(html).toContain('Usage limit reached')
    expect(html).toContain('run AI command')
    expect(html).toContain('Ai Execute Medium')
    expect(html).toContain('seller')
  })

  it('renders ordinary-authorization-failure without any leaked internals', () => {
    const html = renderToStaticMarkup(<EntitlementDenialPanel denial={buildDenial('ordinary-authorization-failure', { requestedOperation: 'cancel subscription' })} />)
    expect(html).toContain('Not permitted')
    expect(html).toContain('You do not have permission')
    expect(html).not.toMatch(/PGRST|stack|sk_live|tenant_id=/i)
  })
})
