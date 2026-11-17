/** RX04-C2 — Service history (unified): a per-car timeline, newest first; a failed read is never "no history". */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = {
  fetchOwnedVehicles: vi.fn(),
  fetchServiceHistory: vi.fn(),
}

const car = (vin: string, model: string) => ({ vin, year: 2018, make: 'Toyota', model })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi') })

async function renderPage() {
  const { default: ServiceHistory } = await import('./ServiceHistory')
  return render(<MemoryRouter><ServiceHistory /></MemoryRouter>)
}

describe('ServiceHistory — unified', () => {
  it('groups work orders by car, newest first, with cost in no invented currency and no invented next service', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([car('HILUX000000000001', 'Hilux'), car('VITZ0000000000002', 'Vitz')])
    api.fetchServiceHistory.mockResolvedValue([
      { id: 'a', vin: 'HILUX000000000001', description: 'Brake pads replaced', status: 'Completed', total_cost: 120, created_at: '2026-03-01T09:00:00Z' },
      { id: 'b', vin: 'HILUX000000000001', description: 'Oil change', status: 'In Progress', total_cost: null, created_at: '2026-09-10T09:00:00Z' },
    ])
    await renderPage()
    const group = await screen.findByTestId('service-vehicle-HILUX000000000001')
    expect(group).toHaveTextContent('2018 Toyota Hilux')
    expect(group).toHaveTextContent('VIN HILUX000000000001')
    const entries = within(group).getAllByTestId(/^service-entry-/)
    expect(entries.map(e => e.getAttribute('data-testid'))).toEqual(['service-entry-b', 'service-entry-a'])
    expect(screen.getByTestId('service-entry-a')).toHaveTextContent('Completed')
    expect(screen.getByTestId('service-entry-a')).toHaveTextContent('Currency not recorded')
    expect(screen.getByTestId('service-entry-b')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('service-entry-b')).toHaveTextContent('In progress')
    expect(screen.getByTestId('service-entry-a')).toHaveTextContent('Garage work order')
    // The Vitz has no work orders — said in words, with a door to its Passport.
    expect(screen.getByTestId('service-history-cars-without')).toHaveTextContent('2018 Toyota Vitz')
    expect(document.body).not.toHaveTextContent('500 km')
    expect(document.body).not.toHaveTextContent(/next service/i)
    expect(document.querySelector('[data-presentation="rx04"]')).not.toBeNull()
  })

  it('search filters by recorded description and says when nothing matches', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([car('HILUX000000000001', 'Hilux')])
    api.fetchServiceHistory.mockResolvedValue([{ id: 'a', vin: 'HILUX000000000001', description: 'Brake pads replaced', status: 'Completed', total_cost: 120, created_at: '2026-03-01T09:00:00Z' }])
    await renderPage()
    fireEvent.change(await screen.findByTestId('service-history-search'), { target: { value: 'gearbox' } })
    expect(screen.getByTestId('service-history-no-match')).toHaveTextContent('No records match “gearbox”')
    fireEvent.click(screen.getByRole('button', { name: /Clear search/ }))
    expect(screen.getByTestId('service-entry-a')).toBeInTheDocument()
  })

  it('a failed service read is an error with a retry — never "no service recorded"', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([car('HILUX000000000001', 'Hilux')])
    api.fetchServiceHistory.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([])
    await renderPage()
    expect(await screen.findByTestId('service-history-error')).toHaveTextContent('not the same as having no service history')
    expect(screen.queryByTestId('service-history-empty')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('service-history-empty')).toHaveTextContent('No service recorded yet'))
    expect(api.fetchServiceHistory).toHaveBeenCalledTimes(2)
  })

  it('an owner with no cars is told how history starts', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([])
    api.fetchServiceHistory.mockResolvedValue([])
    await renderPage()
    expect(await screen.findByTestId('service-history-empty')).toHaveTextContent('No cars in your garage yet')
    expect(screen.getByRole('link', { name: /Add a car/ })).toHaveAttribute('href', '/sell')
  })
})
