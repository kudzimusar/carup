/**
 * CarUp Intelligence 1.0 — I14 referral surface.
 *
 * The surface must not let a reader conclude that the referral counts describe
 * the whole shared event table, nor that accrued benefit value is money any
 * referrer has received.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReferralIntelligence from './ReferralIntelligence'

const fetchReferralIntelligence = vi.fn()
let hookValue: Record<string, unknown> = { fetchReferralIntelligence }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const base = {
  ok: true,
  scope: 'platform',
  availability: 'value',
  calculation_version: 'referral_performance@1',
  window_days: 30,
  inventory: { active_codes: value(64), active_campaigns: value(57), draft_campaigns: value(1) },
  activity: {
    referral_events: value(235),
    codes_created: value(64),
    validations: value(170),
    failed_validations: value(1),
    validation_success_rate: { availability: 'value', value: 99.4, unit: 'percent' },
    coupons_applied: value(23),
    coupons_redeemed: value(8),
    by_type: { 'referral.code_validated': 170 },
    excluded_from_this_count: {
      other_domain_events: 928,
      note: 'The referral event table is shared with the trust, agent, AI-marketing and marketplace domains. Only referral-domain events are counted above.',
    },
  },
  channels: {
    by_channel: { web: 877, whatsapp: 102, telegram: 61 },
    by_source: { marketplace: 52 },
    source_coverage: { recorded: 87, total: 1163, note: 'Most events record no source. The source breakdown describes only the events that carry one and is not a picture of the whole.' },
  },
  rewards: {
    transactions_recorded: value(62),
    paid_out: value(0),
    awaiting_settlement: value(62),
    by_status: { pending: 53, held: 9 },
    accrued_amounts: { by_currency: { USD: { total: 620, count: 62 } }, currencies: 1, unpriced_records: 0, note: 'x' },
    paid_amounts: { by_currency: {}, currencies: 0, unpriced_records: 0, note: 'No reward has been paid.' },
    note: 'No referral reward has been paid. The accrued figures are value promised, not value delivered.',
  },
  attributed_outcomes: {
    inquiries_total: value(59),
    inquiries_with_a_referral_code: value(22),
    inquiries_with_a_campaign_code: value(8),
    referral_attribution_rate: { availability: 'value', value: 37.3, unit: 'percent' },
    note: 'An inquiry is the furthest a referral can be followed. CarUp records no sale against a referral code, so nothing here is a conversion to a completed transaction.',
  },
  not_measurable: [
    { key: 'campaign_roi', label: 'Campaign ROI', reason: 'no_cost_recorded', detail: 'No campaign, code or promotion table records a budget, spend or cost.' },
    { key: 'reward_payout', label: 'Rewards paid', reason: 'no_settled_wallet_transaction', detail: 'Every referral wallet transaction is pending or held.' },
  ],
  domain_boundary: 'Referral activity and accrued reward value only. No figure here is a return on spend.',
}

beforeEach(() => {
  fetchReferralIntelligence.mockReset()
  hookValue = { fetchReferralIntelligence }
})

describe('the shared event log is not presented as referral activity', () => {
  it('says how many events from other domains were excluded', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-exclusion-note')).toHaveTextContent(/928 events from other domains/i)
    expect(screen.getByTestId('referral-exclusion-note')).toHaveTextContent(/shared/i)
  })

  it('shows the referral count, not the table total', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-activity-referral_events-value')).toHaveTextContent('235')
    expect(screen.getByTestId('referral-activity-grid')).not.toHaveTextContent('1163')
  })
})

describe('accrued is never presented as paid', () => {
  it('shows an empty paid block with its own wording', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-paid-none')).toHaveTextContent(/nothing has been paid/i)
    expect(screen.getByTestId('referral-accrued-USD')).toHaveTextContent('620 USD')
    expect(screen.getByTestId('referral-reward-note')).toHaveTextContent(/value promised, not value delivered/i)
  })

  it('reports nothing paid out', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-rewards-paid_out-value')).toHaveTextContent('0')
  })
})

describe('coverage and boundaries stay visible', () => {
  it('states how few events carry a source', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-source-coverage')).toHaveTextContent(/87 of 1163/)
  })

  it('says an attributed inquiry is not a completed sale', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-outcome-note')).toHaveTextContent(/records no sale/i)
  })

  it('lists ROI as not measurable', async () => {
    fetchReferralIntelligence.mockResolvedValue(base)
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-missing-campaign_roi')).toHaveTextContent(/budget, spend or cost/i)
    expect(screen.getByTestId('referral-domain-boundary')).toHaveTextContent(/no figure here is a return on spend/i)
  })
})

describe('a failed read is never a zero', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchReferralIntelligence.mockRejectedValue(new Error('down'))
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('referral-activity-grid')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<ReferralIntelligence />)
    expect(await screen.findByTestId('referral-intelligence-message')).toHaveTextContent(/NOT zero/i)
  })
})
