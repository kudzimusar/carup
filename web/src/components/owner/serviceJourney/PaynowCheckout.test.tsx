import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CustomerInvoice } from '@/lib/garageBusiness'

/**
 * CARUP-PAY-05 — the customer pays the garage through the garage's OWN Paynow account. Truth rules: only enabled
 * methods are offered, a phone is asked for where Paynow needs one, a Paynow page is the only redirect, express methods
 * show Paynow's own instructions/code/OTP step, and nothing reads "paid" before Paynow's status is Paid and counted.
 */
const fetchGarageInvoicePaymentOptions = vi.fn()
const startGarageInvoicePayment = vi.fn()
const verifyGarageInvoicePayment = vi.fn()
const cancelGarageInvoicePayment = vi.fn()
const submitPaynowOtp = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageInvoicePaymentOptions, startGarageInvoicePayment, verifyGarageInvoicePayment, cancelGarageInvoicePayment, submitPaynowOtp }),
}))
const { default: InvoicePayment } = await import('./InvoicePayment')

const invoice = { id: 'inv-9', invoice_number: 'INV-000009', currency: 'USD', status: 'issued', balance_amount: '60.00' } as unknown as CustomerInvoice
const option = (methods = ['web', 'ecocash', 'innbucks', 'omari']) => ({
  available: true, gateway: 'paynow_zimbabwe', provider: 'paynow', simulated: true, merchant_display_name: 'P5 Motors (Paynow)', max_amount: '60.00',
  currency: 'USD', methods, simulation_notice: 'Simulated Paynow — local test environment. No real money moves.',
  notices: { no_redirect_proof: 'Coming back from Paynow is not proof of payment. CarUp checks with Paynow.', cannot_cancel: 'Paynow cannot cancel a payment request.', channel: '' },
})
const options = (over: Record<string, unknown> = {}) => ({
  invoice_id: 'inv-9', invoice_number: 'INV-000009', status: 'issued', currency: 'USD',
  money: { currency: 'USD', invoice_status: 'issued', total_amount: '60.00', declared_paid: '0.00', provider_paid: '0.00', paid_amount: '0.00',
    balance_amount: '60.00', provider_reserved: '0.00', uncommitted_balance: '60.00', payment_status: 'unpaid' },
  payment_instructions: null, instructions_missing_label: 'The garage has not published payment instructions on CarUp yet.',
  online_payment: option(), provider_payments: [], provider_receipts: [], labels: { declared: '', provider: '', in_flight: '' }, ...over,
})
const paynowView = (over: Record<string, unknown> = {}) => ({
  method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone',
  checkout_url: null, instructions: 'Dial *151*2*4# and enter your EcoCash PIN.', authorization_code: null, authorization_expires: null, otp_reference: null,
  needs_otp: false, phone: '077*****67', hold_released: false, ...over,
})
const COLLECTION = '11111111-2222-3333-4444-555555555555'
const started = (paynow: Record<string, unknown>, checkout_url: string | null = null) => ({
  collection_id: COLLECTION, gateway: 'paynow_zimbabwe', replayed: false, simulated: true, amount: '60.00', currency: 'USD',
  expires_at: '', checkout_url, paynow: paynowView(paynow), notice: '', cannot_cancel: 'Paynow cannot cancel a payment request.',
})
/** The customer's provider-payments row for a Paynow request, as the payment-options read lists it. */
const row = (paynow: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  id: COLLECTION, amount: '60.00', currency: 'USD', initiated_at: '2026-11-02T10:00:00Z', expires_at: '2026-11-02T10:30:00Z', cancelled_at: null,
  state: 'awaiting_provider', state_label: 'Waiting for the provider to confirm', payment_status: 'pending', gateway: 'paynow_zimbabwe', simulated: true,
  source_label: '', paynow: paynowView(paynow), ...over,
})
/** A network read answers later than the click that caused it: same-tick mocks hid W1. */
const later = <T,>(value: T, ms = 50) => new Promise<T>((resolve) => { setTimeout(() => resolve(value), ms) })

async function openPaynow() {
  render(<InvoicePayment invoice={invoice} />)
  fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
  return screen.findByTestId('paynow-checkout')
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, writable: true })
  fetchGarageInvoicePaymentOptions.mockResolvedValue(options())
})

describe('Paying the garage with Paynow', () => {
  it('replaces the generic provider form and says the money is the garage’s, and a return is no proof', async () => {
    await openPaynow()
    expect(screen.queryByTestId('online-payment-start')).toBeNull()
    expect(screen.getByText(/The money goes to P5 Motors \(Paynow\), not to CarUp/)).toBeInTheDocument()
    expect(screen.getByTestId('paynow-no-redirect-proof')).toHaveTextContent('not proof of payment')
    expect(screen.getByTestId('paynow-simulated')).toHaveTextContent('No real money moves')
  })

  it('offers only the methods the garage’s integration enables', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options({ online_payment: option(['web', 'ecocash']) }))
    await openPaynow()
    expect(screen.getByTestId('paynow-method-web')).toBeInTheDocument()
    expect(screen.getByTestId('paynow-method-ecocash')).toBeInTheDocument()
    expect(screen.queryByTestId('paynow-method-innbucks')).toBeNull()
    expect(screen.queryByTestId('paynow-method-omari')).toBeNull()
    expect(screen.getByRole('group', { name: /How do you want to pay/ })).toBeInTheDocument()
  })

  it('the Paynow page method redirects only to the URL the server returned', async () => {
    startGarageInvoicePayment.mockResolvedValue(started({ method: 'web', provider_status: 'created' }, 'http://127.0.0.1:5061/Payment/ConfirmPayment/x'))
    await openPaynow()
    fireEvent.click(screen.getByTestId('paynow-start'))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('http://127.0.0.1:5061/Payment/ConfirmPayment/x'))
    expect(startGarageInvoicePayment).toHaveBeenCalledWith('inv-9', { amount: '60.00', method: 'web' }, expect.any(String))
  })

  it('EcoCash needs a valid phone, then shows Paynow’s instructions and never claims success before Paynow does', async () => {
    startGarageInvoicePayment.mockResolvedValue(started({}))
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'awaiting_provider' }, applied: true, refused: null, duplicate_event: false,
      payment_status: 'pending', money: {}, paynow: paynowView({ provider_status: 'awaiting_delivery', provider_status_label: 'Paid to Paynow — held by Paynow' }) })
    await openPaynow()
    fireEvent.click(screen.getByTestId('paynow-method-ecocash'))
    expect(screen.getByTestId('paynow-start')).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '12345' } })
    expect(screen.getByTestId('paynow-phone-problem')).toHaveTextContent('Zimbabwe mobile number')
    expect(screen.getByTestId('paynow-start')).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-pending')).toBeInTheDocument()
    expect(startGarageInvoicePayment).toHaveBeenCalledWith('inv-9', { amount: '60.00', method: 'ecocash', phone: '0771234567' }, expect.any(String))
    expect(window.location.assign).not.toHaveBeenCalled()
    expect(screen.getByTestId('paynow-instructions')).toHaveTextContent('EcoCash PIN')
    expect(screen.getByTestId('paynow-cannot-cancel')).toHaveTextContent('Paynow cannot cancel')
    expect(screen.queryByText(/It now counts on the invoice/)).toBeNull()
    fireEvent.click(screen.getByTestId('paynow-check'))
    const said = await screen.findByTestId('paynow-outcome')
    expect(said).toHaveTextContent(/held by Paynow/)
    expect(said).toHaveAttribute('data-tone', 'wait')
  })

  it('InnBucks asks for the payer’s mobile number, sends it, then shows its code', async () => {
    startGarageInvoicePayment.mockResolvedValueOnce(started({ method: 'innbucks', authorization_code: '123456789', authorization_expires: '2-Nov-2026 18:00', phone: '077*****67' }))
    await openPaynow()
    fireEvent.click(screen.getByTestId('paynow-method-innbucks'))
    expect(screen.getByLabelText('InnBucks mobile number')).toBe(screen.getByTestId('paynow-phone'))
    expect(screen.getByTestId('paynow-start')).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-innbucks-code')).toHaveTextContent('123456789')
    expect(startGarageInvoicePayment).toHaveBeenCalledWith('inv-9', { amount: '60.00', method: 'innbucks', phone: '0771234567' }, expect.any(String))
  })

  it('O’mari: the OTP is checked locally, sent to CarUp, and the outcome is Paynow’s', async () => {
    startGarageInvoicePayment.mockResolvedValue(started({ method: 'omari', needs_otp: true, otp_reference: 'OTP1001' }))
    submitPaynowOtp.mockResolvedValue({ collection: { state: 'confirmed' }, applied: true, refused: null, duplicate_event: false, payment_status: 'paid',
      money: {}, paynow: paynowView({ method: 'omari', provider_status: 'paid', needs_otp: false }) })
    await openPaynow()
    fireEvent.click(screen.getByTestId('paynow-method-omari'))
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0711234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-otp')).toHaveTextContent('OTP1001')
    fireEvent.change(screen.getByTestId('paynow-otp-input'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    expect(await screen.findByTestId('paynow-otp-problem')).toHaveTextContent('numbers only')
    expect(submitPaynowOtp).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('paynow-otp-input'), { target: { value: '483920' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    expect(await screen.findByTestId('paynow-outcome')).toHaveAttribute('data-tone', 'ok')
    expect(submitPaynowOtp).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555', '483920')
  })

  it('a Paynow refusal reads as nothing charged, and the next try is a new request', async () => {
    startGarageInvoicePayment.mockRejectedValueOnce(new Error('PAY05_PROVIDER_REFUSED'))
    await openPaynow()
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-error')).toHaveTextContent('Paynow refused this payment request. Nothing was charged.')
    const firstKey = startGarageInvoicePayment.mock.calls[0][2]
    startGarageInvoicePayment.mockResolvedValueOnce(started({ method: 'web', provider_status: 'created' }, 'http://127.0.0.1:5061/Payment/ConfirmPayment/y'))
    fireEvent.click(screen.getByTestId('paynow-start'))
    await waitFor(() => expect(startGarageInvoicePayment).toHaveBeenCalledTimes(2))
    expect(startGarageInvoicePayment.mock.calls[1][2]).not.toBe(firstKey)
  })

  it('W1: a started express payment stays on screen while How to pay refreshes in place', async () => {
    startGarageInvoicePayment.mockResolvedValueOnce(started({ method: 'innbucks', authorization_code: '123456789', authorization_expires: '2-Nov-2026 18:00' }))
    await openPaynow()
    let refreshes = 0
    fetchGarageInvoicePaymentOptions.mockImplementation(() => { refreshes += 1; return later(options()) })
    fireEvent.click(screen.getByTestId('paynow-method-innbucks'))
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0771234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-innbucks-code', {}, { timeout: 2000 })).toHaveTextContent('123456789')
    expect(screen.queryByTestId('how-to-pay-loading')).toBeNull()
    await waitFor(() => expect(refreshes).toBe(1))
    await act(() => later(null, 80)) // the refresh answers
    expect(screen.getByTestId('paynow-innbucks-code')).toHaveTextContent('123456789')
    expect(screen.queryByTestId('how-to-pay-loading')).toBeNull()
  })

  it('W1: once the whole balance is in progress, the checkout keeps showing the request it started — once, and as last read', async () => {
    startGarageInvoicePayment.mockResolvedValueOnce(started({ method: 'omari', needs_otp: true, otp_reference: 'OTP1001' }))
    await openPaynow()
    // the realistic refresh: nothing is left to start (online payment is "in progress") and the request is listed below
    fetchGarageInvoicePaymentOptions.mockImplementation(() => later(options({
      online_payment: { available: false, reason: 'payment_in_progress' },
      provider_payments: [row({ method: 'omari', needs_otp: true, otp_reference: 'OTP1002' })],
    })))
    fireEvent.click(screen.getByTestId('paynow-method-omari'))
    fireEvent.change(screen.getByTestId('paynow-phone'), { target: { value: '0711234567' } })
    fireEvent.click(screen.getByTestId('paynow-start'))
    expect(await screen.findByTestId('paynow-otp', {}, { timeout: 2000 })).toHaveTextContent('OTP1001')
    await act(() => later(null, 80))
    expect(screen.getByTestId('my-provider-payment')).toBeInTheDocument()
    expect(screen.getAllByTestId('paynow-otp')).toHaveLength(1)
    const checkout = screen.getByTestId('paynow-checkout')
    expect(within(checkout).getByTestId('paynow-otp')).toHaveTextContent('OTP1002')
    expect(within(checkout).getByTestId('paynow-otp-input')).toBeInTheDocument()
  })

  it('an existing Paynow payment shows Paynow’s own status and a stop that says Paynow cannot cancel', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options({
      online_payment: { available: false, reason: 'payment_in_progress' },
      provider_payments: [{ id: 'c1', amount: '60.00', currency: 'USD', initiated_at: '2026-11-02T10:00:00Z', expires_at: '', cancelled_at: null,
        state: 'awaiting_provider', state_label: 'Waiting for the provider to confirm', payment_status: 'pending', gateway: 'paynow_zimbabwe', simulated: true,
        source_label: '', paynow: paynowView() }],
    }))
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    expect(await screen.findByTestId('my-provider-payment-paynow')).toHaveTextContent('approve the payment on your phone')
    fireEvent.click(screen.getByTestId('my-provider-payment-stop'))
    expect(screen.getByTestId('my-provider-payment-stop-ask')).toHaveTextContent('Paynow cannot cancel a payment request')
  })
})

describe('Continuing a Paynow payment already on the invoice (W2)', () => {
  const inProgress = (rows: unknown[]) => options({ online_payment: { available: false, reason: 'payment_in_progress' }, provider_payments: rows })

  it('each in-progress Paynow row offers what Paynow gave — its page link or an InnBucks code — or says plainly there is no link', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([
      row({ method: 'web', provider_status: 'created', checkout_url: 'http://127.0.0.1:5061/Payment/ConfirmPayment/z', instructions: null }, { id: 'c-web' }),
      row({ method: 'innbucks', authorization_code: '987654321', authorization_expires: '2-Nov-2026 18:00', instructions: null }, { id: 'c-inn' }),
      row({ method: 'web', provider_status: null, initiation: 'unknown', checkout_url: null, instructions: null }, { id: 'c-traced' }),
      row({ method: 'ecocash', provider_status: 'paid' }, { id: 'c-paid', state: 'confirmed', state_label: 'Confirmed by the provider' }),
    ]))
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    const rows = await screen.findAllByTestId('my-provider-payment')
    expect(within(rows[0]).getByRole('link', { name: 'Continue on Paynow' })).toHaveAttribute('href', 'http://127.0.0.1:5061/Payment/ConfirmPayment/z')
    expect(within(rows[1]).getByTestId('paynow-innbucks-code')).toHaveTextContent('987654321')
    expect(within(rows[2]).getByTestId('paynow-no-link')).toHaveTextContent('Paynow did not give CarUp a page link for this request; check its status or stop waiting.')
    expect(within(rows[3]).queryByTestId('paynow-continue')).toBeNull()
  })

  it('O’mari: the code form is on the row; Paynow’s answer shows there and the invoice refreshes', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(inProgress([row({ method: 'omari', provider_status: 'created', needs_otp: true, otp_reference: 'OTP1001', instructions: null })]))
    submitPaynowOtp.mockResolvedValue({ collection: { state: 'confirmed' }, applied: true, refused: null, duplicate_event: false, payment_status: 'paid',
      money: {}, paynow: paynowView({ method: 'omari', provider_status: 'paid', needs_otp: false }) })
    const onChanged = vi.fn()
    render(<InvoicePayment invoice={invoice} onChanged={onChanged} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    const listed = await screen.findByTestId('my-provider-payment')
    expect(within(listed).getByTestId('paynow-otp')).toHaveTextContent('OTP1001')
    fireEvent.change(within(listed).getByTestId('paynow-otp-input'), { target: { value: '483920' } })
    fireEvent.click(within(listed).getByTestId('paynow-otp-submit'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(submitPaynowOtp).toHaveBeenCalledWith(COLLECTION, '483920')
    expect(fetchGarageInvoicePaymentOptions).toHaveBeenCalledTimes(2)
    expect(await screen.findByTestId('my-provider-payment-outcome')).toHaveTextContent('Paynow confirmed your payment')
  })
})
