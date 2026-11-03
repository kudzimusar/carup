/**
 * CARUP-PAY-05-R1 — what a person gets on each screen, for the states the server now produces: truth in separate parts, focus
 * moved to new content, always-mounted live regions, and no dead ends (ICR-W1, W2, W5, W6, W7, W8, W12, W13 inverted).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchGarageInvoicePaymentOptions: vi.fn(), startGarageInvoicePayment: vi.fn(), verifyGarageInvoicePayment: vi.fn(),
  cancelGarageInvoicePayment: vi.fn(), submitPaynowOtp: vi.fn(),
  fetchGaragePaynowConnection: vi.fn(), connectGaragePaynow: vi.fn(), disconnectGaragePaynow: vi.fn(),
  fetchPaynowMerchants: vi.fn(), verifyPaynowMerchant: vi.fn(), rejectPaynowMerchant: vi.fn(), suspendPaynowMerchant: vi.fn(),
  setPaynowAvailability: vi.fn(), fetchPaynowProviderErrors: vi.fn(), fetchPaynowHeldCollections: vi.fn(), releasePaynowHold: vi.fn(),
  reconcilePaynowCollection: vi.fn(),
  fetchGaragePaymentExceptions: vi.fn(), resolveGaragePaymentDiscrepancy: vi.fn(), fetchGarageMerchantAccounts: vi.fn(),
  registerGarageMerchantAccount: vi.fn(), suspendGarageMerchantAccount: vi.fn(),
  refundGarageProviderPayment: vi.fn(), reconcileGarageProviderPayment: vi.fn(), cancelGarageProviderPayment: vi.fn(),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const { default: InvoicePayment } = await import('./InvoicePayment')
const { default: PaymentReturnNotice } = await import('./PaymentReturnNotice')
const { default: InvoiceCard } = await import('./InvoiceCard')
const { default: PaynowCheckout } = await import('./PaynowCheckout')
const { default: PaynowConnection } = await import('@/components/garage/PaynowConnection')
const { default: PaynowOperatorPanel } = await import('@/components/admin/PaynowOperatorPanel')
const { default: GaragePaymentsOperator } = await import('@/pages/dashboard/admin/GaragePaymentsOperator')
const { ProviderPaymentsPanel } = await import('@/components/garage/hub/ProviderPaymentsPanel')

const COLL = '11111111-2222-3333-4444-555555555555'
const invoice = { id: 'inv-9', invoice_number: 'INV-000009', currency: 'USD', status: 'issued', balance_amount: '60.00' } as never
const facts = (over: Record<string, unknown> = {}) => ({ provider: 'Waiting for approval on the phone', counted: false, allocation: 'Not counted on this invoice', review: null,
  next_step: 'Complete this request, or check its status. Do not start another payment for this amount.', last_read_at: '2026-11-02T10:00:00Z', ...over })
const pview = (over: Record<string, unknown> = {}) => ({
  method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone', checkout_url: null,
  instructions: 'Dial *151*2*4# and enter your EcoCash PIN.', authorization_code: null, authorization_expires: null, otp_reference: null,
  needs_otp: false, phone: '077*****67', hold_released: false, settled_outside: false, facts: facts(), ...over,
})
const row = (paynow: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  id: COLL, amount: '60.00', currency: 'USD', initiated_at: '2026-11-02T10:00:00Z', expires_at: '2026-11-02T10:30:00Z', cancelled_at: null,
  state: 'awaiting_provider', state_label: 'Waiting for Paynow — not counted', payment_status: 'pending', gateway: 'paynow_zimbabwe', simulated: true,
  source_label: 'Through the garage’s own Paynow account.', paynow: pview(paynow), ...over,
})
const paynowOption = (methods = ['web', 'ecocash', 'innbucks', 'omari'], notices = {}) => ({
  available: true, gateway: 'paynow_zimbabwe', provider: 'paynow', simulated: true, merchant_display_name: 'P5 Motors (Paynow)', max_amount: '60.00',
  currency: 'USD', methods, simulation_notice: null, notices: { no_redirect_proof: 'Coming back is not proof.', cannot_cancel: 'Paynow cannot cancel.', channel: '', ...notices },
})
const options = (over: Record<string, unknown> = {}) => ({
  invoice_id: 'inv-9', invoice_number: 'INV-000009', status: 'issued', currency: 'USD',
  money: { currency: 'USD', invoice_status: 'issued', total_amount: '60.00', declared_paid: '0.00', provider_paid: '0.00', paid_amount: '0.00',
    balance_amount: '60.00', provider_reserved: '0.00', uncommitted_balance: '60.00', payment_status: 'unpaid' },
  payment_instructions: null, instructions_missing_label: 'None.', online_payment: paynowOption(), provider_payments: [], provider_receipts: [],
  labels: { declared: '', provider: '', in_flight: '' }, ...over,
})
const inProgress = (rows: unknown[]) => options({ online_payment: { available: false, reason: 'payment_in_progress' }, provider_payments: rows })
const openHowToPay = async () => {
  render(<InvoicePayment invoice={invoice} />)
  fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
}
const availability = { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null }

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, writable: true })
  api.fetchPaynowMerchants.mockResolvedValue({ merchants: [], availability })
  api.fetchPaynowHeldCollections.mockResolvedValue({ held: [] })
  api.fetchPaynowProviderErrors.mockResolvedValue({ errors: [] })
})

describe('ICR-W5: focus moves to the new content after each action', () => {
  it('customer: Stop moves to the question; Keep it returns to Stop', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([row()]))
    await openHowToPay()
    const stop = await screen.findByTestId('my-provider-payment-stop')
    stop.focus()
    fireEvent.click(stop)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('my-provider-payment-stop-ask')))
    fireEvent.click(screen.getByTestId('my-provider-payment-stop-keep'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('my-provider-payment-stop')))
  })

  it('customer: Yes, stop it is announced in the live region that was already there, and takes the focus', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValueOnce(inProgress([row()]))
      .mockResolvedValue(inProgress([row({ provider_status_label: 'You stopped waiting, but Paynow cannot cancel a request.' }, { state: 'stopping', state_label: 'Stopped waiting — the amount stays reserved while CarUp checks with Paynow (not counted)', cancelled_at: '2026-11-02T10:05:00Z' })]))
    api.cancelGarageInvoicePayment.mockResolvedValue({ collection: null, applied: false, notice: 'Paynow cannot cancel a payment request.' })
    await openHowToPay()
    fireEvent.click(await screen.findByTestId('my-provider-payment-stop'))
    const region = screen.getByTestId('my-provider-payment-outcome')
    expect(region).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(screen.getByTestId('my-provider-payment-stop-confirm'))
    await waitFor(() => expect(screen.getByTestId('my-provider-payment')).toHaveAttribute('data-state', 'stopping'))
    await waitFor(() => expect(screen.getByTestId('my-provider-payment-outcome')).toHaveTextContent(/stays reserved/))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('my-provider-payment-outcome')))
    expect(screen.getByTestId('my-provider-payment')).not.toHaveTextContent(/nothing was paid/i)
  })

  it('customer: an accepted O’mari code moves focus to the outcome', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(options())
    api.startGarageInvoicePayment.mockResolvedValue({ collection_id: COLL, gateway: 'paynow_zimbabwe', replayed: false, simulated: true, amount: '60.00',
      currency: 'USD', expires_at: '', checkout_url: null, paynow: pview({ method: 'omari', needs_otp: true, otp_reference: 'OTP1', instructions: null }),
      notice: '', cannot_cancel: 'Paynow cannot cancel a payment request.' })
    api.submitPaynowOtp.mockResolvedValue({ collection: { state: 'confirmed' }, applied: true, refused: null, duplicate_event: false, payment_status: 'paid',
      money: {}, paynow: pview({ method: 'omari', provider_status: 'paid', provider_status_label: 'Paid — counted on this invoice.', needs_otp: false, instructions: null }) })
    await openHowToPay()
    await screen.findByTestId('paynow-checkout')
    fireEvent.click(screen.getByTestId('paynow-method-omari'))
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0711234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    fireEvent.change(await screen.findByTestId('paynow-otp-input'), { target: { value: '483920' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    await waitFor(() => expect(screen.getByTestId('paynow-outcome')).toHaveTextContent('Paynow confirmed your payment'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('paynow-outcome')))
  })

  it('customer: back from Paynow, Check payment status stays on screen while checking and focus lands on the answer', async () => {
    let answer: (v: unknown) => void = () => {}
    const waiting = { collection: { state: 'awaiting_provider' }, paynow: pview() }
    api.verifyGarageInvoicePayment.mockResolvedValueOnce(waiting).mockReturnValueOnce(new Promise((r) => { answer = r }))
    render(<MemoryRouter initialEntries={[`/dashboard/service-requests?pay05=returned&collection=${COLL}`]}><PaymentReturnNotice /></MemoryRouter>)
    const recheck = await screen.findByTestId('payment-return-recheck')
    recheck.focus()
    fireEvent.click(recheck)
    expect(screen.getByTestId('payment-return-recheck')).toBeInTheDocument()
    answer(waiting)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('payment-return-outcome')))
  })

  it('customer: a lost answer on Pay while the request was created: the warning survives the refresh and takes the focus', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValueOnce(options({ online_payment: paynowOption(['ecocash']) }))
      .mockResolvedValue(inProgress([row({ initiation: 'unknown', provider_status: null, provider_status_label: 'CarUp has not confirmed that Paynow received this request.', instructions: null })]))
    api.startGarageInvoicePayment.mockRejectedValue(new TypeError('Failed to fetch'))
    await openHowToPay()
    await screen.findByTestId('paynow-checkout')
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    await waitFor(() => expect(screen.queryByTestId('paynow-checkout')).toBeNull())
    const warning = await screen.findByTestId('paynow-start-lost')
    expect(warning).toHaveTextContent(/may still have been sent/)
    await waitFor(() => expect(document.activeElement).toBe(warning))
  })

  it('garage: Disconnect moves to the reason field; Keep it connected returns to Disconnect', async () => {
    api.fetchGaragePaynowConnection.mockResolvedValue({
      enabled: true, can_connect: false, mode: 'simulator', availability, capabilities: {}, methods: ['web', 'ecocash'], currencies: ['USD'], previous: [],
      merchant: { id: 'm1', tenant_id: 't1', gateway: 'paynow_zimbabwe', display_name: 'P5 Motors (Paynow)', merchant_reference: 'pnm_x', currencies: ['USD'],
        status: 'verified', registered_by: 'u1', registered_at: '', suspended_at: null, suspended_reason: null, profile: null, integrations: [], history: [] },
    })
    render(<PaynowConnection />)
    fireEvent.click(await screen.findByTestId('garage-paynow-disconnect'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('garage-paynow-disconnect-reason')))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it connected' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('garage-paynow-disconnect')))
  })

  it('operator: Resolve moves into the form, Cancel returns, and the result is announced from a region already there, with focus', async () => {
    api.fetchGaragePaymentExceptions.mockResolvedValue({ reconciliation_holds: [], discrepancies: [{ id: 'd1', type: 'provider_paid_after_close', garage: 'P5 Garage',
      tenant_id: 't1', invoice_id: 'i1', collection_id: COLL, amount: '25.00', currency: 'USD', evidence: { observed_status: 'paid' }, detected_via: 'signed_webhook',
      first_detected_at: '2026-11-02T10:00:00Z', observation_count: 1, gateway: 'paynow_zimbabwe' }] })
    api.fetchGarageMerchantAccounts.mockResolvedValue({ accounts: [] })
    api.resolveGaragePaymentDiscrepancy.mockResolvedValue({})
    render(<MemoryRouter><GaragePaymentsOperator /></MemoryRouter>)
    const region = await screen.findByTestId('operator-message')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
    fireEvent.click(await screen.findByTestId('operator-resolve'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('operator-resolution')))
    fireEvent.click(screen.getByTestId('operator-resolve-cancel'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('operator-resolve')))
    fireEvent.click(screen.getByTestId('operator-resolve'))
    fireEvent.change(screen.getByTestId('operator-resolution-note'), { target: { value: 'Refunded in the garage’s Paynow dashboard; checked.' } })
    fireEvent.click(screen.getByTestId('operator-resolve-submit'))
    await waitFor(() => expect(screen.getByTestId('operator-message')).toHaveTextContent('Exception closed.'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('operator-message')))
  })
})

describe('Each surface shows the truth in separate parts (R1 directive §4)', () => {
  const settled = () => row({ provider_status: 'paid', provider_status_label: 'This payment was settled outside CarUp. It is not counted on this invoice.', hold_released: true, settled_outside: true, instructions: null,
    facts: facts({ provider: 'Paid', review: 'Reviewed: settled outside CarUp.', next_step: 'If you also paid through Paynow, check its status and tell the garage.' }) },
  { state: 'settled_outside', state_label: 'Settled outside CarUp — not counted on this invoice', payment_status: 'paid' })
  const expects = (scope: HTMLElement) => {
    const f = within(scope).getByTestId('paynow-facts')
    expect(f).toHaveTextContent('Paynow reports')
    expect(f).toHaveTextContent('Paid')
    expect(f).toHaveTextContent('On this invoice')
    expect(f).toHaveTextContent('Not counted on this invoice')
    expect(f).toHaveTextContent('Review')
    expect(f).toHaveTextContent('Reviewed: settled outside CarUp.')
    expect(f).toHaveTextContent('tell the garage')
    expect(f).toHaveTextContent(/Last read/)
  }
  it('the customer’s list', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([settled()]))
    await openHowToPay()
    expects(await screen.findByTestId('my-provider-payment'))
    expect(screen.getByTestId('my-provider-payment')).not.toHaveTextContent(/waiting for you/i)
  })
  it('the customer’s invoice card', () => {
    const inv = { id: 'inv-9', invoice_number: 'INV-000009', currency: 'USD', status: 'issued', payment_status: 'unpaid', issued_at: '2026-11-02T09:00:00Z', due_date: null, voided_at: null,
      lines: [], total_amount: '60.00', paid_amount: '0.00', balance_amount: '60.00', payment_source_label: 'x', customer_note: null, variance: { state: 'no_estimate' }, payments: [], receipts: [],
      provider_receipts: [], provider_payments: [settled()], money: { currency: 'USD', invoice_status: 'issued', total_amount: '60.00', declared_paid: '0.00', provider_paid: '0.00', paid_amount: '0.00',
        balance_amount: '60.00', provider_reserved: '0.00', uncommitted_balance: '60.00', payment_status: 'unpaid' } }
    render(<InvoiceCard invoice={inv as never} />)
    expects(screen.getByTestId('invoice-provider-payment'))
  })
  it('the garage’s panel', () => {
    const inv = { id: 'inv-9', currency: 'USD', status: 'issued', provider_payments_supported: true, provider_receipts: [], provider_source_label: 'x',
      provider_payments: [{ ...settled(), open_discrepancies: [] }], provider_history: [{ event_type: 'hold_released', actor: 'system:expiry', detail: {}, created_at: '2026-11-02T11:00:00Z' }] }
    render(<ProviderPaymentsPanel invoice={inv as never} canAct busy={false} run={vi.fn() as never} />)
    expects(screen.getByTestId('provider-payment-row'))
    const activity = screen.getByTestId('provider-activity-row')
    expect(activity).not.toHaveTextContent('hold_released')
    expect(activity).toHaveTextContent('CarUp')
  })
})

describe('The payment a person is in the middle of stays where they are', () => {
  it('nothing the refresh after Pay can draw sits above the way to pay: the invoice’s lists come after it', () => {
    const card = {
      id: 'inv-9', invoice_number: 'INV-000009', currency: 'USD', status: 'issued', payment_status: 'unpaid', total_amount: '60.00', paid_amount: '0.00', balance_amount: '60.00',
      issued_at: '2026-11-02T10:00:00Z', lines: [], payments: [], receipts: [], payment_source_label: 'x', variance: { state: 'none' }, provider_receipts: [], provider_payments: [row()],
      money: { currency: 'USD', invoice_status: 'issued', total_amount: '60.00', declared_paid: '0.00', provider_paid: '0.00', paid_amount: '0.00', balance_amount: '60.00', provider_reserved: '60.00', uncommitted_balance: '0.00', payment_status: 'unpaid' },
    }
    render(<MemoryRouter><InvoiceCard invoice={card as never} /></MemoryRouter>)
    const pay = screen.getByTestId('invoice-how-to-pay')
    for (const id of ['invoice-payments', 'invoice-provider-payments', 'invoice-receipts']) {
      expect(pay.compareDocumentPosition(screen.getByTestId(id)) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
    }
  })
})

describe('The way to pay comes first in a request (390 px rehearsal)', () => {
  it('a started request shows its code before its separate facts, and takes the focus without leaving it off screen', async () => {
    const scrolled = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrolled
    api.startGarageInvoicePayment.mockResolvedValue({ collection_id: COLL, amount: '60.00', currency: 'USD', cannot_cancel: 'Paynow cannot cancel.', checkout_url: null,
      paynow: pview({ method: 'innbucks', instructions: null, authorization_code: '123456789' }) })
    const started = pview({ method: 'innbucks', instructions: null, authorization_code: '123456789' })
    const { rerender } = render(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['innbucks']) as never} />)
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    await screen.findByTestId('paynow-pending')
    rerender(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['innbucks']) as never} latest={row(started) as never} />)
    const code = await screen.findByTestId('paynow-innbucks-code')
    const facts = await screen.findByTestId('paynow-facts')
    expect(code.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('paynow-pending-heading')).toHaveFocus())
    expect(scrolled).toHaveBeenCalledWith({ block: 'start' })
    Element.prototype.scrollIntoView = original
  })
  it('in the list of payments, the means of payment comes before the separate facts too', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([row({ method: 'innbucks', instructions: null, authorization_code: '123456789' })]))
    await openHowToPay()
    const code = await screen.findByTestId('paynow-innbucks-code')
    expect(code.compareDocumentPosition(screen.getByTestId('paynow-facts')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('PFR-L3: the garage reads a part-counted payment with its refund guidance', () => {
  it('a part that counted can be refunded in the Paynow dashboard, as a whole one can', () => {
    const part = row({ provider_status: 'paid', facts: facts({ provider: 'Paid', counted: true, allocation: 'Counted on this invoice: 30.00 USD', review: 'CarUp is reviewing the money that is not counted.' }) },
      { state: 'confirmed_partial', state_label: 'Paid at Paynow — part counted on this invoice, the rest under review', payment_status: 'paid', open_discrepancies: [] })
    const inv = { id: 'inv-9', currency: 'USD', status: 'issued', provider_payments_supported: true, provider_receipts: [], provider_source_label: 'x', provider_payments: [part], provider_history: [] }
    render(<ProviderPaymentsPanel invoice={inv as never} canAct busy={false} run={vi.fn() as never} />)
    expect(screen.getByTestId('provider-payment-paynow-refund-guidance')).toBeInTheDocument()
  })
})

describe('ICR-W7: no dead ends while the money stays reserved', () => {
  it('the InnBucks code stays on screen past CarUp’s time; the stop warning says the amount stays reserved', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([
      row({ method: 'innbucks', provider_status: 'sent', authorization_code: '718114681', authorization_expires: '2-Nov-2026 18:00', instructions: null },
        { state: 'expired', state_label: 'Past CarUp’s time — the amount stays reserved while CarUp checks with Paynow (not counted)' }),
      row({}, { id: 'c2' }),
    ]))
    await openHowToPay()
    const [expired, open] = await screen.findAllByTestId('my-provider-payment')
    expect(within(expired).getByTestId('paynow-innbucks-code')).toHaveTextContent('718114681')
    fireEvent.click(within(open).getByTestId('my-provider-payment-stop'))
    expect(within(open).getByTestId('my-provider-payment-stop-ask')).toHaveTextContent(/stays reserved/)
    expect(within(open).getByTestId('my-provider-payment-stop-ask')).not.toHaveTextContent(/still counts/)
  })
  it('a request with no address for the code says what to do instead of offering a form', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([row({ method: 'omari', needs_otp: false, otp_unavailable: true, instructions: null })]))
    await openHowToPay()
    const listed = await screen.findByTestId('my-provider-payment')
    expect(within(listed).queryByTestId('paynow-otp')).toBeNull()
    expect(within(listed).getByTestId('paynow-otp-unavailable')).toHaveTextContent(/check its status/i)
  })
})

describe('Duplicate-payment prompts', () => {
  it('an earlier request with money at Paynow says so, and no checkout is offered', async () => {
    api.fetchGarageInvoicePaymentOptions.mockResolvedValue(options({ online_payment: { available: false, reason: 'earlier_request_unresolved' }, provider_payments: [row({ hold_released: true, provider_status: 'delivered' }, { state: 'released' })] }))
    await openHowToPay()
    expect(await screen.findByTestId('online-payment-unavailable')).toHaveTextContent(/earlier/i)
    expect(screen.queryByTestId('paynow-checkout')).toBeNull()
  })
  it('an earlier released request warns before a new one starts', () => {
    render(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['ecocash'], { earlier_request: 'An earlier Paynow request for this invoice was released. Do not approve it on your phone.' }) as never} />)
    expect(screen.getByTestId('paynow-earlier-request')).toHaveTextContent(/do not approve/i)
  })
})

describe('ICR-W6: the operator is offered only what the database would allow', () => {
  const held = (over: Record<string, unknown>) => ({ collection_id: 'c', garage: 'P5 Garage', invoice_number: 'INV-1', amount: '70.00', currency: 'USD', initiated_at: '',
    expires_at: new Date(Date.now() - 3_600_000).toISOString(), stopped_at: null, state: 'expired', state_label: 'Past CarUp’s time', released: false, settled: false,
    can_release: true, release_blocked_reason: null, paynow: pview({ facts: facts() }), ...over })
  it('a request Paynow reports paid: no release, and it says why', async () => {
    api.fetchPaynowHeldCollections.mockResolvedValue({ held: [held({ collection_id: 'c-paid', state: 'under_review', state_label: 'Under review — not counted', can_release: false,
      release_blocked_reason: 'Paynow reports money on this request.', paynow: pview({ provider_status: 'delivered', facts: facts({ provider: 'Paid into Paynow and held by Paynow', review: 'CarUp is reviewing this payment.' }) }) })] })
    render(<PaynowOperatorPanel />)
    const row1 = await screen.findByTestId('paynow-op-held')
    expect(row1).toHaveTextContent('Under review')
    expect(within(row1).queryByTestId('paynow-op-release')).toBeNull()
    expect(within(row1).getByTestId('paynow-op-release-blocked')).toHaveTextContent('Paynow reports money on this request.')
    expect(within(row1).getByTestId('paynow-op-held-check')).toBeEnabled()
  })
  it('a request it may release keeps its action', async () => {
    api.fetchPaynowHeldCollections.mockResolvedValue({ held: [held({ collection_id: 'c-ok' })] })
    render(<PaynowOperatorPanel />)
    const row1 = await screen.findByTestId('paynow-op-held')
    fireEvent.change(within(row1).getByTestId('paynow-op-reason-release-c-ok'), { target: { value: 'Customer abandoned the request.' } })
    expect(within(row1).getByTestId('paynow-op-release')).toBeEnabled()
  })
  it('released and settled requests stay on the page, can be read again, and offer no release', async () => {
    api.fetchPaynowHeldCollections.mockResolvedValue({ held: [held({ collection_id: 'c-rel', state: 'released', state_label: 'Released by CarUp', released: true, can_release: false, release_blocked_reason: 'Already released.', paynow: pview({ hold_released: true }) }),
      held({ collection_id: 'c-set', state: 'settled_outside', state_label: 'Settled outside CarUp', released: true, settled: true, can_release: false, release_blocked_reason: 'Already released.', paynow: pview({ hold_released: true, settled_outside: true }) })] })
    render(<PaynowOperatorPanel />)
    const rows = await screen.findAllByTestId('paynow-op-held')
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(within(r).getByTestId('paynow-op-held-check')).toBeEnabled()
      expect(within(r).queryByTestId('paynow-op-release')).toBeNull()
    }
  })
})

describe('ICR-P1: verification asks for each integration’s own settlement currency', () => {
  const merchant = { id: 'm1', tenant_id: 't1', gateway: 'paynow_zimbabwe', display_name: 'P5 Motors', merchant_reference: 'pnm_x', currencies: ['USD', 'ZWG'], status: 'pending_verification',
    registered_by: 'u1', registered_at: '', suspended_at: null, suspended_reason: null, profile: null, history: [], garage_name: 'P5 Garage',
    integrations: [{ id: 'i-usd', currency: 'USD', integration_id: '1', methods: ['web'], mode: 'simulator', status: 'pending_verification', credential_fingerprint: 'a', registered_at: '', verified_at: null, verified_by: null, closed_at: null, closed_reason: null, probe: null },
      { id: 'i-zwg', currency: 'ZWG', integration_id: '2', methods: ['web'], mode: 'simulator', status: 'pending_verification', credential_fingerprint: 'b', registered_at: '', verified_at: null, verified_by: null, closed_at: null, closed_reason: null, probe: null }] }
  it('sends each one, and cannot verify while a currency differs or a reference is missing', async () => {
    api.fetchPaynowMerchants.mockResolvedValue({ merchants: [merchant], availability })
    api.verifyPaynowMerchant.mockResolvedValue({})
    render(<PaynowOperatorPanel />)
    await screen.findByTestId('paynow-op-merchant')
    fireEvent.click(screen.getByTestId('paynow-op-legal'))
    fireEvent.click(screen.getByTestId('paynow-op-settlement'))
    fireEvent.click(screen.getByTestId('paynow-op-currency'))
    fireEvent.change(screen.getByTestId('paynow-op-note'), { target: { value: 'Reviewed the merchant.' } })
    const verify = screen.getByTestId('paynow-op-verify')
    expect(verify).toBeDisabled()
    expect(screen.getByTestId('paynow-op-verify-why')).toHaveTextContent(/settlement currency/i)
    fireEvent.change(screen.getByTestId('paynow-op-settles-i-usd'), { target: { value: 'USD' } })
    fireEvent.change(screen.getByTestId('paynow-op-settles-ref-i-usd'), { target: { value: 'Merchant settlement page, USD.' } })
    fireEvent.change(screen.getByTestId('paynow-op-settles-i-zwg'), { target: { value: 'USD' } })
    fireEvent.change(screen.getByTestId('paynow-op-settles-ref-i-zwg'), { target: { value: 'Merchant settlement page, ZWG.' } })
    expect(verify).toBeDisabled()
    expect(screen.getByTestId('paynow-op-settles-mismatch-i-zwg')).toHaveTextContent(/cannot collect/i)
    fireEvent.change(screen.getByTestId('paynow-op-settles-i-zwg'), { target: { value: 'ZWG' } })
    expect(verify).toBeEnabled()
    fireEvent.click(verify)
    await waitFor(() => expect(api.verifyPaynowMerchant).toHaveBeenCalled())
    expect(api.verifyPaynowMerchant.mock.calls[0][1].currency_evidence).toEqual({
      'i-usd': { settlement_currency: 'USD', reference: 'Merchant settlement page, USD.' },
      'i-zwg': { settlement_currency: 'ZWG', reference: 'Merchant settlement page, ZWG.' },
    })
  })
})

describe('ICR-W12: an edit does not mint a new request', () => {
  it('after a lost answer, editing a field and restoring it retries the SAME request', async () => {
    const started = { collection_id: COLL, gateway: 'paynow_zimbabwe', replayed: true, simulated: true, amount: '60.00', currency: 'USD', expires_at: '', checkout_url: null, paynow: pview(), notice: '', cannot_cancel: 'x' }
    api.startGarageInvoicePayment.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(started)
    render(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['ecocash']) as never} />)
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    await screen.findByTestId('paynow-error')
    const firstKey = api.startGarageInvoicePayment.mock.calls[0][2]
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234568' } })
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    await screen.findByTestId('paynow-pending')
    expect(api.startGarageInvoicePayment.mock.calls[1][2]).toBe(firstKey)
  })
  it('a different amount is a different request', async () => {
    api.startGarageInvoicePayment.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['web']) as never} />)
    fireEvent.click(screen.getByTestId('paynow-start'))
    await screen.findByTestId('paynow-error')
    fireEvent.change(screen.getByTestId('paynow-amount'), { target: { value: '30.00' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    await waitFor(() => expect(api.startGarageInvoicePayment).toHaveBeenCalledTimes(2))
    expect(api.startGarageInvoicePayment.mock.calls[1][2]).not.toBe(api.startGarageInvoicePayment.mock.calls[0][2])
  })
})

describe('ICR-W13: a disabled control says why', () => {
  it('Pay names what is missing, tied to the field and to the button', () => {
    render(<PaynowCheckout invoiceId="inv-9" option={paynowOption(['ecocash']) as never} />)
    const hint = screen.getByTestId('paynow-phone-hint')
    expect(screen.getByTestId('paynow-phone').getAttribute('aria-describedby')).toContain(hint.id)
    expect(screen.getByTestId('paynow-start').getAttribute('aria-describedby')).toContain(hint.id)
  })
})
