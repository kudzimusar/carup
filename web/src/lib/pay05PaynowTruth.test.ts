/**
 * CARUP-PAY-05-R1 — the words a person reads about a Paynow payment. Each case is one of the independent certification's web
 * findings, inverted: ICR-W1, W2, W3, W4, W9, W10, W11 and W14.
 */
import {
  paynowContinuable, paynowErrorText, paynowOtpFailure, paynowOutcomeMessage, paynowStateBadge, paynowStatusLine, pay05ErrorText,
  type PaynowOutcome, type PaynowView,
} from './pay05Paynow'
import { ONLINE_PAYMENT_REASON_LABEL, PROVIDER_EVENT_LABEL, PROVIDER_STATE_TONE, activityActor, paymentStatusLabel, type ProviderPaymentState } from './pay04GaragePayments'

const view = (over: Partial<PaynowView> = {}): PaynowView => ({
  method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone', checkout_url: null,
  instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false, phone: '077*****11',
  hold_released: false, ...over,
})
const outcome = (state: string, over: Partial<PaynowView>): PaynowOutcome => ({
  collection: { state } as never, applied: false, refused: null, duplicate_event: false, payment_status: null, money: {} as never, paynow: view(over),
})
const MONEY_WORDS = ['awaiting_delivery', 'delivered', 'paid', 'disputed'] as const
const NOT_COUNTED_STATES = ['awaiting_provider', 'at_paynow', 'stopping', 'expired', 'released', 'settled_outside', 'not_counted', 'closed_not_counted',
  'stopped', 'cancelled', 'under_review', 'confirmed_unallocated', 'refunded', 'reviewed_held', 'no_longer_needed', 'closed_live', 'confirmed_partial']

describe('ICR-W3: "Paid" is said only when the money counts', () => {
  for (const state of NOT_COUNTED_STATES) {
    it(`state ${state} with Paynow's Paid never reads as confirmed`, () => {
      const m = paynowOutcomeMessage(outcome(state, { provider_status: 'paid', provider_status_label: 'Paynow reports it paid' }), false)
      expect(m.tone).not.toBe('ok')
      expect(m.text).not.toMatch(/confirmed|^paid —/i)
      expect(paynowStatusLine(state, view({ provider_status: 'paid', provider_status_label: 'Paynow reports it paid' }))).not.toMatch(/confirmed by paynow|^paid —/i)
      expect(paynowStateBadge(state, 'paid').label).not.toMatch(/^paid —/i)
    })
  }
  it('counted money says so', () => {
    expect(paynowOutcomeMessage(outcome('confirmed', { provider_status: 'paid' }), false)).toEqual({ tone: 'ok', text: expect.stringMatching(/counts on the invoice/) })
    expect(paynowStateBadge('confirmed', 'paid').label).toBe('Paid — counted on the invoice')
  })
})

describe('The pre-final review: each state says what is true, and a closed review is not an open one', () => {
  it('PFR-L4: a word from a review that has closed does not say "until the review ends"', () => {
    for (const state of ['reviewed_held', 'not_counted', 'settled_outside', 'closed_not_counted']) {
      for (const status of ['disputed', 'unrecognized', 'cancelled'] as const) {
        expect(paynowOutcomeMessage(outcome(state, { provider_status: status }), false).text, `${state}/${status}`).not.toMatch(/until the review ends/)
      }
    }
  })
  it('PFR-L4: "nothing was charged" is said only of a closed request Paynow took no money on', () => {
    for (const state of ['refunded', 'reviewed_held', 'not_counted', 'closed_not_counted', 'closed_live', 'no_longer_needed', 'under_review', 'settled_outside']) {
      expect(paynowOutcomeMessage(outcome(state, { provider_status: 'cancelled' }), false).text, state).not.toMatch(/nothing was charged/i)
      expect(paynowStatusLine(state, view({ provider_status: 'cancelled', provider_status_label: 'From the server' }), 'garage'), state).not.toMatch(/nothing was charged/i)
    }
    expect(paynowOutcomeMessage(outcome('stopped', { provider_status: 'cancelled' }), false).text).toMatch(/nothing was charged/i)
    expect(paynowOutcomeMessage(outcome('refunded', { provider_status: 'cancelled' }), false).text).toMatch(/refunded/i)
  })
  it('PFR-H2: reviewed and held: not counted, reserved, and no invitation to complete it', () => {
    const m = paynowOutcomeMessage(outcome('reviewed_held', { provider_status: 'cancelled' }), false)
    expect(m.tone).toBe('warn')
    expect(m.text).toMatch(/does not count it/)
    expect(m.text).toMatch(/stays reserved/)
    expect(paynowStateBadge('reviewed_held', 'cancelled').label).toBe('Reviewed — not counted')
    expect(paynowStatusLine('reviewed_held', view({ provider_status: 'cancelled' }), 'garage')).toMatch(/does not count it/)
    expect(paynowContinuable('reviewed_held', view({ provider_status: 'sent' }))).toBe(false)
  })
  it('PFR-H4: a request the invoice no longer needs is not one to complete', () => {
    const m = paynowOutcomeMessage(outcome('no_longer_needed', { provider_status: 'sent' }), false)
    expect(m.text).toMatch(/do not complete/i)
    expect(paynowStateBadge('no_longer_needed', 'sent').label).toBe('No longer needed')
    expect(paynowStatusLine('no_longer_needed', view({ provider_status: 'sent' }), 'garage')).not.toMatch(/waiting/i)
    expect(paynowContinuable('no_longer_needed', view({ provider_status: 'sent', needs_otp: true }))).toBe(false)
  })
  it('PFR-M5: a closed request never reads as waiting, for anyone', () => {
    for (const state of ['stopped', 'cancelled', 'closed_live']) {
      for (const status of [null, 'created', 'sent'] as const) {
        const line = paynowStatusLine(state, view({ provider_status: status, provider_status_label: 'From the server' }), 'garage')
        expect(line, `${state}/${status}`).not.toMatch(/waiting/i)
        expect(paynowContinuable(state, view({ provider_status: status, needs_otp: true })), `${state}/${status}`).toBe(false)
      }
    }
    expect(paynowOutcomeMessage(outcome('closed_live', { provider_status: null }), false).text).toMatch(/do not approve/i)
    expect(paynowStateBadge('closed_live', null).label).toBe('Closed — Paynow may still have it')
  })
  it('PFR-L3: part counted says part', () => {
    const m = paynowOutcomeMessage(outcome('confirmed_partial', { provider_status: 'paid' }), false)
    expect(m.tone).toBe('warn')
    expect(m.text).toMatch(/part of it counts/i)
    expect(paynowStateBadge('confirmed_partial', 'paid').label).toBe('Part counted — the rest under review')
    expect(paynowStatusLine('confirmed_partial', view({ provider_status: 'paid' }), 'garage')).toMatch(/part of it counts/i)
  })
  it('every state has a tone', () => {
    for (const state of ['reviewed_held', 'no_longer_needed', 'closed_live', 'confirmed_partial'] as ProviderPaymentState[]) expect(PROVIDER_STATE_TONE[state]).toBeTruthy()
  })
  it('the operator\'s review refusals have words', () => {
    for (const code of ['PAY05_REVIEW_NOT_OPENABLE', 'PAY05_REVIEW_AUTHORITY_REFUSED', 'PAY05_REVIEW_SELF_DEALING_REFUSED']) expect(pay05ErrorText(code)).not.toMatch(/did not go through/)
  })
})

describe('ICR-W1: never "nothing was paid or charged" while Paynow reports money', () => {
  for (const status of MONEY_WORDS) {
    for (const state of NOT_COUNTED_STATES) {
      it(`${status} in state ${state}`, () => {
        const said = [
          paynowOutcomeMessage(outcome(state, { provider_status: status, provider_status_label: 'x' }), false).text,
          paynowStatusLine(state, view({ provider_status: status, provider_status_label: 'x' })),
          paynowStatusLine(state, view({ provider_status: status, provider_status_label: 'x' }), 'garage'),
        ]
        for (const words of said) expect(words).not.toMatch(/nothing (was|is) (paid|charged)/i)
      })
    }
  }
})

describe('ICR-W2: a released or settled request is not waiting for anyone', () => {
  for (const flags of [{ hold_released: true }, { hold_released: true, settled_outside: true }] as Array<Partial<PaynowView>>) {
    for (const status of ['created', 'sent', null] as const) {
      it(`${JSON.stringify(flags)} ${status}`, () => {
        const v = view({ ...flags, provider_status: status })
        for (const state of ['released', 'settled_outside', 'expired', null]) {
          expect(paynowContinuable(state, v)).toBe(false)
          for (const audience of ['customer', 'garage'] as const) {
            expect(paynowStatusLine(state, v, audience)).not.toMatch(/waiting for|still counts|approve the payment/i)
          }
        }
      })
    }
  }
  it('the outcome of checking a released request says not to approve it', () => {
    const m = paynowOutcomeMessage(outcome('released', { hold_released: true }), false)
    expect(m.text).toMatch(/do not approve/i)
    expect(m.text).not.toMatch(/still counts/i)
  })
})

describe('ICR-W7: while the amount stays reserved, the request can still be continued', () => {
  for (const state of ['awaiting_provider', 'expired', 'stopping']) {
    it(`state ${state}`, () => {
      expect(paynowContinuable(state, view({ method: 'innbucks', authorization_code: 'ABC123' }))).toBe(true)
      expect(paynowContinuable(state, view({ method: 'omari', needs_otp: true }))).toBe(true)
      expect(paynowContinuable(state, view({ method: 'web', provider_status: 'created', checkout_url: 'https://x' }))).toBe(true)
    })
  }
  it('not once the money is reported or the request is over', () => {
    for (const state of ['at_paynow', 'under_review', 'confirmed', 'not_counted', 'refunded', 'cancelled', 'stopped']) {
      expect(paynowContinuable(state, view())).toBe(false)
    }
    expect(paynowContinuable('expired', view({ provider_status: 'delivered' }))).toBe(false)
  })
})

describe('ICR-W4: a lost answer to an O’mari code is never "nothing changed"', () => {
  const failure = (code: string, status: number) => Object.assign(new Error(code), { status, code })
  for (const [code, status] of [['PAY05_PROVIDER_UNREACHABLE', 504], ['PAY05_PROVIDER_HTTP_ERROR', 502], ['PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED', 502],
    ['PAY05_PROVIDER_MESSAGE_MALFORMED', 502], ['PAY05_OPERATION_UNAVAILABLE', 503]] as const) {
    it(code, () => {
      const said = paynowOtpFailure(failure(code, status))
      expect(said.definite).toBe(false)
      expect(said.text).toMatch(/may have taken the payment/i)
      expect(said.text).toMatch(/check this payment’s status before entering the code again/i)
      expect(said.text).not.toMatch(/nothing (was )?changed|try again\.?$/i)
    })
  }
  it('a dropped connection never shows the browser’s words', () => {
    const said = paynowOtpFailure(new TypeError('Failed to fetch'))
    expect(said.definite).toBe(false)
    expect(said.text).not.toMatch(/failed to fetch/i)
    expect(said.text).toMatch(/before entering the code again/i)
  })
  it('Paynow’s own refusal of a code is definite', () => {
    expect(paynowOtpFailure(failure('PAY05_OTP_REJECTED', 422))).toEqual({ definite: true, text: expect.stringMatching(/did not accept that code/) })
    expect(paynowOtpFailure(failure('PAY05_OTP_INVALID', 422)).definite).toBe(true)
  })
})

describe('ICR-W11: no raw code or browser error reaches a person', () => {
  it('an unknown PAY-05 code reads as words and promises nothing about the money', () => {
    const text = pay05ErrorText('PAY05_SOMETHING_NEW') ?? ''
    expect(text).not.toMatch(/PAY05_/)
    expect(text).not.toMatch(/nothing (was )?changed/i)
  })
  it('a network failure uses the fallback words', () => {
    expect(paynowErrorText(new TypeError('Failed to fetch'), 'The fallback.')).toBe('The fallback.')
  })
  it('R1’s refusals have words', () => {
    for (const code of ['PAY05_INTEGRATION_NOT_ACCEPTED', 'PAY05_CONNECT_PROBE_UNAVAILABLE', 'PAY05_EARLIER_REQUEST_UNRESOLVED', 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER',
      'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER', 'PAY05_CURRENCY_EVIDENCE_MISMATCH', 'PAY05_STATUS_UPDATE_UNCONFIRMED', 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_TRACE']) {
      expect(pay05ErrorText(code)).not.toMatch(/did not go through/)
    }
  })
  it('the refusal of an already-taken integration says nothing about who holds it', () => {
    expect(pay05ErrorText('PAY05_INTEGRATION_NOT_ACCEPTED')).not.toMatch(/another|already|in use|connected/i)
  })
})

describe('ICR-W14: what CarUp does not know is said as not known', () => {
  it('an unconfirmed request is not called confirming', () => {
    const line = paynowStatusLine(null, view({ initiation: 'unknown', provider_status: null, provider_status_label: 'x' }), 'garage')
    expect(line).toMatch(/has not confirmed/i)
    expect(line).not.toMatch(/nothing was charged/i)
  })
})

describe('ICR-W9, W10: PAY-04 words on Paynow rows', () => {
  it('an invoice with a Paynow request only awaiting approval does not say money is with the provider', () => {
    const label = paymentStatusLabel({ payment_status: 'unpaid', status: 'issued',
      money: { declared_paid: '0.00', provider_paid: '0.00', provider_reserved: '20.00', uncommitted_balance: '0.00' },
      provider_payments: [{ gateway: 'paynow_zimbabwe' } as never] } as never)
    expect(label).not.toMatch(/money is with/i)
    expect(label).toMatch(/not counted/)
  })
  it('PAY-04 rows keep PAY-04’s words', () => {
    expect(paymentStatusLabel({ payment_status: 'unpaid', status: 'issued',
      money: { declared_paid: '0.00', provider_paid: '0.00', provider_reserved: '20.00', uncommitted_balance: '0.00' },
      provider_payments: [{ gateway: 'pay04_garage_provider_simulator' } as never] } as never)).toMatch(/money is with the provider/)
  })
  it('activity reads as words', () => {
    expect(PROVIDER_EVENT_LABEL.hold_released).toMatch(/released/i)
    expect(activityActor('system:expiry')).toBe('CarUp')
    expect(activityActor('provider:paynow_zimbabwe')).toBe('Payment provider')
  })
  it('every new state has a tone and every reason has words', () => {
    for (const state of ['at_paynow', 'released', 'settled_outside', 'not_counted', 'closed_not_counted'] as ProviderPaymentState[]) expect(PROVIDER_STATE_TONE[state]).toBeTruthy()
    expect(ONLINE_PAYMENT_REASON_LABEL.earlier_request_unresolved).toMatch(/earlier/i)
  })
})
