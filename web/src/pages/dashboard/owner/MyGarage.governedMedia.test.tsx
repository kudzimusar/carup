import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * T11-CAP-LR01-R2 — a vehicle imported with private photographs and no listing, as the owner sees it in My Garage.
 *
 * The row below is shaped like the real purchase this was built for: a stored price of 0 with no currency (the column is NOT NULL, so 0 is how a
 * record says "never priced"), no listing photograph, and a governed-media hero attached by `/api/vehicles/me`. Held on screen:
 *   · the private hero is the picture, marked private with its own review state — and is never called a seller listing photograph;
 *   · "$0" is never printed as a price;
 *   · a vehicle whose private photographs could not be read is not told it has "no photos";
 *   · a vehicle with a published listing photograph is shown exactly as before.
 */

const VIN = 'FRAME-0000123'

const fetchSafePayEscrows = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchNotifications = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const unsaveMarketplaceListing = vi.fn()
const updateVehicleStatus = vi.fn()
const fetchCommunicationThreads = vi.fn()
const publishVehicleListing = vi.fn()
const unpublishVehicleListing = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications, fetchSavedMarketplaceListings,
    unsaveMarketplaceListing, updateVehicleStatus, fetchCommunicationThreads, publishVehicleListing, unpublishVehicleListing,
  }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', name: 'Owner', email: 'owner@staging.carup.local', role: 'owner' }, isAuthenticated: true, loading: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const MyGarage = (await import('./MyGarage')).default

const governedHero = (over: Record<string, unknown> = {}) => ({
  state: 'available',
  items: [{
    gallery_item_id: 'g1', gallery_rank: 1, designated_primary: true, designation_basis: 'SOURCE_FIRST_IMAGE', caption: null, review_status: 'pending',
    view: { href: 'https://signed.example.test/hero.jpg?token=abc', expires_at: '2026-10-26T06:00:00Z' },
  }],
  total_count: 50, unavailable_count: 0, empty_statement: null, ...over,
})

function row(over: Record<string, unknown> = {}) {
  return {
    vin: VIN, year: 2018, make: 'Make', model: 'Model', color: 'Pearl', mileage: 134741, price: 0, currency: null, status: 'Pending',
    created_at: '2026-10-25T00:00:00.000Z', publication_status: 'not_published', listing_media: { state: 'none', items: [], unpublishable_count: 0, empty_statement: null },
    trust: { vin: VIN, score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated', evidence_basis: null, calculation_version: null, evaluated_at: null, known_limitations: [], source: 'cache' },
    governed_media: governedHero(), ...over,
  }
}

const renderGarage = () => render(<MemoryRouter><MyGarage /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([row()])
  fetchSafePayEscrows.mockResolvedValue([])
  fetchNotifications.mockResolvedValue([])
  fetchCommunicationThreads.mockResolvedValue({ threads: [] })
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
})

describe('My Garage — the owner\'s private photograph and an unpriced record', () => {
  it('shows the private hero as the vehicle\'s picture, marked private and awaiting review', async () => {
    renderGarage()
    const card = await screen.findByTestId(`vehicle-row-${VIN}`)
    const hero = within(card).getByTestId('owner-vehicle-hero-governed')
    expect(within(hero).getByRole('img').getAttribute('src')).toBe('https://signed.example.test/hero.jpg?token=abc')
    expect(hero.textContent).toMatch(/Private · Awaiting review/)
    expect(card.textContent).toMatch(/Your photograph — private, not in a listing/)
    expect(card.textContent).not.toMatch(/Seller listing media/)
    expect(card.textContent).not.toMatch(/No seller listing photo recorded/)
  })

  it('an unpriced record (0, no currency) is "Price not recorded" — never "$0"', async () => {
    renderGarage()
    await screen.findByTestId(`vehicle-row-${VIN}`)
    const price = screen.getByTestId(`vehicle-price-${VIN}`)
    expect(price.textContent).toMatch(/Price not recorded/)
    expect(price.textContent).not.toMatch(/\$\s*0/)
  })

  it('a recorded price still prints as it always has', async () => {
    fetchOwnedVehicles.mockResolvedValue([row({ price: 12500, currency: 'USD' })])
    renderGarage()
    await screen.findByTestId(`vehicle-row-${VIN}`)
    expect(screen.getByTestId(`vehicle-price-${VIN}`).textContent).toMatch(/\$12,500/)
  })

  it('a published listing photograph is shown exactly as before — the private one is not shown beside it', async () => {
    fetchOwnedVehicles.mockResolvedValue([row({
      listing_media: { state: 'published', items: [{ media_id: 'm1', url: 'https://cdn.example.test/listing.jpg', url_form: 'absolute_https', position: 0, is_primary: true }], unpublishable_count: 0, empty_statement: null },
    })])
    renderGarage()
    const card = await screen.findByTestId(`vehicle-row-${VIN}`)
    expect(within(card).queryByTestId('owner-vehicle-hero-governed')).toBeNull()
    expect(card.textContent).toMatch(/Seller listing media/)
    expect(Array.from(card.querySelectorAll('img')).map((i) => i.getAttribute('src'))).toContain('https://cdn.example.test/listing.jpg')
  })

  it('a vehicle with no private block sent says what it always said', async () => {
    fetchOwnedVehicles.mockResolvedValue([row({ governed_media: undefined })])
    renderGarage()
    const card = await screen.findByTestId(`vehicle-row-${VIN}`)
    expect(within(card).queryByTestId('owner-vehicle-hero-governed')).toBeNull()
    expect(card.textContent).toMatch(/No seller listing photo recorded/)
    expect(within(card).getByTestId('owner-listing-media-none')).toBeTruthy()
  })

  it('a fault reading the private photographs is not told to the owner as "no photos added yet"', async () => {
    fetchOwnedVehicles.mockResolvedValue([row({ governed_media: { state: 'not_loaded', items: [], total_count: 0, unavailable_count: 0, empty_statement: null } })])
    renderGarage()
    const card = await screen.findByTestId(`vehicle-row-${VIN}`)
    await waitFor(() => expect(within(card).getByTestId('owner-listing-media-not-loaded')).toBeTruthy())
    expect(within(card).queryByTestId('owner-listing-media-none')).toBeNull()
  })
})
