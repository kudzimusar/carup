import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** CARUP-PAY-04 — the garage's own money, per currency, every source named, failures stated. */
const fetchGarageFinancialOverview = vi.fn()
const fetchGaragePaymentInstructions = vi.fn()
const saveGaragePaymentInstructions = vi.fn()
let role = 'admin'
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageFinancialOverview, fetchGaragePaymentInstructions, saveGaragePaymentInstructions }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', active_tenant: { role } } }) }))
const { default: GaragePayments } = await import('./GaragePayments')

const overview = {
  currencies: [
    { currency: 'USD', invoiced: '300.00', declared_paid: '80.00', provider_paid: '120.00', outstanding: '100.00', in_flight: '50.00',
      counts: { issued: 2, voided: 1, unpaid: 0, partially_paid: 1, paid: 1 } },
    { currency: 'ZWG', invoiced: '20.00', declared_paid: '0.00', provider_paid: '0.00', outstanding: '20.00', in_flight: '0.00',
      counts: { issued: 1, voided: 0, unpaid: 1, partially_paid: 0, paid: 0 } },
  ],
  truncated: false, invoice_count: 4, open_discrepancies: 1,
  provider: { connected: true, gateway: 'pay04_garage_provider_simulator', simulated: true, display_name: 'Hilux Motors (simulated)', currencies: ['USD'], status: 'simulated' },
  provider_payments_enabled: true, payment_instructions: null,
  revenue_owner_note: 'All amounts are the garage’s own invoices and receipts. CarUp is not paid any of this money.',
  labels: { declared: '', provider: '' },
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'admin'
  fetchGarageFinancialOverview.mockResolvedValue(overview)
  fetchGaragePaymentInstructions.mockResolvedValue({ active: null, history: [], disclosure: '' })
})
const page = () => render(<MemoryRouter><GaragePayments /></MemoryRouter>)

describe('Garage invoices and payments', () => {
  it('shows one card per currency with every source named — never a cross-currency total', async () => {
    page()
    const cards = await screen.findAllByTestId('garage-money-currency')
    expect(cards.map((c) => c.getAttribute('data-currency'))).toEqual(['USD', 'ZWG'])
    expect(cards[0]).toHaveTextContent('Recorded by the garage80.00 USD')
    expect(cards[0]).toHaveTextContent('Confirmed by your payment provider120.00 USD')
    expect(cards[0]).toHaveTextContent('With the provider — in progress or under review (not counted)50.00 USD')
    expect(screen.queryByText(/320\.00/)).toBeNull()
    expect(screen.getByTestId('garage-money-owner-note')).toHaveTextContent('CarUp is not paid any of this money')
    expect(screen.getByTestId('garage-money-discrepancies')).toHaveTextContent('1 provider-payment exception is under review')
    expect(screen.getByTestId('garage-money-discrepancies')).toHaveTextContent('money it concerns is not counted')
    expect(screen.getByTestId('garage-provider-status')).toHaveTextContent('Simulated provider')
  })

  it('a failed overview is an error, not "nothing owed"', async () => {
    fetchGarageFinancialOverview.mockRejectedValue(new Error('Database unavailable'))
    page()
    expect(await screen.findByTestId('garage-money-error')).toHaveTextContent('not a statement that nothing is owed or received')
    expect(screen.queryByTestId('garage-money-empty')).toBeNull()
  })

  it('publishes payment instructions as a new version and reports the server’s version', async () => {
    saveGaragePaymentInstructions.mockResolvedValue({ active: { id: 'i1', version: 1, payee_name: 'Hilux Motors', instructions: 'Pay at the desk please.', accepted_methods: ['cash'], currencies: ['USD'] }, history: [], disclosure: '' })
    page()
    fireEvent.change(await screen.findByTestId('instructions-payee'), { target: { value: 'Hilux Motors' } })
    fireEvent.change(screen.getByTestId('instructions-text-input'), { target: { value: 'Pay at the desk please.' } })
    fireEvent.click(screen.getByTestId('instructions-method-cash'))
    fireEvent.change(screen.getByTestId('instructions-currencies'), { target: { value: 'usd' } })
    fireEvent.click(screen.getByTestId('instructions-save'))
    await waitFor(() => expect(saveGaragePaymentInstructions).toHaveBeenCalledWith({ payee_name: 'Hilux Motors', instructions: 'Pay at the desk please.', accepted_methods: ['cash'], currencies: ['USD'] }))
    expect(await screen.findByTestId('instructions-save-message')).toHaveTextContent('Saved as version 1')
  })

  it('a refused save shows the server’s words and claims nothing was published', async () => {
    saveGaragePaymentInstructions.mockRejectedValue(new Error('Only a garage administrator can do that.'))
    page()
    fireEvent.click(await screen.findByTestId('instructions-save'))
    const msg = await screen.findByTestId('instructions-save-message')
    expect(msg).toHaveTextContent('Only a garage administrator can do that.')
    expect(msg).toHaveAttribute('role', 'alert')
  })

  it('is closed to anyone but the garage administrator (no money request is made)', () => {
    role = 'mechanic'
    page()
    expect(screen.getByTestId('garage-payments-admin-only')).toBeInTheDocument()
    expect(fetchGarageFinancialOverview).not.toHaveBeenCalled()
  })
})
