/**
 * RX04-C2 — owner Communications, unified presentation (flag ON). Presentation only: the same
 * handlers run; what is new is the phone list → conversation shape and honest read states.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

const thread = {
  id: 'thread-1',
  business_workflow: 'marketplace',
  participant_role: 'seller',
  primary_channel: 'in_app',
  unread_count: 2,
  latest_message: { id: 'm-2', text: 'Is the Hilux still available?', created_at: '2026-11-10T09:00:00.000Z' },
}
const detail = {
  thread: { id: 'thread-1', business_workflow: 'marketplace' },
  participants: [{ id: 'p-1', display_name: 'Fictional Buyer', is_self: false }, { id: 'p-2', is_self: true }],
  messages: [
    { id: 'm-1', text: 'Hello, I saw your listing.', author: { display_name: 'Fictional Buyer', is_self: false }, channel: 'in_app' },
    { id: 'm-2', text: 'Is the Hilux still available?', author: { display_name: 'Fictional Buyer', is_self: false }, channel: 'in_app' },
  ],
}

async function renderPage() {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  const Communications = (await import('./Communications')).default
  return render(<MemoryRouter><Communications /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  api.fetchCommunicationAccountActivity.mockResolvedValue({ activity: [] })
  api.fetchCommunicationPreferences.mockResolvedValue({ preferences: null })
  api.markCommunicationThreadRead.mockResolvedValue({ success: true })
  productApi.fetchAnalytics.mockResolvedValue({ analytics: null })
  productApi.fetchAiHealth.mockResolvedValue({ ai: { available: false } })
})
afterAll(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Communications — unified presentation', () => {
  it('while reading, shows loading — never "No conversations yet" or an unread count', async () => {
    api.fetchCommunicationThreads.mockReturnValue(new Promise(() => {}))
    await renderPage()
    expect(screen.getByTestId('communications-unified')).toHaveAttribute('data-presentation', 'rx04')
    expect(screen.getAllByTestId('data-state')[0]).toHaveAttribute('data-state', 'loading')
    expect(screen.queryByText(/No conversations yet/)).toBeNull()
    expect(screen.queryByText(/\d+ unread/)).toBeNull()
  })

  it('a failed conversations read is announced, not an empty inbox, and offers a retry', async () => {
    api.fetchCommunicationThreads.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce({ threads: [] })
    await renderPage()
    const alert = await screen.findByTestId('communication-threads-unavailable')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.queryByText(/No conversations yet/)).toBeNull()
    expect(screen.queryByText(/\d+ unread/)).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument()
  })

  // RX06-LR06 (Owner decision N3: "EXPLICIT MARK AS READ"): opening a conversation never marks it read.
  it('lists conversations and opens one into a thread with a composer, WITHOUT marking it read', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    await renderPage()
    expect(await screen.findByText('1 conversation · 2 unread')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('communication-thread-thread-1'))
    expect(await screen.findByText('Hello, I saw your listing.')).toBeInTheDocument()
    expect(screen.getByText('With Fictional Buyer')).toBeInTheDocument()
    expect(screen.getByTestId('communication-reply-text')).toBeInTheDocument()
    expect(screen.getByTestId('communication-reply-send')).toBeDisabled()
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalled()
    expect(screen.getByText('1 conversation · 2 unread')).toBeInTheDocument()
    expect(api.sendCommunicationMessage).not.toHaveBeenCalled()
  })

  it('"Mark as read" is explicit: one call, and the unread count clears only after the server confirms', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    await renderPage()
    fireEvent.click(await screen.findByTestId('communication-thread-thread-1'))
    fireEvent.click(await screen.findByTestId('communication-mark-read'))
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledTimes(1), { timeout: 2500 })
    expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('thread-1')
    await waitFor(() => expect(screen.getByText('1 conversation · 0 unread')).toBeInTheDocument(), { timeout: 2500 })
    expect(screen.queryByTestId('communication-mark-read')).toBeNull()
  })

  it('a failed "Mark as read" says so and leaves the conversation unread', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    api.markCommunicationThreadRead.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }))
    await renderPage()
    fireEvent.click(await screen.findByTestId('communication-thread-thread-1'))
    fireEvent.click(await screen.findByTestId('communication-mark-read'))
    await waitFor(() => expect(screen.getByTestId('communication-mark-read-failed')).toBeInTheDocument(), { timeout: 2500 })
    expect(screen.getByText('1 conversation · 2 unread')).toBeInTheDocument()
  })

  it('shows each message\'s delivery state as the server records it, in plain words', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue({ ...detail, messages: [{ id: 'm-9', text: 'Fictional reply', author: { display_name: 'You', is_self: true }, channel: 'in_app', status: 'queued' }] })
    await renderPage()
    fireEvent.click(await screen.findByTestId('communication-thread-thread-1'))
    expect(await screen.findByText('Fictional reply')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.queryByText('queued')).toBeNull()
  })

  it('a reply reports the server\'s own delivery state ("Queued"), never "Sent" before the server says so', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    api.sendCommunicationMessage.mockResolvedValueOnce({ message: { id: 'm-new', status: 'queued' } })
    await renderPage()
    fireEvent.click(await screen.findByTestId('communication-thread-thread-1'))
    fireEvent.change(await screen.findByTestId('communication-reply-text'), { target: { value: 'Fictional reply text' } })
    fireEvent.click(screen.getByTestId('communication-reply-send'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Message recorded · Queued|Sent through CarUp/), { timeout: 2500 })
    expect(document.body.textContent).toMatch(/Message recorded · Queued/)
    expect(document.body.textContent).not.toMatch(/Sent through CarUp/)
  })

  it('flags OFF: the legacy page still marks a conversation read when it is opened (unchanged)', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    vi.resetModules()
    ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
    const Communications = (await import('./Communications')).default
    render(<MemoryRouter><Communications /></MemoryRouter>)
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('thread-1'), { timeout: 2500 })
  })

  it('when the AI provider is unavailable, says so and renders no dead AI controls', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    await renderPage()
    expect(await screen.findByTestId('communication-ai-off')).toHaveTextContent(/AI provider is not available/i)
    expect(screen.queryByRole('button', { name: /Suggest reply/ })).toBeNull()
  })

  it('when the AI provider is available, offers the existing assist actions', async () => {
    productApi.fetchAiHealth.mockResolvedValue({ ai: { available: true } })
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [thread] })
    api.fetchCommunicationThread.mockResolvedValue(detail)
    await renderPage()
    expect(await screen.findByRole('button', { name: /Suggest reply/ })).toBeEnabled()
    expect(screen.queryByTestId('communication-ai-off')).toBeNull()
  })

  it('a failed notifications read is an error, not "No notifications"', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [] })
    api.fetchCommunicationNotifications.mockRejectedValue(new Error('HTTP 500'))
    await renderPage()
    await screen.findByText(/No conversations yet/)
    fireEvent.click(screen.getByRole('tab', { name: /Notifications/ }))
    expect(await screen.findByText(/This is not an empty list/)).toBeInTheDocument()
    expect(screen.queryByText('No notifications.')).toBeNull()
  })

  it('a failed preferences read shows no on/off switches', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [] })
    api.fetchCommunicationPreferences.mockRejectedValue(new Error('HTTP 500'))
    await renderPage()
    await screen.findByText(/No conversations yet/)
    fireEvent.click(screen.getByRole('tab', { name: /Preferences/ }))
    expect(await screen.findByText(/not shown as on or off/)).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('keeps the Account & security delivery rail and its resend action', async () => {
    api.fetchCommunicationThreads.mockResolvedValue({ threads: [] })
    await renderPage()
    await screen.findByText(/No conversations yet/)
    fireEvent.click(screen.getByRole('tab', { name: /Security/ }))
    expect(screen.getByTestId('account-security-activity')).toHaveTextContent('Account & security')
    expect(screen.getByTestId('resend-verification-email')).toBeInTheDocument()
    expect(api.resendVerificationEmail).not.toHaveBeenCalled()
  })
})
