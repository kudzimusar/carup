/**
 * CA-OWNER-02 — the Command Center page reads TRUTH (renders the REAL page against a mocked API).
 *
 *   H2  the header strip shows the /metrics truth block — and "unavailable", never 0, when it cannot be computed;
 *       the legacy raw counts (654 open / 653 overdue) are never shown.
 *   H5  every section has its own document title ("Inbox · Command Center · CarUp Admin"), never "Page not found".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

beforeEach(() => {
  document.title = 'Page not found | CarUp'
  api.fetchAdminCommunicationMetrics.mockReset()
  api.fetchAdminCommunicationMetrics.mockResolvedValue({ ...LEGACY_METRICS, truth: TRUTH } as never)
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
