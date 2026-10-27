/**
 * T11-CAP-LR01-R3 (Moderator D-3) — My Listings lists LISTINGS, not every vehicle the account owns.
 *
 * Before: the page was populated from all owned vehicles, so the never-listed Honda Vezel appeared as an unpublished draft "needing
 * action" with Publish and Buyer Preview buttons — and the invitation led a person into the Seller Studio, which then wrote to the
 * vehicle row merely by being opened.
 *
 * Now a vehicle appears here when its server-derived Marketplace capability is published, in progress or sold. A vehicle whose state
 * could not be read is neither silently dropped nor silently listed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle, VehicleCapabilities } from '@/types'

vi.setConfig({ testTimeout: 30_000 })

const SERENA = 'GFC27-027051'
const VEZEL = 'RU3-1316558'

const fetchOwnedVehicles = vi.fn()
const fetchCommunicationThreads = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnedVehicles,
    fetchCommunicationThreads,
    updateVehicleStatus: vi.fn(),
    publishVehicleListing: vi.fn(),
    unpublishVehicleListing: vi.fn(),
    updateVehiclePrice: vi.fn(),
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/marketplace/SellerInquiriesCard', () => ({
  SellerInquiriesCard: ({ ownedListings }: { ownedListings?: Vehicle[] }) => <div data-testid="inquiries-card" data-owned={ownedListings ? ownedListings.map((v) => v.vin).join(',') : 'unloaded'} />,
}))

const MyListings = (await import('./MyListings')).default

const veh = (vin: string, over: Record<string, unknown> = {}) => ({
  vin, make: 'Make', model: `Model ${vin}`, year: 2018, price: 0, currency: null, status: 'Pending', publication_status: 'draft', ...over,
}) as unknown as Vehicle

const serena = (capabilities?: VehicleCapabilities) => veh(SERENA, {
  make: 'Nissan', model: 'Serena Highway Star', year: 2016, price: 12800, currency: 'USD', status: 'Available', publication_status: 'published',
  ...(capabilities ? { capabilities } : {}),
})
const vezel = (capabilities?: VehicleCapabilities) => veh(VEZEL, { make: 'Honda', model: 'Vezel', ...(capabilities ? { capabilities } : {}) })

const PUBLISHED: VehicleCapabilities = { marketplace: { state: 'published' }, trade_import: { state: 'none' } }
const NOT_LISTED: VehicleCapabilities = { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: 'ord-1' } }

const show = async (rows: Vehicle[]) => {
  fetchOwnedVehicles.mockResolvedValue(rows)
  render(<MemoryRouter><MyListings /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('inquiries-card').getAttribute('data-owned')).not.toBe('unloaded'))
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  fetchCommunicationThreads.mockResolvedValue({ threads: [] })
})

describe('the Serena and the Vezel in one account', () => {
  it('lists the published Serena and does NOT list the never-listed Vezel', async () => {
    await show([serena(PUBLISHED), vezel(NOT_LISTED)])
    expect(screen.getByTestId(`my-listing-card-${SERENA}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`my-listing-card-${VEZEL}`)).toBeNull()
    expect(screen.queryByTestId(`publish-toggle-${VEZEL}`)).toBeNull()
    expect(screen.queryByText(/Publish to Marketplace/)).toBeNull()
  })

  it('counts only listings: one listing, nothing needing action, and the inquiries card is told only about the listing', async () => {
    await show([serena(PUBLISHED), vezel(NOT_LISTED)])
    const kpis = screen.getByTestId('seller-listing-kpis')
    expect(within(kpis).getByText('Published').parentElement).toHaveTextContent('1')
    expect(within(kpis).getByText('Need action').parentElement).toHaveTextContent('0')
    expect(screen.getByTestId('inquiries-card')).toHaveAttribute('data-owned', SERENA)
    expect(screen.getByRole('heading', { level: 1, name: 'My Listings' }).closest('header')).toHaveTextContent('1 vehicle listing ·')
  })
})

describe('what makes a vehicle a listing', () => {
  it.each(['published', 'in_progress', 'sold'] as const)('%s is listed', async (state) => {
    await show([vezel({ marketplace: { state }, trade_import: { state: 'none' } })])
    expect(screen.getByTestId(`my-listing-card-${VEZEL}`)).toBeInTheDocument()
  })

  it('not_listed is not', async () => {
    await show([vezel({ marketplace: { state: 'not_listed' }, trade_import: { state: 'none' } })])
    expect(screen.queryByTestId(`my-listing-card-${VEZEL}`)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: /No Seller listing thread yet/ })).toBeInTheDocument()
  })
})

describe('a state that could not be read', () => {
  it('is not listed, is not hidden without a word, and does not claim the vehicle is unlisted', async () => {
    await show([serena(PUBLISHED), vezel({ marketplace: { state: 'unavailable' }, trade_import: { state: 'none' } })])
    expect(screen.queryByTestId(`my-listing-card-${VEZEL}`)).toBeNull()
    const note = screen.getByTestId('listing-state-unread')
    expect(note).toHaveTextContent('1 of your vehicles could not be checked for a listing just now')
    expect(note).toHaveTextContent('has not concluded it is unlisted')
    expect(within(note).getByRole('link', { name: 'My Garage' })).toHaveAttribute('href', '/dashboard/garage')
    expect(screen.getByTestId(`my-listing-card-${SERENA}`)).toBeInTheDocument()
  })

  it('no capabilities at all (the server sent none): every vehicle is shown, with a notice — hiding a real listing is the worse error', async () => {
    await show([serena(), vezel()])
    expect(screen.getByTestId(`my-listing-card-${SERENA}`)).toBeInTheDocument()
    expect(screen.getByTestId(`my-listing-card-${VEZEL}`)).toBeInTheDocument()
    expect(screen.getByTestId('listing-capabilities-not-loaded')).toHaveTextContent('Listing states could not be loaded')
  })

  it('a healthy response shows neither notice', async () => {
    await show([serena(PUBLISHED), vezel(NOT_LISTED)])
    expect(screen.queryByTestId('listing-state-unread')).toBeNull()
    expect(screen.queryByTestId('listing-capabilities-not-loaded')).toBeNull()
  })
})

describe('where am I', () => {
  it('names the Marketplace workspace and does not offer the Seller-only parent label', async () => {
    await show([serena(PUBLISHED)])
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'marketplace')
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByText('Seller / Owner home')).toBeNull()
  })

  it('reads the grammar of one vehicle in the plural correctly', async () => {
    await show([serena(PUBLISHED), veh('SECOND-0001', { capabilities: { marketplace: { state: 'in_progress' }, trade_import: { state: 'none' } } })])
    expect(screen.getByRole('heading', { level: 1, name: 'My Listings' }).closest('header')).toHaveTextContent('2 vehicle listings ·')
  })
})
