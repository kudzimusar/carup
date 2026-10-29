import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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

import Pay01aPayments from './Pay01aPayments'

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
    render(<Pay01aPayments />)

    expect(await screen.findByTestId('pay01a-current-payment')).toBeInTheDocument()
    expect(screen.getByText('¥100')).toBeInTheDocument()
    expect(screen.getAllByText('Payment confirmed').length).toBeGreaterThan(0)
    expect(screen.getByTestId('pay01a-refund')).toBeInTheDocument()
    expect(screen.getAllByText(paidRecord.reference).length).toBeGreaterThan(0)
  })

  it('keeps refund controls hidden while a payment is pending', async () => {
    apiRequest.mockResolvedValue({ payments: [{ ...paidRecord, status: 'pending', paymentIntentId: null }] })
    render(<Pay01aPayments />)

    await screen.findByTestId('pay01a-current-payment')
    expect(screen.getAllByText('Pending provider confirmation').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('pay01a-refund')).toBeNull()
  })

  it('fails closed when the sandbox feature is disabled by the backend', async () => {
    const error = Object.assign(new Error('PAY01A_SANDBOX_DISABLED'), { status: 404 })
    apiRequest.mockRejectedValue(error)
    render(<Pay01aPayments />)

    expect(await screen.findByRole('alert')).toHaveTextContent('sandbox payment feature is disabled')
    expect(screen.getByTestId('pay01a-start-checkout')).toBeDisabled()
  })
})
