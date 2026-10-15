import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetCommunicationCapabilityCache } from '@/hooks/useCommunicationCapability'

const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string; phone?: string } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
const api = vi.hoisted(() => ({ createMarketplaceInquiry: vi.fn(async () => ({ inquiry: { id: 'inq-1' } })) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ createMarketplaceInquiry: api.createMarketplaceInquiry }) }))
vi.mock('@/lib/intelligenceActivity', () => ({ track: vi.fn() }))

const { InquiryModal } = await import('./InquiryModal')

function health({ whatsapp = false, email = false } = {}) {
  const external = whatsapp || email
  return {
    communications: {
      providers: [
        { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: whatsapp ? 'READY' : 'BLOCKED', available: whatsapp },
        { channel: 'email', provider: 'resend', status: 'READY', available: true },
      ],
      scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
      outbound: external
        ? { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled' }
        : { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' },
    },
  }
}
function serve(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))
}
function open(props: Partial<Parameters<typeof InquiryModal>[0]> = {}) {
  render(<MemoryRouter initialEntries={['/marketplace/VIN123']}><InquiryModal listingId="VIN123" {...props} /></MemoryRouter>)
  fireEvent.click(screen.getByTestId('marketplace-inquiry-open'))
}
const picker = () => screen.getByTestId('marketplace-inquiry-preferred-contact')

beforeEach(() => { resetCommunicationCapabilityCache(); auth.user = null })
afterEach(() => { vi.unstubAllGlobals() })

describe('inquiry delivery channels follow runtime truth (OC-LAUNCH R1)', () => {
  // Product authority (publicAccessPolicy): a guest inquiry with an email or phone is accepted and the
  // seller sees those contact details. Paused CarUp delivery is explained, never a reason to block it
  // (Golden Dynamic Seller spec 38 caught the earlier block on release head 8a5a920d).
  it('accepts a guest inquiry while CarUp delivery is paused, and says so truthfully', async () => {
    api.createMarketplaceInquiry.mockClear()
    serve(health())
    open()
    const note = await screen.findByTestId('guest-delivery-paused')
    expect(note.textContent).toMatch(/still reaches the\s+seller with the contact details/i)
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/login?returnTo=%2Fmarketplace%2FVIN123')
    const submit = screen.getByTestId('marketplace-inquiry-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.change(screen.getByTestId('marketplace-inquiry-phone'), { target: { value: '+263771234567' } })
    fireEvent.click(submit)
    await waitFor(() => expect(api.createMarketplaceInquiry).toHaveBeenCalledTimes(1))
    expect(api.createMarketplaceInquiry.mock.calls[0][0]).toMatchObject({ listing_id: 'VIN123', guest_phone: '+263771234567' })
  })
  it('moves a guest off an unavailable WhatsApp default onto a working channel', async () => {
    serve(health({ email: true }))
    open()
    await waitFor(() => expect(picker().getAttribute('data-preferred-contact')).toBe('email'))
    expect(screen.queryByTestId('guest-no-delivery-channel')).toBeNull()
    expect((screen.getByTestId('marketplace-inquiry-submit') as HTMLButtonElement).disabled).toBe(false)
  })
  it('honours a WhatsApp entry point only while WhatsApp is available, with the WhatsApp mark', async () => {
    serve(health({ whatsapp: true, email: true }))
    open({ defaultPreferredContact: 'whatsapp', triggerIcon: 'whatsapp', triggerLabel: 'Ask on WhatsApp' })
    // The picker shows the settled selection: WhatsApp, available (no "— checking" / "— unavailable").
    await waitFor(() => expect(picker().textContent?.trim()).toBe('WhatsApp'))
    expect(picker().getAttribute('data-preferred-contact')).toBe('whatsapp')
    expect(screen.getByTestId('marketplace-inquiry-open').querySelector('svg')).toBeTruthy()
  })
  it('falls back to the CarUp inbox for a signed-in buyer when WhatsApp is unavailable', async () => {
    auth.user = { name: 'Buyer', email: 'buyer@example.test' }
    serve(health())
    open({ defaultPreferredContact: 'whatsapp' })
    await waitFor(() => expect(picker().getAttribute('data-preferred-contact')).toBe('carup'))
    expect(screen.queryByTestId('guest-no-delivery-channel')).toBeNull()
  })
  it('treats a failed health read as unknown, never as available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    open()
    // Unknown is not available: the guest sees the paused-delivery note, and no channel is offered as live.
    expect(await screen.findByTestId('guest-delivery-paused')).toBeTruthy()
    expect(picker().textContent).not.toMatch(/^WhatsApp$|^Email$/)
  })
})
