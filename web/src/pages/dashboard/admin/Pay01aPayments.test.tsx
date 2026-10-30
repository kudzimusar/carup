import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'

const apiRequest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/apiClient', () => ({
  apiRequest,
  resolveApiBaseUrl: () => '/api',
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', role: 'admin', name: 'Test Admin' },
    token: 'session-token',
  }),
}))

import Pay01aPayments, { formatAmount, formatDate, parsePaymentRecord, providerMessage } from './Pay01aPayments'

const paidRecord = {
  reference: 'pay01a_00000000-0000-4000-8000-000000000001',
  amount: 100,
  currency: 'JPY',
  status: 'paid' as const,
  checkoutId: 'cs_test_fixture',
  paymentIntentId: 'pi_fixture',
  refundId: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:01:00.000Z',
}

describe('PAY-01B sandbox payment console', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/admin/payments')
  })

  it('shows the backend-controlled JPY 100 item and a provider-confirmed record', async () => {
    apiRequest.mockResolvedValue({ payments: [paidRecord] })
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)

    expect(await screen.findByTestId('pay01a-current-payment')).toBeInTheDocument()
    expect(screen.getAllByText('¥100').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Payment confirmed').length).toBeGreaterThan(0)
    expect(screen.getByTestId('pay01a-refund')).toBeInTheDocument()
    expect(screen.getAllByText(paidRecord.reference).length).toBeGreaterThan(0)
  })

  it('keeps refund controls hidden while a payment is pending', async () => {
    apiRequest.mockResolvedValue({ payments: [{ ...paidRecord, status: 'pending', paymentIntentId: null }] })
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)

    await screen.findByTestId('pay01a-current-payment')
    expect(screen.getAllByText('Pending provider confirmation').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('pay01a-refund')).toBeNull()
  })

  it('fails closed when the sandbox feature is disabled by the backend', async () => {
    const error = Object.assign(new Error('PAY01A_SANDBOX_DISABLED'), { status: 404 })
    apiRequest.mockRejectedValue(error)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('sandbox payment feature is disabled')
    expect(screen.getByTestId('pay01a-start-checkout')).toBeDisabled()
  })
})

const refundRecord = {
  ...paidRecord,
  status: 'refunded' as const,
  refundId: 're_test_canonical',
  updatedAt: '2026-10-29T00:02:00.000Z',
}
const otherRecord = {
  ...refundRecord,
  reference: 'pay01a_00000000-0000-4000-8000-000000000002',
  updatedAt: '2026-10-29T00:03:00.000Z',
}

function mockCanonical(history: unknown[], detail: unknown = paidRecord, refund: unknown = refundRecord) {
  apiRequest.mockImplementation(({ path }: { path: string }) => {
    if (path === '/pay01a') return Promise.resolve({ payments: history })
    if (path.endsWith('/refund')) return Promise.resolve(refund)
    return Promise.resolve(detail)
  })
}

describe('PAY-01B canonical response, UI truth and accessibility regressions', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/admin/payments')
  })

  it('formats verified zero-decimal JPY and refuses malformed amounts', () => {
    expect(formatAmount(paidRecord)).toBe('¥100')
    expect(formatAmount(refundRecord)).toBe('¥100')
    expect(formatAmount({ amount: Number.NaN, currency: 'JPY' })).toBe('Amount unavailable')
    expect(formatAmount({ amount: 100, currency: undefined as unknown as string })).toBe('Amount unavailable')
    expect(() => parsePaymentRecord({ ...paidRecord, amount: undefined })).toThrow(/Incomplete canonical/)
    expect(() => parsePaymentRecord({ ...paidRecord, currency: undefined })).toThrow(/Incomplete canonical/)
    expect(() => parsePaymentRecord({ ...paidRecord, createdAt: undefined })).toThrow(/Incomplete canonical/)
    expect(() => parsePaymentRecord({ ...paidRecord, status: 'invented' })).toThrow(/Incomplete canonical/)
    expect(parsePaymentRecord(refundRecord).status).toBe('refunded')
  })

  it('presents genuine creation time in Japan and genuine missing time as unrecorded', () => {
    expect(formatDate(paidRecord.createdAt)).toContain('09:00')
    expect(formatDate(paidRecord.createdAt)).toMatch(/GMT\+9/)
    expect(formatDate(null)).toBe('Not recorded')
    expect(formatDate('not-a-timestamp')).toBe('Not recorded')
    expect(parsePaymentRecord({ ...paidRecord, createdAt: null }).createdAt).toBeNull()
  })

  it('shows a refunded ¥100 record with provider references, without stale status', async () => {
    mockCanonical([refundRecord], refundRecord)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    const detail = await screen.findByTestId('pay01a-current-payment')
    expect(within(detail).getByText('¥100')).toBeInTheDocument()
    expect(within(detail).getByText('Refund confirmed')).toBeInTheDocument()
    expect(within(detail).getByText('cs_test_fixture')).toBeInTheDocument()
    expect(within(detail).getByText('pi_fixture')).toBeInTheDocument()
    expect(within(detail).getByText('re_test_canonical')).toBeInTheDocument()
    expect(within(detail).getByText(/29 Oct 2026/)).toBeInTheDocument()
    expect(screen.queryByTestId('pay01a-refund')).toBeNull()
  })

  it('accepts a complete reconciliation projection and replaces selected detail', async () => {
    const user = userEvent.setup()
    mockCanonical([paidRecord], refundRecord)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    await screen.findByTestId('pay01a-current-payment')
    await user.click(screen.getByTestId('pay01a-reconcile'))
    expect(await screen.findByText('Refund confirmed by Stripe.')).toBeInTheDocument()
    const detail = screen.getByTestId('pay01a-current-payment')
    expect(within(detail).getByText('¥100')).toBeInTheDocument()
    expect(within(detail).getByText('re_test_canonical')).toBeInTheDocument()
    expect(screen.getByText('Selected transaction')).toBeInTheDocument()
  })

  it('refuses incomplete reconciliation without losing previously verified money', async () => {
    const user = userEvent.setup()
    mockCanonical([paidRecord], { reference: paidRecord.reference, status: 'refunded', refundId: 're_bad_shape' })
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    await screen.findByTestId('pay01a-current-payment')
    await user.click(screen.getByTestId('pay01a-reconcile'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incomplete canonical payment response')
    const detail = screen.getByTestId('pay01a-current-payment')
    expect(within(detail).getByText('¥100')).toBeInTheDocument()
    expect(within(detail).getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.queryByText('undefined undefined')).toBeNull()
    expect(screen.queryByText('NaN JPY')).toBeNull()
  })

  it('refund confirmation consumes the complete canonical response and retains dialog safety', async () => {
    const user = userEvent.setup()
    mockCanonical([paidRecord], paidRecord, refundRecord)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    await screen.findByTestId('pay01a-refund')
    await user.click(screen.getByTestId('pay01a-refund'))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/single full JPY 100 refund/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm test refund' }))
    expect(await screen.findByText('Refund confirmed by Stripe.')).toBeInTheDocument()
    expect(within(screen.getByTestId('pay01a-current-payment')).getByText('¥100')).toBeInTheDocument()
    expect(within(screen.getByTestId('pay01a-current-payment')).getByText('re_test_canonical')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('returns from Stripe pending, then clears pending language on authoritative paid status', async () => {
    window.localStorage.setItem('carup_pay01a_pending_reference', paidRecord.reference)
    window.history.replaceState({}, '', '/admin/payments?carup_pay01a=returned')
    mockCanonical([paidRecord], paidRecord)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    expect(await screen.findByText('Payment confirmed by Stripe.')).toBeInTheDocument()
    expect(screen.queryByText(/Verifying payment with Stripe/)).toBeNull()
    expect(window.localStorage.getItem('carup_pay01a_pending_reference')).toBeNull()
    expect(window.location.search).toBe('')
    await waitFor(() => expect(apiRequest.mock.calls.filter(([x]) => x.path.includes(paidRecord.reference)).length).toBe(1))
  })

  it('keeps provider failures explicitly unconfirmed after redirect', async () => {
    window.localStorage.setItem('carup_pay01a_pending_reference', paidRecord.reference)
    window.history.replaceState({}, '', '/admin/payments?carup_pay01a=returned')
    apiRequest.mockImplementation(({ path }: { path: string }) => path === '/pay01a'
      ? Promise.resolve({ payments: [{ ...paidRecord, status: 'pending' }] })
      : Promise.reject(new Error('Provider unavailable')))
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    expect(await screen.findByText(/Stripe verification is currently unavailable/)).toBeInTheDocument()
    expect(screen.queryByText('Payment confirmed by Stripe.')).toBeNull()
  })

  it('does not treat a cancelled browser return as provider payment confirmation', async () => {
    window.localStorage.setItem('carup_pay01a_pending_reference', paidRecord.reference)
    window.history.replaceState({}, '', '/admin/payments?carup_pay01a=cancelled')
    const pending = { ...paidRecord, status: 'pending' as const }
    mockCanonical([pending], pending)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    expect(await screen.findByText('Checkout cancelled in the browser. No payment has been confirmed.')).toBeInTheDocument()
    expect(screen.queryByText('Payment confirmed by Stripe.')).toBeNull()
    expect(providerMessage('cancelled')).toContain('No payment has been confirmed')
  })

  it('preserves verified history when subsequent history payload is incomplete', async () => {
    const user = userEvent.setup()
    let reads = 0
    apiRequest.mockImplementation(({ path }: { path: string }) => {
      if (path === '/pay01a') {
        reads += 1
        return Promise.resolve({ payments: reads === 1 ? [paidRecord] : [{ ...paidRecord, amount: undefined }] })
      }
      return Promise.resolve(paidRecord)
    })
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    await screen.findByTestId('pay01a-current-payment')
    await user.click(screen.getByRole('button', { name: 'Refresh sandbox payments' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incomplete canonical payment response')
    expect(within(screen.getByTestId('pay01a-current-payment')).getByText('¥100')).toBeInTheDocument()
  })

  it('makes older record selection explicit, keeps newest available and offers a reset', async () => {
    const user = userEvent.setup()
    apiRequest.mockImplementation(({ path }: { path: string }) => {
      if (path === '/pay01a') return Promise.resolve({ payments: [otherRecord, paidRecord] })
      return Promise.resolve(paidRecord)
    })
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    await screen.findByTestId('pay01a-current-payment')
    expect(screen.getByText('Latest transaction')).toBeInTheDocument()
    const region = screen.getByTestId('pay01a-history-scroll')
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveAttribute('role', 'region')
    await user.click(within(region).getByRole('button', { name: `Inspect transaction ${paidRecord.reference}` }))
    expect(await screen.findByText('Selected transaction')).toBeInTheDocument()
    const detail = screen.getByTestId('pay01a-current-payment')
    expect(within(detail).getByText(paidRecord.reference)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show latest transaction' }))
    expect(screen.getByText('Latest transaction')).toBeInTheDocument()
    expect(within(screen.getByTestId('pay01a-current-payment')).getByText(otherRecord.reference)).toBeInTheDocument()
  })

  it('retains the sandbox-only disabled gate and no financial placeholders', async () => {
    const error = Object.assign(new Error('PAY01A_SANDBOX_DISABLED'), { status: 404 })
    apiRequest.mockRejectedValue(error)
    render(<MemoryRouter><Pay01aPayments /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('sandbox payment feature is disabled')
    expect(screen.getByTestId('pay01a-start-checkout')).toBeDisabled()
    expect(screen.queryByText('undefined undefined')).toBeNull()
  })
})
