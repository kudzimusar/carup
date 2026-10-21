/**
 * CARUP-MVP-STAB-01 F-004 — My Listings names its two buyer numbers correctly, and they agree with the
 * inquiry card.
 *
 * Before: the KPI tile "Buyer inquiries" showed the number of conversation THREADS (any thread whose
 * business_workflow was 'marketplace' — so Trade OS RFQ and diaspora threads counted), its detail was the
 * number of unread MESSAGES, and the inquiry card's badge counted every inquiry row while its list showed
 * only this seller's listings: three numbers, two names, no agreement (Seller master plan defect I4).
 *
 * Now: Inquiries = the inquiry rows for this seller's listings (one read, shared with the card).
 * Conversations = marketplace-inquiry threads (thread_type AND subject_type) on those listings.
 * Unread = conversations with something unread — never a message count. A failed read is "Unavailable".
 *
 * Fixture: the Serena GFC27-027051 as staging holds it — 36 inquiries, 33 conversations, one unread.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle } from '@/types'

vi.setConfig({ testTimeout: 30_000 })

const api = vi.hoisted(() => ({
  fetchOwnedVehicles: vi.fn(),
  fetchCommunicationThreads: vi.fn(),
  fetchMyMarketplaceInquiries: vi.fn(),
}))
// Stable identities, as the real hook's useCallbacks are.
const hook = {
  ...api,
  updateVehicleStatus: vi.fn(),
  publishVehicleListing: vi.fn(),
  unpublishVehicleListing: vi.fn(),
  updateVehiclePrice: vi.fn(),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hook }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const MyListings = (await import('./MyListings')).default

const SERENA = 'GFC27-027051'
const COROLLA = 'JTDKARFP0H3000731'
const listings = [
  { vin: SERENA, make: 'Nissan', model: 'Serena Highway Star', year: 2016, price: 12800, currency: 'USD', status: 'Available', publication_status: 'published' },
  { vin: COROLLA, make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', status: 'Available', publication_status: 'published' },
] as Vehicle[]

const inquiry = (n: number, vin: string) => ({
  id: `inq-${vin}-${n}`, listing_id: vin, inquiry_type: 'vehicle_purchase_interest', status: 'new',
  message: `Question ${n} about ${vin}`, contact_name: `Buyer ${n}`, created_at: '2026-10-11T00:00:00.000Z',
})
const INQUIRIES = [
  ...Array.from({ length: 36 }, (_, i) => inquiry(i, SERENA)),
  ...Array.from({ length: 2 }, (_, i) => inquiry(i, COROLLA)),
  // A row for a vehicle that is not one of these listings: it is not an inquiry ON my listings.
  inquiry(0, 'WBA8E9C50HK000732'),
]

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id, thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: `inq-${id}`,
  business_workflow: 'marketplace', marketplace_listing_id: SERENA, unread_count: 0, latest_message: { text: 'Hello' }, ...extra,
})
const THREADS = [
  ...Array.from({ length: 33 }, (_, i) => thread(`serena-${i}`, i === 0 ? { unread_count: 2 } : {})),
  thread('corolla-0', { marketplace_listing_id: COROLLA }),
  // NOT buyer inquiry conversations on these listings, whatever their workflow says:
  thread('rfq', { subject_type: 'trade_rfq', unread_count: 5 }),
  thread('diaspora', { thread_type: 'import', subject_type: 'diaspora_import', unread_count: 1 }),
  thread('as-buyer', { marketplace_listing_id: 'SOMEONE-ELSES-VIN', unread_count: 1 }),
]

const HEADER = '2 vehicle listings · 38 inquiries · 34 conversations · 1 unread conversation'

function tile(name: string) {
  return screen.getByTestId(`seller-kpi-${name}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  api.fetchOwnedVehicles.mockResolvedValue(listings)
  api.fetchCommunicationThreads.mockResolvedValue({ threads: THREADS })
  api.fetchMyMarketplaceInquiries.mockResolvedValue({ inquiries: INQUIRIES })
})

describe('My Listings counts inquiries and conversations as two different things', () => {
  it('the header, the KPI tiles and every listing use the same two definitions', async () => {
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    expect(await screen.findByText(HEADER)).toBeTruthy()

    expect(within(tile('inquiries')).getByText('38')).toBeTruthy()
    expect(tile('inquiries')).toHaveTextContent('Buyer requests on your listings')
    expect(within(tile('conversations')).getByText('34')).toBeTruthy()
    expect(tile('conversations')).toHaveTextContent('1 unread conversation')

    expect(screen.getByTestId(`listing-buyer-activity-${SERENA}`)).toHaveTextContent('36 inquiries · 33 conversations · 1 unread conversation')
    expect(screen.getByTestId(`listing-buyer-activity-${COROLLA}`)).toHaveTextContent('2 inquiries · 1 conversation · 0 unread conversations')

    // One number, one name: nothing calls the conversation count "inquiries" any more.
    expect(screen.queryByText('Buyer inquiries')).toBeNull()
    expect(document.body.textContent).not.toMatch(/unread\b(?! conversation)/)
  })

  it('the inquiry card shows the same inquiry total, from the same single read', async () => {
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    await screen.findByText(HEADER)
    const card = screen.getByTestId('seller-inquiries-card')
    expect(within(card).getByTestId('seller-inquiries-total')).toHaveTextContent('38 inquiries')
    expect(api.fetchMyMarketplaceInquiries).toHaveBeenCalledTimes(1)
    expect(card.textContent).not.toContain('WBA8E9C50HK000732')
  })

  it('a failed inquiry read is "Unavailable" — never zero — and the conversations still show', async () => {
    api.fetchMyMarketplaceInquiries.mockRejectedValue(new Error('503'))
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    expect(await screen.findByText('2 vehicle listings · inquiries unavailable · 34 conversations · 1 unread conversation')).toBeTruthy()
    expect(within(tile('inquiries')).getByText('Unavailable')).toBeTruthy()
    expect(tile('inquiries')).toHaveTextContent('Inquiry read failed')
    expect(within(tile('conversations')).getByText('34')).toBeTruthy()
    expect(screen.getByTestId(`listing-buyer-activity-${SERENA}`)).toHaveTextContent('Inquiries unavailable · 33 conversations · 1 unread conversation')
    expect(within(screen.getByTestId('seller-inquiries-card')).getByTestId('seller-inquiries-total')).toHaveTextContent('Unavailable')
    expect(document.body.textContent).not.toMatch(/\b0 inquir/)
  })

  it('a failed conversation read is "Unavailable" while the inquiries still show', async () => {
    api.fetchCommunicationThreads.mockRejectedValue(new Error('503'))
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    expect(await screen.findByText('2 vehicle listings · 38 inquiries · conversations unavailable')).toBeTruthy()
    expect(within(tile('conversations')).getByText('Unavailable')).toBeTruthy()
    expect(tile('conversations')).toHaveTextContent('Conversation read failed')
    expect(screen.getByTestId(`listing-buyer-activity-${SERENA}`)).toHaveTextContent('36 inquiries · Conversations unavailable')
    expect(document.body.textContent).not.toMatch(/\b0 conversation/)
  })
})
