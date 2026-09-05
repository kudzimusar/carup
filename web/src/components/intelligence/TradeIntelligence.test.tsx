/**
 * CarUp Intelligence 1.0 — I13 trade demand surface.
 *
 * Everything here is demand or intent, and the surface must not let any of it
 * read as a completed transaction: a scheduled milestone is not money received, a
 * sandbox settlement is not a settlement, and amounts in different currencies are
 * never shown as one total.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TradeIntelligence from './TradeIntelligence'

const fetchTradeIntelligence = vi.fn()

let hookValue: Record<string, unknown> = { fetchTradeIntelligence }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const base = {
  ok: true,
  scope: 'platform',
  availability: 'value',
  calculation_version: 'trade_demand@1',
  window_days: 30,
  corridor_demand: {
    corridors: [{ corridor: 'Japan → Zimbabwe', orders: 91 }],
    distinct_corridors: 1,
    unspecified_corridor: 0,
    note: 'Every recorded order uses a single corridor. This is the whole of the observed market, not the top of a ranking.',
  },
  order_funnel: {
    orders_created: value(91),
    cancelled: value(16),
    by_status: { IMPORT_REQUESTED: 47, SELLER_ASSIGNED: 26, CANCELLED: 16 },
    by_order_type: { vehicle: 62, parts: 29 },
  },
  quote_activity: {
    quotes_issued: value(26),
    quotes_accepted: value(26),
    orders_with_a_quote: value(26),
    orders_awaiting_a_quote: value(65),
    acceptance_rate: { availability: 'value', value: 100, unit: 'percent' },
    quoted_amounts: { by_currency: { USD: { total: 156000, count: 26 } }, currencies: 1, unpriced_records: 0, note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.' },
  },
  requested_budgets: { by_currency: { USD: { total: 455000, count: 91 } }, currencies: 1, unpriced_records: 0, note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.' },
  payment_milestones: {
    milestones_scheduled: value(107),
    milestones_confirmed: value(0),
    awaiting_confirmation: value(107),
    confirmation_rate: { availability: 'value', value: 0, unit: 'percent' },
    scheduled_amounts: { by_currency: { USD: { total: 107000, count: 107 } }, currencies: 1, unpriced_records: 0, note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.' },
    note: 'No milestone has been confirmed. The scheduled amounts below are what was agreed, not money received.',
  },
  escrow: {
    sessions_opened: value(27),
    live: { sessions: value(0), settled: value(0) },
    sandbox: { sessions: value(11), settled: value(8), note: 'Simulated escrow against a sandbox provider. These are never combined with live activity and are not trade value.' },
    no_payment_started: value(16),
    live_market: false,
    note: 'No escrow session has used a live payment provider, so no settlement here represents money that moved.',
  },
  not_measurable: [
    { key: 'settled_trade_value', label: 'Settled trade value', reason: 'no_confirmed_payment', detail: 'No payment milestone has ever been confirmed.' },
    { key: 'shipment_demand', label: 'Shipment and container demand', reason: 'no_shipment_records', detail: 'Every shipment, container and cargo-reservation table is empty.' },
  ],
  domain_boundary: 'Trade demand and its funnel only. No figure here represents money that moved.',
}

beforeEach(() => {
  fetchTradeIntelligence.mockReset()
  hookValue = { fetchTradeIntelligence }
})

describe('nothing reads as money that moved', () => {
  it('says the scheduled milestone amounts are not money received', async () => {
    fetchTradeIntelligence.mockResolvedValue(base)
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-milestone-note')).toHaveTextContent(/not money received/i)
    expect(screen.getByTestId('trade-milestones-milestones_confirmed-value')).toHaveTextContent('0')
  })

  it('keeps live and sandbox escrow in separate blocks with no combined total', async () => {
    fetchTradeIntelligence.mockResolvedValue(base)
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-escrow-live-settled')).toHaveTextContent('0')
    expect(screen.getByTestId('trade-escrow-sandbox-settled')).toHaveTextContent('8')
    // 8 must never appear as the live figure.
    expect(screen.getByTestId('trade-escrow-live')).not.toHaveTextContent('8')
    expect(screen.getByTestId('trade-escrow-note')).toHaveTextContent(/no settlement here represents money that moved/i)
  })

  it('states the domain boundary', async () => {
    fetchTradeIntelligence.mockResolvedValue(base)
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-domain-boundary')).toHaveTextContent(/money that moved/i)
  })
})

describe('currencies are never combined', () => {
  it('renders each currency on its own line with no total', async () => {
    fetchTradeIntelligence.mockResolvedValue({
      ...base,
      requested_budgets: {
        by_currency: { USD: { total: 300, count: 2 }, ZAR: { total: 5000, count: 1 } },
        currencies: 2,
        unpriced_records: 0,
        note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.',
      },
    })
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-budgets-USD')).toHaveTextContent('300 USD')
    expect(screen.getByTestId('trade-budgets-ZAR')).toHaveTextContent('5,000 ZAR')
    expect(screen.getByTestId('trade-budgets-fx-note')).toHaveTextContent(/no exchange rate/i)
    // 5300 is the cross-currency sum and must appear nowhere.
    expect(screen.getByTestId('trade-budgets')).not.toHaveTextContent('5300')
    expect(screen.getByTestId('trade-budgets')).not.toHaveTextContent('5,300')
  })

  it('discloses records with no recorded amount rather than counting them as zero', async () => {
    fetchTradeIntelligence.mockResolvedValue({
      ...base,
      requested_budgets: { by_currency: { USD: { total: 100, count: 1 } }, currencies: 1, unpriced_records: 3, note: 'x' },
    })
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-budgets-unpriced')).toHaveTextContent(/3 records with no recorded amount/i)
  })
})

describe('a one-corridor market is described honestly', () => {
  it('says a single corridor is the whole market, not a ranking leader', async () => {
    fetchTradeIntelligence.mockResolvedValue(base)
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-corridor-note')).toHaveTextContent(/whole of the observed market/i)
  })

  it('carries no whole-market claim when several corridors exist', async () => {
    fetchTradeIntelligence.mockResolvedValue({
      ...base,
      corridor_demand: {
        corridors: [{ corridor: 'Japan → Zimbabwe', orders: 5 }, { corridor: 'UK → Zimbabwe', orders: 2 }],
        distinct_corridors: 2, unspecified_corridor: 1, note: null,
      },
    })
    render(<TradeIntelligence />)
    await screen.findByTestId('trade-corridors')
    expect(screen.queryByTestId('trade-corridor-note')).toBeNull()
    expect(screen.getByTestId('trade-corridor-unspecified')).toHaveTextContent(/1 request/i)
  })
})

describe('a failed read is never a zero', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchTradeIntelligence.mockRejectedValue(new Error('down'))
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('trade-orders-grid')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-intelligence-message')).toHaveTextContent(/NOT zero/i)
  })
})

describe('what CarUp cannot measure stays visible', () => {
  it('lists settled trade value and shipment demand with their reasons', async () => {
    fetchTradeIntelligence.mockResolvedValue(base)
    render(<TradeIntelligence />)
    expect(await screen.findByTestId('trade-missing-settled_trade_value')).toHaveTextContent(/has ever been confirmed/i)
    expect(screen.getByTestId('trade-missing-shipment_demand')).toHaveTextContent(/empty/i)
    expect(screen.getByTestId('trade-not-measurable')).toHaveTextContent(/not zero/i)
  })
})
