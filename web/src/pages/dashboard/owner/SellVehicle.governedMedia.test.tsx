/**
 * T11-CAP-LR01-R2 — the Seller Studio can SEE the owner's private photographs of the vehicle it is resumed for.
 *
 * `/api/vehicles/me` carries a one-photograph window (the hero) on each row; the studio then reads the whole gallery from the dedicated route.
 * Held here: the hero stands in when there is no listing photograph; the full gallery replaces the window; a failed read of the full gallery
 * leaves the window and claims nothing about the rest; and a vehicle with no private block shows no gallery at all. None of it is listing media —
 * adding photographs to a listing remains the separate step the studio already has.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const lookupVehiclePassport = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchGovernedMedia = vi.fn()
const updateSellerDraft = vi.fn()
const requestSellerAuthorityClaim = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    lookupVehiclePassport, fetchOwnedVehicles, fetchGovernedMedia, updateSellerDraft, requestSellerAuthorityClaim,
    createVehicleListing: vi.fn(), uploadVehicleImages: vi.fn(),
  }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'seller-1', role: 'owner' } }) }))
vi.mock('@/components/VehicleCompletenessPanel', () => ({ VehicleCompletenessPanel: () => null }))
vi.mock('@/components/seller/SellerWorkspaceHeader', () => ({ SellerWorkspaceHeader: () => null }))

const SellVehicle = (await import('./SellVehicle')).default

const VIN = 'JTDKARFP0H3000731'
const photo = (rank: number) => ({
  gallery_item_id: `g${rank}`, gallery_rank: rank, designated_primary: rank === 1, designation_basis: rank === 1 ? 'SOURCE_FIRST_IMAGE' : null, caption: null, review_status: 'pending',
  view: { href: `https://signed.example.test/p${rank}.jpg?token=abc`, expires_at: '2026-10-26T06:00:00Z' },
})
const block = (n: number, total = 50) => ({ state: 'available', items: Array.from({ length: n }, (_, i) => photo(i + 1)), total_count: total, unavailable_count: 0, empty_statement: null })
const owned = (over: Record<string, unknown> = {}) => ({
  vin: VIN, make: 'Toyota', model: 'Aqua', year: 2017, color: 'Silver', publication_status: 'draft', status: 'Available',
  listing_media: { state: 'none', items: [], unpublishable_count: 0, empty_statement: null }, governed_media: block(1), ...over,
})
const renderResumed = () => render(<MemoryRouter initialEntries={[`/dashboard/sell-vehicle?vin=${VIN}`]}><SellVehicle /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  lookupVehiclePassport.mockResolvedValue({ vehicle: { vin: VIN, make: 'Toyota', model: 'Aqua', year: 2017 } })
  updateSellerDraft.mockResolvedValue({})
  fetchOwnedVehicles.mockResolvedValue([owned()])
  fetchGovernedMedia.mockResolvedValue(block(3))
})

describe('Seller Studio — the owner\'s private photographs', () => {
  it('shows the WHOLE private gallery once it is read, and uses the private hero while there is no listing photograph', { timeout: 30_000 }, async () => {
    renderResumed()
    const gallery = await screen.findByTestId('governed-gallery', {}, { timeout: 10_000 })
    await waitFor(() => expect(within(within(gallery).getByTestId('governed-gallery-thumbs')).getAllByRole('button')).toHaveLength(3))
    expect(fetchGovernedMedia).toHaveBeenCalledWith(VIN)
    expect(gallery.textContent).toMatch(/Photographs on file for this vehicle/)
    expect(gallery.textContent).toMatch(/not part of any listing/i)
    expect(Array.from(document.querySelectorAll('img')).some((i) => i.getAttribute('src') === 'https://signed.example.test/p1.jpg?token=abc')).toBe(true)
  })

  it('a failed read of the full gallery leaves the hero window and claims nothing about the rest', { timeout: 30_000 }, async () => {
    fetchGovernedMedia.mockRejectedValue(new Error('offline'))
    renderResumed()
    const gallery = await screen.findByTestId('governed-gallery', {}, { timeout: 10_000 })
    await waitFor(() => expect(fetchGovernedMedia).toHaveBeenCalled())
    expect(within(gallery).queryByTestId('governed-gallery-thumbs')).toBeNull()
    expect(within(gallery).getByTestId('governed-gallery-position').textContent).toBe('Photograph 1 of 50')
    expect(within(gallery).queryByTestId('governed-gallery-none')).toBeNull()
  })

  it('a vehicle that was sent no private block shows no gallery', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([owned({ governed_media: undefined })])
    fetchGovernedMedia.mockRejectedValue(new Error('404'))
    renderResumed()
    await waitFor(() => expect(screen.getByTestId('vehicle-vin-input')).toHaveValue(VIN), { timeout: 10_000 })
    await waitFor(() => expect(fetchGovernedMedia).toHaveBeenCalled())
    expect(screen.queryByTestId('governed-gallery')).toBeNull()
  })
})
