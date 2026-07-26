import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SubscriptionActions } from '../SubscriptionActions'
import type { Plan, SubscriptionStatus } from '@/types'

const PLANS: Plan[] = [
  { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Free', entitlements: {} },
  { planKey: 'seller', name: 'Seller / Supplier', tier: 'seller', sortOrder: 20, description: 'Seller', entitlements: {} },
]

const status: SubscriptionStatus = { tenantId: 't1', planKey: 'free', status: 'active', synthetic: true, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, active: true }

const noop = async () => {}
const handlers = { onCheckout: vi.fn(noop), onPortal: vi.fn(noop), onChangePlan: vi.fn(noop), onCancel: vi.fn(noop) }

describe('SubscriptionActions (manager-only control surface)', () => {
  it('always shows the sandbox notice (never claims a real charge)', () => {
    const html = renderToStaticMarkup(<SubscriptionActions plans={PLANS} status={status} {...handlers} />)
    expect(html).toContain('sandbox mode')
    expect(html).toContain('No real payment is collected')
    expect(html).not.toMatch(/payment succeeded|card charged|live subscription activated/i)
  })

  it('renders all four sandbox actions and an aria-live outcome region', () => {
    const html = renderToStaticMarkup(<SubscriptionActions plans={PLANS} status={status} outcome="Sandbox checkout session created." {...handlers} />)
    expect(html).toContain('data-testid="subscription-actions-checkout"')
    expect(html).toContain('data-testid="subscription-actions-change-plan"')
    expect(html).toContain('data-testid="subscription-actions-portal"')
    expect(html).toContain('data-testid="subscription-actions-cancel"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Sandbox checkout session created.')
  })

  it('disables Cancel when a cancellation is already scheduled (anti double-effect)', () => {
    const html = renderToStaticMarkup(<SubscriptionActions plans={PLANS} status={{ ...status, cancelAtPeriodEnd: true }} {...handlers} />)
    // The disabled attribute is present on the cancel control.
    const cancelIdx = html.indexOf('data-testid="subscription-actions-cancel"')
    const segment = html.slice(Math.max(0, cancelIdx - 120), cancelIdx + 40)
    expect(segment).toContain('disabled')
  })
})
