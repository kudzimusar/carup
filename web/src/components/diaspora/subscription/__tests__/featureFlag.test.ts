import { describe, it, expect, vi, afterEach } from 'vitest'
import { subscriptionUiEnabled, SANDBOX_BILLING_NOTICE } from '@/config/subscriptionFlag'

describe('subscriptionUiEnabled feature flag (fail closed)', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is OFF by default (anything other than the string "true")', () => {
    vi.stubEnv('VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED', '')
    expect(subscriptionUiEnabled()).toBe(false)
    vi.stubEnv('VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED', 'false')
    expect(subscriptionUiEnabled()).toBe(false)
    vi.stubEnv('VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED', '1')
    expect(subscriptionUiEnabled()).toBe(false)
  })

  it('is ON only for the exact string "true"', () => {
    vi.stubEnv('VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED', 'true')
    expect(subscriptionUiEnabled()).toBe(true)
  })
})

describe('sandbox truthfulness wording', () => {
  it('never claims a real charge / live activation / refund / invoice', () => {
    expect(SANDBOX_BILLING_NOTICE).toContain('sandbox mode')
    expect(SANDBOX_BILLING_NOTICE).toContain('No real payment is collected')
    expect(SANDBOX_BILLING_NOTICE).not.toMatch(/payment succeeded|card charged|live subscription activated|refund issued|invoice settled/i)
  })
})
