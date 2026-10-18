/**
 * CA-OWNER-02 — the Command Center page reads TRUTH (renders the REAL page against a mocked API).
 *
 *   H1  the inbox asks for a classification view (default "Active work"), offers every view with its count, badges
 *       non-operational rows, says when the classification is partial, and refuses to show an unclassified list.
 *   H2  the header strip shows the /metrics truth block — and "unavailable", never 0, when it cannot be computed;
 *       the legacy raw counts (654 open / 653 overdue) are never shown; row / worklist SLA labels come from truth.
 *   H3  one primary identity: the customer heads the row, the conversation header, the inbound bubbles and the rail;
 *       the seller is context; the opened conversation keeps its row's identity.
 *   H5  every section has its own document title ("Inbox · Command Center · CarUp Admin"), never "Page not found".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

const THREAD_ID = '61acc236-aaab-4d27-815c-9062f9c99f05'

const ok = <T,>(value: T) => vi.fn(async () => value)
// ONE stable object: the page memoises callbacks on these functions; a fresh object per render loops.
const api = {
  user: { id: 'admin-1', role: 'admin' },
  fetchAdminCommunicationThreads: vi.fn(async () => ({ threads: [], counts: null, page: { next_cursor: null } })),
  fetchCommunicationDeadLetters: ok({ notifications: [] }),
  fetchAdminCommunicationMetrics: vi.fn(async () => ({})),
  fetchAdminCommunicationThread: vi.fn(async () => ({ thread: { id: THREAD_ID, status: 'open' }, messages: [], participants: [], escalations: [], identities: [], linked_identities: [], delivery_attempts: [], preferences: null })),
  markAdminCommunicationThreadRead: ok({ ok: true }),
  fetchAdminCommunicationThreadAudit: ok({ events: [] }),
  fetchCommunicationAudit: ok({ events: [] }),
  fetchCommunicationSlaPolicies: ok({ policies: [] }),
  fetchCommunicationWorkerHealth: ok(null),
  fetchCommunicationProviders: ok({ channels: [] }),
  sendCommunicationProviderSmokeTest: ok({}),
  adminReplyCommunicationThread: ok({}),
  assignCommunicationThread: ok({}),
  escalateCommunicationThread: ok({}),
  resolveCommunicationThread: ok({}),
  reopenCommunicationThread: ok({}),
  pauseCommunicationThreadSla: ok({}),
  resumeCommunicationThreadSla: ok({}),
  retryCommunicationDeadLetter: ok({}),
  cancelCommunicationDeadLetter: ok({}),
  fetchCommunicationRecovery: ok({ categories: {}, counts: {} }),
  bulkRetryCommunicationRecovery: ok({}),
  requeueCommunicationDeadLetter: ok({}),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const AdminCommunications = (await import('./Communications')).default

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/communications" element={<AdminCommunications />} />
        <Route path="/admin/communications/inbox/:threadId" element={<AdminCommunications />} />
        <Route path="/admin/communications/:section" element={<AdminCommunications />} />
        <Route path="/dashboard/admin/communications/:section" element={<AdminCommunications />} />
      </Routes>
    </MemoryRouter>,
  )
}

const LEGACY_METRICS = { open_threads: 654, unassigned_threads: 654, overdue_threads: 653, dead_letter_count: 49, dead_letter_latest_at: null, duplicate_webhook_count: 0 }
const TRUTH = {
  available: true,
  total_open: 654,
  operational: { open: 2, awaiting_reply: 1, overdue: 1, live: 0, no_individual_assignee: 1, oldest_awaiting_since: null },
  needs_review: { open: 5, awaiting_reply: 3, overdue: 2, live: 0, no_individual_assignee: 5, oldest_awaiting_since: null },
  non_operational_open: 647,
  by_category: { operational: 2, needs_review: 5, certification: 600, automation: 40, historical: 7 },
  view_counts: { all: 654, active: 7, operational: 2, needs_review: 5, certification: 600, automation: 40, historical: 7 },
}

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const truthOf = (category: string, sla: Record<string, unknown> = {}) => ({
  category, class: 'x', rule: 'r', basis: 'marketplace_inquiry', open: true, awaiting_reply: false, no_individual_assignee: true,
  sla: { state: 'not_applicable', reason: 'No customer message is waiting for a reply.', due_at: null, due_source: null, awaiting_since: null, ...sla },
})

// The legacy projection named the Marketplace conversation after its primary_user_id — the SELLER ("UAT seller").
const ROW_OP = {
  id: 't-op', status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-1',
  marketplace_listing_id: 'JTDBR32E520123456', primary_channel: 'in_app', created_at: hoursAgo(700), last_message_at: hoursAgo(1),
  sla_due_at: hoursAgo(692), identity_display_name: 'UAT seller',
  truth: truthOf('operational', { state: 'overdue', reason: null, due_at: hoursAgo(692), due_source: 'default_priority_target', awaiting_since: hoursAgo(690) }),
  customer: { display_name: 'Rudo Banda', source: 'buyer_account', identity_id: 'ci-buyer' },
  seller: { display_name: 'Tendai Moyo' },
}
const ROW_CERT = {
  id: 't-uat', status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-2', primary_channel: 'in_app',
  created_at: hoursAgo(900), last_message_at: hoursAgo(2), sla_due_at: hoursAgo(892),
  truth: truthOf('certification', { state: 'certification', reason: 'Certification, UAT or automation record — no customer service level applies.' }),
  customer: { display_name: 'UAT buyer', source: 'buyer_account', identity_id: null }, seller: { display_name: 'Tendai Moyo' },
}
const ROW_SMOKE = {
  id: 't-smoke', status: 'awaiting_user', thread_type: 'support', primary_channel: 'whatsapp', created_at: hoursAgo(50), last_message_at: hoursAgo(3),
  identity_display_name: 'Provider Smoke Test',
  truth: truthOf('automation', { state: 'certification', reason: 'Certification, UAT or automation record — no customer service level applies.' }),
  customer: { display_name: 'Provider smoke test', source: 'provider_smoke_test', identity_id: 'ci-smoke' }, seller: null,
}
const VIEW_COUNTS = { all: 3, active: 1, operational: 1, needs_review: 0, certification: 1, automation: 1, historical: 0 }
const ROWS_BY_VIEW: Record<string, unknown[]> = { active: [ROW_OP], operational: [ROW_OP], certification: [ROW_CERT], automation: [ROW_SMOKE], all: [ROW_OP, ROW_CERT, ROW_SMOKE] }

function listResponse(filters: Record<string, string | undefined> = {}, extra: Record<string, unknown> = {}) {
  const view = filters.view || 'all'
  return { threads: ROWS_BY_VIEW[view] || [], counts: { total: 3, all_active: 1, sla_breach: 1, by_channel: {}, by_workflow: {} }, page: { next_cursor: null }, view, view_counts: VIEW_COUNTS, truth_complete: true, ...extra }
}

beforeEach(() => {
  document.title = 'Page not found | CarUp'
  api.fetchAdminCommunicationMetrics.mockReset()
  api.fetchAdminCommunicationMetrics.mockResolvedValue({ ...LEGACY_METRICS, truth: TRUTH } as never)
  api.fetchAdminCommunicationThreads.mockReset()
  api.fetchAdminCommunicationThreads.mockImplementation((async (filters?: Record<string, string | undefined>) => listResponse(filters || {})) as never)
  api.fetchAdminCommunicationThread.mockReset()
  api.fetchAdminCommunicationThread.mockImplementation((async (id: string) => ({
    // The detail row is the raw message_threads row (+ its own verdict): no identity_* projection.
    thread: { id, status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-1', marketplace_listing_id: 'JTDBR32E520123456', primary_channel: 'in_app', created_at: hoursAgo(700), truth: null, customer: null, seller: null },
    messages: [{ id: 'm-in', direction: 'inbound', channel: 'web', status: 'received', content_text: 'Is it still available?', created_at: hoursAgo(690) }],
    participants: [], escalations: [],
    identities: [
      { id: 'ci-seller', channel: 'email', display_name: 'Seller Email', normalized_address: 'seller@gmail.com' },
      { id: 'ci-buyer', channel: 'whatsapp', display_name: 'Rudo WhatsApp', normalized_address: '263771234567', consent_status: 'implied_transactional' },
    ],
    linked_identities: [], delivery_attempts: [], preferences: null, reply_channel: null,
  })) as never)
})

const lastListFilters = () => (api.fetchAdminCommunicationThreads.mock.calls.at(-1) as unknown as [Record<string, string | undefined>])[0]

describe('H1 — classification views in the inbox', () => {
  it('asks for "Active work" by default and offers every view with its count', async () => {
    renderAt('/admin/communications')
    await screen.findByText('Rudo Banda')
    expect(lastListFilters().view).toBe('active')
    const selector = screen.getByTestId('view-selector') as HTMLSelectElement
    expect(selector.value).toBe('active')
    const options = Array.from(selector.options).map((o) => o.textContent)
    expect(options).toEqual([
      'Active work (operational + needs review) · 1', 'Operational · 1', 'Needs provenance review · 0', 'Certification & UAT · 1',
      'Automation & smoke tests · 1', 'Historical · 0', 'All · 3',
    ])
  })

  it('switching the view refetches that view; non-operational rows carry their badge, operational rows none', async () => {
    renderAt('/admin/communications')
    const opRow = (await screen.findByText('Rudo Banda')).closest('[data-unread], div.flex.items-stretch') as HTMLElement
    expect(within(opRow).queryByTestId('row-category')).toBeNull()
    fireEvent.change(screen.getByTestId('view-selector'), { target: { value: 'certification' } })
    await screen.findByText('UAT buyer')
    expect(lastListFilters().view).toBe('certification')
    expect(screen.getByTestId('row-category')).toHaveTextContent('Certification & UAT')
    expect(screen.queryByText('Rudo Banda')).toBeNull()
  })

  it('says so when the classification is partial', async () => {
    api.fetchAdminCommunicationThreads.mockImplementation((async (filters?: Record<string, string | undefined>) => listResponse(filters || {}, { truth_complete: false, truth_window: { size: 1000, read: 1000, saturated: true } })) as never)
    renderAt('/admin/communications')
    expect(await screen.findByTestId('view-partial')).toHaveTextContent('Classification is partial: it covers the 1000 most recently updated conversations')
  })

  it('refuses to show an unclassified list when the classification is unavailable', async () => {
    api.fetchAdminCommunicationThreads.mockRejectedValue(Object.assign(new Error('Conversation classification is unavailable'), { status: 503, code: 'CONVERSATION_TRUTH_UNAVAILABLE' }) as never)
    renderAt('/admin/communications')
    expect(await screen.findByText(/classification is unavailable right now/i)).toBeInTheDocument()
    expect(screen.queryByText('Rudo Banda')).toBeNull()
  })
})

describe('H2 — row SLA labels come from truth', () => {
  it('names the target, and never prints a raw minute count', async () => {
    renderAt('/admin/communications')
    await screen.findByText('Rudo Banda')
    const sla = screen.getByTestId('row-sla')
    expect(sla).toHaveTextContent('Overdue · default 8h first-response target')
    expect(screen.getByTestId('inbox-pane').textContent).not.toMatch(/\d{3,}m\b/)
  })

  it('the SLA worklist lists only conversations under a live service level, labelled from truth', async () => {
    api.fetchAdminCommunicationThreads.mockImplementation((async (filters?: Record<string, string | undefined>) => (filters?.sort === 'sla'
      ? listResponse({ view: 'all' })
      : listResponse(filters || {}))) as never)
    renderAt('/admin/communications/sla')
    const rows = await screen.findAllByTestId('sla-row')
    const slaCall = (api.fetchAdminCommunicationThreads.mock.calls as unknown as Array<[Record<string, string>]>).find(([f]) => f?.sort === 'sla')![0]
    expect(slaCall.view).toBe('active')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Rudo Banda')
    expect(rows[0]).toHaveTextContent('Overdue · default 8h first-response target')
    expect(rows[0]).toHaveAttribute('data-sla-state', 'breached')
  })
})

describe('H4 — the composer follows the server\'s reply-channel authority', () => {
  it('defaults to the server\'s channel and offers only the customer\'s — not in-app to the seller', async () => {
    api.fetchAdminCommunicationThread.mockImplementation((async (id: string) => ({
      thread: { id, status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-1', primary_channel: 'in_app', primary_user_id: 'u-seller', truth: null, customer: null, seller: null },
      // The latest inbound came in-app (the inquiry form), which the local rule would default to.
      messages: [{ id: 'm1', direction: 'inbound', channel: 'in_app', status: 'received', content_text: 'hi', created_at: hoursAgo(1) }],
      participants: [], escalations: [],
      identities: [{ id: 'ci-guest', channel: 'whatsapp', consent_status: 'implied_transactional' }],
      linked_identities: [], delivery_attempts: [], preferences: null,
      reply_channel: { default_channel: 'whatsapp', deliverable: ['whatsapp'], basis: 'primary_binding' },
    })) as never)
    api.adminReplyCommunicationThread.mockResolvedValue({ message: { id: 'm-new', status: 'queued' }, notification: { id: 1, status: 'queued' } } as never)
    renderAt(`/admin/communications/inbox/${THREAD_ID}`)
    const composer = await screen.findByTestId('reply-composer-sticky')
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'whatsapp'))
    expect(within(composer).queryByRole('radiogroup'), 'one deliverable channel → no selector').toBeNull()
    fireEvent.change(within(composer).getByRole('textbox'), { target: { value: 'Yes, it is available.' } })
    fireEvent.click(within(composer).getByRole('button', { name: /Send reply/ }))
    await waitFor(() => expect(api.adminReplyCommunicationThread).toHaveBeenCalled())
    expect((api.adminReplyCommunicationThread.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1]).toMatchObject({ channel: 'whatsapp', internal: false })
  })

  it('shows the server\'s refusal when a reply channel is not deliverable, and keeps the draft', async () => {
    api.fetchAdminCommunicationThread.mockImplementation((async (id: string) => ({
      thread: { id, status: 'open', primary_channel: 'in_app', truth: null, customer: null, seller: null },
      messages: [], participants: [], escalations: [], identities: [], linked_identities: [], delivery_attempts: [], preferences: null,
      reply_channel: { default_channel: 'whatsapp', deliverable: ['whatsapp'], basis: 'primary_binding' },
    })) as never)
    api.adminReplyCommunicationThread.mockRejectedValue(Object.assign(new Error('This conversation\'s customer cannot be reached by WhatsApp. Reachable: none. Nothing was sent.'), { status: 409, code: 'REPLY_CHANNEL_NOT_DELIVERABLE' }) as never)
    renderAt(`/admin/communications/inbox/${THREAD_ID}`)
    const composer = await screen.findByTestId('reply-composer-sticky')
    await waitFor(() => expect(within(composer).getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'whatsapp'))
    fireEvent.change(within(composer).getByRole('textbox'), { target: { value: 'Keep me.' } })
    fireEvent.click(within(composer).getByRole('button', { name: /Send reply/ }))
    expect(await within(composer).findByText(/Nothing was sent/)).toBeInTheDocument()
    expect(within(composer).getByRole('textbox')).toHaveValue('Keep me.')
  })
})

describe('H3 — one primary identity', () => {
  it('heads the row with the customer and puts the subject under it — never the seller', async () => {
    renderAt('/admin/communications')
    await screen.findByText('Rudo Banda')
    expect(screen.queryByText('UAT seller')).toBeNull()
    expect(screen.getByTestId('row-subject')).toHaveTextContent('Marketplace inquiry · listing JTDBR32E520123456')
  })

  it('the opened conversation keeps its row\'s identity: header, inbound sender and rail name the customer; the seller is context', async () => {
    renderAt('/admin/communications')
    fireEvent.click(await screen.findByText('Rudo Banda'))
    await waitFor(() => expect(screen.getByTestId('conversation-heading')).toHaveTextContent('Rudo Banda'))
    expect(screen.getByTestId('conversation-subject')).toHaveTextContent('Marketplace inquiry · listing JTDBR32E520123456')
    const pane = screen.getByTestId('conversation-pane')
    expect(within(pane).getAllByText('Rudo Banda').length).toBeGreaterThan(1)
    expect(within(pane).queryByText(/Marketplace Inquiry$/)).toBeNull()
    const rail = screen.getByTestId('ops-rail')
    expect(within(within(rail).getByTestId('context-identity')).getByText('Rudo Banda')).toBeInTheDocument()
    expect(within(rail).getByTestId('context-identity')).toHaveTextContent('Whatsapp')
    expect(within(rail).getByTestId('context-refs')).toHaveTextContent('Seller')
    expect(within(rail).getByTestId('context-refs')).toHaveTextContent('Tendai Moyo')
    expect(rail).not.toHaveTextContent('Seller Email')
  })

  it('a provider smoke test reads as one heading, with its automation badge', async () => {
    renderAt('/admin/communications')
    await screen.findByText('Rudo Banda')
    fireEvent.change(screen.getByTestId('view-selector'), { target: { value: 'automation' } })
    expect(await screen.findByText('Provider smoke test')).toBeInTheDocument()
    expect(screen.queryByText('Provider Smoke Test')).toBeNull()
    expect(screen.getByTestId('row-category')).toHaveTextContent('Automation')
  })
})

describe('H2 — the header strip reads truth', () => {
  it('shows operational work and needs-review apart, and never the legacy 654 / 653', async () => {
    renderAt('/admin/communications')
    const operational = await screen.findByTestId('cc-operational')
    expect(operational).toHaveTextContent(/Open\s*2/)
    expect(operational).toHaveTextContent(/Overdue\s*1/)
    expect(screen.getByTestId('cc-needs-review')).toHaveTextContent('5 open · 3 awaiting reply')
    expect(screen.getByTestId('cc-filtered-out')).toHaveTextContent('647 filtered out of the working inbox')
    const strip = screen.getByTestId('command-center-strip')
    expect(strip).not.toHaveTextContent('654')
    expect(strip).not.toHaveTextContent('653')
    expect(within(strip).getByTestId('cc-dead-letter')).toHaveTextContent(/Delivery dead-letters\s*49/)
  })

  it('says "unavailable" when the server could not compute the truth', async () => {
    api.fetchAdminCommunicationMetrics.mockResolvedValue({ ...LEGACY_METRICS, truth: { available: false } } as never)
    renderAt('/admin/communications')
    expect(await screen.findByTestId('cc-truth-unavailable')).toHaveTextContent('Conversation figures unavailable')
    expect(screen.queryByTestId('cc-operational')).toBeNull()
    expect(screen.getByTestId('command-center-strip')).not.toHaveTextContent('653')
  })

  it('says "unavailable" when the metrics request itself fails — never a zero', async () => {
    api.fetchAdminCommunicationMetrics.mockRejectedValue(new Error('network down'))
    renderAt('/admin/communications')
    expect(await screen.findByTestId('cc-truth-unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('cc-dead-letter')).toHaveTextContent('—')
  })
})

describe('touch targets (390×844)', () => {
  it('every queue chip and the view selector are at least 44px tall on phones (and the chips 44px wide)', async () => {
    renderAt('/admin/communications')
    await screen.findByText('Rudo Banda')
    const chips = within(screen.getByRole('group', { name: 'Filter threads by workflow queue' })).getAllByRole('button')
    expect(chips.length).toBeGreaterThan(5)
    for (const chip of chips) {
      expect(chip.className).toContain('max-sm:min-h-11')
      expect(chip.className).toContain('max-sm:min-w-11')
    }
    expect(screen.getByTestId('view-selector').className).toContain('max-sm:min-h-11')
  })
})

describe('H5 — every Command Center section has a real document title', () => {
  it.each([
    ['/admin/communications', 'Inbox · Command Center · CarUp Admin'],
    [`/admin/communications/inbox/${THREAD_ID}`, 'Inbox · Command Center · CarUp Admin'],
    ['/admin/communications/sla', 'SLA · Command Center · CarUp Admin'],
    ['/admin/communications/recovery', 'Recovery · Command Center · CarUp Admin'],
    ['/dashboard/admin/communications/providers', 'Providers · Command Center · CarUp Admin'],
  ])('%s → %s', async (path, title) => {
    renderAt(path)
    await waitFor(() => expect(document.title).toBe(title))
  })
})
