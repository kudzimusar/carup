/**
 * CA-OWNER-02 — the Command Center page reads TRUTH (renders the REAL page against a mocked API).
 *
 *   H5  every section has its own document title ("Inbox · Command Center · CarUp Admin"), never "Page not found".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  document.title = 'Page not found | CarUp'
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
