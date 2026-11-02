import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** CARUP-PAY-04 — operators review garage payment evidence and close exceptions with a written note. */
const fetchGaragePaymentExceptions = vi.fn()
const resolveGaragePaymentDiscrepancy = vi.fn()
const fetchGarageMerchantAccounts = vi.fn()
const registerGarageMerchantAccount = vi.fn()
const suspendGarageMerchantAccount = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGaragePaymentExceptions, resolveGaragePaymentDiscrepancy, fetchGarageMerchantAccounts, registerGarageMerchantAccount, suspendGarageMerchantAccount }),
}))
const { default: GaragePaymentsOperator } = await import('./GaragePaymentsOperator')

const exceptions = {
  discrepancies: [{ id: 'd1', type: 'amount_mismatch', garage: 'Hilux Motors', tenant_id: 't1', invoice_id: 'i1', collection_id: 'c1', amount: '44.00',
    currency: 'USD', evidence: { observed_amount_minor: 4400, expected_amount_minor: 4500 }, detected_via: 'signed_webhook', first_detected_at: '2026-11-02T00:00:00Z', observation_count: 2 }],
  reconciliation_holds: [{ id: 'h1', payment_reference: 'pay04_gar_x', status: 'open', gateway: 'pay04_garage_provider_simulator', payment_amount_minor: 8000,
    currency: 'USD', mismatch: 'partial_refund_succeeded', detected_refunded_minor: 2000, detected_pending_refund_minor: 0, first_detected_at: '', observation_count: 1,
    acknowledged_at: null, collection: { id: 'c2', tenant_id: 't1', invoice_id: 'i2' }, resolve_via: '/api/pay03b/admin/reconciliation-exceptions' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchGaragePaymentExceptions.mockResolvedValue(exceptions)
  fetchGarageMerchantAccounts.mockResolvedValue({ accounts: [], simulated_only: true, note: '' })
})
const page = () => render(<MemoryRouter><GaragePaymentsOperator /></MemoryRouter>)

describe('Garage payments operations', () => {
  it('lists discrepancies with their evidence and F5 holds with a pointer to the reconciliation console', async () => {
    page()
    expect(await screen.findByTestId('operator-discrepancy')).toHaveTextContent('Provider reported a different amount — 44.00 USD')
    expect(screen.getByTestId('operator-discrepancy-evidence')).toHaveTextContent('"observed_amount_minor": 4400')
    expect(screen.getByTestId('operator-hold')).toHaveTextContent('80.00 USD · refunded 20.00 USD')
    expect(screen.getByRole('link', { name: 'payment reconciliation console' })).toHaveAttribute('href', '/admin/commercial-foundation')
  })

  it('closing an exception needs a written note and reports the server’s refusal verbatim', async () => {
    resolveGaragePaymentDiscrepancy.mockRejectedValueOnce(new Error('PAY04_RESOLUTION_SELF_DEALING_REFUSED'))
    page()
    fireEvent.click(await screen.findByTestId('operator-resolve'))
    expect(screen.getByTestId('operator-resolve-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('operator-resolution-note'), { target: { value: 'Provider confirmed the 45.00 report' } })
    fireEvent.click(screen.getByTestId('operator-resolve-submit'))
    await waitFor(() => expect(resolveGaragePaymentDiscrepancy).toHaveBeenCalledWith('d1', { resolution: 'provider_corrected', note: 'Provider confirmed the 45.00 report' }))
    expect(await screen.findByTestId('operator-message')).toHaveTextContent('PAY04_RESOLUTION_SELF_DEALING_REFUSED')
  })

  it('a failed load is an error, not "no exceptions"', async () => {
    fetchGaragePaymentExceptions.mockRejectedValue(new Error('503'))
    page()
    expect(await screen.findByTestId('operator-exceptions-error')).toHaveTextContent('not a statement that there are none')
    expect(screen.queryByTestId('operator-exceptions-none')).toBeNull()
  })
})
