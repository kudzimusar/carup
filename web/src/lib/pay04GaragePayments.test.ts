import { describe, expect, it } from 'vitest'
import { minorToMajor, onlineAmountProblem, pay04ErrorText, paymentStatusLabel, returnOutcomeMessage, type CollectionOutcome } from './pay04GaragePayments'

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
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'unpaid', money: money('0.00', '0.00', '50.00') }))
      .toBe('Not paid yet — money is with the provider (in progress or under review) and not counted')
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

describe('PAY-04 review: wording that never overstates', () => {
  it('an unexpected payment status is "unavailable", never "Partly paid"', () => {
    expect(paymentStatusLabel({ status: 'issued', payment_status: 'mystery' as never, money: money('0.00', '10.00') })).toBe('Payment status unavailable')
  })

  it('a checkout the provider has not yet confirmed closed is never "nothing was charged"', () => {
    for (const state of ['stopping', 'expired']) {
      const m = returnOutcomeMessage(outcome(state), false)
      expect(m.tone, state).toBe('wait')
      expect(m.text, state).toMatch(/confirming with the provider/)
      expect(m.text, state).not.toMatch(/[Nn]othing was charged/)
    }
    for (const state of ['stopped', 'cancelled']) {
      expect(returnOutcomeMessage(outcome(state), false).text, state).toMatch(/provider confirmed nothing was charged/)
    }
  })

  it('PAY-04 refusals reach people as sentences, never raw codes', () => {
    for (const code of ['PAY04_AMOUNT_INVALID', 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE', 'PAY04_IDEMPOTENCY_CONFLICT',
      'PAY04_PROVIDER_REFUND_REFUSED', 'PAY04_PROVIDER_CANCEL_UNAVAILABLE', 'PAY04_COLLECTION_NOT_CANCELLABLE', 'PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE',
      'PAY04_RESOLUTION_SELF_DEALING_REFUSED', 'PAY04_SOMETHING_NOT_YET_NAMED']) {
      const t = pay04ErrorText(code)
      expect(t, code).not.toMatch(/PAY04_/)
      expect(t.length, code).toBeGreaterThan(20)
    }
    expect(pay04ErrorText('PAY04_PROVIDER_REFUND_REFUSED')).toMatch(/refused/)
    expect(pay04ErrorText('Only a garage administrator can do that.')).toBe('Only a garage administrator can do that.')
  })

  it('an online amount is checked, in the currency’s own precision, before anything is sent', () => {
    expect(onlineAmountProblem('100.00', '150.00', 'USD')).toBeNull()
    expect(onlineAmountProblem('150', '150.00', 'USD')).toBeNull()
    expect(onlineAmountProblem('-5', '150.00', 'USD')).toMatch(/amount/)
    expect(onlineAmountProblem('abc', '150.00', 'USD')).toMatch(/amount/)
    expect(onlineAmountProblem('10.555', '150.00', 'USD')).toMatch(/amount/)
    expect(onlineAmountProblem('0', '150.00', 'USD')).toMatch(/more than zero/)
    expect(onlineAmountProblem('150.01', '150.00', 'USD')).toMatch(/150\.00/)
    expect(onlineAmountProblem('1500.5', '2000', 'JPY')).toMatch(/amount/)
  })
})
