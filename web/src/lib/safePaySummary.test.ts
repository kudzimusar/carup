import { describe, expect, it } from 'vitest'
import { SAFEPAY_TERMINAL_STATUSES, readSafePaySessions } from './safePaySummary'

/**
 * CARUP-MVP-STAB-01 F-024 — the Owner Dashboard SafePay card read `amount` / `currency`, a shape
 * `/api/safepay/list` has not returned since Issue #164 Phase 6, so every owner saw $0; and it called
 * every session "active", settled and cancelled ones included. These rows are the LIVE public
 * projection (`toPublicMarketplaceEscrowSession`).
 */
const session = (status: string, listing_amount: number | null, listing_currency: string | null = 'USD') => ({
  transaction_intent_id: `tx-${status}-${listing_amount}`,
  vin: 'TESTVINSAFEPAY001',
  status,
  listing_amount,
  listing_currency,
  gate_reasons: [],
  payment_state: 'not_started',
  reservation_state: null,
  deposit_eligibility: null,
  created_at: '2026-10-20T00:00:00.000Z',
  updated_at: '2026-10-20T00:00:00.000Z',
})

describe('SafePay sessions as the dashboard may state them (F-024)', () => {
  it('a successful empty read is "no purchases yet", not a zero total', () => {
    expect(readSafePaySessions([])).toEqual({ state: 'empty' })
  })

  it('anything other than a session list is a failed read, never an empty one', () => {
    for (const body of [null, undefined, {}, { sessions: [] }, 'oops', 42]) {
      expect(readSafePaySessions(body)).toEqual({ state: 'error' })
    }
  })

  it('sums listing_amount per listing_currency over in-progress sessions only', () => {
    const summary = readSafePaySessions([
      session('initiated', 1200),
      session('funds_held', 800),
      session('settled', 5000),
      session('cancelled', 9000),
    ])
    expect(summary).toEqual({
      state: 'ready',
      total: 4,
      inProgress: 2,
      closed: 2,
      totals: [{ currency: 'USD', amount: 2000 }],
      unpriced: 0,
    })
  })

  it('never adds one currency to another', () => {
    const summary = readSafePaySessions([
      session('initiated', 1200, 'USD'),
      session('eligible', 1500000, 'JPY'),
      session('inspection_pending', 300, 'usd'),
    ])
    expect(summary.state === 'ready' && summary.totals).toEqual([
      { currency: 'USD', amount: 1500 },
      { currency: 'JPY', amount: 1500000 },
    ])
  })

  it('a session without a recorded price is counted but never priced as 0', () => {
    const summary = readSafePaySessions([session('initiated', null), session('eligible', 700, null)])
    expect(summary).toMatchObject({ state: 'ready', inProgress: 2, totals: [], unpriced: 2 })
  })

  it('uses the terminal set the native SafePay screen uses', () => {
    expect([...SAFEPAY_TERMINAL_STATUSES].sort()).toEqual(
      ['cancelled', 'failed', 'refunded', 'refunded_sandbox', 'released_sandbox', 'settled'],
    )
    const closedOnly = readSafePaySessions([...SAFEPAY_TERMINAL_STATUSES].map((status) => session(status, 100)))
    expect(closedOnly).toMatchObject({ state: 'ready', inProgress: 0, closed: 6, totals: [] })
  })
})
