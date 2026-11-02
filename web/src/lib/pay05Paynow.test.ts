import { describe, expect, it } from 'vitest'
import {
  CURRENCY_NAME, PAYNOW_METHOD_HINT, PAYNOW_METHOD_LABEL, PAYNOW_STATUS_SHORT, PROVIDER_ERROR_LABEL, needsPhone, pay05ErrorText, paynowOutcomeMessage, phoneProblem,
  type PaynowOutcome, type PaynowView,
} from './pay05Paynow'

/** CARUP-PAY-05 — the words people read about a Paynow payment. Truth rules, not snapshots. */
const view = (over: Partial<PaynowView> = {}): PaynowView => ({
  method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone',
  checkout_url: null, instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false,
  phone: '077*****11', hold_released: false, ...over,
})
const outcome = (state: string, paynow: Partial<PaynowView>): PaynowOutcome => ({
  collection: { state } as never, applied: true, refused: null, duplicate_event: false, payment_status: null, money: {} as never, paynow: view(paynow),
})

describe('Paynow outcome words', () => {
  it('says paid only when Paynow said Paid AND CarUp counted it', () => {
    expect(paynowOutcomeMessage(outcome('confirmed', { provider_status: 'paid' }), false).tone).toBe('ok')
    expect(paynowOutcomeMessage(outcome('awaiting_provider', { provider_status: 'paid' }), false).tone).not.toBe('ok')
    expect(paynowOutcomeMessage(outcome('confirmed', { provider_status: 'awaiting_delivery' }), false).tone).not.toBe('ok')
  })
  it('names escrow as Paynow holding the money, not as paid', () => {
    for (const status of ['awaiting_delivery', 'delivered'] as const) {
      const m = paynowOutcomeMessage(outcome('awaiting_provider', { provider_status: status }), false)
      expect(m.tone).toBe('wait')
      expect(m.text).toMatch(/held by Paynow/)
      expect(m.text).toMatch(/not yet counted/)
    }
  })
  it('a dispute or an unrecognised status is a review; a lost request is "checking", never "nothing was charged"', () => {
    expect(paynowOutcomeMessage(outcome('under_review', { provider_status: 'disputed' }), false).tone).toBe('warn')
    expect(paynowOutcomeMessage(outcome('awaiting_provider', { provider_status: 'unrecognized' }), false).tone).toBe('warn')
    const lost = paynowOutcomeMessage(outcome('awaiting_provider', { provider_status: null, initiation: 'unknown' }), false)
    expect(lost.tone).toBe('wait')
    expect(lost.text).not.toMatch(/nothing was charged/i)
    expect(paynowOutcomeMessage(null, true).tone).toBe('error')
  })
})

describe('Paynow inputs and labels', () => {
  it('accepts Zimbabwe mobile numbers as Paynow documents them and refuses others', () => {
    for (const ok of ['0771234567', '+263 77 123 4567', '263711234567', '073-123-4567']) expect(phoneProblem(ok)).toBeNull()
    for (const bad of ['', '077123456', '0701234567', '+27771234567', '0871234567']) expect(phoneProblem(bad)).not.toBeNull()
  })
  it('asks for a phone for every express method (EcoCash, OneMoney, InnBucks, O’mari), never for Paynow’s own page', () => {
    expect((['web', 'ecocash', 'onemoney', 'innbucks', 'omari'] as const).filter(needsPhone)).toEqual(['ecocash', 'onemoney', 'innbucks', 'omari'])
    expect(PAYNOW_METHOD_HINT.innbucks).toMatch(/mobile number/)
  })
  it('never uses ZIG as a currency code', () => {
    expect(Object.keys(CURRENCY_NAME)).toEqual(['USD', 'ZWG'])
    expect(CURRENCY_NAME.ZWG).toMatch(/ISO ZWG/)
  })
  it('turns refusals into sentences that say nothing was charged where that is true', () => {
    expect(pay05ErrorText('PAY05_PROVIDER_REFUSED')).toMatch(/Nothing was charged/)
    expect(pay05ErrorText('PAY05_PROVIDER_REFUND_UNSUPPORTED')).toMatch(/Paynow dashboard/)
    expect(pay05ErrorText('PAY05_SOMETHING_NEW')).toMatch(/Nothing was changed/)
    expect(pay05ErrorText('PAY04_AMOUNT_INVALID')).toBeNull()
  })
  it('labels every method, status and provider-error kind', () => {
    expect(Object.keys(PAYNOW_METHOD_LABEL).sort()).toEqual(['ecocash', 'innbucks', 'omari', 'onemoney', 'web'])
    expect(Object.keys(PAYNOW_STATUS_SHORT)).toHaveLength(10)
    expect(PAYNOW_STATUS_SHORT.awaiting_delivery).toBe('Held by Paynow')
    expect(Object.keys(PROVIDER_ERROR_LABEL)).toContain('callback_signature_invalid')
  })
})
