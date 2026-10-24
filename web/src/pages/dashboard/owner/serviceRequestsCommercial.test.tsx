import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * GARAGE-1.0 — the CUSTOMER side of the lifecycle, on My Service Requests.
 * A person follows request -> appointment -> estimate -> decision -> work -> invoice -> recorded payments
 * -> receipts without entering a Garage screen. Each test pins a truth rule, not a snapshot.
 */

const fetchMyServiceRequests = vi.fn()
const cancelServiceRequest = vi.fn()
const fetchMyServiceAppointments = vi.fn()
const fetchServiceAppointmentAvailability = vi.fn()
const requestServiceAppointment = vi.fn()
const cancelMyServiceAppointment = vi.fn()
const fetchMyEstimates = vi.fn()
const decideMyEstimate = vi.fn()
const fetchMyInvoices = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyServiceRequests,
    cancelServiceRequest,
    fetchMyServiceAppointments,
    fetchServiceAppointmentAvailability,
    requestServiceAppointment,
    cancelMyServiceAppointment,
    fetchMyEstimates,
    decideMyEstimate,
    fetchMyInvoices,
  }),
}))

const { default: ServiceRequests } = await import('./ServiceRequests')

const SOURCE_LABEL = 'Recorded by the garage. CarUp has not processed or verified this payment.'

const request = {
  id: 'case-1',
  vin: 'VIN-1',
  status: 'accepted',
  service_category: 'brakes',
  request_summary: null,
  garage_display_name: 'Garage One',
  garage_slug: 'garage-one',
  branch_id: 'site-1',
  requested_at: '2026-10-20T00:00:00Z',
  accepted_at: '2026-10-20T01:00:00Z',
  declined_at: null,
  started_at: null,
  completed_at: null,
  cancelled_at: null,
}

function estimate(over: Record<string, unknown> = {}) {
  return {
    id: 'est-1',
    service_case_id: 'case-1',
    work_order_id: 'wo-1',
    version: 1,
    status: 'sent',
    currency: 'USD',
    customer_note: null,
    valid_until: '2026-12-31T00:00:00Z',
    expired: false,
    sent_at: '2026-10-22T10:00:00Z',
    decided_at: null,
    decision_basis: null,
    decision_reason: null,
    total_amount: '120.00',
    total_state: 'frozen_at_send',
    line_count: 2,
    lines: [
      { line_no: 1, category: 'labour', description: 'Brake service', quantity: '1', unit_price: '80.00', line_total: '80.00', price_recorded: true },
      { line_no: 2, category: 'part', description: 'Brake pads', quantity: '2', unit_price: '20.00', line_total: '40.00', price_recorded: true },
    ],
    vin: 'VIN-1',
    can_decide: true,
    awaiting_owner: false,
    // the job's CANONICAL authorization; an estimate's own status never stands in for it
    work_order_authorization: 'pending',
    ...over,
  }
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoice_number: 'INV-0001',
    service_case_id: 'case-1',
    work_order_id: 'wo-1',
    status: 'issued',
    currency: 'USD',
    total_amount: '150.00',
    line_count: 1,
    customer_note: null,
    due_date: '2026-11-15',
    issued_at: '2026-10-24T08:00:00Z',
    voided_at: null,
    estimate: { version: 1, total_amount: '120.00', currency: 'USD' },
    variance: { state: 'comparable', currency: 'USD', estimate_total: '120.00', invoice_total: '150.00', difference: '+30.00', direction: 'over_estimate' },
    payment_status: 'unpaid',
    paid_amount: '0.00',
    balance_amount: '150.00',
    payment_source_label: SOURCE_LABEL,
    lines: [{ line_no: 1, category: 'labour', description: 'Brake service and pads', quantity: '1', unit_price: '150.00', line_total: '150.00' }],
    payments: [],
    receipts: [],
    vin: 'VIN-1',
    ...over,
  }
}

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1', kind: 'payment', amount: '50.00', currency: 'USD', method: 'cash', reference: null,
  paid_at: '2026-10-25T09:00:00Z', recorded_at: '2026-10-25T09:01:00Z', source: 'garage_recorded_external',
  source_label: SOURCE_LABEL, reverses_payment_id: null, ...over,
})

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', receipt_number: 'RCT-0001', payment_id: 'pay-1', amount: '50.00', currency: 'USD', status: 'issued',
  issued_at: '2026-10-25T09:02:00Z', voided_at: null, payment_source: 'garage_recorded_external',
  payment_source_label: SOURCE_LABEL, ...over,
})

function renderPage() {
  return render(<MemoryRouter><ServiceRequests /></MemoryRouter>)
}

/** step key -> its state and the sentence beside it, read from the rendered journey. */
function journey(card: HTMLElement) {
  const out: Record<string, { state: string | null; detail: string }> = {}
  for (const li of within(card).getAllByTestId('journey-step')) {
    out[li.getAttribute('data-step') as string] = {
      state: li.getAttribute('data-state'),
      detail: within(li).getByTestId('journey-step-detail').textContent || '',
    }
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMyServiceRequests.mockResolvedValue([request])
  fetchMyServiceAppointments.mockResolvedValue([])
  fetchMyEstimates.mockResolvedValue({ estimates: [] })
  fetchMyInvoices.mockResolvedValue({ invoices: [] })
  decideMyEstimate.mockResolvedValue({ success: true, decision: 'accepted', estimate_id: 'est-1', work_order_authorization: 'authorized' })
  cancelServiceRequest.mockResolvedValue({})
})

describe('the customer decides an estimate', () => {
  it('Accept calls decideMyEstimate with accept, then reads the estimates and requests again', async () => {
    fetchMyEstimates
      .mockResolvedValueOnce({ estimates: [estimate()] })
      .mockResolvedValue({ estimates: [estimate({ status: 'accepted', can_decide: false, decided_at: '2026-10-23T12:00:00Z', work_order_authorization: 'authorized' })] })
    renderPage()

    const card = await screen.findByTestId('estimate-card')
    expect(within(card).getByText(/lets the garage start the work/i)).toBeInTheDocument()
    const accept = within(card).getByRole('button', { name: 'Accept' })
    expect(accept).toHaveClass('min-h-11')
    expect(within(card).getByRole('button', { name: 'Decline' })).toHaveClass('min-h-11')

    fireEvent.click(accept)

    await waitFor(() => expect(decideMyEstimate).toHaveBeenCalledWith('est-1', 'accept'))
    expect(decideMyEstimate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchMyEstimates).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fetchMyServiceRequests).toHaveBeenCalledTimes(2))
    // what the server now holds, not what we hoped for
    await waitFor(() => expect(screen.getByTestId('estimate-status')).toHaveTextContent('Accepted'))
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
  })

  it('Decline asks for an optional reason, labelled, and sends it', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    renderPage()
    await screen.findByTestId('estimate-card')

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    const reason = screen.getByLabelText('Reason for declining (optional)')
    fireEvent.change(reason, { target: { value: 'Too expensive' } })
    expect(screen.getByRole('button', { name: 'Confirm decline' })).toHaveClass('min-h-11')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))

    await waitFor(() => expect(decideMyEstimate).toHaveBeenCalledWith('est-1', 'decline', 'Too expensive'))
    expect(decideMyEstimate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchMyEstimates).toHaveBeenCalledTimes(2))
  })

  it('a decline without a reason sends no reason', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    renderPage()
    await screen.findByTestId('estimate-card')
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))
    await waitFor(() => expect(decideMyEstimate).toHaveBeenCalledTimes(1))
    expect(decideMyEstimate.mock.calls[0]).toEqual(['est-1', 'decline'])
  })

  it('a person who is not the registered owner is told so and is offered no buttons', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ can_decide: false, awaiting_owner: true })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    expect(within(card).getByTestId('estimate-awaiting-owner')).toHaveTextContent(/Only the vehicle.s registered owner can accept or decline/)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
    expect(screen.queryByTestId('estimate-decision-controls')).toBeNull()
    expect(journey(screen.getByTestId('service-request-card')).estimate.detail).toMatch(/waiting for the vehicle's registered owner/)
  })

  it.each([
    ['expired', { status: 'sent', expired: true, can_decide: false }, /can no longer be accepted/],
    ['superseded', { status: 'superseded', can_decide: false }, /newer version replaced this estimate/],
    ['accepted', { status: 'accepted', can_decide: false, decided_at: '2026-10-23T12:00:00Z', work_order_authorization: 'authorized' }, /Accepted/],
    ['declined', { status: 'declined', can_decide: false, decided_at: '2026-10-23T12:00:00Z', decision_reason: 'Found a cheaper quote' }, /Found a cheaper quote/],
    ['cancelled', { status: 'cancelled', can_decide: false }, /was cancelled/],
  ])('a %s estimate offers no decision', async (_name, over, text) => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate(over)] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    expect(card).toHaveTextContent(text)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm decline' })).toBeNull()
  })

  it('an expired estimate says it expired; a superseded one is labelled with the server wording', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ status: 'sent', expired: true, can_decide: false })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    expect(within(card).getByTestId('estimate-expired')).toHaveTextContent('Expired')
    expect(within(card).getByTestId('estimate-expired-note')).toHaveTextContent('This estimate has expired and can no longer be accepted.')
  })

  it("shows the server's own words when a decision is refused, and reads the estimates again", async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    decideMyEstimate.mockRejectedValue(new Error('This estimate has already been decided or replaced.'))
    renderPage()
    await screen.findByTestId('estimate-card')

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(await screen.findByTestId('estimate-decision-error')).toHaveTextContent('This estimate has already been decided or replaced.')
    await waitFor(() => expect(fetchMyEstimates).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('estimate-recorded')).toBeNull()
  })

  it('prefers the error text the server put in the response body over a generic message', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    decideMyEstimate.mockRejectedValue(Object.assign(new Error('Request failed (403)'), {
      data: { error: "Only the vehicle's registered owner can accept or decline an estimate for it." },
    }))
    renderPage()
    await screen.findByTestId('estimate-card')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByTestId('estimate-decision-error')).toHaveTextContent("Only the vehicle's registered owner can accept or decline an estimate for it.")
  })

  it('only the latest version is decidable; earlier versions sit behind a disclosure', async () => {
    fetchMyEstimates.mockResolvedValue({
      estimates: [
        estimate({ id: 'est-2', version: 2 }),
        estimate({ id: 'est-1', version: 1, status: 'declined', can_decide: false, decided_at: '2026-10-22T12:00:00Z' }),
      ],
    })
    renderPage()
    await screen.findAllByTestId('estimate-card')
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1)
    const earlier = screen.getByTestId('earlier-estimates')
    expect(earlier).toHaveTextContent('Earlier versions (1)')
    expect(within(earlier).getByText('Estimate, version 1')).toBeInTheDocument()
    expect(within(earlier).queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})

describe('the estimate itself — money is amount + currency, never a made-up zero', () => {
  it('shows version, status, lines, total with currency, the garage note and the validity', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ customer_note: 'Pads are genuine parts.', version: 3 })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    expect(card).toHaveTextContent('Estimate, version 3')
    expect(within(card).getByTestId('estimate-status')).toHaveTextContent('Sent to customer')
    const lines = within(card).getByTestId('estimate-lines')
    expect(lines).toHaveTextContent('Brake service')
    expect(lines).toHaveTextContent('80.00 USD')
    expect(lines).toHaveTextContent('Brake pads')
    expect(lines).toHaveTextContent('20.00 USD')
    expect(lines).toHaveTextContent('40.00 USD')
    expect(within(card).getByTestId('estimate-total')).toHaveTextContent('120.00 USD')
    expect(within(card).getByTestId('estimate-note')).toHaveTextContent('Pads are genuine parts.')
    expect(card).toHaveTextContent(/Valid until/)
  })

  it('a null unit price says "Not recorded" and 0 is never rendered as a price', async () => {
    fetchMyEstimates.mockResolvedValue({
      estimates: [estimate({
        total_amount: null,
        total_state: 'not_recorded',
        lines: [{ line_no: 1, category: 'part', description: 'Special order part', quantity: '2', unit_price: null, line_total: null, price_recorded: false }],
      })],
    })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    const lines = within(card).getByTestId('estimate-lines')
    expect(within(lines).getAllByText('Not recorded')).toHaveLength(2)
    expect(within(card).getByTestId('estimate-total')).toHaveTextContent('Not recorded')
    const cells = Array.from(card.querySelectorAll('td, dd, [data-testid="estimate-total"]')).map((n) => (n.textContent || '').trim())
    for (const text of cells) expect(text).not.toMatch(/^0([.,]0+)?(\s[A-Z]{3})?$/)
    expect(card.textContent).not.toMatch(/\b0\.00\b/)
  })

  it('a price the garage explicitly recorded as free is shown as the amount it recorded', async () => {
    fetchMyEstimates.mockResolvedValue({
      estimates: [estimate({
        total_amount: '0.00',
        lines: [{ line_no: 1, category: 'fee', description: 'Courtesy check', quantity: '1', unit_price: '0.00', line_total: '0.00', price_recorded: true }],
      })],
    })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    expect(within(card).getByTestId('estimate-total')).toHaveTextContent('0.00 USD')
    expect(within(card).queryByText('Not recorded')).toBeNull()
  })
})

describe('the invoice and the payments the garage recorded', () => {
  const completed = { ...request, status: 'completed', started_at: '2026-10-21T09:00:00Z', completed_at: '2026-10-23T17:00:00Z' }

  it('an unpaid invoice shows its payment status and the source label, and never claims payment', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice()] })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-payment-status')).toHaveTextContent('No payment recorded')
    expect(within(card).getByTestId('invoice-source-label')).toHaveTextContent(SOURCE_LABEL)
    expect(within(card).getByTestId('invoice-total')).toHaveTextContent('150.00 USD')
    expect(within(card).getByTestId('invoice-balance')).toHaveTextContent('150.00 USD')
    expect(card).toHaveTextContent('Invoice INV-0001')
    expect(card).toHaveTextContent(/Issued/)
    expect(card).toHaveTextContent(/Due/)
    // a finished job and an issued invoice are not a payment
    expect(screen.queryByText(/\bpaid\b/i)).toBeNull()
    expect(screen.queryByText(/settled|confirmed payment/i)).toBeNull()
    expect(within(card).getByText('The garage has recorded no payments against this invoice.')).toBeInTheDocument()
  })

  it('a partly paid invoice is labelled as such, with its payment and receipt each carrying the source label', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({
        payment_status: 'partially_paid', paid_amount: '50.00', balance_amount: '100.00',
        payments: [payment({ reference: 'TXN-77', method: 'mobile_money' })],
        receipts: [receipt()],
      })],
    })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-payment-status')).toHaveTextContent('Partly paid (recorded by the garage)')
    expect(within(card).getByTestId('invoice-recorded-amount')).toHaveTextContent('50.00 USD')
    expect(within(card).getByTestId('invoice-balance')).toHaveTextContent('100.00 USD')

    const pay = within(card).getByTestId('invoice-payment')
    expect(pay).toHaveTextContent('50.00 USD')
    expect(pay).toHaveTextContent('Mobile money')
    expect(pay).toHaveTextContent('TXN-77')
    expect(within(pay).getByTestId('payment-source-label')).toHaveTextContent(SOURCE_LABEL)

    const rec = within(card).getByTestId('invoice-receipt')
    expect(rec).toHaveTextContent('Receipt RCT-0001')
    expect(rec).toHaveTextContent('50.00 USD')
    expect(rec).toHaveTextContent('Issued')
    expect(within(rec).getByTestId('receipt-source-label')).toHaveTextContent(SOURCE_LABEL)
  })

  it('a fully paid invoice shows the server-labelled state, and a voided receipt is labelled voided', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({
        payment_status: 'paid', paid_amount: '150.00', balance_amount: '0.00',
        payments: [payment({ amount: '150.00' })],
        receipts: [receipt({ amount: '150.00', status: 'voided', voided_at: '2026-10-26T08:00:00Z' })],
      })],
    })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-payment-status')).toHaveTextContent('Paid in full (recorded by the garage)')
    expect(within(card).getByTestId('invoice-receipt')).toHaveTextContent('Voided')
    expect(within(card).getByTestId('receipt-source-label')).toHaveTextContent(SOURCE_LABEL)
  })

  it('a payment the garage reversed is shown as a reversal, not as money received', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({
        payment_status: 'unpaid',
        payments: [payment(), payment({ id: 'pay-2', kind: 'reversal', reverses_payment_id: 'pay-1' })],
      })],
    })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    const rows = within(card).getAllByTestId('invoice-payment')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('Payment reversed by the garage')
    expect(within(card).getAllByTestId('payment-source-label')).toHaveLength(2)
  })

  it('a voided invoice is labelled voided', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({ status: 'voided', payment_status: 'voided', voided_at: '2026-10-26T08:00:00Z' })],
    })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-payment-status')).toHaveTextContent('Voided')
    expect(within(card).getByTestId('invoice-voided-note')).toHaveTextContent(/voided this invoice/)
  })

  it('shows the estimate-to-invoice difference exactly as the server gave it', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice()] })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-variance')).toHaveTextContent(
      'Estimate 120.00 USD → final invoice 150.00 USD (difference +30.00 USD, above the estimate)',
    )
  })

  it("shows the server's reason when the estimate and invoice cannot be compared, and computes nothing", async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({
        currency: 'ZWG',
        estimate: { version: 1, total_amount: '120.00', currency: 'USD' },
        variance: { state: 'not_comparable', reason: 'The estimate and the invoice are in different currencies; amounts are never converted.' },
      })],
    })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-variance')).toHaveTextContent('The estimate and the invoice are in different currencies; amounts are never converted.')
    expect(card.textContent).not.toMatch(/difference/i)
  })

  it('shows the garage note and the due date; a missing due date is stated, not invented', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice({ customer_note: 'Thank you for your business.', due_date: null })] })
    renderPage()
    const card = await screen.findByTestId('invoice-card')
    expect(within(card).getByTestId('invoice-note')).toHaveTextContent('Thank you for your business.')
    expect(card).toHaveTextContent('No due date recorded')
  })

  it('states that no invoice has been issued for a completed request, only once invoices have loaded', async () => {
    fetchMyServiceRequests.mockResolvedValue([completed])
    renderPage()
    expect(await screen.findByTestId('no-invoices')).toHaveTextContent('The garage has not issued an invoice for this request.')
  })
})

describe('the journey is derived from data, never assumed', () => {
  it('walks a finished job with an accepted estimate and a partly paid invoice', async () => {
    fetchMyServiceRequests.mockResolvedValue([{ ...request, status: 'completed', started_at: '2026-10-21T09:00:00Z', completed_at: '2026-10-23T17:00:00Z' }])
    fetchMyServiceAppointments.mockResolvedValue([{
      id: 'appt-1', service_case_id: 'case-1', branch_id: 'site-1', status: 'fulfilled',
      starts_at: '2026-10-21T08:00:00Z', ends_at: '2026-10-21T09:00:00Z', appointment_timezone: 'Africa/Harare',
      planned_workforce_profile_id: null, requested_by_user_id: 'u1', confirmed_at: '2026-10-20T12:00:00Z',
      created_at: '2026-10-20T11:00:00Z', updated_at: '2026-10-21T10:00:00Z',
    }])
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ status: 'accepted', can_decide: false, decided_at: '2026-10-22T12:00:00Z', work_order_authorization: 'authorized' })] })
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice({ payment_status: 'partially_paid', paid_amount: '50.00', balance_amount: '100.00' })] })
    renderPage()
    await screen.findByTestId('invoice-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(Object.keys(j)).toEqual(['requested', 'accepted', 'appointment', 'estimate', 'authorized', 'in_progress', 'completed', 'invoice', 'payment'])
    expect(j.requested.state).toBe('done')
    expect(j.accepted.state).toBe('done')
    expect(j.appointment.state).toBe('done')
    expect(j.estimate.state).toBe('done')
    expect(j.authorized.state).toBe('done')
    expect(j.in_progress.state).toBe('done')
    expect(j.completed.state).toBe('done')
    expect(j.invoice.state).toBe('done')
    expect(j.payment.state).toBe('current')
    expect(j.payment.detail).toBe('Partly paid (recorded by the garage)')
  })

  it('a finished job with an unpaid invoice does not show payment as done', async () => {
    fetchMyServiceRequests.mockResolvedValue([{ ...request, status: 'completed', started_at: '2026-10-21T09:00:00Z', completed_at: '2026-10-23T17:00:00Z' }])
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ status: 'accepted', can_decide: false, work_order_authorization: 'authorized' })] })
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice()] })
    renderPage()
    await screen.findByTestId('invoice-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.invoice.state).toBe('done')
    expect(j.payment.state).toBe('pending')
    expect(j.payment.detail).toBe('No payment recorded')
  })

  it('a declined estimate is "not authorized" and the later steps are not shown as coming', async () => {
    fetchMyEstimates.mockResolvedValue({
      estimates: [estimate({ status: 'declined', can_decide: false, decided_at: '2026-10-22T12:00:00Z' })],
    })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.detail).toBe('Version 1 — Declined')
    expect(j.authorized.state).toBe('stopped')
    expect(j.authorized.detail).toMatch(/Not authorized/)
    for (const later of ['in_progress', 'completed', 'invoice', 'payment']) {
      expect(j[later].state, later).toBe('not_reached')
      expect(j[later].detail, later).toBe('Not reached')
    }
  })

  it('a request the garage declined stops at Accepted; an estimate is not expected', async () => {
    fetchMyServiceRequests.mockResolvedValue([{ ...request, status: 'declined', accepted_at: null, declined_at: '2026-10-21T00:00:00Z' }])
    renderPage()
    await screen.findByTestId('journey-progress')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.accepted.state).toBe('stopped')
    expect(j.estimate.state).toBe('not_reached')
    expect(j.payment.state).toBe('not_reached')
    expect(screen.queryByTestId('no-estimates')).toBeNull()
  })

  it('a cancelled request says so and shows nothing as pending', async () => {
    fetchMyServiceRequests.mockResolvedValue([{ ...request, status: 'cancelled', accepted_at: null, cancelled_at: '2026-10-21T00:00:00Z' }])
    renderPage()
    expect(await screen.findByTestId('journey-note')).toHaveTextContent('This request was cancelled')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.accepted.state).toBe('not_reached')
    expect(j.estimate.state).toBe('not_reached')
    expect(Object.values(j).filter((s) => s.state === 'pending')).toHaveLength(0)
  })

  it('a sent estimate is the current step and authorization has not happened', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.state).toBe('current')
    expect(j.estimate.detail).toBe('Version 1 is waiting for your decision')
    expect(j.authorized.state).toBe('pending')
    expect(j.in_progress.state).toBe('pending')
    expect(j.completed.state).toBe('pending')
  })

  it('does not call a requested appointment confirmed', async () => {
    fetchMyServiceAppointments.mockResolvedValue([{
      id: 'appt-1', service_case_id: 'case-1', branch_id: 'site-1', status: 'requested',
      starts_at: '2026-10-26T08:00:00Z', ends_at: '2026-10-26T09:00:00Z', appointment_timezone: 'Africa/Harare',
      planned_workforce_profile_id: null, requested_by_user_id: 'u1', confirmed_at: null,
      created_at: '2026-10-23T02:00:00Z', updated_at: '2026-10-23T02:00:00Z',
    }])
    renderPage()
    await screen.findByTestId('journey-progress')
    await waitFor(() => expect(journey(screen.getByTestId('service-request-card')).appointment.state).toBe('current'))
    expect(journey(screen.getByTestId('service-request-card')).appointment.detail).toMatch(/not confirmed by the garage yet/)
  })

  it('an expired estimate is not authorization and later steps are not reached', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ expired: true, can_decide: false })] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.state).toBe('stopped')
    expect(j.estimate.detail).toMatch(/can no longer be accepted/)
    expect(j.authorized.state).toBe('not_reached')
  })
})

describe("authorization is the job's canonical state, never inferred from the estimate's status", () => {
  const accepted = { status: 'accepted', can_decide: false, decided_at: '2026-10-22T12:00:00Z' }

  it('an accepted estimate whose authorization was withdrawn is not "authorized", and nothing after it is expected', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ ...accepted, work_order_authorization: 'revoked' })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))

    // the estimate WAS accepted — and both facts are shown, honestly
    expect(within(card).getByTestId('estimate-status')).toHaveTextContent('Accepted')
    expect(within(card).getByTestId('estimate-authorization')).toHaveTextContent('Estimate accepted — authorization later withdrawn.')
    expect(j.estimate.state).toBe('done')
    expect(j.estimate.detail).toBe('Version 1 — Accepted')

    expect(j.authorized.state).toBe('stopped')
    expect(j.authorized.detail).toBe('Estimate accepted — authorization later withdrawn')
    expect(j.authorized.state).not.toBe('done')
    expect(screen.queryByText(/The work is authorized/)).toBeNull()

    for (const later of ['in_progress', 'completed', 'invoice', 'payment']) {
      expect(j[later].state, later).toBe('not_reached')
      expect(j[later].state, later).not.toBe('done')
    }
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
  })

  it('an accepted estimate with an authorized job is Authorized, and the later steps are simply not yet', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ ...accepted, work_order_authorization: 'authorized' })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.authorized.state).toBe('done')
    expect(j.authorized.detail).toMatch(/^Authorized — estimate accepted/)
    expect(within(card).getByTestId('estimate-authorization')).toHaveTextContent('The work is authorized.')
    expect(j.in_progress.state).toBe('pending')
    expect(j.completed.state).toBe('pending')
  })

  it('an accepted estimate with NO authorization state does not claim the work is authorized', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ ...accepted, work_order_authorization: null })] })
    renderPage()
    const card = await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.state).toBe('done')
    expect(j.authorized.state).toBe('unknown')
    expect(j.authorized.state).not.toBe('done')
    expect(j.authorized.detail).toMatch(/not available/)
    expect(within(card).getByTestId('estimate-authorization')).toHaveTextContent('Whether the work is authorized is not available.')
    expect(screen.queryByText(/The work is authorized/)).toBeNull()
    expect(j.authorized.detail).not.toMatch(/^Authorized/)
  })

  it('a pending authorization is "not authorized yet"', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ work_order_authorization: 'pending' })] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.state).toBe('current')
    expect(j.authorized.state).toBe('pending')
    expect(j.authorized.detail).toBe('Not authorized yet')
  })

  it('a sent estimate with no authorization state is not authorized yet either', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ work_order_authorization: null })] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.authorized.state).toBe('pending')
    expect(j.authorized.detail).toBe('Not authorized yet')
  })

  it('a declined authorization is "not authorized", even where the estimate itself was not declined', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ ...accepted, work_order_authorization: 'declined' })] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.authorized.state).toBe('stopped')
    expect(j.authorized.detail).toBe('Not authorized — authorization was declined')
    expect(j.in_progress.state).toBe('not_reached')
  })

  it('the authorization on an accepted estimate is read from the job, not from the estimate version', async () => {
    fetchMyEstimates.mockResolvedValue({
      estimates: [
        estimate({ id: 'est-2', version: 2, ...accepted, work_order_authorization: 'revoked' }),
        estimate({ id: 'est-1', version: 1, status: 'declined', can_decide: false, work_order_authorization: 'revoked' }),
      ],
    })
    renderPage()
    await screen.findAllByTestId('estimate-card')
    expect(journey(screen.getByTestId('service-request-card')).authorized.state).toBe('stopped')
  })

  it("still reports what the case record itself says happened, without implying the withdrawal was undone", async () => {
    // a started job whose authorization was later withdrawn: "work started" is a recorded fact, but the
    // Authorized step stays stopped and nothing further (completion, invoice, payment) is expected
    fetchMyServiceRequests.mockResolvedValue([{ ...request, status: 'active', started_at: '2026-10-21T09:00:00Z' }])
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ ...accepted, work_order_authorization: 'revoked' })] })
    renderPage()
    await screen.findByTestId('estimate-card')
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.authorized.state).toBe('stopped')
    expect(j.in_progress.detail).toMatch(/^Work started/)
    expect(j.completed.state).toBe('not_reached')
    expect(j.invoice.state).toBe('not_reached')
    expect(j.payment.state).toBe('not_reached')
  })
})

describe('estimates and invoices belong to the request they are about', () => {
  it('groups by service_case_id onto the matching request', async () => {
    fetchMyServiceRequests.mockResolvedValue([request, { ...request, id: 'case-2', vin: 'VIN-2' }])
    fetchMyEstimates.mockResolvedValue({
      estimates: [estimate(), estimate({ id: 'est-9', service_case_id: 'case-2', vin: 'VIN-2', version: 4, total_amount: '999.00' })],
    })
    renderPage()
    const cards = await screen.findAllByTestId('service-request-card')
    await waitFor(() => expect(within(cards[0]).getAllByTestId('estimate-card')).toHaveLength(1))
    expect(within(cards[0]).getByTestId('estimate-total')).toHaveTextContent('120.00 USD')
    expect(within(cards[1]).getByTestId('estimate-total')).toHaveTextContent('999.00 USD')
    expect(within(cards[1]).getByText('Estimate, version 4')).toBeInTheDocument()
  })

  it('shows records for a job that is not one of the person\'s own requests rather than dropping them', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate({ id: 'est-x', service_case_id: 'case-other', vin: 'VIN-OTHER', can_decide: true })] })
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice({ id: 'inv-x', service_case_id: 'case-other', vin: 'VIN-OTHER' })] })
    renderPage()
    const section = await screen.findByTestId('unlisted-service-records')
    expect(section).toHaveTextContent('VIN-OTHER')
    expect(within(section).getByTestId('estimate-card')).toBeInTheDocument()
    expect(within(section).getByTestId('invoice-card')).toBeInTheDocument()
    // and the person can still decide it: the server said can_decide
    expect(within(section).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })
})

describe('when estimates or invoices cannot be loaded', () => {
  it('keeps the request list and says the estimates did not load, never "no estimates"', async () => {
    fetchMyEstimates.mockRejectedValue(new Error('network'))
    fetchMyInvoices.mockResolvedValue({ invoices: [invoice()] })
    renderPage()

    expect(await screen.findByTestId('service-request-card')).toBeInTheDocument()
    const alert = await screen.findByTestId('commercial-error')
    expect(alert).toHaveTextContent('Estimates could not be loaded.')
    expect(alert).not.toHaveTextContent('Invoices could not be loaded.')
    expect(alert).toHaveTextContent(/not a statement that nothing was sent to you/i)
    expect(screen.queryByTestId('no-estimates')).toBeNull()
    expect(screen.queryByTestId('estimate-card')).toBeNull()
    // the rest of the page still works
    expect(screen.getByTestId('request-reference')).toHaveTextContent('SR-')
    expect(screen.getByTestId('withdraw-request')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find appointment times' })).toBeInTheDocument()
    expect(screen.getByTestId('invoice-card')).toBeInTheDocument()
    // the journey does not pretend there is no estimate
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.estimate.state).toBe('unknown')
    expect(j.authorized.state).toBe('unknown')
    expect(screen.getByTestId('commercial-unavailable')).toHaveTextContent(/did not load/)
  })

  it('keeps everything else when the invoices do not load, and can retry', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    fetchMyInvoices.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ invoices: [] })
    renderPage()

    const alert = await screen.findByTestId('commercial-error')
    expect(alert).toHaveTextContent('Invoices could not be loaded.')
    expect(screen.getByTestId('estimate-card')).toBeInTheDocument()
    const j = journey(screen.getByTestId('service-request-card'))
    expect(j.invoice.state).toBe('unknown')
    expect(j.payment.state).toBe('unknown')

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByTestId('commercial-error')).toBeNull())
    expect(fetchMyInvoices).toHaveBeenCalledTimes(2)
  })

  it('a malformed response is a failure, not an empty list', async () => {
    fetchMyEstimates.mockResolvedValue({})
    renderPage()
    expect(await screen.findByTestId('commercial-error')).toHaveTextContent('Estimates could not be loaded.')
  })

  it('shows a loading state while the estimates are on their way', async () => {
    fetchMyEstimates.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(await screen.findByTestId('commercial-loading')).toHaveTextContent('Loading estimates and invoices…')
    expect(screen.getByTestId('service-request-card')).toBeInTheDocument()
    expect(screen.queryByTestId('no-estimates')).toBeNull()
  })

  it('states there is no estimate only once the estimates have loaded and the job could have one', async () => {
    renderPage()
    expect(await screen.findByTestId('no-estimates')).toHaveTextContent('No estimate has been sent to you for this request.')
  })
})

describe('what the customer never sees', () => {
  it('renders no internal field even if one slipped into a response', async () => {
    const completed = { ...request, status: 'completed', started_at: '2026-10-21T09:00:00Z', completed_at: '2026-10-23T17:00:00Z' }
    fetchMyServiceRequests.mockResolvedValue([completed])
    fetchMyEstimates.mockResolvedValue({
      estimates: [estimate({
        internal_note: 'INTERNAL-ESTIMATE-MARGIN-NOTE',
        created_by_user_id: 'STAFF-USER-ID-1',
        sent_by_user_id: 'STAFF-USER-ID-2',
        cancel_reason: 'INTERNAL-CANCEL-REASON',
        history: [{ event_type: 'sent', actor_scope: 'garage', created_at: '2026-10-22T10:00:00Z' }],
      })],
    })
    fetchMyInvoices.mockResolvedValue({
      invoices: [invoice({
        internal_note: 'INTERNAL-INVOICE-NOTE',
        issued_by_user_id: 'STAFF-USER-ID-3',
        void_reason: 'INTERNAL-VOID-REASON',
        payments: [payment({ reason: 'INTERNAL-PAYMENT-REASON' })],
      })],
    })
    const { container } = renderPage()
    await screen.findByTestId('invoice-card')
    await screen.findByTestId('estimate-card')
    const html = container.innerHTML
    for (const secret of [
      'INTERNAL-ESTIMATE-MARGIN-NOTE', 'STAFF-USER-ID-1', 'STAFF-USER-ID-2', 'INTERNAL-CANCEL-REASON',
      'INTERNAL-INVOICE-NOTE', 'STAFF-USER-ID-3', 'INTERNAL-VOID-REASON', 'INTERNAL-PAYMENT-REASON',
    ]) expect(html).not.toContain(secret)
    for (const field of ['internal_note', 'created_by_user_id', 'issued_by_user_id', 'void_reason', 'cancel_reason']) {
      expect(html).not.toContain(field)
    }
  })
})

describe('the existing page still works', () => {
  it('still lists the request and its appointment controls alongside the new sections', async () => {
    fetchMyEstimates.mockResolvedValue({ estimates: [estimate()] })
    renderPage()
    expect(await screen.findByTestId('service-request-card')).toBeInTheDocument()
    expect(await screen.findByText('No appointment recorded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find appointment times' })).toBeInTheDocument()
    expect(screen.getByTestId('withdraw-request')).toBeInTheDocument()
  })
})
