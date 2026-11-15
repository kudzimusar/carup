import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MarketplaceListingSummary } from '@/types'

/**
 * RX-02 TI-13 — a failed Marketplace read is not an empty showroom.
 *
 * On a built main bundle a rejected listings read rendered the "temporarily unavailable" banner AND
 * "No matching vehicles", "No published vehicle to spotlight" and "0 published listings" — three
 * statements about inventory CarUp never received. A failed read must say only that it failed: no
 * empty state, no spotlight claim, no counts. A genuinely empty 200 keeps the honest empty state.
 *
 * The built bundle runs with import.meta.env.DEV === false, where the dev-only mock inventory is
 * disabled. That flag is read at module load, so it is stubbed BEFORE the page is imported; the
 * test then exercises the same branch a production visitor reaches.
 */
vi.setConfig({ testTimeout: 30_000 })
vi.stubEnv('DEV', false)
vi.stubEnv('VITE_MARKETPLACE_ALLOW_MOCK', 'false')

const fetchMarketplaceListings = vi.fn()
const saveMarketplaceListing = vi.fn()
const unsaveMarketplaceListing = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMarketplaceListings,
    saveMarketplaceListing,
    unsaveMarketplaceListing,
    fetchSavedMarketplaceListings,
  }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false }) }))
vi.mock('@/lib/intelligenceActivity', () => ({ track: vi.fn() }))

const { default: Marketplace } = await import('./Marketplace')

afterAll(() => { vi.unstubAllEnvs() })

const liveListing = {
  vin: 'JTDKARFP0H3000731',
  make: 'Toyota',
  model: 'Corolla',
  year: 2018,
  price: 9500,
  currency: 'USD',
  mileage: 82000,
  location: 'Harare',
  condition_category: 'locally_used',
  marketplace_tags: [],
  seller_display_label: 'Private seller',
} as unknown as MarketplaceListingSummary

function renderMarketplace() {
  return render(<MemoryRouter initialEntries={['/marketplace']}><Marketplace /></MemoryRouter>)
}

async function settled() {
  await waitFor(() => expect(screen.queryByTestId('marketplace-loading-state')).toBeNull())
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
})

describe('Marketplace — failed listings read (TI-13)', () => {
  it('renders an announced error state and never the empty state, spotlight claim or counts', async () => {
    fetchMarketplaceListings.mockRejectedValue(new Error('HTTP 503'))
    renderMarketplace()
    await settled()

    const error = await screen.findByTestId('marketplace-error-state')

    // No statement about inventory CarUp never received.
    expect(screen.queryByTestId('marketplace-empty-state')).toBeNull()
    expect(screen.queryByText('No matching vehicles')).toBeNull()
    expect(screen.queryByTestId('marketplace-results-grid')).toBeNull()
    expect(screen.queryByText('No published vehicle to spotlight')).toBeNull()
    expect(within(screen.getByTestId('marketplace-showroom-spotlight')).getByText(/live showroom is unavailable/i)).toBeInTheDocument()

    // Counts are hidden, not zero.
    expect(screen.queryByTestId('marketplace-results-count')).toBeNull()
    const page = screen.getByTestId('marketplace-page').textContent || ''
    expect(page).not.toMatch(/\d+\s+published listings?/)

    // The failure itself is announced to assistive technology, once.
    expect(error).toHaveAttribute('role', 'alert')
    expect(error.textContent).toMatch(/could not be loaded/i)
    expect(error.textContent).toMatch(/not an empty showroom/i)
    expect(screen.getAllByTestId('marketplace-error-state')).toHaveLength(1)
  })

  it('offers a retry that re-reads the listings and recovers when the read succeeds', async () => {
    fetchMarketplaceListings.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMarketplaceListings.mockResolvedValue({ listings: [liveListing] })
    renderMarketplace()
    await settled()
    await screen.findByTestId('marketplace-error-state')
    const callsBefore = fetchMarketplaceListings.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(fetchMarketplaceListings.mock.calls.length).toBe(callsBefore + 1))
    await screen.findByTestId('marketplace-results-grid')
    expect(screen.queryByTestId('marketplace-error-state')).toBeNull()
    expect(screen.getByTestId('marketplace-results-count').textContent).toMatch(/1\s*published listing/)
  })
})

describe('Marketplace — successful reads keep their existing truth', () => {
  it('a genuinely empty 200 shows the honest empty state and a measured zero, with no error', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderMarketplace()
    await settled()

    const empty = await screen.findByTestId('marketplace-empty-state')
    expect(empty.textContent).toContain('No matching vehicles')
    expect(screen.queryByTestId('marketplace-error-state')).toBeNull()
    expect(screen.getByTestId('marketplace-results-count').textContent).toMatch(/0\s*published listings/)
    expect(within(screen.getByTestId('marketplace-showroom-spotlight')).getByText('No published vehicle to spotlight')).toBeInTheDocument()
  })

  it('a populated 200 shows the listing grid and its count, with no error or empty state', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [liveListing] })
    renderMarketplace()
    await settled()

    expect(await screen.findByTestId('marketplace-results-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('marketplace-error-state')).toBeNull()
    expect(screen.queryByTestId('marketplace-empty-state')).toBeNull()
    expect(screen.getByTestId('marketplace-results-count').textContent).toMatch(/1\s*published listing/)
  })
})
