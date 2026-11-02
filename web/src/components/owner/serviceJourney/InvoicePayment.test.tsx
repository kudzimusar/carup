import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CustomerInvoice } from '@/lib/garageBusiness'

/**
 * CARUP-PAY-04 — "How to pay" on the customer's invoice. Truth rules, not snapshots: the garage is paid (never CarUp),
 * a failed load is never "nothing to pay", online payment appears only when the server says it exists, and a retried
 * start reuses its idempotency key.
 */
const fetchGarageInvoicePaymentOptions = vi.fn()
const startGarageInvoicePayment = vi.fn()
const verifyGarageInvoicePayment = vi.fn()
const cancelGarageInvoicePayment = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageInvoicePaymentOptions, startGarageInvoicePayment, verifyGarageInvoicePayment, cancelGarageInvoicePayment }),
}))
const { default: InvoicePayment } = await import('./InvoicePayment')

const invoice = { id: 'inv-1', invoice_number: 'INV-000001', currency: 'USD', status: 'issued', balance_amount: '150.00' } as unknown as CustomerInvoice
const DISCLOSURE = 'These payment instructions come from the garage. Pay the garage directly. CarUp does not receive, hold or verify this money.'

function options(over: Record<string, unknown> = {}) {
  return {
    invoice_id: 'inv-1', invoice_number: 'INV-000001', status: 'issued', currency: 'USD',
    money: { currency: 'USD', invoice_status: 'issued', total_amount: '150.00', declared_paid: '0.00', provider_paid: '0.00', paid_amount: '0.00',
      balance_amount: '150.00', provider_reserved: '0.00', uncommitted_balance: '150.00', payment_status: 'unpaid' },
    payment_instructions: { id: 'i1', version: 2, status: 'active', payee_name: 'Hilux Motors (Pvt) Ltd', instructions: 'Pay at the front desk.',
      accepted_methods: ['cash', 'mobile_money'], currencies: ['USD'], created_at: '', superseded_at: null, disclosure: DISCLOSURE },
    instructions_missing_label: null,
    online_payment: { available: true, simulated: true, merchant_display_name: 'Hilux Motors (simulated)', max_amount: '150.00', currency: 'USD',
      simulation_notice: 'Simulated payment provider — test environment. No real money moves.' },
    provider_payments: [], provider_receipts: [],
    labels: { declared: '', provider: '', in_flight: '' },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, writable: true })
})

describe('How to pay', () => {
  it('shows the garage’s own instructions with the CarUp disclosure', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options())
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    expect(await screen.findByTestId('instructions-text')).toHaveTextContent('Pay at the front desk.')
    expect(screen.getByText(/Pay Hilux Motors \(Pvt\) Ltd/)).toBeInTheDocument()
    expect(screen.getByTestId('instructions-disclosure')).toHaveTextContent('CarUp does not receive, hold or verify this money')
    expect(screen.getByText(/Accepted: Cash, Mobile money/)).toBeInTheDocument()
  })

  it('a failed load is an error with a retry — never an empty "nothing to pay"', async () => {
    fetchGarageInvoicePaymentOptions.mockRejectedValue(new Error('network'))
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    expect(await screen.findByTestId('how-to-pay-error')).toHaveTextContent('could not be loaded')
    expect(screen.queryByTestId('online-payment')).toBeNull()
    expect(screen.queryByText(/Nothing is left to pay/)).toBeNull()
  })

  it('online payment goes to the garage’s provider, says it is simulated, and reuses one key on retry', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options())
    startGarageInvoicePayment.mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce({ collection_id: 'c1', checkout_url: 'http://127.0.0.1:5041/api/pay04/simulator/checkout/gsim_co_x', replayed: false })
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    expect(await screen.findByTestId('online-payment-simulated')).toHaveTextContent('No real money moves')
    expect(screen.getByText(/The money goes to Hilux Motors \(simulated\), not to CarUp/)).toBeInTheDocument()
    expect(screen.getByTestId('online-payment-amount')).toHaveValue('150.00')
    fireEvent.click(screen.getByTestId('online-payment-start'))
    expect(await screen.findByTestId('online-payment-error')).toHaveTextContent('Temporarily unavailable')
    expect(window.location.assign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('online-payment-start'))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('http://127.0.0.1:5041/api/pay04/simulator/checkout/gsim_co_x'))
    const [[, , key1], [, , key2]] = startGarageInvoicePayment.mock.calls
    expect(key1).toBe(key2)
  })

  it('says plainly when online payment is not offered, and why', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options({ online_payment: { available: false, reason: 'garage_not_connected' }, payment_instructions: null, instructions_missing_label: 'The garage has not published payment instructions on CarUp yet. Ask the garage how to pay.' }))
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    expect(await screen.findByTestId('online-payment-unavailable')).toHaveTextContent('does not take payments through CarUp')
    expect(screen.getByTestId('instructions-missing')).toHaveTextContent('Ask the garage how to pay')
    expect(screen.queryByTestId('online-payment-start')).toBeNull()
  })

  it('checking a payment in progress never claims success before the provider confirms it', async () => {
    fetchGarageInvoicePaymentOptions.mockResolvedValue(options({ provider_payments: [{ id: 'c1', amount: '50.00', currency: 'USD', initiated_at: '2026-11-02T00:00:00Z',
      expires_at: '2026-11-02T00:30:00Z', cancelled_at: null, state: 'awaiting_provider', state_label: 'Waiting for the provider to confirm', payment_status: 'pending',
      gateway: 'pay04_garage_provider_simulator', simulated: true, source_label: '' }] }))
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'awaiting_provider', state_label: 'Waiting for the provider to confirm' }, applied: true, money: {} })
    render(<InvoicePayment invoice={invoice} />)
    fireEvent.click(screen.getByTestId('how-to-pay-toggle'))
    fireEvent.click(await screen.findByTestId('my-provider-payment-check'))
    const message = await screen.findByTestId('my-provider-payment-outcome')
    expect(message).toHaveTextContent('has not confirmed this payment yet')
    expect(message).not.toHaveTextContent('confirmed your payment')
  })
})
