/**
 * CarUp Intelligence 1.0 — I9 service intelligence surface.
 *
 * The surface's job is to keep the two scopes visibly distinct and to present the
 * unmeasurable as unmeasurable. Both are things a reader could be misled by, so
 * both are asserted directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ServiceIntelligence from './ServiceIntelligence'

const fetchMechanicIntelligence = vi.fn()
const fetchGarageIntelligence = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchMechanicIntelligence, fetchGarageIntelligence }),
}))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const base = {
  ok: true,
  availability: 'value',
  calculation_version: 'service@1',
  window_days: 30,
  metrics: {
    work_orders: value(12), completed_work_orders: value(9), open_work_orders: value(3),
    enquiries: value(5), service_records_logged: value(20), repeat_customers: value(2),
    practitioners_contributing: value(3), identified_customers: value(7),
  },
  conversion: { completion_rate: value(75, 'percent') },
  demand_by_vehicle: { top: [{ label: 'Toyota Hilux', count: 5 }], unidentified: 2 },
  not_measurable: [
    { key: 'bookings', label: 'Bookings', reason: 'no_booking_model', detail: 'CarUp has no booking, appointment or scheduling record.' },
    { key: 'capacity_utilisation', label: 'Capacity utilisation', reason: 'no_capacity_model', detail: 'CarUp records no service bays, slots, shifts or opening hours.' },
  ],
}

beforeEach(() => {
  // Block body: `mockReset()` returns the mock, and a function returned from
  // beforeEach is treated by vitest as a teardown callback — which would call the
  // mock after every test, outside any handler.
  fetchMechanicIntelligence.mockReset()
  fetchGarageIntelligence.mockReset()
})

describe('the two scopes stay visibly distinct', () => {
  it('a mechanic view says it is this person\'s work only', async () => {
    fetchMechanicIntelligence.mockResolvedValue({ ...base, scope: 'mechanic' })
    render(<ServiceIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('service-scope-note')).toHaveTextContent(/your own work only/i)
    expect(screen.getByTestId('service-scope-note')).toHaveTextContent(/not the whole garage/i)
  })

  it('a garage view says it is the whole organization', async () => {
    fetchGarageIntelligence.mockResolvedValue({ ...base, scope: 'garage' })
    render(<ServiceIntelligence scope="garage" />)
    expect(await screen.findByTestId('service-scope-note')).toHaveTextContent(/whole organization/i)
  })

  it('each scope calls only its own endpoint', async () => {
    fetchMechanicIntelligence.mockResolvedValue({ ...base, scope: 'mechanic' })
    render(<ServiceIntelligence scope="mechanic" />)
    await waitFor(() => expect(fetchMechanicIntelligence).toHaveBeenCalled())
    expect(fetchGarageIntelligence).not.toHaveBeenCalled()
  })

  it('the garage scope shows practitioners; the mechanic scope does not', async () => {
    fetchGarageIntelligence.mockResolvedValue({ ...base, scope: 'garage' })
    const garage = render(<ServiceIntelligence scope="garage" />)
    expect(await screen.findByTestId('service-practitioners_contributing')).toBeInTheDocument()
    garage.unmount()

    fetchMechanicIntelligence.mockResolvedValue({ ...base, scope: 'mechanic' })
    render(<ServiceIntelligence scope="mechanic" />)
    await screen.findByTestId('service-intelligence-mechanic')
    expect(screen.queryByTestId('service-practitioners_contributing')).not.toBeInTheDocument()
  })
})

describe('measured values', () => {
  it('renders work-order counts and completion rate', async () => {
    fetchMechanicIntelligence.mockResolvedValue({ ...base, scope: 'mechanic' })
    render(<ServiceIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('service-work_orders-value')).toHaveTextContent('12')
    expect(screen.getByTestId('service-completion-value')).toHaveTextContent('75%')
  })

  it('states how many jobs could not be matched to a known vehicle', async () => {
    fetchMechanicIntelligence.mockResolvedValue({ ...base, scope: 'mechanic' })
    render(<ServiceIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('service-demand-unidentified'))
      .toHaveTextContent(/2 jobs could not be matched/i)
  })

  it('withholds a completion rate the backend would not compute', async () => {
    fetchMechanicIntelligence.mockResolvedValue({
      ...base, scope: 'mechanic',
      conversion: { completion_rate: { availability: 'insufficient_data', value: null, unit: 'percent' } },
    })
    render(<ServiceIntelligence scope="mechanic" />)
    const rate = await screen.findByTestId('service-completion-value')
    expect(rate).toHaveTextContent('Not enough activity yet')
    expect(rate).not.toHaveTextContent('0%')
  })
})

describe('the unmeasurable is shown as unmeasurable', () => {
  it('lists each capability with its explanation', async () => {
    fetchGarageIntelligence.mockResolvedValue({ ...base, scope: 'garage' })
    render(<ServiceIntelligence scope="garage" />)
    const bookings = await screen.findByTestId('not-measurable-bookings')
    expect(bookings).toHaveTextContent('Bookings')
    expect(bookings).toHaveTextContent(/no booking, appointment or scheduling record/i)
    expect(screen.getByTestId('not-measurable-capacity_utilisation')).toBeInTheDocument()
  })

  it('says plainly that these are not zero', async () => {
    fetchGarageIntelligence.mockResolvedValue({ ...base, scope: 'garage' })
    render(<ServiceIntelligence scope="garage" />)
    expect(await screen.findByTestId('service-not-measurable')).toHaveTextContent(/not zero/i)
  })
})

describe('failure is never zero', () => {
  it('reports a failed read', async () => {
    fetchMechanicIntelligence.mockRejectedValue(new Error('down'))
    render(<ServiceIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('service-intelligence-message')).toHaveTextContent(/NOT zero/)
  })

  it('reports a refused garage scope rather than showing personal figures', async () => {
    fetchGarageIntelligence.mockRejectedValue(new Error('A verified organization context is required'))
    render(<ServiceIntelligence scope="garage" />)
    expect(await screen.findByTestId('service-intelligence-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('service-metrics')).not.toBeInTheDocument()
  })

  it('renders a genuinely empty practice as measured zeros', async () => {
    fetchMechanicIntelligence.mockResolvedValue({
      ...base, scope: 'mechanic',
      metrics: { ...base.metrics, work_orders: value(0) },
    })
    render(<ServiceIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('service-work_orders-value')).toHaveTextContent('0')
  })
})
