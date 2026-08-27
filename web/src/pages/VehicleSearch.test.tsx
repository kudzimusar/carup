import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MarketplaceListingSummary } from '@/types'

/**
 * /search de-mock (G2-S9): the public search page previously rendered fabricated inventory from
 * @/data/mockData with zero API calls. It must now browse the live marketplace listings API and
 * resolve identifier-shaped queries through the passport lookup endpoint.
 */

const fetchMarketplaceListings = vi.fn()
const fetchMarketplaceCategories = vi.fn()
const lookupVehiclePassport = vi.fn()
const fetchMarketplaceListingDetail = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchMarketplaceListings, fetchMarketplaceCategories, lookupVehiclePassport, fetchMarketplaceListingDetail }),
}))

const VehicleSearch = (await import('./VehicleSearch')).default
const { looksLikeIdentifier } = await import('@/lib/marketplaceParams')
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'VehicleSearch.tsx'), 'utf8')

const liveListing: MarketplaceListingSummary = {
  vin: 'JTDKARFP0H3000731',
  make: 'Toyota',
  model: 'Corolla',
  year: 2018,
  price: 9500,
  currency: 'USD',
  mileage: 45000,
  fuel_type: 'Petrol',
  transmission: 'Automatic',
  status: 'Available',
  condition_category: 'local_used',
  marketplace_tags: [],
  trust_score: 80,
  primary_image_url: null,
  // Issue #164 Phase 5: the cover image's URL is no longer publishable without the label that says
  // where it came from. `not_loaded` is the honest pair for a null URL in a fixture that models a
  // listing whose gallery was never read — `none` would assert this seller added no photos.
  primary_image_state: 'not_loaded',
  primary_image_unpublishable_count: 0,
  plate_verified: true,
  passport_verified: true,
  evidence_count: 3,
  partsentry_checked: false,
  repair_history_count: 0,
  verified_parts_count: 0,
  duty_cleared: true,
  zimra_verified: true,
  cid_clear: true,
  seller_type: 'dealer',
  seller_display_label: 'Harare Verified Motors',
  seller_public_profile_enabled: true,
  location: 'Zimbabwe',
  created_at: '2026-06-01T00:00:00.000Z',
}

function renderSearch() {
  return render(<MemoryRouter><VehicleSearch /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMarketplaceListings.mockResolvedValue({ listings: [liveListing], total: 1, limit: 60 })
  fetchMarketplaceCategories.mockResolvedValue({
    listing_types: [],
    condition_categories: [{ slug: 'local_used', label: 'Local Used' }],
    trust_tags: [],
  })
  lookupVehiclePassport.mockRejectedValue(new Error('not found'))
})

describe('VehicleSearch de-mock (no fabricated inventory)', () => {
  it('imports nothing from mockData', () => {
    expect(SRC).not.toContain('mockData')
    expect(SRC).not.toContain('zimbabweLocations')
  })

  it('renders live marketplace listings from the API', async () => {
    renderSearch()
    await waitFor(() => expect(fetchMarketplaceListings).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('vehicle-search-result')).toBeTruthy())

    const text = document.body.textContent || ''
    expect(text).toContain('Toyota')
    expect(text).toContain('Harare Verified Motors')
    expect(text).toContain('1 vehicles found')
  })

  it('links browse results to the marketplace listing detail route', async () => {
    renderSearch()
    await waitFor(() => expect(screen.getByTestId('vehicle-search-result')).toBeTruthy())
    const card = screen.getByTestId('vehicle-search-result')
    const link = card.querySelector('[data-testid="marketplace-view-passport"]')
    expect(link?.getAttribute('href')).toBe('/marketplace/listing/JTDKARFP0H3000731')
  })

  it('shows a truthful empty state when the live API returns no listings', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [], total: 0, limit: 60 })
    renderSearch()
    await waitFor(() => expect(screen.getByTestId('vehicle-search-empty')).toBeTruthy())
    expect((document.body.textContent || '')).toContain('0 vehicles found')
  })

  it('shows an honest error state instead of fabricated inventory when the API fails', async () => {
    fetchMarketplaceListings.mockRejectedValue(new Error('backend down'))
    renderSearch()
    await waitFor(() => expect(screen.getByTestId('vehicle-search-error')).toBeTruthy())
    expect(screen.queryAllByTestId('vehicle-search-result')).toHaveLength(0)
  })

  it('tries the passport lookup for identifier-shaped queries and deep-links a publicly listed match', async () => {
    lookupVehiclePassport.mockResolvedValue({
      vehicle: { vin: 'JH4KA8260MC000000', make: 'Honda', model: 'Legend', year: 1991 },
    })
    fetchMarketplaceListingDetail.mockResolvedValue({ vin: 'JH4KA8260MC000000' })
    renderSearch()
    await waitFor(() => expect(fetchMarketplaceListings).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('vehicle-search-input'), { target: { value: 'JH4KA8260MC000000' } })

    await waitFor(() => expect(lookupVehiclePassport).toHaveBeenCalledWith('JH4KA8260MC000000'))
    await waitFor(() => expect(screen.getByTestId('vehicle-search-passport-match')).toBeTruthy())
    expect(screen.getByTestId('vehicle-search-passport-match').getAttribute('href'))
      .toBe('/marketplace/listing/JH4KA8260MC000000')
  })

  it('renders a history-only card (no listing link) when the passport hit is not publicly listed', async () => {
    lookupVehiclePassport.mockResolvedValue({
      vehicle: { vin: 'JH4KA8260MC000001', make: 'Honda', model: 'Legend', year: 1991 },
    })
    fetchMarketplaceListingDetail.mockRejectedValue(Object.assign(new Error('Listing not found'), { status: 404 }))
    renderSearch()
    await waitFor(() => expect(fetchMarketplaceListings).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('vehicle-search-input'), { target: { value: 'JH4KA8260MC000001' } })

    await waitFor(() => expect(screen.getByTestId('vehicle-search-passport-history-only')).toBeTruthy())
    expect(screen.queryByTestId('vehicle-search-passport-match')).toBeNull()
    expect(screen.getByTestId('vehicle-search-passport-history-only').textContent).toContain('not currently listed')
  })

  it('passes non-identifier queries straight through to the listings API without a lookup', async () => {
    renderSearch()
    await waitFor(() => expect(fetchMarketplaceListings).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('vehicle-search-input'), { target: { value: 'toyota corolla' } })

    await waitFor(() =>
      expect(fetchMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({ q: 'toyota corolla' })),
    )
    expect(lookupVehiclePassport).not.toHaveBeenCalled()
  })

  it('still searches listings when the passport lookup misses (backend haystack covers identifiers)', async () => {
    renderSearch()
    fireEvent.change(screen.getByTestId('vehicle-search-input'), { target: { value: 'ABC1234' } })

    await waitFor(() => expect(lookupVehiclePassport).toHaveBeenCalledWith('ABC1234'))
    await waitFor(() =>
      expect(fetchMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({ q: 'ABC1234' })),
    )
    expect(screen.queryByTestId('vehicle-search-passport-match')).toBeNull()
  })
})

describe('looksLikeIdentifier heuristic', () => {
  it('accepts VIN/plate/chassis-shaped queries (no spaces, length >= 6)', () => {
    expect(looksLikeIdentifier('JH4KA8260MC000000')).toBe(true)
    expect(looksLikeIdentifier('ABC1234')).toBe(true)
    expect(looksLikeIdentifier('  ABC1234  ')).toBe(true)
  })

  it('rejects free-text and short queries', () => {
    expect(looksLikeIdentifier('toyota corolla')).toBe(false)
    expect(looksLikeIdentifier('AE123')).toBe(false)
    expect(looksLikeIdentifier('')).toBe(false)
  })
})
