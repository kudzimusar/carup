/**
 * CarUp Intelligence 1.0 — I11 finance demand surface.
 *
 * The surface must never let a lender read a figure as more than it is: a failed
 * read must not look like an empty pipeline, sandbox activity must not look like
 * market demand, and the absent credit domain must be visibly absent rather than
 * quietly omitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import FinanceIntelligence from './FinanceIntelligence'

const fetchFinanceIntelligence = vi.fn()

/** Mutable so one test can present a hook that never exposes the fetcher. */
let hookValue: Record<string, unknown> = { fetchFinanceIntelligence }

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => hookValue,
}))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const base = {
  ok: true,
  scope: 'finance_commercial',
  availability: 'value',
  calculation_version: 'finance_demand@1',
  window_days: 30,
  provider_state: {
    active_lenders: value(0),
    live_market: false,
    note: 'No lender is onboarded, so no application can reach a live provider.',
  },
  application_demand: {
    applications_received: value(3),
    decisions_recorded: value(0),
    awaiting_decision: value(3),
    decision_rate: { availability: 'insufficient_data', reason: 'below_minimum' },
  },
  live_eligibility: { requests: value(0), eligible: value(0), not_eligible: value(0) },
  sandbox_activity: { requests: value(7), note: 'Simulated prequalification against a sandbox provider.' },
  not_measurable: [
    { key: 'disbursements', label: 'Disbursements', reason: 'no_disbursement_state', detail: 'CarUp records no disbursement anywhere.' },
    { key: 'portfolio_value', label: 'Portfolio value', reason: 'no_disbursement_state', detail: 'Without disbursements there is no portfolio.' },
  ],
  attribution: {
    basis: 'bank_id',
    unattributed_applications: null,
    note: 'You see applications routed to you. CarUp also holds applications that are attached to no lender, so this count is not a measure of total market demand.',
  },
  domain_boundary: 'Commercial demand only. Credit risk, underwriting and collateral are a separate governed domain.',
}

beforeEach(() => {
  // Block body: `mockReset()` returns the mock, and vitest treats a function
  // returned from beforeEach as a teardown callback.
  fetchFinanceIntelligence.mockReset()
  hookValue = { fetchFinanceIntelligence }
})

describe('a failed read is never an empty pipeline', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchFinanceIntelligence.mockRejectedValue(new Error('backend down'))
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('finance-applications')).toBeNull()
  })

  it('an unavailable envelope renders its reason, not counts', async () => {
    fetchFinanceIntelligence.mockResolvedValue({
      ok: true, availability: 'unavailable', message: 'Finance demand could not be read.',
    })
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-intelligence-unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable, not as empty', async () => {
    // Partially-stubbed useCarUpApi is common across this suite. An unreadable
    // API surface is an unreadable read, not a pipeline with nothing in it.
    hookValue = {}
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('finance-applications')).toBeNull()
  })
})

describe('sandbox activity is never market demand', () => {
  it('live and sandbox counts appear in separate blocks and are not summed', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-live-requests-value')).toHaveTextContent('0')
    expect(screen.getByTestId('finance-sandbox-requests')).toHaveTextContent('7')
    // 7 live requests would be the sum; it must appear nowhere in the live block.
    expect(screen.getByTestId('finance-eligibility')).not.toHaveTextContent('7')
  })

  it('the sandbox block says the activity is simulated', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-sandbox')).toHaveTextContent(/simulated/i)
  })
})

describe('an empty market is described rather than scored', () => {
  it('names why no decision can be recorded when no lender is onboarded', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-no-live-market')).toHaveTextContent(/no lender is onboarded/i)
  })

  it('shows a recorded-decision count of zero only alongside that explanation', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-decisions_recorded-value')).toHaveTextContent('0')
    expect(screen.getByTestId('finance-no-live-market')).toBeInTheDocument()
  })
})

describe('the absent credit domain is visible', () => {
  it('lists what is not measurable with its reason', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-missing-disbursements')).toHaveTextContent(/no disbursement/i)
    expect(screen.getByTestId('finance-missing-portfolio_value')).toBeInTheDocument()
    expect(screen.getByTestId('finance-not-measurable')).toHaveTextContent(/not zero/i)
  })

  it('says what the view cannot see, so a small count is not read as the whole market', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-attribution-note'))
      .toHaveTextContent(/not a measure of total market demand/i)
  })

  it('gives a platform reader the unattributed count a lender does not get', async () => {
    fetchFinanceIntelligence.mockResolvedValue({
      ...base,
      attribution: {
        basis: 'platform',
        unattributed_applications: value(4),
        note: 'Applications with no lender attached are counted here but appear in no lender view.',
      },
    })
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-attribution-note')).toHaveTextContent('4')
  })

  it('states the commercial boundary', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    expect(await screen.findByTestId('finance-domain-boundary')).toHaveTextContent(/separate governed domain/i)
  })
})

describe('an insufficient-data metric is not rendered as a number', () => {
  it('shows the qualifier rather than a count', async () => {
    fetchFinanceIntelligence.mockResolvedValue(base)
    render(<FinanceIntelligence />)
    const received = await screen.findByTestId('finance-applications_received-value')
    expect(received).toHaveTextContent('3')
    // decision_rate is insufficient_data and has no tile of its own, so no
    // percentage may be printed anywhere in the applications block.
    expect(screen.getByTestId('finance-applications')).not.toHaveTextContent('%')
  })
})
