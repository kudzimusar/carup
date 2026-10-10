/**
 * PC01-J-R1 — a `publishable` listing says, in words, that it is not on the public Marketplace, and
 * who took it down when the audit trail recorded that.
 *
 * The fixture is the real UAT vehicle GFC27-027051 as `/api/vehicles/me` returns it for its owner:
 * `publishable`, last moved by a CarUp staging reconciliation on 2026-10-06 after its owner had
 * left it published. Before this change My Listings showed only "Publication: Ready to publish".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle } from '@/types'
import { describeReadyToPublish } from '@/lib/publicationStatus'

vi.setConfig({ testTimeout: 30_000 })

const fetchOwnedVehicles = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnedVehicles,
    updateVehicleStatus: vi.fn(),
    fetchCommunicationThreads: vi.fn().mockResolvedValue({ threads: [] }),
    publishVehicleListing: vi.fn(),
    unpublishVehicleListing: vi.fn(),
    updateVehiclePrice: vi.fn(),
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/marketplace/SellerInquiriesCard', () => ({ SellerInquiriesCard: () => null }))

const MyListings = (await import('./MyListings')).default

const VIN = 'GFC27-027051'
const serena = (over: Partial<Vehicle> = {}): Vehicle => ({
  vin: VIN,
  make: 'Nissan',
  model: 'Serena Highway Star',
  year: 2016,
  price: 12800,
  currency: 'USD',
  status: 'Available',
  publication_status: 'publishable',
  publication_last_change: { state: 'recorded', change: 'unpublished', at: '2026-10-06T23:32:43.696Z', by: 'carup' },
  ...over,
} as Vehicle)

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe('a publishable listing explains that it is not on the public Marketplace', () => {
  it('names the state, its consequence for buyers, and that CarUp — not the owner — took it down', async () => {
    fetchOwnedVehicles.mockResolvedValue([serena()])
    render(<MemoryRouter><MyListings /></MemoryRouter>)

    const badge = await screen.findByTestId(`publication-badge-${VIN}`)
    expect(badge).toHaveTextContent('Ready to publish — not on the public Marketplace yet')

    const explainer = screen.getByTestId(`publication-explainer-${VIN}`)
    expect(explainer).toHaveTextContent('CarUp took this listing off the public Marketplace on 6 October 2026. This was not your action.')
    expect(explainer).toHaveTextContent('Buyers cannot see this listing — it is not on the public Marketplace.')
    expect(screen.getByTestId(`publish-toggle-${VIN}`)).toHaveTextContent('Publish to Marketplace')
  })

  it('does not explain a published listing as hidden', async () => {
    fetchOwnedVehicles.mockResolvedValue([serena({ publication_status: 'published', publication_last_change: { state: 'recorded', change: 'published', at: '2026-09-26T20:08:27.773Z', by: 'you' } })])
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    await screen.findByTestId(`publication-badge-${VIN}`)
    expect(screen.queryByTestId(`publication-explainer-${VIN}`)).toBeNull()
  })
})

describe('describeReadyToPublish', () => {
  it('attributes only what the audit trail recorded', () => {
    expect(describeReadyToPublish({ state: 'recorded', change: 'unpublished', at: '2026-10-06T23:32:43.696Z', by: 'you' }))
      .toMatch(/^You took this listing off the public Marketplace on 6 October 2026\./)
    expect(describeReadyToPublish({ state: 'recorded', change: 'unpublished', at: '2026-10-06T23:32:43.696Z', by: 'another_account' }))
      .toMatch(/^Another account with selling rights took this listing off/)
  })

  it('a failed read, an absent trail or a publish event adds no attribution at all', () => {
    const plain = describeReadyToPublish(null)
    expect(plain).toMatch(/^Buyers cannot see this listing/)
    expect(describeReadyToPublish({ state: 'not_read' })).toBe(plain)
    expect(describeReadyToPublish({ state: 'none' })).toBe(plain)
    expect(describeReadyToPublish({ state: 'recorded', change: 'published', at: '2026-09-26T20:08:27.773Z', by: 'you' })).toBe(plain)
  })

  it('never promises the listing goes straight live', () => {
    expect(describeReadyToPublish(null)).toContain('re-checks its publication requirements first')
  })
})
