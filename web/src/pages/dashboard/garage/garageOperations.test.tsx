import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchGarageOperationsSummary = vi.fn()
const fetchGarageInvoices = vi.fn()
const fetchGarageQueue = vi.fn()
let activeTenantRole = 'admin'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', active_tenant: { type: 'garage', role: activeTenantRole } } }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageOperationsSummary, fetchGarageInvoices, fetchGarageQueue }),
}))

const { default: GarageOperations } = await import('./GarageOperations')
const { default: GarageWorkspace } = await import('./GarageWorkspace')

const PAYMENT_LABEL = 'Recorded by the garage. CarUp has not processed or verified these payments.'
const NOTE = 'Invoiced amounts are documents, and recorded payments are the garage’s own declarations. Neither is revenue.'
const NO_SHOW_REASON = 'Fewer than 5 cases so far (3); a rate would not mean anything yet.'
const CYCLE_REASON = 'No job completed in this window has both an accepted and a completed time.'

function summaryFor(days: 7 | 30 | 90, over: Record<string, unknown> = {}) {
  return {
    window_days: days,
    window: { from: '2026-09-24T00:00:00.000Z', to: '2026-10-24T00:00:00.000Z' },
    generated_at: '2026-10-24T00:00:00.000Z',
    truncated: false,
    work: {
      open_cases: { requested: 2, accepted: 1, active: 3, definition: 'Service cases currently in that status (not limited to the window).' },
      completed_jobs: { value: 4, definition: 'Service cases completed inside the window.' },
      cycle_time: { state: 'not_measured', reason: CYCLE_REASON, definition: 'Accepted to completed.' },
      by_site: [
        { branch_id: 'b1', name: 'Central', open: 2, completed_in_window: 3 },
        { branch_id: null, name: null, open: 1, completed_in_window: 0 },
      ],
      by_mechanic: [
        { user_id: 'm1', name: 'Tendai', completed_jobs: 3, attribution: 'assigned_mechanic' },
        { user_id: null, name: null, completed_jobs: 1, attribution: 'no_assignment_recorded' },
      ],
      repeat_customers: { state: 'measured', repeat: 2, identified: 7, definition: 'Customers with more than one service case with this garage.' },
    },
    appointments: {
      by_status: {},
      upcoming_confirmed: { value: 5, definition: 'Confirmed appointments that have not started yet.' },
      no_show_rate: { state: 'not_measured', reason: NO_SHOW_REASON, numerator: 1, denominator: 3, definition: 'No-shows divided by fulfilled plus no-shows.' },
    },
    estimates: {
      by_status: {},
      sent_in_window: { value: 6, definition: 'Estimate versions sent to a customer inside the window.' },
      approval_rate: { state: 'measured', rate: 62.5, unit: 'percent', numerator: 5, denominator: 8, definition: 'Accepted divided by accepted plus declined.' },
    },
    money: {
      invoiced_by_currency: [
        { currency: 'USD', total: '1200.00', invoices: 3 },
        { currency: 'ZWG', total: '45000.00', invoices: 2 },
      ],
      outstanding_by_currency: [
        { currency: 'USD', balance: '300.00', definition: 'Live invoice totals minus the payments the garage recorded.' },
        { currency: 'ZWG', balance: '1000.00', definition: 'Live invoice totals minus the payments the garage recorded.' },
      ],
      recorded_payments_by_currency: [
        { currency: 'USD', net_recorded: '900.00', source: 'garage_recorded_external', label: PAYMENT_LABEL },
      ],
      estimate_vs_invoice: {
        by_currency: [{ currency: 'USD', jobs: 2, estimate_total: '800.00', invoice_total: '850.00', difference: '+50.00' }],
        not_comparable: 1,
        definition: 'Invoiced total against the accepted estimate it replaced, per currency.',
      },
      note: NOTE,
    },
    parts: {
      used_in_window: [{ part_name: 'Brake pad set', sku: 'BP-1', quantity: 4 }],
      stock_alerts: { total: 9, out: 1, low: 2, uncounted: 3, unknown: 5 },
      definition: 'Units used on jobs, net of reversals.',
    },
    not_measured: [
      { key: 'revenue', reason: 'Revenue is an accounting judgement. CarUp does not know what the garage has earned.' },
      { key: 'profit', reason: 'No governed cost record exists, so no profit can be stated.' },
      { key: 'bay_capacity_utilisation', reason: 'There is no worked-time model.' },
      { key: 'conversion_rate', reason: 'Enquiries are not linked to outcomes.' },
      { key: 'forecast', reason: 'A forecast is a model, not a measurement; none is defined.' },
    ],
    ...over,
  }
}

const invoiceList = {
  truncated: false,
  invoices: [
    {
      id: 'i1', invoice_number: 'INV-0001', service_case_id: 'case-1', work_order_id: 'wo-1', status: 'issued', currency: 'USD',
      total_amount: '500.00', line_count: 2, customer_note: null, due_date: null, issued_at: '2026-10-10T08:00:00Z', voided_at: null,
      estimate: null, variance: { state: 'no_estimate' }, payment_status: 'partially_paid', paid_amount: '200.00', balance_amount: '300.00',
      payment_source_label: 'Recorded by the garage. CarUp has not processed or verified this payment.', lines: [], payments: [], receipts: [],
    },
    {
      id: 'i2', invoice_number: 'INV-0002', service_case_id: 'case-2', work_order_id: 'wo-2', status: 'issued', currency: 'ZWG',
      total_amount: '45000.00', line_count: 1, customer_note: null, due_date: null, issued_at: '2026-10-12T08:00:00Z', voided_at: null,
      estimate: null, variance: { state: 'no_estimate' }, payment_status: 'unpaid', paid_amount: '0.00', balance_amount: '45000.00',
      payment_source_label: 'Recorded by the garage. CarUp has not processed or verified this payment.', lines: [], payments: [], receipts: [],
    },
  ],
  summary: {
    issued: 2, unpaid: 1, partially_paid: 1, paid: 0,
    outstanding_by_currency: [{ currency: 'USD', balance: '300.00' }, { currency: 'ZWG', balance: '45000.00' }],
  },
}

function renderPage() {
  return render(<MemoryRouter><GarageOperations /></MemoryRouter>)
}

async function ready() {
  renderPage()
  await screen.findByTestId('ops-section-work')
  await screen.findByTestId('invoice-list')
}

beforeEach(() => {
  vi.clearAllMocks()
  activeTenantRole = 'admin'
  fetchGarageOperationsSummary.mockImplementation(async (days: 7 | 30 | 90) => structuredClone(summaryFor(days)))
  fetchGarageInvoices.mockImplementation(async () => structuredClone(invoiceList))
})

describe('GARAGE-1.0 operations: who sees it', () => {
  it('is the garage administrator\'s view: a mechanic gets an explanation and nothing is requested', async () => {
    activeTenantRole = 'mechanic'
    renderPage()
    expect(await screen.findByTestId('operations-admin-only')).toBeInTheDocument()
    expect(fetchGarageOperationsSummary).not.toHaveBeenCalled()
    expect(fetchGarageInvoices).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ops-section-work')).toBeNull()
  })
})

describe('GARAGE-1.0 operations: the window', () => {
  it('starts on 30 days and refetches for 7 and 90', async () => {
    await ready()
    expect(fetchGarageOperationsSummary).toHaveBeenCalledTimes(1)
    expect(fetchGarageOperationsSummary).toHaveBeenLastCalledWith(30)
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(fetchGarageOperationsSummary).toHaveBeenLastCalledWith(7))
    expect(await screen.findByTestId('operations-window-dates')).toHaveTextContent(/^7 days/)
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }))
    await waitFor(() => expect(fetchGarageOperationsSummary).toHaveBeenLastCalledWith(90))
    expect(await screen.findByTestId('operations-window-dates')).toHaveTextContent(/^90 days/)
    expect(fetchGarageOperationsSummary).toHaveBeenCalledTimes(3)
  })

  it('does not leave one window\'s numbers on screen while another loads', async () => {
    await ready()
    let release: (v: unknown) => void = () => {}
    fetchGarageOperationsSummary.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(screen.queryByTestId('ops-section-work')).toBeNull())
    expect(screen.getByText(/Loading the last 7 days/)).toBeInTheDocument()
    release(summaryFor(7))
    expect(await screen.findByTestId('ops-section-work')).toBeInTheDocument()
  })

  it('reports a failed read as a loading problem, not as a quiet workshop', async () => {
    fetchGarageOperationsSummary.mockRejectedValue(new Error('summary unavailable'))
    renderPage()
    const card = await screen.findByTestId('operations-load-error')
    expect(card).toHaveTextContent('summary unavailable')
    expect(card).toHaveTextContent(/loading problem/i)
    expect(screen.queryByTestId('ops-section-work')).toBeNull()
  })

  it('says the view covers the most recent records only when the server says it was truncated', async () => {
    fetchGarageOperationsSummary.mockImplementation(async (days: 7 | 30 | 90) => summaryFor(days, { truncated: true }))
    await ready()
    expect(screen.getByTestId('operations-truncated')).toHaveTextContent(/most recent records only/i)
  })

  it('does not claim truncation when the server did not', async () => {
    await ready()
    expect(screen.queryByTestId('operations-truncated')).toBeNull()
  })
})

describe('GARAGE-1.0 operations: not measured is not zero', () => {
  it('shows a not-measured rate as its reason, with no number, no percentage and no 0', async () => {
    await ready()
    const rate = screen.getByTestId('metric-no-show-rate')
    expect(rate).toHaveTextContent('Not measured')
    expect(rate).toHaveTextContent(NO_SHOW_REASON)
    expect(rate.textContent).not.toMatch(/%/)
    expect(rate.textContent).not.toMatch(/1 of 3/)
    expect(rate.textContent).not.toMatch(/\b0\b/)
  })

  it('shows a not-measured cycle time as its reason alone', async () => {
    await ready()
    const cycle = screen.getByTestId('metric-cycle-time')
    expect(within(cycle).getByTestId('not-measured-value')).toHaveTextContent(CYCLE_REASON)
    expect(cycle.textContent).not.toMatch(/hours/)
    expect(cycle.textContent).not.toMatch(/\d/)
  })

  it('shows a measured rate with its numerator and denominator', async () => {
    await ready()
    const rate = screen.getByTestId('metric-approval-rate')
    expect(rate).toHaveTextContent('62.5%')
    expect(rate).toHaveTextContent('5 of 8')
    expect(within(rate).queryByTestId('not-measured-value')).toBeNull()
  })

  it('lists every not-measured entry with its reason', async () => {
    await ready()
    const section = screen.getByTestId('ops-section-not-measured')
    const entries = within(section).getAllByTestId('not-measured-entry')
    expect(entries).toHaveLength(5)
    expect(section).toHaveTextContent('Revenue is an accounting judgement. CarUp does not know what the garage has earned.')
    expect(section).toHaveTextContent('There is no worked-time model.')
    expect(entries[2]).toHaveTextContent('bay capacity utilisation')
    for (const entry of entries) expect(entry.textContent!.length).toBeGreaterThan(20)
  })
})

describe('GARAGE-1.0 operations: money', () => {
  it('shows one line per currency and never a combined figure', async () => {
    await ready()
    expect(screen.getByTestId('invoiced-USD')).toHaveTextContent('1200.00 USD')
    expect(screen.getByTestId('invoiced-ZWG')).toHaveTextContent('45000.00 ZWG')
    expect(screen.getByTestId('outstanding-USD')).toHaveTextContent('300.00 USD')
    expect(screen.getByTestId('outstanding-ZWG')).toHaveTextContent('1000.00 ZWG')
    expect(screen.getByTestId('variance-USD')).toHaveTextContent('850.00 USD')
    expect(screen.getByTestId('variance-USD')).toHaveTextContent('+50.00 USD')
    const money = screen.getByTestId('ops-section-money').textContent!
    expect(money).not.toMatch(/46200|46,200/)
    expect(within(screen.getByTestId('money-invoiced')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the server\'s note and the unverified-payments label exactly as stated', async () => {
    await ready()
    expect(screen.getByTestId('money-note')).toHaveTextContent('Neither is revenue.')
    expect(screen.getByTestId('money-note')).toHaveTextContent(NOTE)
    const payments = screen.getByTestId('recorded-USD')
    expect(payments).toHaveTextContent('900.00 USD')
    expect(payments).toHaveTextContent(PAYMENT_LABEL)
  })

  it('says what could not be compared instead of comparing across currencies', async () => {
    await ready()
    expect(screen.getByTestId('money-estimate-vs-invoice')).toHaveTextContent(/1 job was not compared/i)
  })

  it('states an empty currency list as empty, not as a zero amount', async () => {
    fetchGarageOperationsSummary.mockImplementation(async (days: 7 | 30 | 90) => {
      const base = summaryFor(days)
      return { ...base, money: { ...base.money, invoiced_by_currency: [], outstanding_by_currency: [], recorded_payments_by_currency: [] } }
    })
    await ready()
    expect(screen.getByTestId('money-invoiced')).toHaveTextContent('No invoices were issued in this window.')
    expect(screen.getByTestId('money-recorded-payments')).toHaveTextContent('The garage recorded no payments in this window.')
    expect(screen.getByTestId('money-outstanding').textContent).not.toMatch(/\b0(\.00)?\b/)
  })
})

describe('GARAGE-1.0 operations: honest labelling', () => {
  it('never labels a figure revenue, profit, conversion, utilisation or forecast (outside the server\'s own note and the not-measured list)', async () => {
    await ready()
    const clone = document.body.cloneNode(true) as HTMLElement
    clone.querySelector('[data-testid="ops-section-not-measured"]')?.remove()
    clone.querySelector('[data-testid="money-note"]')?.remove()
    expect(clone.textContent).not.toMatch(/revenue|profit|conversion|utilisation|utilization|forecast/i)
  })

  it('offers each metric\'s own definition', async () => {
    await ready()
    expect(screen.getAllByText('How this is counted').length).toBeGreaterThanOrEqual(8)
    expect(screen.getByText('Service cases currently in that status (not limited to the window).')).toBeInTheDocument()
    expect(screen.getByText('Confirmed appointments that have not started yet.')).toBeInTheDocument()
    expect(screen.getByText('Accepted divided by accepted plus declined.')).toBeInTheDocument()
    expect(screen.getByText('Units used on jobs, net of reversals.')).toBeInTheDocument()
  })
})

describe('GARAGE-1.0 operations: work, appointments, estimates, parts', () => {
  it('shows the server\'s counts by site and by mechanic, with what is not recorded said plainly', async () => {
    await ready()
    expect(screen.getByTestId('metric-open-cases')).toHaveTextContent('2 requested')
    expect(screen.getByTestId('metric-open-cases')).toHaveTextContent('3 in progress')
    expect(screen.getByTestId('metric-completed-jobs')).toHaveTextContent('4')
    expect(screen.getByTestId('metric-repeat-customers')).toHaveTextContent('2 of 7 customers')
    expect(screen.getByTestId('work-by-site')).toHaveTextContent('Central')
    expect(screen.getByTestId('work-by-site')).toHaveTextContent('No site recorded')
    expect(screen.getByTestId('work-by-mechanic')).toHaveTextContent('Tendai')
    expect(screen.getByTestId('work-by-mechanic')).toHaveTextContent('No mechanic assignment recorded')
    expect(screen.getByTestId('metric-upcoming-appointments')).toHaveTextContent('5')
    expect(screen.getByTestId('metric-estimates-sent')).toHaveTextContent('6')
  })

  it('shows parts used and the stock alerts, and links to the stock page', async () => {
    await ready()
    expect(screen.getByTestId('parts-used')).toHaveTextContent('Brake pad set')
    expect(screen.getByTestId('parts-used')).toHaveTextContent('4 used')
    expect(screen.getByTestId('alert-out')).toHaveTextContent('1')
    expect(screen.getByTestId('alert-low')).toHaveTextContent('2')
    expect(screen.getByTestId('alert-uncounted')).toHaveTextContent('3')
    expect(screen.getByTestId('alert-unknown')).toHaveTextContent('5')
    expect(within(screen.getByTestId('parts-stock-alerts')).getByRole('link', { name: 'Open parts and stock' })).toHaveAttribute('href', '/garage/stock')
  })
})

describe('GARAGE-1.0 operations: invoices', () => {
  it('lists invoices, each linking to its service case, with the server\'s payment state', async () => {
    await ready()
    const rows = screen.getAllByTestId('invoice-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('href', '/garage/cases/case-1')
    expect(rows[1]).toHaveAttribute('href', '/garage/cases/case-2')
    expect(rows[0]).toHaveTextContent('INV-0001')
    expect(rows[0]).toHaveTextContent('500.00 USD')
    expect(rows[0]).toHaveTextContent('Partly paid (recorded by the garage)')
    expect(rows[0]).toHaveTextContent('Recorded payments 200.00 USD, balance 300.00 USD')
    expect(rows[0]).toHaveTextContent('CarUp has not processed or verified this payment')
    expect(rows[1]).toHaveTextContent('45000.00 ZWG')
    expect(rows[1]).toHaveTextContent('No payment recorded')
    expect(rows[1]).not.toHaveTextContent(/Recorded payments/)
    expect(rows[1]).not.toHaveTextContent(/processed or verified/)
  })

  it('shows the server\'s summary counts and outstanding balance per currency', async () => {
    await ready()
    expect(screen.getByTestId('invoice-count-issued')).toHaveTextContent('2')
    expect(screen.getByTestId('invoice-count-unpaid')).toHaveTextContent('1')
    expect(screen.getByTestId('invoice-count-partial')).toHaveTextContent('1')
    expect(screen.getByTestId('invoice-count-paid')).toHaveTextContent('0')
    const outstanding = screen.getByTestId('invoice-outstanding')
    expect(outstanding).toHaveTextContent('300.00 USD')
    expect(outstanding).toHaveTextContent('45000.00 ZWG')
    expect(screen.getByTestId('invoice-source-label')).toHaveTextContent('CarUp has not processed or verified')
  })

  it('refetches with the status filter', async () => {
    await ready()
    expect(fetchGarageInvoices).toHaveBeenCalledTimes(1)
    expect(fetchGarageInvoices.mock.calls[0][0]).toBeUndefined()
    fireEvent.change(screen.getByLabelText('Invoice status'), { target: { value: 'voided' } })
    await waitFor(() => expect(fetchGarageInvoices).toHaveBeenLastCalledWith('voided'))
    fireEvent.change(screen.getByLabelText('Invoice status'), { target: { value: 'issued' } })
    await waitFor(() => expect(fetchGarageInvoices).toHaveBeenLastCalledWith('issued'))
  })

  it('says plainly when the invoice list is truncated, and that its counts are for the list only', async () => {
    fetchGarageInvoices.mockImplementation(async () => ({ ...structuredClone(invoiceList), truncated: true }))
    await ready()
    const notice = screen.getByTestId('invoices-truncated')
    expect(notice).toHaveTextContent('most recent 200 invoices')
    expect(notice).toHaveTextContent(/may be partial/i)
    expect(notice).toHaveTextContent(/counts below are for the invoices in this list only/i)
    // the invoices themselves are still shown
    expect(screen.getAllByTestId('invoice-row')).toHaveLength(2)
  })

  it('shows no truncation notice when the server did not truncate the list', async () => {
    await ready()
    expect(screen.queryByTestId('invoices-truncated')).toBeNull()
    expect(screen.getByTestId('ops-section-invoices').textContent).not.toMatch(/most recent 200|may be partial/i)
  })

  it('says an empty filter result is empty only after a successful read', async () => {
    fetchGarageInvoices.mockImplementation(async () => ({ truncated: false, invoices: [], summary: { issued: 0, unpaid: 0, partially_paid: 0, paid: 0, outstanding_by_currency: [] } }))
    renderPage()
    expect(await screen.findByTestId('invoices-empty')).toHaveTextContent('No invoices match this filter.')
  })

  it('treats a failed invoice read as a loading problem and keeps the rest of the view', async () => {
    fetchGarageInvoices.mockRejectedValue(new Error('invoices unavailable'))
    renderPage()
    expect(await screen.findByTestId('invoices-error')).toHaveTextContent('invoices unavailable')
    expect(screen.getByTestId('invoices-error')).toHaveTextContent(/not a statement that there are no invoices/i)
    expect(await screen.findByTestId('ops-section-work')).toBeInTheDocument()
    expect(screen.queryByTestId('invoices-empty')).toBeNull()
  })
})

describe('GARAGE-1.0 the Workshop page links to both', () => {
  beforeEach(() => {
    fetchGarageQueue.mockResolvedValue({ queue: [], counts: { requested: 0, accepted: 0, active: 0 } })
  })

  it('offers Stock and Operations to the garage administrator', async () => {
    render(<MemoryRouter><GarageWorkspace /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/garage/stock')
    expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute('href', '/garage/operations')
  })

  it('offers a mechanic Stock but not Operations', async () => {
    activeTenantRole = 'mechanic'
    render(<MemoryRouter><GarageWorkspace /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/garage/stock')
    expect(screen.queryByRole('link', { name: 'Operations' })).toBeNull()
  })
})
