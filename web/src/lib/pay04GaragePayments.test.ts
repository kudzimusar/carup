import { describe, expect, it } from 'vitest'
import { minorToMajor, paymentStatusLabel, returnOutcomeMessage, type CollectionOutcome } from './pay04GaragePayments'

const money = (declared: string, provider: string, reserved = '0.00') => ({
  declared_paid: declared, provider_paid: provider, provider_reserved: reserved, uncommitted_balance: '0.00',
})
const outcome = (state: string): CollectionOutcome => ({
  collection: { id: 'c1', amount: '10.00', currency: 'USD', initiated_at: '', expires_at: '', cancelled_at: null, state: state as never,
    state_label: `label:${state}`, payment_status: null, gateway: 'g', simulated: true, source_label: '' },
  applied: true, refused: null, duplicate_event: false, payment_status: null,
  money: {} as CollectionOutcome['money'],
})

describe('PAY-04 payment status wording', () => {
  it('keeps the OPS07 meaning while every counted payment was recorded by the garage', () => {
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'paid', money: money('100.00', '0.00') })).toBe('Paid in full (recorded by the garage)')
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'partially_paid' })).toBe('Partly paid (recorded by the garage)')
  })

  it('names the provider when provider-confirmed money counts — never "recorded by the garage" alone', () => {
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'paid', money: money('0.00', '100.00') })).toBe('Paid in full (confirmed by the garage’s payment provider)')
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'partially_paid', money: money('20.00', '30.00') }))
      .toBe('Partly paid (recorded by the garage and confirmed by its payment provider)')
  })

  it('money in flight is never paid', () => {
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'unpaid', money: money('0.00', '0.00', '50.00') })).toBe('Not paid yet — a payment is in progress')
    expect(paymentStatusLabel({ status: 'voided', payment_status: 'voided' })).toBe('Voided')
  })
})

describe('PAY-04 return-from-provider wording', () => {
  it('claims success only for a provider-confirmed, counted payment', () => {
    expect(returnOutcomeMessage(outcome('confirmed'), false).tone).toBe('ok')
    for (const state of ['awaiting_provider', 'under_review', 'confirmed_unallocated', 'stopped', 'expired', 'cancelled', 'refund_pending', 'refunded']) {
      const m = returnOutcomeMessage(outcome(state), false)
      expect(m.tone, state).not.toBe('ok')
      expect(m.text, state).not.toMatch(/confirmed your payment/)
    }
  })

  it('a failed check is an error that says nothing is paid, not a quiet success', () => {
    const m = returnOutcomeMessage(null, true)
    expect(m.tone).toBe('error')
    expect(m.text).toMatch(/Nothing is shown as paid/)
  })
})

describe('PAY-04 minor units', () => {
  it('uses each currency’s own precision', () => {
    expect(minorToMajor(12050, 'USD')).toBe('120.50 USD')
    expect(minorToMajor(500, 'JPY')).toBe('500 JPY')
  })
})
