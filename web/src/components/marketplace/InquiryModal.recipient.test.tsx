import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetCommunicationCapabilityCache } from '@/hooks/useCommunicationCapability'

/**
 * OC-NATIVE-FINAL-02-R1 P2-B — the parts inquiry promised a seller.
 *
 * A parts quote request carries no listing, and the backend resolves a seller only for a vehicle-bound
 * inquiry on a listing (marketplaceInquiryService VEHICLE_BOUND_TYPES), so seller_id is null: the
 * request is recorded for CarUp's marketplace reviewers and nobody is contacted automatically. The
 * modal nevertheless said "Deliver seller replies through", told a guest "Your inquiry still reaches
 * the seller", and confirmed "Inquiry sent".
 */
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
const api = vi.hoisted(() => ({
  createMarketplaceInquiry: vi.fn(async () => ({ inquiry: { id: 'inq-1' } })),
  fetchMarketplaceParts: vi.fn(async () => ({ listings: [] as unknown[] })),
  fetchMarketplaceServices: vi.fn(async () => ({ listings: [] as unknown[] })),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/lib/intelligenceActivity', () => ({ track: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const { InquiryModal } = await import('./InquiryModal')
const MarketplaceCategoryPage = (await import('@/pages/MarketplaceCategoryPage')).default

// CarUp delivery paused: the guest sees the delivery note, which must not promise a recipient.
const PAUSED_HEALTH = {
  communications: {
    providers: [
      { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'BLOCKED', available: false },
      { channel: 'email', provider: 'resend', status: 'READY', available: true },
    ],
    scheduler: { status: 'READY' },
    fakeAdapters: { enabled: false },
    outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' },
  },
}

function openModal(props: Partial<Parameters<typeof InquiryModal>[0]>) {
  render(<MemoryRouter initialEntries={['/marketplace/parts']}><InquiryModal {...props} /></MemoryRouter>)
  fireEvent.click(screen.getByTestId('marketplace-inquiry-open'))
  return screen.getByTestId('marketplace-inquiry-modal')
}

async function submitAsGuest() {
  fireEvent.change(screen.getByTestId('marketplace-inquiry-phone'), { target: { value: '+263771234567' } })
  fireEvent.click(screen.getByTestId('marketplace-inquiry-submit'))
  await waitFor(() => expect(api.createMarketplaceInquiry).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
  return String(toasts.success.mock.calls[0][0])
}

beforeEach(() => {
  resetCommunicationCapabilityCache()
  auth.user = null
  api.createMarketplaceInquiry.mockClear()
  toasts.success.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PAUSED_HEALTH })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('an inquiry promises a seller only when CarUp resolves one (OC-NATIVE-FINAL-02-R1 P2-B)', () => {
  it('a parts request with no listing says it reaches no seller, and confirms only that it was recorded', async () => {
    const modal = openModal({ inquiryTypes: ['part_quote_request'], defaultInquiryType: 'part_quote_request', triggerLabel: 'Request a parts quote' })
    expect(screen.getByTestId('inquiry-recipient-note').textContent).toMatch(/not sent to a particular seller or supplier/i)
    expect(modal.textContent).not.toMatch(/Deliver seller replies/i)
    const note = await screen.findByTestId('guest-delivery-paused')
    expect(note.textContent).not.toMatch(/reaches the\s+seller/i)
    expect(note.textContent).toMatch(/still recorded with the contact details/i)

    const confirmation = await submitAsGuest()
    expect(confirmation).toMatch(/not been sent to a seller or supplier/i)
    expect(confirmation).not.toMatch(/Inquiry sent/i)
  })

  it('a service request that names no garage is handled the same way', async () => {
    const modal = openModal({ inquiryTypes: ['garage_service_request'], defaultInquiryType: 'garage_service_request', triggerLabel: 'Ask CarUp to help me find a garage' })
    expect(screen.getByTestId('inquiry-recipient-note').textContent).toMatch(/not sent to a particular seller or supplier/i)
    expect(modal.textContent).not.toMatch(/Deliver seller replies/i)
  })

  it('a parts request is never seller-bound, even if a listing id is attached — exactly as the backend resolves it', () => {
    openModal({ listingId: 'PART-1', inquiryTypes: ['part_quote_request'], defaultInquiryType: 'part_quote_request' })
    expect(screen.getByTestId('inquiry-recipient-note').textContent).toMatch(/not sent to a particular seller or supplier/i)
  })

  it('a vehicle listing inquiry keeps its seller wording, because the backend resolves that seller', async () => {
    const modal = openModal({ listingId: 'VIN123', inquiryTypes: ['vehicle_purchase_interest'], defaultInquiryType: 'vehicle_purchase_interest' })
    expect(screen.queryByTestId('inquiry-recipient-note')).toBeNull()
    expect(modal.textContent).toMatch(/Deliver seller replies through/)
    expect((await screen.findByTestId('guest-delivery-paused')).textContent).toMatch(/still reaches the\s+seller/i)
    expect(await submitAsGuest()).toMatch(/Inquiry sent/)
  })
})

describe('the parts page asks for nothing it cannot deliver (OC-NATIVE-FINAL-02-R1 P2-B)', () => {
  it('a part card’s quote request names the part it is about', async () => {
    api.fetchMarketplaceParts.mockResolvedValueOnce({
      listings: [{ id: 'part-1', part_name: 'Front brake pads', part_category: 'Brakes', condition: 'new', price_mode: 'quote_required' }],
    })
    render(<MemoryRouter initialEntries={['/marketplace/parts']}><MarketplaceCategoryPage kind="part" /></MemoryRouter>)
    const card = await screen.findByTestId('marketplace-part-card')
    fireEvent.click(within(card).getByTestId('marketplace-inquiry-open'))
    const message = screen.getByTestId('marketplace-inquiry-message') as HTMLTextAreaElement
    expect(message.value).toContain('Front brake pads')
  })

  it('with no parts listed, the page does not promise that CarUp will source the part', async () => {
    api.fetchMarketplaceParts.mockResolvedValueOnce({ listings: [] })
    render(<MemoryRouter initialEntries={['/marketplace/parts']}><MarketplaceCategoryPage kind="part" /></MemoryRouter>)
    const empty = await screen.findByTestId('marketplace-category-empty')
    expect(empty.textContent).not.toMatch(/our team will source/i)
    expect(empty.textContent).toMatch(/not sent to a supplier automatically/i)
  })
})
