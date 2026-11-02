import { describe, expect, it } from 'vitest'
import {
  CURRENCY_NAME, PAYNOW_METHOD_HINT, PAYNOW_METHOD_LABEL, PAYNOW_START_UNREACHABLE, PAYNOW_STATUS_SHORT, PROVIDER_ERROR_LABEL, needsPhone, pay05ErrorText,
  paynowOutcomeMessage, paynowStartFailure, paynowStateBadge, paynowStatusLine, phoneProblem, type PaynowStatus,
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

describe('A failed Paynow start (W3)', () => {
  const failure = (message: string, status?: number) => Object.assign(new Error(message), status === undefined ? {} : { status })
  it('only a definite 4xx refusal is definite; a lost answer, a 5xx or a 502 PAY05_PROVIDER_* may have sent the request', () => {
    expect(paynowStartFailure(new TypeError('Failed to fetch'))).toEqual({ text: PAYNOW_START_UNREACHABLE, definite: false })
    expect(paynowStartFailure(failure('Load failed')).definite).toBe(false)
    expect(paynowStartFailure(failure('PAY05_PROVIDER_REFUSED', 502))).toEqual({ text: pay05ErrorText('PAY05_PROVIDER_REFUSED'), definite: false })
    expect(paynowStartFailure(failure('PAY05_PROVIDER_RESPONSE_UNEXPECTED', 502)).definite).toBe(false)
    expect(paynowStartFailure(failure('HTTP error! status: 504', 504))).toMatchObject({ definite: false, text: expect.stringMatching(/may still have been sent/) })
    expect(paynowStartFailure(failure('PAY05_METHOD_NOT_AVAILABLE', 422))).toMatchObject({ definite: true, text: expect.stringMatching(/Nothing was charged/) })
    expect(paynowStartFailure(failure('PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE', 409)).definite).toBe(true)
    expect(paynowStartFailure(failure('Too many requests', 429))).toEqual({ text: 'The payment could not be started. Nothing was charged.', definite: true })
  })
  it('never shows a raw transport message, and keeps the key when nothing says the request was refused', () => {
    expect(paynowStartFailure(failure('HTTP error! status: 500', 500)).text).not.toMatch(/HTTP error/)
    const csrf = paynowStartFailure(failure('Could not establish a secure session. Please refresh the page and try again.'))
    expect(csrf).toEqual({ text: 'Could not establish a secure session. Please refresh the page and try again.', definite: false })
  })
})

describe('Tone and words follow the collection state, never the applied Paynow status alone (W5)', () => {
  const STATUSES: Array<PaynowStatus | null> = [null, 'created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed', 'refunded', 'unrecognized']
  const NOT_COUNTED = [null, 'awaiting_provider', 'stopping', 'stopped', 'expired', 'confirmed_unallocated', 'under_review', 'refund_pending', 'refunded',
    'partially_refunded', 'cancelled', 'unknown']
  it('green and "Paid" only when the state is confirmed', () => {
    expect(paynowStateBadge('confirmed', 'paid').tone).toMatch(/green/)
    expect(paynowStateBadge('confirmed', 'paid').label).toMatch(/^Paid/)
    for (const state of NOT_COUNTED) {
      for (const status of STATUSES) {
        const badge = paynowStateBadge(state, status)
        expect(badge.tone, `${state}/${status}`).not.toMatch(/green/)
        expect(badge.label, `${state}/${status}`).not.toMatch(/^Paid/)
      }
    }
  })
  it('under review says so, then what Paynow reported in words', () => {
    expect(paynowStateBadge('under_review', 'paid').label).toBe('Under review — not counted')
    expect(paynowStatusLine('under_review', view({ provider_status: 'paid', provider_status_label: 'Paid — confirmed by Paynow' })))
      .toBe('Under review — not counted. Paynow reports it paid.')
    expect(paynowStatusLine('under_review', view({ provider_status: null }))).toBe('Under review — not counted.')
    expect(paynowStatusLine('confirmed_unallocated', view({ provider_status: 'paid' }))).toMatch(/^Under review — not counted\./)
  })
  it('a paid status CarUp did not count is never worded as paid', () => {
    const line = paynowStatusLine('awaiting_provider', view({ provider_status: 'paid', provider_status_label: 'Paid — confirmed by Paynow' }))
    expect(line).not.toMatch(/^Paid/)
    expect(line).toMatch(/not counted/)
    expect(paynowStatusLine('awaiting_provider', view())).toBe('Waiting for you to approve the payment on your phone')
  })
})
