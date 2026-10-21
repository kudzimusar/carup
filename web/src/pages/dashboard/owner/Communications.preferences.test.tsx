import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readCommunicationCapability, type CommunicationCapability } from '@/lib/communicationChannels'

/**
 * CARUP-MVP-STAB-01 F-018 — WIRING. DeliveryPreferencesCard takes its read and save functions as
 * props, so its own tests cannot prove the owner page hands it the real client methods (the
 * injected-collaborator trap). This renders the Communications page itself.
 */

const api = {
  fetchCommunicationThreads: vi.fn(),
  fetchCommunicationThread: vi.fn(),
  markCommunicationThreadRead: vi.fn(),
  fetchCommunicationNotifications: vi.fn(),
  fetchCommunicationAccountActivity: vi.fn(),
  resendVerificationEmail: vi.fn(),
  fetchCommunicationPreferences: vi.fn(),
  sendCommunicationMessage: vi.fn(),
  updateCommunicationPreferences: vi.fn(),
  markCommunicationNotificationRead: vi.fn(),
  user: { id: 'owner-1', email: 'owner@staging.carup.local' },
}
const productApi = {
  fetchAnalytics: vi.fn(),
  fetchAiHealth: vi.fn(),
  suggestReply: vi.fn(),
  summarize: vi.fn(),
  translate: vi.fn(),
  nextBestAction: vi.fn(),
  uploadMedia: vi.fn(),
  sendLocation: vi.fn(),
  mediaAccess: vi.fn(),
  analyzeMedia: vi.fn(),
}
let capabilityState: { capability: CommunicationCapability; checking: boolean }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/hooks/useCommunicationProductApi', () => ({ useCommunicationProductApi: () => productApi }))
vi.mock('@/hooks/useCommunicationCapability', () => ({ useCommunicationCapabilityState: () => capabilityState }))

const Communications = (await import('./Communications')).default

const KILL_SWITCH_HEALTH = { communications: {
  providers: [
    { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
    { channel: 'email', provider: 'resend', status: 'READY', available: true },
  ],
  marketingEmail: { channel: 'email_marketing', provider: 'brevo', status: 'READY', available: true },
  scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
  outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' },
} }

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(productApi)]) {
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
  }
  api.fetchCommunicationThreads.mockResolvedValue({ threads: [] })
  api.fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  api.fetchCommunicationAccountActivity.mockResolvedValue({ activity: [] })
  productApi.fetchAnalytics.mockResolvedValue({ analytics: null })
  productApi.fetchAiHealth.mockResolvedValue({ ai: { available: false } })
  capabilityState = { capability: readCommunicationCapability(KILL_SWITCH_HEALTH), checking: false }
})

function renderPage() {
  return render(<MemoryRouter initialEntries={['/dashboard/communications']}><Communications /></MemoryRouter>)
}

describe('owner Communications — Channels & consent wiring (F-018)', () => {
  it('a failed preferences read shows no switches and saves nothing', async () => {
    api.fetchCommunicationPreferences.mockRejectedValue(new Error('HTTP error! status: 500'))
    renderPage()

    const card = await screen.findByTestId('delivery-preferences')
    await waitFor(() => expect(within(card).getByTestId('delivery-preferences-read-failed')).toBeTruthy())
    expect(within(card).queryAllByRole('switch')).toHaveLength(0)
    expect(within(card).getByText('Delivery preferences could not be loaded.')).toBeTruthy()
    expect(screen.queryByText('Save preferences')).toBeNull()
    expect(api.updateCommunicationPreferences).not.toHaveBeenCalled()
    expect(api.fetchCommunicationPreferences).toHaveBeenCalledTimes(1)
  })

  it('reads through the page client, gates channels on readiness, and saves one key through it', async () => {
    api.fetchCommunicationPreferences.mockResolvedValue({ preferences: { transactional_enabled: true, marketing_enabled: false, email_enabled: true, in_app_enabled: true } })
    api.updateCommunicationPreferences.mockResolvedValue({ preferences: { transactional_enabled: true, marketing_enabled: true, email_enabled: true, in_app_enabled: true } })
    renderPage()

    const email = await screen.findByTestId('delivery-pref-email_enabled')
    expect(email).toBeDisabled()
    expect(screen.getByTestId('delivery-pref-email_enabled-availability').textContent).toContain('Temporarily unavailable')
    expect(screen.getByTestId('delivery-pref-in_app_enabled')).not.toBeDisabled()

    await act(async () => { fireEvent.click(screen.getByTestId('delivery-pref-marketing_enabled')) })
    expect(api.updateCommunicationPreferences).toHaveBeenCalledWith({ marketing_enabled: true })
    await waitFor(() => expect(screen.getByTestId('delivery-pref-marketing_enabled').getAttribute('aria-checked')).toBe('true'))
  })
})
