import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { UNKNOWN_CAPABILITY } from '@/lib/communicationChannels'

/**
 * CARUP-MVP-STAB-01 F-017 — owner Communications as a master/detail inbox.
 *
 * Found: one breakpoint (lg, three columns). Below 1024px the page was a single column with the
 * conversation after the whole list; at 1024px beside the sidebar the conversation column was ~70px
 * wide; the selected thread lived only in component state; and the page opened the most recent
 * thread on every viewport — so visiting Communications on a phone marked it read.
 *
 * jsdom does no layout, so widths cannot be measured here. What IS tested: the behaviour that follows
 * the layout (selection in the URL, auto-open only with two panes, no read receipt from a phone list
 * view, Back), driven by a controllable matchMedia, plus the classes that produce each layout. The
 * geometry itself needs a browser.
 */

const THREADS = [
  {
    id: 't1', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace', status: 'open',
    marketplace_listing_id: 'JTDKARFP0H3000731', unread_count: 3, primary_channel: 'in_app',
    participant_role: 'seller', latest_message: { text: 'Is the Aqua still available?' },
  },
  {
    id: 't2', thread_type: 'support', business_workflow: 'support', status: 'open',
    unread_count: 0, primary_channel: 'in_app', latest_message: { text: 'Thanks for your help' },
  },
  {
    id: 't3', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace', status: 'open',
    marketplace_listing_id: 'WBA8E9C50HK000732', unread_count: 1, primary_channel: 'in_app',
    latest_message: { text: 'What is your best price?' },
  },
]

function threadDetail(id: string) {
  const thread = THREADS.find((item) => item.id === id)
  return {
    thread,
    participants: [{ id: `${id}-buyer`, stakeholder_role: 'buyer', display_name: 'Tendai', is_self: false }],
    messages: [{ id: `${id}-m1`, text: `Hello from ${id}`, channel: 'in_app', author: { is_self: false, display_name: 'Tendai' } }],
  }
}

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

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/hooks/useCommunicationProductApi', () => ({ useCommunicationProductApi: () => productApi }))
vi.mock('@/hooks/useCommunicationCapability', () => ({
  useCommunicationCapabilityState: () => ({ capability: UNKNOWN_CAPABILITY, checking: false }),
}))

const Communications = (await import('./Communications')).default

// ── viewport: a controllable matchMedia (jsdom has none) ───────────────────────────────────────────
let twoPane = false
const mediaListeners = new Set<() => void>()
const originalMatchMedia = window.matchMedia
function setTwoPane(next: boolean) {
  twoPane = next
  mediaListeners.forEach((listener) => listener())
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderInbox(entry = '/dashboard/communications') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/dashboard/communications" element={<><Communications /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const location = () => screen.getByTestId('location').textContent
const classes = (testId: string) => new Set(screen.getByTestId(testId).className.split(/\s+/))
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(productApi)]) {
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
  }
  api.fetchCommunicationThreads.mockResolvedValue({ threads: THREADS.map((thread) => ({ ...thread })) })
  api.fetchCommunicationThread.mockImplementation((id: string) => Promise.resolve(threadDetail(id)))
  api.markCommunicationThreadRead.mockImplementation((id: string) => Promise.resolve({ ok: true, thread_id: id }))
  api.fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  api.fetchCommunicationAccountActivity.mockResolvedValue({ activity: [] })
  api.fetchCommunicationPreferences.mockReturnValue(new Promise(() => {}))
  productApi.fetchAnalytics.mockResolvedValue({ analytics: null })
  productApi.fetchAiHealth.mockResolvedValue({ ai: { available: false } })

  twoPane = false
  mediaListeners.clear()
  window.matchMedia = ((query: string) => ({
    get matches() { return query === '(min-width: 768px)' ? twoPane : false },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => { mediaListeners.add(listener) },
    removeEventListener: (_type: string, listener: () => void) => { mediaListeners.delete(listener) },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe('phone (< 768px): the list OR the conversation', () => {
  it('opening the page shows the list and marks nothing read', async () => {
    renderInbox()
    await screen.findByTestId('communication-thread-t1')
    await settle()

    expect(screen.getByTestId('communication-layout').getAttribute('data-view')).toBe('list')
    expect(classes('communication-list-pane').has('hidden')).toBe(false)
    expect(classes('communication-conversation-pane').has('hidden')).toBe(true)
    expect(api.fetchCommunicationThread).not.toHaveBeenCalled()
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalled()
    expect(location()).toBe('/dashboard/communications')
  })

  it('choosing a conversation puts it in the URL, opens it, and only then marks it read', async () => {
    renderInbox()
    const t3 = await screen.findByTestId('communication-thread-t3')
    await act(async () => { fireEvent.click(t3) })

    expect(location()).toBe('/dashboard/communications?thread=t3')
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t3'))
    expect(api.fetchCommunicationThread).toHaveBeenCalledWith('t3')
    expect(api.markCommunicationThreadRead).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('communication-layout').getAttribute('data-view')).toBe('conversation')
    expect(classes('communication-list-pane').has('hidden')).toBe(true)
    expect(classes('communication-conversation-pane').has('hidden')).toBe(false)
    expect((await screen.findByTestId('communication-active-listing')).textContent).toContain('WBA8E9C50HK000732')
    expect(screen.getByTestId('communication-reply-text')).toBeTruthy()
  })

  it('"Back to conversations" clears ?thread= and returns to the list without another read', async () => {
    renderInbox('/dashboard/communications?thread=t2')
    const back = await screen.findByTestId('communication-back')
    expect(back.textContent).toContain('Back to conversations')
    expect(back.closest('.md\\:hidden')).not.toBeNull()
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t2'))

    await act(async () => { fireEvent.click(back) })

    expect(location()).toBe('/dashboard/communications')
    expect(screen.getByTestId('communication-layout').getAttribute('data-view')).toBe('list')
    expect(classes('communication-list-pane').has('hidden')).toBe(false)
    await settle()
    expect(api.markCommunicationThreadRead).toHaveBeenCalledTimes(1)
  })
})

describe('two panes (≥ 768px)', () => {
  it('with no ?thread=, opens the most recent conversation and pins it in the URL', async () => {
    twoPane = true
    renderInbox()

    await waitFor(() => expect(location()).toBe('/dashboard/communications?thread=t1'))
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t1'))
    expect(api.fetchCommunicationThread).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('communication-layout').getAttribute('data-view')).toBe('conversation')
    // Both panes are on screen from md: neither is hidden there.
    expect(classes('communication-list-pane').has('md:flex')).toBe(true)
    expect(classes('communication-conversation-pane').has('flex')).toBe(true)
  })

  it('a deep link opens THAT conversation, never the first one', async () => {
    twoPane = true
    renderInbox('/dashboard/communications?thread=t2')

    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t2'))
    await settle()
    expect(api.fetchCommunicationThread).toHaveBeenCalledTimes(1)
    expect(api.fetchCommunicationThread).toHaveBeenCalledWith('t2')
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalledWith('t1')
    expect(location()).toBe('/dashboard/communications?thread=t2')
    expect(screen.getByTestId('communication-thread-t2').getAttribute('aria-current')).toBe('true')
  })

  it('switching conversation never shows the previous one under the new selection', async () => {
    twoPane = true
    let releaseT3: (value: unknown) => void = () => {}
    api.fetchCommunicationThread.mockImplementation((id: string) => (id === 't3'
      ? new Promise((resolve) => { releaseT3 = resolve })
      : Promise.resolve(threadDetail(id))))
    renderInbox('/dashboard/communications?thread=t1')
    expect((await screen.findByTestId('communication-message-text')).textContent).toBe('Hello from t1')

    await act(async () => { fireEvent.click(screen.getByTestId('communication-thread-t3')) })
    expect(location()).toBe('/dashboard/communications?thread=t3')
    // t1's messages and composer must not sit under t3's selection while t3 loads.
    expect(screen.queryByTestId('communication-message-text')).toBeNull()
    expect(screen.queryByTestId('communication-reply-text')).toBeNull()

    await act(async () => { releaseT3(threadDetail('t3')) })
    expect((await screen.findByTestId('communication-message-text')).textContent).toBe('Hello from t3')
  })

  it('resizing a phone list view to two panes opens the first conversation then, not before', async () => {
    renderInbox()
    await screen.findByTestId('communication-thread-t1')
    await settle()
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalled()

    act(() => setTwoPane(true))
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t1'))
    expect(location()).toBe('/dashboard/communications?thread=t1')
  })
})

describe('a ?thread= that is not in this inbox', () => {
  it.each([true, false])('opens nothing, marks nothing read and says so (two panes: %s)', async (wide) => {
    twoPane = wide
    renderInbox('/dashboard/communications?thread=not-mine')

    expect((await screen.findByTestId('communication-thread-not-found')).textContent).toMatch(/isn't in your inbox/)
    await settle()
    expect(api.fetchCommunicationThread).not.toHaveBeenCalled()
    expect(api.markCommunicationThreadRead).not.toHaveBeenCalled()
    expect(screen.getByTestId('communication-layout').getAttribute('data-view')).toBe('list')

    // Choosing a real conversation replaces the bad link.
    await act(async () => { fireEvent.click(screen.getByTestId('communication-thread-t2')) })
    expect(location()).toBe('/dashboard/communications?thread=t2')
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t2'))
    expect(screen.queryByTestId('communication-thread-not-found')).toBeNull()
  })
})

describe('header badge and list states', () => {
  it('counts unread CONVERSATIONS, and drops one only after the read receipt is persisted', async () => {
    let releaseRead: (value: unknown) => void = () => {}
    api.markCommunicationThreadRead.mockImplementation(() => new Promise((resolve) => { releaseRead = resolve }))
    renderInbox()

    // 3 + 0 + 1 unread messages across two conversations.
    await waitFor(() => expect(screen.getByTestId('communication-unread-conversations').textContent).toBe('2 unread conversations'))

    await act(async () => { fireEvent.click(screen.getByTestId('communication-thread-t1')) })
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t1'))
    expect(screen.getByTestId('communication-unread-conversations').textContent).toBe('2 unread conversations')

    await act(async () => { releaseRead({ ok: true }) })
    await waitFor(() => expect(screen.getByTestId('communication-unread-conversations').textContent).toBe('1 unread conversation'))
  })

  it('a failed read receipt leaves the badge as it was', async () => {
    api.markCommunicationThreadRead.mockRejectedValue(new Error('HTTP error! status: 500'))
    renderInbox('/dashboard/communications?thread=t3')
    await waitFor(() => expect(api.markCommunicationThreadRead).toHaveBeenCalledWith('t3'))
    await settle()
    expect(screen.getByTestId('communication-unread-conversations').textContent).toBe('2 unread conversations')
    expect(within(screen.getByTestId('communication-thread-t3')).getByText('1')).toBeTruthy()
  })

  it('a failed conversation-list read is not an empty inbox, publishes no count, and can be retried', async () => {
    api.fetchCommunicationThreads.mockRejectedValueOnce(new Error('HTTP error! status: 503'))
    renderInbox()

    expect((await screen.findByTestId('communication-threads-failed')).textContent).toMatch(/could not be loaded/i)
    expect(screen.queryByText(/No conversations yet/)).toBeNull()
    expect(screen.queryByTestId('communication-unread-conversations')).toBeNull()

    await act(async () => { fireEvent.click(within(screen.getByTestId('communication-threads-failed')).getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByTestId('communication-thread-t1')).toBeTruthy()
    expect(api.fetchCommunicationThreads).toHaveBeenCalledTimes(2)
  })
})

describe('the reply still goes through the one conversation authority', () => {
  it('sends to the open thread and says "Sent through CarUp"', async () => {
    api.sendCommunicationMessage.mockResolvedValue({ success: true })
    renderInbox('/dashboard/communications?thread=t3')
    const text = await screen.findByTestId('communication-reply-text')

    fireEvent.change(text, { target: { value: 'Yes, still available.' } })
    await act(async () => { fireEvent.click(screen.getByTestId('communication-reply-send')) })

    expect(api.sendCommunicationMessage).toHaveBeenCalledWith('t3', { channel: 'in_app', message: 'Yes, still available.' })
    await waitFor(() => expect(screen.getByTestId('communication-status').textContent).toBe('Sent through CarUp'))
    expect(location()).toBe('/dashboard/communications?thread=t3')
  })
})

describe('layout classes (the geometry itself needs a browser)', () => {
  it('two columns from md, three from xl; the details move below the conversation on tablets', async () => {
    renderInbox()
    await screen.findByTestId('communication-thread-t1')
    const grid = classes('communication-layout')
    expect(grid.has('md:grid-cols-[300px_minmax(0,1fr)]')).toBe(true)
    expect(grid.has('xl:grid-cols-[320px_minmax(0,1fr)_290px]')).toBe(true)
    // The old single breakpoint is gone: lg no longer forces three columns beside the sidebar.
    expect([...grid].some((name) => name.startsWith('lg:grid-cols'))).toBe(false)

    const details = classes('communication-details')
    expect(details.has('md:col-span-2')).toBe(true)
    expect(details.has('xl:col-span-1')).toBe(true)
  })

  it('the list and the conversation are bounded panes that scroll on their own', async () => {
    renderInbox()
    await screen.findByTestId('communication-thread-t1')
    for (const pane of ['communication-list-pane', 'communication-conversation-pane']) {
      expect(classes(pane).has('md:h-[calc(100dvh-15rem)]'), pane).toBe(true)
      expect(classes(pane).has('md:min-h-[560px]'), pane).toBe(true)
    }
    expect(classes('communication-thread-list').has('md:overflow-y-auto')).toBe(true)
  })

  it('a thread title and VIN wrap; nothing critical is cut to one line', async () => {
    renderInbox('/dashboard/communications?thread=t1')
    const title = await screen.findByTestId('communication-thread-title-t1')
    expect(title.className).toContain('line-clamp-2')
    expect(title.className).not.toMatch(/\btruncate\b/)
    expect((await screen.findByTestId('communication-active-listing')).className).toContain('break-all')
    expect(screen.getByTestId('communication-thread-listing-t1').textContent).toContain('JTDKARFP0H3000731')
    expect(screen.getByTestId('communication-conversation-title').className).toContain('break-words')
  })
})
