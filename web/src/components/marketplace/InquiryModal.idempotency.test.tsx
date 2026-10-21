import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetCommunicationCapabilityCache } from '@/hooks/useCommunicationCapability'

/**
 * CARUP-MVP-STAB-01 F-002 (web) — one composed inquiry is recorded once.
 *
 * The server records a repeat of the same `client_request_id` once (marketplaceInquiryService). The web
 * modal therefore sends one key per composed message: a double click, or a retry of the same words after a
 * failure, reuses it; editing the message is a different message and gets a new key.
 */
const auth = vi.hoisted(() => ({ user: { name: 'Certification Buyer', email: 'buyer@carup-staging.test' } as null | { name: string; email: string } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
const api = vi.hoisted(() => ({
  createMarketplaceInquiry: vi.fn(),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/lib/intelligenceActivity', () => ({ track: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const { InquiryModal } = await import('./InquiryModal')

const HEALTH = {
  communications: {
    providers: [],
    scheduler: { status: 'READY' },
    fakeAdapters: { enabled: false },
    outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' },
  },
}

function openModal() {
  render(<MemoryRouter initialEntries={['/marketplace/GFC27-027051']}><InquiryModal listingId="GFC27-027051" /></MemoryRouter>)
  fireEvent.click(screen.getByTestId('marketplace-inquiry-open'))
}

const keys = () => api.createMarketplaceInquiry.mock.calls.map((call) => (call[0] as { client_request_id?: string }).client_request_id)

beforeEach(() => {
  resetCommunicationCapabilityCache()
  api.createMarketplaceInquiry.mockReset()
  toasts.success.mockClear()
  toasts.error.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => HEALTH })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('web inquiry idempotency (CARUP-MVP-STAB-01 F-002)', () => {
  it('a double click sends one request carrying one key', async () => {
    let release: (value: unknown) => void = () => {}
    api.createMarketplaceInquiry.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    openModal()
    fireEvent.change(screen.getByTestId('marketplace-inquiry-message'), { target: { value: 'Is it still available?' } })
    // Two submits inside ONE act: React has not re-rendered (the button is not yet disabled) when the second
    // arrives — the race a real double click or Enter-key repeat can win. Only the synchronous guard stops it.
    const form = screen.getByTestId('marketplace-inquiry-submit').closest('form') as HTMLFormElement
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(api.createMarketplaceInquiry).toHaveBeenCalledTimes(1))
    expect(keys()[0]).toMatch(/^web-[a-z0-9]+-[A-Za-z0-9]+$/)
    release({ inquiry: { id: 'inq-1' } })
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
    expect(api.createMarketplaceInquiry).toHaveBeenCalledTimes(1)
  })

  it('a retry of the same words after a failure reuses the key; an edited message gets a new one', async () => {
    api.createMarketplaceInquiry
      .mockRejectedValueOnce(Object.assign(new Error('Network error'), { status: 0 }))
      .mockRejectedValueOnce(Object.assign(new Error('Network error'), { status: 0 }))
      .mockResolvedValueOnce({ inquiry: { id: 'inq-2' } })
    openModal()
    fireEvent.change(screen.getByTestId('marketplace-inquiry-message'), { target: { value: 'Is it still available?' } })
    fireEvent.click(screen.getByTestId('marketplace-inquiry-submit'))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('marketplace-inquiry-submit'))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(2))
    expect(keys()[1]).toBe(keys()[0])
    fireEvent.change(screen.getByTestId('marketplace-inquiry-message'), { target: { value: 'Is it still available? Can I view it Saturday?' } })
    fireEvent.click(screen.getByTestId('marketplace-inquiry-submit'))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
    expect(keys()[2]).toBeTruthy()
    expect(keys()[2]).not.toBe(keys()[0])
  })
})
