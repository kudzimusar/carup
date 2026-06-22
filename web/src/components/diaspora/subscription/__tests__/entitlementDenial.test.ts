import { describe, it, expect } from 'vitest'
import { parseEntitlementDenial, classifyDenial, buildDenial } from '../entitlementDenial'

describe('classifyDenial — all categories', () => {
  it('classifies feature-unavailable-on-plan', () => {
    expect(classifyDenial({ message: 'Feature diaspora.api.access is not included in plan free' })).toBe('feature-unavailable-on-plan')
    expect(classifyDenial({ code: 'FEATURE_NOT_ENTITLED' })).toBe('feature-unavailable-on-plan')
  })
  it('classifies quota-exhausted', () => {
    expect(classifyDenial({ message: 'Reserving 1 would exceed the 25 quota for diaspora.ai.execute_medium' })).toBe('quota-exhausted')
    expect(classifyDenial({ code: 'QUOTA_EXCEEDED' })).toBe('quota-exhausted')
  })
  it('classifies inactive-subscription', () => {
    expect(classifyDenial({ message: 'The subscription is not active' })).toBe('inactive-subscription')
    expect(classifyDenial({ code: 'SUBSCRIPTION_INACTIVE' })).toBe('inactive-subscription')
  })
  it('classifies tenant-context-missing', () => {
    expect(classifyDenial({ message: 'An x-tenant-id context is required for subscription operations' })).toBe('tenant-context-missing')
    expect(classifyDenial({ message: 'A tenant context is required to manage a subscription' })).toBe('tenant-context-missing')
  })
  it('classifies external-activation-unavailable', () => {
    expect(classifyDenial({ code: 'BILLING_PROVIDER_UNAVAILABLE' })).toBe('external-activation-unavailable')
    expect(classifyDenial({ message: 'The billing provider is not available' })).toBe('external-activation-unavailable')
  })
  it('classifies ordinary-authorization-failure (Gate S8-A 403)', () => {
    expect(classifyDenial({ message: 'You are not authorized to manage this tenant subscription' })).toBe('ordinary-authorization-failure')
    expect(classifyDenial({ code: 'INSUFFICIENT_PERMISSIONS' })).toBe('ordinary-authorization-failure')
    expect(classifyDenial({ code: 'SUBSCRIPTION_MANAGEMENT_FORBIDDEN' })).toBe('ordinary-authorization-failure')
  })
  it('classifies network-or-server-failure', () => {
    expect(classifyDenial({ message: 'Failed to fetch' })).toBe('network-or-server-failure')
    expect(classifyDenial({ message: 'HTTP error! status: 500' })).toBe('network-or-server-failure')
  })
  it('falls back to ordinary-authorization-failure for unknown 4xx (never echoes raw text)', () => {
    expect(classifyDenial({ message: 'some weird internal db constraint detail' })).toBe('ordinary-authorization-failure')
  })
})

describe('parseEntitlementDenial — safe normalization', () => {
  it('parses a thrown Error message into a structured, safe denial', () => {
    const d = parseEntitlementDenial(new Error('You are not authorized to manage this tenant subscription'), { requestedOperation: 'cancel subscription', currentPlan: 'seller' })
    expect(d.category).toBe('ordinary-authorization-failure')
    expect(d.requestedOperation).toBe('cancel subscription')
    expect(d.currentPlan).toBe('seller')
    expect(d.retryable).toBe(false)
  })

  it('parses a raw backend error body { error: { code, message } }', () => {
    const d = parseEntitlementDenial({ success: false, error: { code: 'QUOTA_EXCEEDED', message: 'would exceed the 25 quota', timestamp: 'x', requestId: 'r' } }, { remaining: 0 })
    expect(d.category).toBe('quota-exhausted')
    expect(d.remaining).toBe(0)
    expect(d.upgradeEligible).toBe(true)
  })

  it('marks network/server failures retryable', () => {
    const d = parseEntitlementDenial(new Error('Failed to fetch'))
    expect(d.category).toBe('network-or-server-failure')
    expect(d.retryable).toBe(true)
  })

  it('re-normalizes an already-structured denial and keeps it safe', () => {
    const d = parseEntitlementDenial(buildDenial('feature-unavailable-on-plan', { requiredPlan: 'trade_pro' }))
    expect(d.category).toBe('feature-unavailable-on-plan')
    expect(d.requiredPlan).toBe('trade_pro')
    expect(d.upgradeEligible).toBe(true)
  })

  it('NEVER surfaces db details / stack traces / raw provider strings in the human message', () => {
    const leaky = new Error('PGRST116: duplicate key value violates unique constraint "diaspora_subscriptions_pkey" at tenant 7f3a-internal; provider secret sk_live_abc')
    const d = parseEntitlementDenial(leaky)
    expect(d.message).not.toMatch(/PGRST|constraint|sk_live|7f3a-internal|provider secret/i)
    // The safe message is one of our own category summaries.
    expect(d.message.length).toBeGreaterThan(0)
  })
})
