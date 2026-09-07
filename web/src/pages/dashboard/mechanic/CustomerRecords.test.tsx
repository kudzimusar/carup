import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CustomerRecords from './CustomerRecords'

/**
 * Service Network S9 — the Customer Records truth contract.
 *
 * This page shipped four invented people (Tendai Moyo, Sarah Chikomo, James Ncube,
 * Grace Mupfumi) with fabricated phone numbers, emails, visit counts and spend totals,
 * presented as a garage's real customer book. These tests exist so none of that can
 * return, and so the replacement stays honest about what it does not know.
 */
const originalFetch = global.fetch

function mockCustomers(customers: unknown[], ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 500, json: async () => ({ customers, total: customers.length }),
  }) as unknown as typeof fetch
}

const customer = (over = {}) => ({
  user_id: 'u-cust-1',
  display_name: 'Tendai Moyo',
  vehicle_count: 2,
  case_count: 3,
  completed_count: 2,
  last_service_at: '2026-08-05T00:00:00Z',
  spend_by_currency: { ZWG: 250 },
  conversation_thread_id: 'thread-1',
  ...over,
})

describe('CustomerRecords', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it('renders real customers returned by the garage projection', async () => {
    mockCustomers([customer()])
    render(<CustomerRecords />)
    expect(await screen.findByTestId('customer-name')).toBeTruthy()
    expect(screen.getByTestId('customer-name').textContent).toBe('Tendai Moyo')
    expect(screen.getByText(/2 vehicles/)).toBeTruthy()
  })

  it('shows an honest empty state instead of seeded people', async () => {
    mockCustomers([])
    render(<CustomerRecords />)
    expect(await screen.findByTestId('customers-empty')).toBeTruthy()
    // The four fabricated names must never appear when the garage has no customers.
    for (const name of ['Tendai Moyo', 'Sarah Chikomo', 'James Ncube', 'Grace Mupfumi']) {
      expect(screen.queryByText(name)).toBeNull()
    }
  })

  it('never displays harvested contact details', async () => {
    mockCustomers([customer()])
    const { container } = render(<CustomerRecords />)
    await screen.findByTestId('customer-name')
    const text = container.textContent || ''
    expect(/@/.test(text)).toBe(false)
    expect(/\+263/.test(text)).toBe(false)
  })

  it('shows no-cost-recorded rather than a zero spend', async () => {
    mockCustomers([customer({ spend_by_currency: {} })])
    render(<CustomerRecords />)
    const spend = await screen.findByTestId('customer-spend')
    expect(spend.textContent).toBe('No cost recorded')
    expect(spend.textContent).not.toContain('0')
  })

  it('renders spend per currency and never sums across them', async () => {
    mockCustomers([customer({ spend_by_currency: { ZWG: 250, USD: 100 } })])
    render(<CustomerRecords />)
    const spend = await screen.findByTestId('customer-spend')
    expect(spend.textContent).toContain('ZWG 250')
    expect(spend.textContent).toContain('USD 100')
    expect(spend.textContent).not.toContain('350')
  })

  it('says unnamed customer rather than inventing a name', async () => {
    mockCustomers([customer({ display_name: null })])
    render(<CustomerRecords />)
    expect((await screen.findByTestId('customer-name')).textContent).toBe('Unnamed customer')
  })

  it('offers no Add Customer action — a customer comes from a real service case', async () => {
    mockCustomers([customer()])
    const { container } = render(<CustomerRecords />)
    await screen.findByTestId('customer-name')
    expect(/add customer/i.test(container.textContent || '')).toBe(false)
  })

  it('reports a failed load as a failure, not as having no customers', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    render(<CustomerRecords />)
    expect(await screen.findByTestId('customers-error')).toBeTruthy()
    expect(screen.queryByTestId('customers-empty')).toBeNull()
  })
})
