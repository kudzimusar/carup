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
/** The garage's view of a Paynow request (PAY-05). */
const paynowView = (over: Record<string, unknown> = {}) => ({
  method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone',
  checkout_url: null, instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false,
  phone: '077*****67', hold_released: false, paynow_reference: 'PN-1', ...over,
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
    expect(screen.getByText('With the provider — in progress or under review (not counted)')).toBeInTheDocument()
  })

  it('lists provider payments and receipts with the garage-not-CarUp source label', () => {
    render(<ProviderPaymentsPanel invoice={invoice()} canAct={false} busy={false} run={vi.fn()} />)
    expect(screen.getByTestId('provider-payment-state')).toHaveTextContent('State confirmed')
    expect(screen.getByTestId('provider-payment-simulated')).toHaveTextContent('Simulated provider (test)')
    expect(screen.getByTestId('provider-receipt-row')).toHaveTextContent('Receipt RCT-000007: 100.00 USD')
    expect(screen.getByTestId('provider-receipt-source')).toHaveTextContent('paid to the garage, not to CarUp')
    expect(screen.queryByTestId('provider-payment-refund')).toBeNull()
  })

  it('shows the append-only provider activity, naming the provider or a CarUp user', () => {
    render(<ProviderPaymentsPanel invoice={invoice({ provider_history: [
      { event_type: 'initiated', actor: 'cust-1', detail: {}, created_at: '2026-11-02T00:00:00Z' },
      { event_type: 'allocated', actor: 'provider:pay04_garage_provider_simulator', detail: {}, created_at: '2026-11-02T00:01:00Z' },
    ] })} canAct={false} busy={false} run={vi.fn()} />)
    const rows = screen.getAllByTestId('provider-activity-row')
    expect(rows[0]).toHaveTextContent('Customer started a payment through the provider · CarUp user')
    expect(rows[1]).toHaveTextContent('Counted on the invoice · Payment provider')
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

  it('a provider refusal reaches the hub as a sentence, never a raw code or a success', async () => {
    refundGarageProviderPayment.mockRejectedValueOnce(new Error('PAY04_PROVIDER_REFUND_REFUSED'))
    let shown = ''
    const run = vi.fn(async (_scope, fn) => { try { await fn(); return true } catch (e) { shown = (e as Error).message; return false } })
    render(<ProviderPaymentsPanel invoice={invoice()} canAct busy={false} run={run} />)
    fireEvent.click(screen.getByTestId('provider-payment-refund'))
    fireEvent.change(screen.getByTestId('provider-refund-form-reason'), { target: { value: 'Customer was charged twice' } })
    fireEvent.click(screen.getByTestId('provider-refund-form-submit'))
    await waitFor(() => expect(shown).toMatch(/refused/))
    expect(shown).not.toMatch(/PAY04_/)
  })

  it('a checkout that is already stopping offers no second stop', () => {
    render(<ProviderPaymentsPanel busy={false} run={vi.fn()} canAct invoice={invoice({ provider_receipts: [], provider_payments: [payment('stopping')] })} />)
    expect(screen.queryByTestId('provider-payment-stop')).toBeNull()
  })

  it('W5: a Paynow payment under review reads as under review — with what Paynow reported — never as paid', () => {
    const paynow = paynowView({ provider_status: 'paid', provider_status_label: 'Paid — confirmed by Paynow' })
    render(<ProviderPaymentsPanel busy={false} run={vi.fn()} canAct invoice={invoice({ provider_receipts: [], provider_payments: [
      payment('under_review', { gateway: 'paynow_zimbabwe', state_label: 'Under review — not counted', paynow }),
    ] })} />)
    expect(screen.getByTestId('provider-payment-paynow-status')).toHaveTextContent('Under review — not counted. Paynow reports it paid.')
    expect(screen.getByTestId('provider-payment-row')).not.toHaveTextContent(/Paid — confirmed/)
    expect(screen.getByTestId('provider-payment-state').className).not.toMatch(/green/)
  })

  it('W4: stopping a Paynow request never promises a cancel — the amount stays held until Paynow reports or an operator releases it', async () => {
    const run = vi.fn(async (_scope, fn) => { await fn(); return true })
    render(<ProviderPaymentsPanel busy={false} run={run} canAct invoice={invoice({ provider_receipts: [], provider_payments: [
      payment('awaiting_provider', { gateway: 'paynow_zimbabwe', payment_status: 'pending', paynow: paynowView() }),
    ] })} />)
    fireEvent.click(screen.getByTestId('provider-payment-stop'))
    const form = screen.getByTestId('provider-stop-form')
    expect(form).toHaveTextContent(new RegExp('Paynow cannot cancel a payment request\\. Stopping records that the customer should not pay through this request; '
      + 'the amount stays held until Paynow reports the outcome, or CarUp.s payment time passes and a CarUp operator releases it\\.'))
    expect(form).not.toHaveTextContent(/releases the amount it was holding|Nothing has been paid/)
    expect(screen.getByTestId('provider-stop-form-submit')).toHaveTextContent(/^Stop waiting$/)
    fireEvent.change(screen.getByTestId('provider-stop-form-reason'), { target: { value: 'Customer will pay cash at the counter' } })
    fireEvent.click(screen.getByTestId('provider-stop-form-submit'))
    await waitFor(() => expect(run).toHaveBeenCalledWith('closeout', expect.any(Function), 'Stop recorded — the amount stays held until Paynow reports the outcome.'))
    expect(cancelGarageProviderPayment).toHaveBeenCalledWith('col-awaiting_provider', 'Customer will pay cash at the counter')
  })

  it('W4: a PAY-04 provider checkout keeps its own stop words', () => {
    render(<ProviderPaymentsPanel busy={false} run={vi.fn()} canAct invoice={invoice({ provider_receipts: [], provider_payments: [payment('awaiting_provider')] })} />)
    fireEvent.click(screen.getByTestId('provider-payment-stop'))
    expect(screen.getByTestId('provider-stop-form')).toHaveTextContent('Nothing has been paid. Stopping releases the amount it was holding on the invoice.')
    expect(screen.getByTestId('provider-stop-form-submit')).toHaveTextContent('Stop the checkout')
  })

  it('W10: the garage reads Paynow’s status about the customer, not the customer’s own words', () => {
    render(<ProviderPaymentsPanel busy={false} run={vi.fn()} canAct={false} invoice={invoice({ provider_receipts: [], provider_payments: [
      payment('awaiting_provider', { gateway: 'paynow_zimbabwe', payment_status: 'pending', paynow: paynowView() }),
    ] })} />)
    const status = screen.getByTestId('provider-payment-paynow-status')
    expect(status).toHaveTextContent('Waiting for the customer to approve on their phone')
    expect(status).not.toHaveTextContent(/\byou(r)?\b/i)
  })

  it('renders nothing where PAY-04 is not installed', () => {
    const { container } = render(<ProviderPaymentsPanel invoice={invoice({ provider_payments_supported: false })} canAct busy={false} run={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
