import { describe, expect, it } from 'vitest'
import {
  PAY03B_SANDBOX_PLAN_LABEL,
  PAY03B_SIMULATED_PROVIDER_LABEL,
  describePay03bAccessReason,
  describePay03bError,
  formatPay03bInterval,
  formatPay03bMinor,
  isPay03bSubscriptionChangeable,
  isPay03bSubscriptionLive,
  pay03bAllowedChangeModes,
  pay03bCommercialKind,
  pay03bCommercialLabel,
  pay03bProviderLabel,
  describePay03bTransitionCause,
  pay03bPlanBillableBy,
  pay03bRuntimeGateway,
} from './pay03bDisplay'

describe('formatPay03bMinor — minor units with the currency’s own scale', () => {
  it('JPY has no minor unit: 3000 minor is ¥3,000 (never ¥30.00)', () => {
    expect(formatPay03bMinor(3000, 'JPY')).toBe('¥3,000')
    expect(formatPay03bMinor(3000, 'JPY', 0)).toBe('¥3,000')
  })

  it('USD is scale 2; an explicit governed scale wins', () => {
    expect(formatPay03bMinor(1999, 'USD')).toBe('$19.99')
    expect(formatPay03bMinor(1999, 'usd', 2)).toBe('$19.99')
  })

  it('returns null (not a fake zero) when the amount or currency is missing', () => {
    expect(formatPay03bMinor(null, 'JPY')).toBeNull()
    expect(formatPay03bMinor(3000, null)).toBeNull()
    expect(formatPay03bMinor(Number.NaN, 'JPY')).toBeNull()
  })

  it('describes billing intervals', () => {
    expect(formatPay03bInterval('month', 1)).toBe('per month')
    expect(formatPay03bInterval('month', 3)).toBe('every 3 months')
    expect(formatPay03bInterval(null, 1)).toBeNull()
  })
})

describe('gateway compatibility (finding F-L2-01)', () => {
  it('maps the runtime provider mode to the gateway that bills a NEW checkout (mirrors the backend)', () => {
    expect(pay03bRuntimeGateway('local_simulator')).toBe('pay03b_local_provider_simulator')
    expect(pay03bRuntimeGateway('stripe_sandbox')).toBe('stripe_carup_japan_sandbox')
  })

  it('a plan is billable only by a gateway on its allowlist; unknown is not billable', () => {
    expect(pay03bPlanBillableBy({ providerAllowlist: ['stripe_carup_japan_sandbox'] }, 'stripe_carup_japan_sandbox')).toBe(true)
    expect(pay03bPlanBillableBy({ providerAllowlist: ['pay03b_local_provider_simulator'] }, 'stripe_carup_japan_sandbox')).toBe(false)
    expect(pay03bPlanBillableBy({ providerAllowlist: [] }, 'stripe_carup_japan_sandbox')).toBe(false)
    expect(pay03bPlanBillableBy({}, 'stripe_carup_japan_sandbox')).toBe(false)
    expect(pay03bPlanBillableBy({ providerAllowlist: ['stripe_carup_japan_sandbox'] }, null)).toBe(false)
  })
})

describe('lifecycle transition causes', () => {
  it('names each part of a compound cause, including the canonical payment outcome (finding F-L2-03)', () => {
    expect(describePay03bTransitionCause('invoice_paid:payment_refunded')).toBe('Invoice paid · payment refunded')
    expect(describePay03bTransitionCause('provider_snapshot:active')).toBe('Provider snapshot · active')
    expect(describePay03bTransitionCause('invoice_paid')).toBe('Invoice paid')
    expect(describePay03bTransitionCause(null)).toBe('—')
  })
})

describe('commercial classification is fail-closed', () => {
  it('only a free tier is "Free"; quotation is "Request a quote"; unpriced is "Not yet available"', () => {
    expect(pay03bCommercialLabel(pay03bCommercialKind({ pricingKind: 'free', commercialStatus: 'free' }))).toBe('Free')
    expect(pay03bCommercialLabel(pay03bCommercialKind({ pricingKind: 'contract_quotation', commercialStatus: 'request_quote' }))).toBe('Request a quote')
    expect(pay03bCommercialLabel(pay03bCommercialKind({ pricingKind: 'unpriced', commercialStatus: 'not_available' }))).toBe('Not yet available')
  })

  it('a sandbox fixture is always labelled as a sandbox test plan, never as an offer', () => {
    const kind = pay03bCommercialKind({ pricingKind: 'sandbox_fixture', commercialStatus: 'sandbox_test_only_not_a_commercial_offer' })
    expect(kind).toBe('sandbox')
    expect(pay03bCommercialLabel(kind)).toBe(PAY03B_SANDBOX_PLAN_LABEL)
    expect(PAY03B_SANDBOX_PLAN_LABEL).toBe('Sandbox test plan — not a commercial offer')
  })

  it('an unknown or "approved_tariff" kind is never presented as purchasable or free', () => {
    expect(pay03bCommercialKind({ pricingKind: 'approved_tariff', commercialStatus: 'whatever' })).toBe('not_available')
    expect(pay03bCommercialKind({ pricingKind: 'mystery', commercialStatus: 'free' })).toBe('not_available')
  })

  it('labels the simulated provider as not Stripe', () => {
    expect(pay03bProviderLabel({ simulated: true })).toBe(PAY03B_SIMULATED_PROVIDER_LABEL)
    expect(pay03bProviderLabel({ gateway: 'pay03b_local_provider_simulator' })).toBe('Simulated provider (local test) — not Stripe')
    expect(pay03bProviderLabel({ simulated: false, gateway: 'stripe_carup_japan_sandbox' })).toContain('Stripe sandbox')
  })
})

describe('access reasons and lifecycle', () => {
  it('explains the reconciliation hold exactly', () => {
    expect(describePay03bAccessReason('payment_reconciliation_hold')).toBe(
      'A payment on this subscription is under reconciliation; paid features are suspended until it is resolved.',
    )
    expect(describePay03bAccessReason('paid_through_after_period_end_cancellation')).toContain('paid-through date')
    expect(describePay03bAccessReason('some_new_reason')).toBe('Access decision: Some new reason.')
    expect(describePay03bAccessReason('provider_sync_exception')).toBe(
      'CarUp could not record an invoice from the provider; paid features are suspended until it is reconciled.',
    )
  })

  it('live vs changeable mirrors the database rules', () => {
    expect(isPay03bSubscriptionLive({ status: 'incomplete' })).toBe(true)
    expect(isPay03bSubscriptionLive({ status: 'cancelled' })).toBe(false)
    expect(isPay03bSubscriptionChangeable({ status: 'incomplete', providerSubscriptionId: 'sim_sub_1' })).toBe(false)
    expect(isPay03bSubscriptionChangeable({ status: 'active', providerSubscriptionId: null })).toBe(false)
    expect(isPay03bSubscriptionChangeable({ status: 'past_due', providerSubscriptionId: 'sim_sub_1' })).toBe(true)
  })

  it('allowed plan-change modes follow the CURRENT plan’s governed change policy', () => {
    const current = { tierRank: 10, changePolicy: { upgrade: 'period_end', downgrade: 'period_end', proration: 'none' } }
    expect(pay03bAllowedChangeModes(current, { tierRank: 20 })).toEqual(['period_end'])
    expect(pay03bAllowedChangeModes({ ...current, changePolicy: { upgrade: 'immediate_prorated', downgrade: 'not_allowed', proration: 'always_invoice' } }, { tierRank: 20 }))
      .toEqual(['period_end', 'immediate'])
    expect(pay03bAllowedChangeModes({ ...current, changePolicy: { upgrade: 'immediate_prorated', downgrade: 'not_allowed', proration: 'always_invoice' } }, { tierRank: 5 }))
      .toEqual([])
    expect(pay03bAllowedChangeModes(null, { tierRank: 20 })).toEqual([])
  })
})

describe('describePay03bError', () => {
  it('maps the documented codes to human messages', () => {
    expect(describePay03bError({ status: 400, code: 'PAY03B_TENANT_CONTEXT_REQUIRED', message: 'PAY03B_TENANT_CONTEXT_REQUIRED' }).message)
      .toBe('Select your dealership organization first.')
    expect(describePay03bError({ status: 503, data: { error: 'PAY03B_PAYMENT_METHOD_UPDATE_NOT_CONFIGURED' }, message: 'x' }).message)
      .toBe('Updating the payment method is not configured for this provider in this environment.')
  })

  it('keeps an unknown code visible with a safe fallback, and passes through non-code messages', () => {
    expect(describePay03bError({ code: 'PAY03B_SOMETHING_NEW' }, 'Fallback.')).toEqual({ code: 'PAY03B_SOMETHING_NEW', status: null, message: 'Fallback.' })
    expect(describePay03bError(new Error('Could not establish a secure session.'))).toMatchObject({ code: null, message: 'Could not establish a secure session.' })
    expect(describePay03bError({ code: 'PAY03B_OVERVIEW_RESPONSE_INVALID' }).message).toBe('The billing service returned an unexpected response.')
  })
})
