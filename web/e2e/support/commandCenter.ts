import type { Page, Route } from '@playwright/test'

// Shared harness for the Command Center e2e specs (plan §16). Seeds a test admin session and mocks
// every /api/admin/communications/* endpoint with in-memory fixtures + real keyset pagination, so the
// specs run against the built app with no live backend.

const admin = { id: 'admin-e2e', name: 'QA Admin', email: 'qa-admin@x.test', role: 'admin' }

export interface FixtureThread {
  id: string
  status: string
  primary_channel: string
  identity_display_name: string
  identity_address: string
  latest_message_text: string
  unread_count: number
  priority: string
  last_message_at: string
  assigned_admin_id: string | null
  assigned_team: string | null
}

const CHANNELS = ['whatsapp', 'telegram', 'email', 'sms']
const STATUSES = ['awaiting_human', 'awaiting_ai', 'awaiting_user', 'escalated']

export function makeThreads(n: number): FixtureThread[] {
  const base = Date.parse('2026-07-05T00:00:00.000Z')
  return Array.from({ length: n }, (_, i) => ({
    id: `11111111-0000-4000-8000-${String(i).padStart(12, '0')}`,
    status: STATUSES[i % STATUSES.length],
    primary_channel: CHANNELS[i % CHANNELS.length],
    identity_display_name: `Customer ${i}`,
    identity_address: `+2637${String(i).padStart(7, '0')}`,
    latest_message_text: `Message body number ${i}`,
    unread_count: i % 3 === 0 ? (i % 5) + 1 : 0,
    priority: i % 7 === 0 ? 'high' : 'normal',
    last_message_at: new Date(base + (n - i) * 60_000).toISOString(),
    assigned_admin_id: i % 4 === 0 ? admin.id : null,
    assigned_team: i % 4 === 1 ? 'support' : null,
  }))
}

function counts(threads: FixtureThread[]) {
  const active = threads.filter((t) => !['resolved', 'closed', 'spam'].includes(t.status))
  const by = (s: string) => threads.filter((t) => t.status === s).length
  return {
    total: threads.length,
    all_active: active.length,
    awaiting_human: by('awaiting_human'),
    awaiting_ai: by('awaiting_ai'),
    awaiting_user: by('awaiting_user'),
    escalated: by('escalated'),
    resolved: by('resolved'),
    mine: active.filter((t) => t.assigned_admin_id === admin.id).length,
    unassigned: active.filter((t) => !t.assigned_admin_id && !t.assigned_team).length,
    sla_breach: 0,
    failed_risk: 0,
    by_workflow: {},
    by_channel: {},
  }
}

export interface MockOptions {
  threads?: FixtureThread[]
  recovery?: { categories: Record<string, unknown[]>; counts: Record<string, number> }
  pageLimit?: number
}

export async function seedAdmin(page: Page) {
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: admin }) }))
  // The client fetches a CSRF token before every unsafe request (apiClient.ts) — serve one so
  // mutations (mark-read, bulk retry, replies) succeed against the mock.
  await page.route('**/api/security/csrf-token', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'e2e-csrf-token' }) }))
  await page.addInitScript(([u, t]) => {
    localStorage.setItem('carup_user', u as string)
    localStorage.setItem('carup_token', t as string)
  }, [JSON.stringify(admin), 'admin-e2e-token'])
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

export async function mockCommandCenterApi(page: Page, opts: MockOptions = {}) {
  const threads = opts.threads ?? makeThreads(12)
  const recovery = opts.recovery ?? { categories: {}, counts: { total: 0 } }
  const limit = opts.pageLimit ?? 100

  await page.route('**/api/admin/communications/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    // Providers telemetry (P1.4)
    if (path.endsWith('/providers')) return json(route, {
      channels: [
        { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', mode: 'real', available: true, webhook: { configured: true, last_signature_valid: true, latest_inbound_at: '2026-07-05T11:00:00.000Z' }, outbound: { latest_success_at: '2026-07-05T11:30:00.000Z' }, latest_error: null, queue: { queued: 1, retry_scheduled: 0, dead_letter: 0 }, credentials: { complete: true, missing: [] } },
        { channel: 'telegram', provider: 'telegram_bot_api', mode: 'fake', available: false, webhook: { configured: false }, queue: { queued: 0, retry_scheduled: 0, dead_letter: 0 }, credentials: { complete: false, missing: ['CARUP_TELEGRAM_BOT_TOKEN'] } },
      ],
      worker: { stale_locks: 0, scheduler: {} },
    })

    // Global audit search (P1.10)
    if (path.endsWith('/audit') && !path.includes('/threads/')) return json(route, {
      events: [
        { id: 'ev1', event_type: 'reply_sent', actor_type: 'admin', actor_id: 'admin-e2e', thread_id: threads[0]?.id, summary: 'Reply sent to customer', created_at: '2026-07-05T10:00:00.000Z' },
        { id: 'ev2', event_type: 'escalated', actor_type: 'admin', actor_id: 'admin-e2e', thread_id: threads[1]?.id, summary: 'Escalated to support', created_at: '2026-07-05T09:00:00.000Z' },
      ],
    })
    // SLA policies (P1.10 settings)
    if (path.endsWith('/sla/policies')) return json(route, {
      policies: [{ id: 'pol', name: 'Default WhatsApp', channel: 'whatsapp', priority: 'high', first_response_minutes: 15, resolution_minutes: 240, business_timezone: 'Africa/Harare', active: true }],
    })

    // Recovery
    if (path.endsWith('/recovery')) return json(route, recovery)
    if (path.endsWith('/recovery/bulk-retry')) return json(route, { retried: 1, failed: 0, total: 1, results: [{ id: 'x', ok: true }] })
    if (path.endsWith('/dead-letter')) return json(route, { notifications: [] })
    if (path.endsWith('/metrics')) return json(route, { open_threads: threads.length, unassigned_threads: 0, overdue_threads: 0, dead_letter_count: 0 })
    if (path.endsWith('/worker/health')) return json(route, { queue: { depth: 0, dead_letter: 0 }, adapters: [], scheduler: {} })

    // Thread sub-resources
    const auditMatch = path.match(/\/threads\/([^/]+)\/audit$/)
    if (auditMatch) return json(route, { events: [{ id: 'a1', event_type: 'assigned', actor_type: 'admin', actor_id: admin.id, created_at: '2026-07-05T10:00:00.000Z', summary: 'Assigned to support' }] })
    if (/\/threads\/[^/]+\/read$/.test(path)) return json(route, { ok: true, thread_id: 'x', last_read_at: '2026-07-05T10:00:00.000Z' })

    // Thread detail
    const detailMatch = path.match(/\/threads\/([^/]+)$/)
    if (detailMatch && method === 'GET') {
      const t = threads.find((x) => x.id === detailMatch[1]) || threads[0]
      return json(route, {
        thread: t,
        messages: [
          { id: 'm1', thread_id: t.id, direction: 'inbound', channel: t.primary_channel, content_text: t.latest_message_text, created_at: '2026-07-05T09:00:00.000Z', status: 'received', provider_message_id: 'wamid.IN' },
          { id: 'm2', thread_id: t.id, direction: 'outbound', channel: t.primary_channel, content_text: 'Agent reply', created_at: '2026-07-05T09:05:00.000Z', status: 'delivered', provider_message_id: 'wamid.OUT' },
        ],
        participants: [], escalations: [],
        identities: [{ id: 'ci1', display_name: t.identity_display_name, normalized_address: t.identity_address, channel: t.primary_channel, provider: 'meta_whatsapp_cloud_api', verified: true }],
        linked_identities: [],
        delivery_attempts: [{ id: 'da1', message_id: 'm2', attempt_number: 1, provider: 'meta_whatsapp_cloud_api', channel: t.primary_channel, status: 'delivered', provider_message_id: 'wamid.OUT', started_at: '2026-07-05T09:05:00.000Z' }],
        preferences: { preferred_channel: t.primary_channel, timezone: 'Africa/Harare', language: 'en', consent_status: 'granted', whatsapp_enabled: true },
      })
    }

    // Thread list — keyset pagination over the cursor (index-encoded).
    if (path.endsWith('/threads')) {
      const cursor = url.searchParams.get('cursor')
      const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) || 0 : 0
      const statusFilter = url.searchParams.get('status')
      const search = url.searchParams.get('search')
      let pool = threads
      if (statusFilter) pool = pool.filter((t) => t.status === statusFilter)
      if (search) pool = pool.filter((t) => (t.identity_display_name + t.latest_message_text + t.id).toLowerCase().includes(search.toLowerCase()))
      const slice = pool.slice(start, start + limit)
      const hasMore = start + limit < pool.length
      const nextCursor = hasMore ? Buffer.from(String(start + limit), 'utf8').toString('base64url') : null
      return json(route, { threads: slice, page: { sort: 'newest', limit, returned: slice.length, has_more: hasMore, next_cursor: nextCursor, mode: 'mock' }, counts: counts(threads) })
    }

    // Any other mutation — succeed.
    return json(route, { ok: true })
  })

  // Safety net: any other API call resolves so the app never hangs on the network. Fall back (to the
  // earlier, more specific handlers) for the comms API + the auth/CSRF endpoints seeded by seedAdmin;
  // Playwright runs the LAST-registered matching handler first, so this net must defer to them.
  await page.route('**/api/**', (route) => {
    const url = route.request().url()
    if (url.includes('/admin/communications/') || url.includes('/security/csrf-token') || url.includes('/auth/me')) return route.fallback()
    return json(route, {})
  })
}

export { admin as E2E_ADMIN }
