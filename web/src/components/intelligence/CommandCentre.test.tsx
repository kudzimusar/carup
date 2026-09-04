/**
 * CarUp Intelligence 1.0 — I16 command centre surface.
 *
 * This is the page read as "the state of the platform", so three states must stay
 * visibly distinct: a real figure, a section that could not be read, and a section
 * that has no source at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CommandCentre from './CommandCentre'

const fetchCommandCentre = vi.fn()
let hookValue: Record<string, unknown> = { fetchCommandCentre }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const value = (n: number) => ({ availability: 'value', value: n, unit: 'count' })

const base = {
  ok: true,
  scope: 'platform',
  availability: 'value',
  calculation_version: 'command_centre@1',
  window_days: 30,
  sections: {
    overview: {
      available: true,
      source: 'users, organizations',
      metrics: { users_total: value(117), organizations_total: value(5) },
    },
    supply: {
      available: true,
      source: 'vehicles',
      metrics: { vehicles_total: value(38), vehicles_published: value(35) },
    },
    demand: {
      available: true,
      source: 'marketplace_inquiries, marketplace_activity_events, saved_vehicles',
      metrics: {
        inquiries: value(59),
        saved_vehicles: value(4),
        behavioural_events: { availability: 'insufficient_data', reason: 'ledger_instrumented_but_empty', value: null },
      },
      note: 'The activity ledger is instrumented but holds no events for this period. That is not an absence of interest — it is an absence of recorded events.',
    },
    trust_evidence: {
      available: true,
      source: 'vehicle_evidence',
      metrics: { evidence_reviewed: value(19), evidence_awaiting_review: value(1) },
      trust_authority: 'Trust positions are stated only by the canonical trust service. No Trust distribution is aggregated on this surface.',
    },
    communications: {
      available: true,
      source: 'message_threads, messages',
      metrics: { threads: value(80), messages: value(197) },
      authority: 'Communications remains the authority on conversation state. These are volume counts only.',
    },
    transactions: {
      available: true,
      source: 'escrow_trust_sessions',
      metrics: { sessions_opened: value(27), live_settlements: value(0), sandbox_settlements: value(8) },
      note: 'No session used a live payment provider, so no settlement here represents money that moved.',
    },
    risk: {
      available: true,
      source: 'insurance_claims',
      metrics: { claims_recorded: value(2) },
      boundary: 'Volume only. Fraud and underwriting adjudication are a separate governed domain and no risk verdict is issued here.',
    },
  },
  verticals: [
    { key: 'insurance', label: 'Insurance demand', endpoint: '/api/insurance/demand-intelligence', phase: 'I10' },
    { key: 'finance', label: 'Finance demand', endpoint: '/api/finance/demand-intelligence', phase: 'I11' },
  ],
  sections_without_a_source: [
    { key: 'revenue', label: 'Revenue', reason: 'no_revenue_record', detail: 'CarUp records no completed payment.' },
    { key: 'platform_health', label: 'Platform health', reason: 'no_health_measurement', detail: 'No uptime, latency or error-rate measurement is collected.' },
  ],
  composition_note: 'Each vertical is answered by its own governed projection and is linked rather than restated here.',
}

beforeEach(() => {
  fetchCommandCentre.mockReset()
  hookValue = { fetchCommandCentre }
})

describe('three states stay distinct', () => {
  it('renders a real figure with its source', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-overview-users_total-value')).toHaveTextContent('117')
    expect(screen.getByTestId('command-overview-source')).toHaveTextContent('users, organizations')
  })

  it('marks an unreadable section without showing a zero', async () => {
    fetchCommandCentre.mockResolvedValue({
      ...base,
      sections: {
        ...base.sections,
        supply: { available: false, unreadable: true, source: 'vehicles', reason: 'vehicles unavailable', note: 'This section could not be read. Its figures are NOT zero.' },
      },
    })
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-section-supply-unreadable')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('command-supply-vehicles_total-value')).toBeNull()
    // The rest of the page still answers.
    expect(screen.getByTestId('command-overview-users_total-value')).toHaveTextContent('117')
  })

  it('lists the sections that have no source at all', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-missing-revenue')).toHaveTextContent(/no completed payment/i)
    expect(screen.getByTestId('command-missing-platform_health')).toHaveTextContent(/no uptime, latency or error-rate/i)
    expect(screen.getByTestId('command-no-source')).toHaveTextContent(/absent, not zero/i)
  })
})

describe('an empty ledger is not an absence of interest', () => {
  it('renders the behavioural count as a qualifier rather than zero', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    const cell = await screen.findByTestId('command-demand-behavioural_events-value')
    expect(cell).not.toHaveTextContent('0')
    expect(screen.getByTestId('command-demand-note')).toHaveTextContent(/absence of recorded events/i)
    // The real inquiry count is still shown.
    expect(screen.getByTestId('command-demand-inquiries-value')).toHaveTextContent('59')
  })
})

describe('authorities are not usurped', () => {
  it('says Trust is stated only by the canonical service', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-trust_evidence-authority'))
      .toHaveTextContent(/canonical trust service/i)
  })

  it('links each vertical rather than restating it', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-vertical-insurance')).toHaveTextContent('/api/insurance/demand-intelligence')
    expect(screen.getByTestId('command-verticals')).toHaveTextContent(/linked rather than restated/i)
  })

  it('keeps sandbox settlements out of the live figure', async () => {
    fetchCommandCentre.mockResolvedValue(base)
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-transactions-live_settlements-value')).toHaveTextContent('0')
    expect(screen.getByTestId('command-transactions-sandbox_settlements-value')).toHaveTextContent('8')
    expect(screen.getByTestId('command-transactions-note')).toHaveTextContent(/money that moved/i)
  })
})

describe('a failed read is never a zero', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchCommandCentre.mockRejectedValue(new Error('down'))
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-centre-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('command-section-overview')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<CommandCentre />)
    expect(await screen.findByTestId('command-centre-message')).toHaveTextContent(/NOT zero/i)
  })
})
