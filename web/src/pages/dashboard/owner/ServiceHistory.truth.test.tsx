import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * RX-02 TI-06 — "Next Service" must not show a fixed distance.
 * On main the tile rendered the literal "500 km" for every vehicle, whether or not any service
 * schedule or odometer reading existed. CarUp has no next-service measurement, so the tile says so.
 */
vi.setConfig({ testTimeout: 30_000 })

const fetchOwnedVehicles = vi.fn()
const fetchServiceHistory = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchOwnedVehicles, fetchServiceHistory }) }))

const ServiceHistory = (await import('./ServiceHistory')).default

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([{ vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Corolla' }])
  fetchServiceHistory.mockResolvedValue([
    { id: 's1', vin: 'JTDKARFP0H3000731', description: 'Oil change', status: 'completed', total_cost: 40, created_at: '2026-08-01T00:00:00.000Z' },
  ])
})

describe('owner ServiceHistory — Next Service tile (TI-06)', () => {
  it('shows "Not measured" and no fabricated distance', async () => {
    render(<MemoryRouter><ServiceHistory /></MemoryRouter>)
    await screen.findByRole('button', { name: /Toyota Corolla/ })
    expect(screen.queryByText(/500\s*km/)).toBeNull()

    const tile = screen.getByTestId('service-next-service')
    expect(within(tile).getByText('Next Service')).toBeInTheDocument()
    expect(within(tile).getByText('Not measured')).toBeInTheDocument()
    expect(tile.textContent).not.toMatch(/\d/)
  })
})
