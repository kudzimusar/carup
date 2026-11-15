import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MarketplaceListingSummary } from '@/types'

/**
 * RX03-P1a — the Marketplace Showroom layout. The hero is gone; the first result IS the showroom
 * spotlight, and from 1024 px it may open into a wide feature card. These tests pin when that may
 * happen (enough inventory, not mid-compare), that the spotlight is always the first real result,
 * and that the header's live count is the same governed count as before (TI-13 is covered in
 * Marketplace.loadError.test.tsx and is not repeated here).
 */
vi.setConfig({ testTimeout: 30_000 })
vi.stubEnv('DEV', false)
vi.stubEnv('VITE_MARKETPLACE_ALLOW_MOCK', 'false')

const fetchMarketplaceListings = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMarketplaceListings,
    saveMarketplaceListing: vi.fn(),
    unsaveMarketplaceListing: vi.fn(),
    fetchSavedMarketplaceListings,
  }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false }) }))
vi.mock('@/lib/intelligenceActivity', () => ({ track: vi.fn() }))

const { default: Marketplace } = await import('./ShowroomMarketplace')

afterAll(() => { vi.unstubAllEnvs() })

function listing(vin: string, make: string, model: string, overrides: Record<string, unknown> = {}) {
  return {
    vin,
    make,
    model,
    year: 2019,
    price: 9500,
    currency: 'USD',
    mileage: 82000,
    body_style: 'Sedan',
    location: 'Harare',
    location_state: 'recorded',
    condition_category: 'locally_used',
    marketplace_tags: [],
    seller_display_label: 'Private seller',
    primary_image_state: 'none',
    ...overrides,
  } as unknown as MarketplaceListingSummary
}

const THREE = [
  listing('VINSHOWROOMA000001', 'Toyota', 'Prado', { body_style: 'SUV' }),
  listing('VINSHOWROOMB000002', 'Honda', 'Fit'),
  listing('VINSHOWROOMC000003', 'Mazda', 'CX-5'),
]

function renderMarketplace() {
  return render(<MemoryRouter initialEntries={['/marketplace']}><Marketplace /></MemoryRouter>)
}

async function grid() {
  await waitFor(() => expect(screen.queryByTestId('marketplace-loading-state')).toBeNull())
  return screen.findByTestId('marketplace-results-grid')
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
})

describe('Marketplace showroom — spotlight and feature card', () => {
  it('the spotlight is the first real result and opens into a feature card with three or more results', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: THREE })
    renderMarketplace()
    const results = await grid()

    const spotlight = within(results).getByTestId('marketplace-showroom-spotlight')
    expect(screen.getAllByTestId('marketplace-showroom-spotlight')).toHaveLength(1)
    expect(spotlight.textContent).toContain('2019 Toyota Prado')
    expect(within(spotlight).getByTestId('marketplace-vehicle-card')).toHaveAttribute('data-card-layout', 'feature')
    // Only the first card is featured; the rest of the grid stays uniform.
    const layouts = within(results).getAllByTestId('marketplace-vehicle-card').map(card => card.getAttribute('data-card-layout'))
    expect(layouts).toEqual(['feature', 'standard', 'standard'])
    // The studio plate draws the listing's own body style.
    expect(within(spotlight).getByTestId('listing-image-placeholder')).toHaveAttribute('data-studio-plate', 'suv')
  })

  it('with fewer than three results the spotlight stays a standard card', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: THREE.slice(0, 2) })
    renderMarketplace()
    const results = await grid()
    const spotlight = within(results).getByTestId('marketplace-showroom-spotlight')
    expect(within(spotlight).getByTestId('marketplace-vehicle-card')).toHaveAttribute('data-card-layout', 'standard')
  })

  it('a buyer who starts comparing gets a uniform grid, and the compare dock states the selection', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: THREE })
    renderMarketplace()
    const results = await grid()

    fireEvent.click(within(results).getAllByTestId('marketplace-compare-toggle')[1])
    await waitFor(() => expect(screen.getByTestId('marketplace-compare-bar')).toBeInTheDocument())
    const layouts = within(results).getAllByTestId('marketplace-vehicle-card').map(card => card.getAttribute('data-card-layout'))
    expect(layouts).toEqual(['standard', 'standard', 'standard'])
    expect(screen.getByTestId('marketplace-compare-bar').textContent).toContain('1 selected to compare')
    expect(screen.getByTestId('marketplace-compare-go')).toBeDisabled()

    fireEvent.click(within(results).getAllByTestId('marketplace-compare-toggle')[2])
    await waitFor(() => expect(screen.getByTestId('marketplace-compare-go').textContent).toMatch(/Compare 2 vehicles/))
    expect(screen.getByTestId('marketplace-compare-go')).toBeEnabled()
  })
})

describe('Marketplace showroom — header', () => {
  it('keeps one h1, the category sub-navigation and the live count in the compact header', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: THREE })
    renderMarketplace()
    await grid()

    const header = screen.getByTestId('marketplace-compact-header')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toMatch(/Find the car\.\s*Know what stands behind it\./)
    expect(within(header).getByTestId('marketplace-results-count').textContent).toMatch(/3\s*published listings/)

    const nav = within(header).getByRole('navigation', { name: 'Marketplace categories' })
    expect(within(nav).getByRole('link', { name: 'Cars' })).toHaveAttribute('aria-current', 'page')
    for (const [name, href] of [['Parts', '/marketplace/parts'], ['Garages', '/marketplace/services'], ['Imports', '/diaspora'], ['Insurance', '/insurance'], ['Finance', '/pricing']]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })
})

describe('RX03-P1a — every filter control has an accessible name', () => {
  it('names the Radix select triggers (role=combobox takes its name from aria-label, not content)', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: THREE })
    renderMarketplace()
    for (const name of ['Make', 'Year', 'Location', 'Sort results']) {
      expect(screen.getByRole('combobox', { name })).toBeInTheDocument()
    }
  })
})
