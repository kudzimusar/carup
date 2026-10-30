import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const apiRequest = vi.hoisted(() => vi.fn())
const identity = vi.hoisted(() => ({ user: { id: 'buyer-1' } as { id: string } | null, token: 'valid-session' as string | null }))
vi.mock('@/lib/apiClient', () => ({ apiRequest, resolveApiBaseUrl: () => '/api' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => identity }))

import DemoVehicleHistory from './DemoVehicleHistory'

const product = {
  code: 'vehicle_history_demo', name: 'CarUp Vehicle History Report — Demo Edition',
  amount: 100, currency: 'JPY', merchant: 'CarUp Japan sandbox',
  testOnly: true, synthetic: true,
}
const order = {
  id: '00000000-0000-4000-8000-000000000019',
  product: product.name, testOnly: true,
  reference: 'pay01a_00000000-0000-4000-8000-000000000019',
  amount: 100, currency: 'JPY', status: 'pending',
  createdAt: '2026-10-30T00:00:00Z', paymentUpdatedAt: '2026-10-30T00:00:00Z',
  checkoutId: 'cs_test_fixture', paymentIntentId: null, refundId: null,
  reportAvailable: false, entitlement: 'awaiting_verified_payment',
}
const report = {
  title: product.name, classification: 'SYNTHETIC SAMPLE — TEST ONLY',
  summary: 'Fictional demonstration data', vehicleIdentifier: 'DEMO-VEHICLE-NOT-A-VIN',
  make: 'Sample Motors', model: 'Prototype', manufactureYear: 2020,
  history: [{ date: '2021-01-01', event: 'Illustrative registration', odometerKm: 100 }],
  disclaimer: 'No actual vehicle was queried.',
}
function mockData(orders: unknown[] = [], status: unknown = order) {
  apiRequest.mockImplementation(({ path }: { path: string }) => {
    if (path === '/pay01c/product') return Promise.resolve({ product })
    if (path === '/pay01c/orders') return Promise.resolve({ orders })
    if (path.endsWith('/report')) return Promise.resolve({ order: status, report })
    return Promise.resolve(status)
  })
}

describe('PAY-01C customer-facing sandbox demo', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    identity.user = { id: 'buyer-1' }
    identity.token = 'valid-session'
    sessionStorage.clear()
    window.history.replaceState({}, '', '/demo/vehicle-history')
  })

  it('presents a visibly test-only JPY 100 synthetic product with buyer action', async () => {
    mockData([])
    render(<DemoVehicleHistory />)
    expect(await screen.findByText('¥100')).toBeInTheDocument()
    expect(screen.getByText(/SANDBOX · TEST ONLY/)).toBeInTheDocument()
    expect(screen.getByText(/Synthetic report/)).toBeInTheDocument()
    expect(screen.getByTestId('pay01c-buy')).toBeEnabled()
    expect(screen.getByText(/No VIN lookup/)).toBeInTheDocument()
  })

  it('requires a real login for purchasing and does not show private history', async () => {
    identity.user = null; identity.token = null
    mockData()
    render(<DemoVehicleHistory />)
    expect(await screen.findByText('¥100')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in to try the demo/ })).toHaveAttribute('href', '/login')
    expect(screen.queryByTestId('pay01c-buy')).toBeNull()
    expect(screen.queryByText('Your demo purchases')).toBeNull()
    expect(apiRequest.mock.calls.some(([c]) => c.path === '/pay01c/orders')).toBe(false)
  })

  it('never exposes a report on pending canonical state', async () => {
    mockData([order])
    render(<DemoVehicleHistory />)
    const item = await screen.findByTestId('pay01c-order')
    expect(within(item).getByText(/Awaiting authoritative Stripe/)).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /Open sample report/ })).toBeNull()
  })

  it('opens only a server-returned synthetic report after confirmed paid entitlement', async () => {
    const paid = { ...order, status: 'paid', reportAvailable: true, entitlement: 'granted', paymentIntentId: 'pi_fixture' }
    mockData([paid], paid)
    const user = userEvent.setup()
    render(<DemoVehicleHistory />)
    const button = await screen.findByRole('button', { name: /Open sample report/ })
    await user.click(button)
    const panel = await screen.findByTestId('pay01c-report')
    expect(within(panel).getByText(/SYNTHETIC SAMPLE/)).toBeInTheDocument()
    expect(within(panel).getByText('DEMO-VEHICLE-NOT-A-VIN')).toBeInTheDocument()
    expect(apiRequest.mock.calls.some(([c]) => c.path.endsWith('/report'))).toBe(true)
  })

  it('a refunded order visibly revokes product entitlement', async () => {
    mockData([{ ...order, status: 'refunded', entitlement: 'revoked', refundId: 're_fixture' }])
    render(<DemoVehicleHistory />)
    const item = await screen.findByTestId('pay01c-order')
    expect(within(item).getByText(/access revoked/)).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /Open sample report/ })).toBeNull()
    expect(within(item).getByText(/re_fixture/)).toBeInTheDocument()
  })

  it('a browser return alone does not claim payment success when provider is unavailable', async () => {
    sessionStorage.setItem('carup_pay01c_pending_demo_order', order.id)
    window.history.replaceState({}, '', '/demo/vehicle-history?carup_pay01c=returned')
    apiRequest.mockImplementation(({ path }: { path: string }) => {
      if (path === '/pay01c/product') return Promise.resolve({ product })
      if (path === '/pay01c/orders') return Promise.resolve({ orders: [order] })
      return Promise.reject(new Error('provider unavailable'))
    })
    render(<DemoVehicleHistory />)
    expect(await screen.findByText(/Payment verification is temporarily unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/Payment verified — sample report ready/)).toBeNull()
    expect(sessionStorage.getItem('carup_pay01c_pending_demo_order')).toBeNull()
  })
})
