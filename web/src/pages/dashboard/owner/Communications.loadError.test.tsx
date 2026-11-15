import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * RX-02 TI-13 — a failed conversations read is not an empty inbox.
 * On main both thread reads caught the failure as `{ threads: [] }`, so the owner saw
 * "No conversations yet" and "0 unread" for an inbox CarUp could not read.
 */
vi.setConfig({ testTimeout: 30_000 })

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
  user: { id: 'owner-1', email: 'owner@example.test' },
}
const productApi = {
  fetchAnalytics: vi.fn(),
  fetchAiHealth: vi.fn(),
  suggestReply: vi.fn(),
  summarize: vi.fn(),
  translate: vi.fn(),
  nextBestAction: vi.fn(),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/hooks/useCommunicationProductApi', () => ({ useCommunicationProductApi: () => productApi }))
vi.mock('@/components/communications/CommunicationMultimodalComposer', () => ({ CommunicationMultimodalComposer: () => null }))
vi.mock('@/components/communications/CommunicationMessagePartView', () => ({ CommunicationMessagePartView: () => null }))

const Communications = (await import('./Communications')).default
const renderPage = () => render(<MemoryRouter><Communications /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  api.fetchCommunicationAccountActivity.mockResolvedValue({ activity: [] })
  api.fetchCommunicationPreferences.mockResolvedValue({ preferences: null })
  productApi.fetchAnalytics.mockResolvedValue({ analytics: null })
  productApi.fetchAiHealth.mockResolvedValue({ ai: { available: false } })
})

describe('owner Communications — failed conversations read (TI-13)', () => {
  it('announces the failure; no "No conversations yet" and no unread count', async () => {
    api.fetchCommunicationThreads.mockRejectedValue(new Error('HTTP 503'))
    renderPage()

    const alert = await screen.findByTestId('communication-threads-unavailable')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent).toMatch(/could not be loaded/i)
    expect(screen.queryByText(/No conversations yet/)).toBeNull()
    expect(screen.queryByText(/\d+ unread/)).toBeNull()
  })

  it('a successful empty read keeps the honest empty inbox and a measured "0 unread"', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText(/No conversations yet/)).toBeInTheDocument())
    expect(screen.getByText('0 unread')).toBeInTheDocument()
    expect(screen.queryByTestId('communication-threads-unavailable')).toBeNull()
  })
})
