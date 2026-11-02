import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GarageInvoice } from '@/lib/garageBusiness'

/** CARUP-PAY-04 — the garage sees each source of its invoice's money separately and refunds only with a reason. */
const refundGarageProviderPayment = vi.fn().mockResolvedValue({})
const reconcileGarageProviderPayment = vi.fn().mockResolvedValue({})
const cancelGarageProviderPayment = vi.fn().mockResolvedValue({})
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ refundGarageProviderPayment, reconcileGarageProviderPayment, cancelGarageProviderPayment }),
}))
const { InvoiceMoneyBreakdown, ProviderPaymentsPanel } = await import('./ProviderPaymentsPanel')

const payment = (state: string, over: Record<string, unknown> = {}) => ({
  id: `col-${state}`, amount: '100.00', currency: 'USD', initiated_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-02T00:30:00Z', cancelled_at: null,
  state, state_label: `State ${state}`, payment_status: 'paid', gateway: 'pay04_garage_provider_simulator', simulated: true,
  source_label: 'Confirmed by the garage’s payment provider. The money is paid to the garage, not to CarUp.', open_discrepancies: [], ...over,
})
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', status: 'issued', currency: 'USD', provider_payments_supported: true,
  money: { declared_paid: '80.00', provider_paid: '100.00', provider_reserved: '20.00', uncommitted_balance: '0.00' },
  provider_payments: [payment('confirmed')], provider_receipts: [{ id: 'r1', receipt_number: 'RCT-000007', collection_id: 'col-confirmed',
    amount: '100.00', currency: 'USD', status: 'issued', issued_at: '2026-11-02T00:01:00Z', voided_at: null, payment_source: 'provider_confirmed',
    payment_source_label: 'Confirmed by the garage’s payment provider. The money is paid to the garage, not to CarUp.' }],
  provider_source_label: 'Confirmed by the garage’s payment provider. The money is paid to the garage, not to CarUp.',
  ...over,
}) as unknown as GarageInvoice

describe('Garage provider payments', () => {
  it('shows recorded, provider-confirmed and in-flight money as three separate facts', () => {
    render(<InvoiceMoneyBreakdown invoice={invoice()} />)
    expect(screen.getByTestId('money-declared')).toHaveTextContent('80.00 USD')
    expect(screen.getByTestId('money-provider')).toHaveTextContent('100.00 USD')
    expect(screen.getByTestId('money-in-flight')).toHaveTextContent('20.00 USD')
    expect(screen.getByText('In progress with the provider (not counted)')).toBeInTheDocument()
  })

  it('lists provider payments and receipts with the garage-not-CarUp source label', () => {
    render(<ProviderPaymentsPanel invoice={invoice()} canAct={false} busy={false} run={vi.fn()} />)
    expect(screen.getByTestId('provider-payment-state')).toHaveTextContent('State confirmed')
    expect(screen.getByTestId('provider-payment-simulated')).toHaveTextContent('Simulated provider (test)')
    expect(screen.getByTestId('provider-receipt-row')).toHaveTextContent('Receipt RCT-000007: 100.00 USD')
    expect(screen.getByTestId('provider-receipt-source')).toHaveTextContent('paid to the garage, not to CarUp')
    expect(screen.queryByTestId('provider-payment-refund')).toBeNull()
  })

  it('a refund needs a real reason and goes through the hub runner', async () => {
    const run = vi.fn(async (_scope, fn) => { await fn(); return true })
    render(<ProviderPaymentsPanel invoice={invoice()} canAct busy={false} run={run} />)
    fireEvent.click(screen.getByTestId('provider-payment-refund'))
    fireEvent.change(screen.getByTestId('provider-refund-form-reason'), { target: { value: 'dup' } })
    fireEvent.click(screen.getByTestId('provider-refund-form-submit'))
    expect(await screen.findByTestId('provider-refund-form-error')).toHaveTextContent('at least 10 characters')
    expect(refundGarageProviderPayment).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('provider-refund-form-reason'), { target: { value: 'Customer was charged twice' } })
    fireEvent.click(screen.getByTestId('provider-refund-form-submit'))
    await waitFor(() => expect(refundGarageProviderPayment).toHaveBeenCalledWith('col-confirmed', 'Customer was charged twice'))
  })

  it('offers "stop" only for a checkout still waiting, and shows a discrepancy as under review', () => {
    render(<ProviderPaymentsPanel busy={false} run={vi.fn()} canAct invoice={invoice({ provider_receipts: [], provider_payments: [
      payment('awaiting_provider'),
      payment('under_review', { open_discrepancies: [{ id: 'd1', type: 'amount_mismatch', amount: '99.00', first_detected_at: '', observation_count: 1 }] }),
    ] })} />)
    expect(screen.getAllByTestId('provider-payment-stop')).toHaveLength(1)
    expect(screen.queryByTestId('provider-payment-refund')).toBeNull()
    expect(screen.getByTestId('provider-payment-discrepancy')).toHaveTextContent('Provider reported a different amount')
  })

  it('renders nothing where PAY-04 is not installed', () => {
    const { container } = render(<ProviderPaymentsPanel invoice={invoice({ provider_payments_supported: false })} canAct busy={false} run={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
