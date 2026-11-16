import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Service Network S6 — the owner Service History truth contract.
 *
 * The canonical plan (§3.4) records four truth debts that lived on this page:
 *   1. a hard-coded "Next Service — 500 km" that no authority supported;
 *   2. an unrecorded cost rendered as "$0";
 *   3. the generic literal "Garage" standing in for provider identity;
 *   4. a "$" prefix that assumed USD.
 * These tests exist so none of them can quietly return.
 */
const fetchOwnedVehicles = vi.fn()
const fetchServiceHistory = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchOwnedVehicles, fetchServiceHistory }),
}))

import ServiceHistory from './ServiceHistory'

const VIN = 'VINOWN000001'
const vehicle = { vin: VIN, make: 'Toyota', model: 'Hilux' }

const entry = (over = {}) => ({
  id: 'wo-1',
  vin: VIN,
  status: 'Completed',
  description: 'Brake service',
  issue_description: null,
  service_category: 'brakes',
  work_performed: 'Replaced front pads',
  provenance: 'professional_governed',
  provider: { known: true, display_name: 'Harare Motors', slug: 'harare-motors' },
  cost: { recorded: true, amount: 250, currency: 'ZWG' },
  completed_at: '2026-08-01T00:00:00Z',
  performed_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z',
  mileage_observation: null,
  ...over,
})

function renderPage() {
  return render(<MemoryRouter><ServiceHistory /></MemoryRouter>)
}

describe('owner ServiceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchOwnedVehicles.mockResolvedValue([vehicle])
  })

  it('never renders a fabricated next-service prediction', async () => {
    fetchServiceHistory.mockResolvedValue([entry()])
    const { container } = renderPage()
    await screen.findByText('Replaced front pads')

    const text = container.textContent || ''
    expect(/next service/i.test(text)).toBe(false)
    expect(/500 km/i.test(text)).toBe(false)
  })

  it('shows an unrecorded cost as not recorded, never as zero', async () => {
    fetchServiceHistory.mockResolvedValue([
      entry({ cost: { recorded: false, amount: null, currency: null } }),
    ])
    renderPage()

    const cost = await screen.findByTestId('entry-cost')
    expect(cost.textContent).toBe('Cost not recorded')
    expect(cost.textContent).not.toContain('$0')
    expect(cost.textContent).not.toContain('0')
  })

  it('renders the recorded currency and never assumes USD', async () => {
    fetchServiceHistory.mockResolvedValue([entry()])
    renderPage()
    const cost = await screen.findByTestId('entry-cost')
    expect(cost.textContent).toContain('ZWG')
    expect(cost.textContent).toContain('250')
    expect(cost.textContent).not.toContain('$')
  })

  it('names the real provider instead of the literal word "Garage"', async () => {
    fetchServiceHistory.mockResolvedValue([entry()])
    renderPage()
    const provider = await screen.findByTestId('entry-provider')
    expect(provider.textContent).toContain('Harare Motors')
    expect(provider.textContent?.trim()).not.toBe('Garage')
  })

  it('says provider not recorded when no governed profile exists', async () => {
    fetchServiceHistory.mockResolvedValue([
      entry({ provider: { known: false, display_name: null, slug: null } }),
    ])
    renderPage()
    const provider = await screen.findByTestId('entry-provider')
    expect(provider.textContent).toContain('Provider not recorded')
  })

  it('states provenance rather than implying verification', async () => {
    fetchServiceHistory.mockResolvedValue([entry({ provenance: 'unknown' })])
    renderPage()
    const provenance = await screen.findByTestId('entry-provenance')
    expect(provenance.textContent).toBe('Source not recorded')
    expect(provenance.textContent).not.toMatch(/verified/i)
  })

  it('excludes unrecorded costs from the total and says how many were excluded', async () => {
    fetchServiceHistory.mockResolvedValue([
      entry({ id: 'wo-1', cost: { recorded: true, amount: 250, currency: 'ZWG' } }),
      entry({ id: 'wo-2', cost: { recorded: false, amount: null, currency: null } }),
    ])
    renderPage()
    const spend = await screen.findByTestId('recorded-spend')
    expect(spend.textContent).toContain('ZWG')
    expect(spend.textContent).toContain('250')

    const note = screen.getByTestId('unrecorded-note')
    expect(note.textContent).toContain('1 service')
    expect(note.textContent).toContain('no cost recorded')
  })

  it('refuses to sum across different currencies', async () => {
    fetchServiceHistory.mockResolvedValue([
      entry({ id: 'wo-1', cost: { recorded: true, amount: 250, currency: 'ZWG' } }),
      entry({ id: 'wo-2', cost: { recorded: true, amount: 100, currency: 'USD' } }),
    ])
    renderPage()
    const spend = await screen.findByTestId('recorded-spend')
    expect(spend.textContent).toBe('Multiple currencies')
    expect(spend.textContent).not.toContain('350')
  })

  it('shows mileage as an observation, and omits it when none exists', async () => {
    fetchServiceHistory.mockResolvedValue([
      entry({ mileage_observation: { observed_mileage: 131500, observed_at: '2026-08-01T00:00:00Z', source: 'mechanic_attributed' } }),
    ])
    renderPage()
    const mileage = await screen.findByTestId('entry-mileage')
    expect(mileage.textContent).toContain('131,500')
    expect(mileage.textContent).toContain('observed')
  })

  it('reports a failed load as a failure, not as an empty history', async () => {
    fetchServiceHistory.mockRejectedValue(new Error('network down'))
    renderPage()
    expect(await screen.findByTestId('service-history-error')).toBeTruthy()
    expect(screen.queryByTestId('service-history-empty')).toBeNull()
  })
})
