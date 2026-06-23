import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavigationAnalytics, setNavAnalyticsAuthProvider } from './navigationAnalytics'
import { resetCsrfTokenCache, type AuthHeaders } from './apiClient'

const BASE = 'https://api.test/api'
const ENDPOINT = `${BASE}/analytics/navigation`
const CSRF_URL = `${BASE}/security/csrf-token`

interface PostCapture {
  body: any
  headers: Record<string, string>
}

/**
 * A fetch mock that (a) answers the identity-bound CSRF GET with {csrfToken:'tok'}
 * and (b) records every POST's parsed body + headers. The POST status is
 * configurable (default 202) and can be a queue (one status per call) so a 403→retry
 * sequence can be exercised.
 */
function makeFetch(opts?: { csrfStatus?: number; postStatuses?: number[]; csrfThrows?: boolean }) {
  const posts: PostCapture[] = []
  const csrfCalls: Record<string, string | undefined>[] = []
  const postStatuses = opts?.postStatuses ?? [202]
  let postIndex = 0

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (url === CSRF_URL) {
      csrfCalls.push({ ...headers })
      if (opts?.csrfThrows) throw new Error('network down')
      if (opts?.csrfStatus && opts.csrfStatus >= 400) {
        return new Response(null, { status: opts.csrfStatus })
      }
      return new Response(JSON.stringify({ csrfToken: 'tok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // POST .../analytics/navigation
    posts.push({ body: JSON.parse(String(init?.body)), headers: { ...headers } })
    const status = postStatuses[Math.min(postIndex, postStatuses.length - 1)]
    postIndex += 1
    return new Response(null, { status })
  }) as unknown as typeof fetch

  return { fetchImpl, posts, csrfCalls }
}

function makeClient(opts?: Parameters<typeof makeFetch>[0]) {
  const { fetchImpl, posts, csrfCalls } = makeFetch(opts)
  const client = new NavigationAnalytics({ baseUrl: BASE, endpoint: ENDPOINT, fetchImpl })
  return { client, fetchImpl, posts, csrfCalls }
}

function setAuth(headers: AuthHeaders | null) {
  setNavAnalyticsAuthProvider(headers ? () => headers : null)
}

describe('NavigationAnalytics (web client)', () => {
  beforeEach(() => {
    resetCsrfTokenCache()
    setNavAnalyticsAuthProvider(null) // default: anonymous/guest unless a test sets it
  })

  // ---- buffering / track contract ----------------------------------------

  it('track is non-throwing and buffers events', () => {
    const { client } = makeClient()
    expect(() => client.track({ event_type: 'navigation_surface_opened', surface: 'mega_menu' })).not.toThrow()
    expect(client.pendingCount).toBe(1)
  })

  it('track returns void synchronously (navigation is never delayed by analytics)', () => {
    const { client } = makeClient()
    const result = client.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs' })
    expect(result).toBeUndefined()
  })

  it('queue is bounded to 100 (drop-oldest)', () => {
    const { client } = makeClient()
    for (let i = 0; i < 150; i++) client.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs', node_id: `n${i}` })
    expect(client.pendingCount).toBe(100)
  })

  it('suppresses duplicate impressions per surface+node within a session', () => {
    const { client } = makeClient()
    client.track({ event_type: 'navigation_item_impression', surface: 'mega_menu', node_id: 'buy.shop-all' })
    client.track({ event_type: 'navigation_item_impression', surface: 'mega_menu', node_id: 'buy.shop-all' })
    expect(client.pendingCount).toBe(1)
  })

  it('flush is a no-op on an empty queue (no CSRF fetch, no POST)', async () => {
    const { client, fetchImpl } = makeClient()
    await client.flush()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // ---- CSRF + session contract -------------------------------------------

  it('authenticated batch POST carries x-session-token AND x-csrf-token', async () => {
    setAuth({ 'x-session-token': 'sess-123', 'x-user-id': 'user-9' })
    const { client, posts, csrfCalls } = makeClient()
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'admin.ai' })
    await client.flush()

    expect(client.pendingCount).toBe(0)
    expect(posts).toHaveLength(1)
    expect(posts[0].headers['x-csrf-token']).toBe('tok')
    expect(posts[0].headers['x-session-token']).toBe('sess-123')
    expect(posts[0].headers['x-user-id']).toBe('user-9')
    expect(posts[0].headers['Content-Type']).toBe('application/json')
    // The token GET was sent with the SAME identity headers so it is correctly bound.
    expect(csrfCalls[0]['x-session-token']).toBe('sess-123')
    expect(csrfCalls[0]['x-user-id']).toBe('user-9')
  })

  it('anonymous batch fetches a guest-bound token and still sends x-csrf-token', async () => {
    // No auth provider set → guest identity.
    const { client, posts, csrfCalls } = makeClient()
    client.track({ event_type: 'navigation_surface_opened', surface: 'mega_menu' })
    await client.flush()

    expect(posts).toHaveLength(1)
    expect(posts[0].headers['x-csrf-token']).toBe('tok')
    expect(posts[0].headers['x-session-token']).toBeUndefined()
    expect(csrfCalls).toHaveLength(1) // a token WAS fetched (guest-bound)
  })

  it('successful 202 clears the queue', async () => {
    const { client } = makeClient({ postStatuses: [202] })
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'x' })
    await client.flush()
    expect(client.pendingCount).toBe(0)
  })

  it('posts a schema-versioned batch (schemaVersion + platform=web)', async () => {
    const { client, posts } = makeClient()
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'admin.ai' })
    await client.flush()
    expect(posts[0].body.schemaVersion).toBe(1)
    expect(posts[0].body.events[0].platform).toBe('web')
    expect(posts[0].body.events[0].event_type).toBe('navigation_item_selected')
  })

  // ---- failure / safety --------------------------------------------------

  it('CSRF token fetch failure drops the batch with NO throw (queue not requeued)', async () => {
    const { client, posts } = makeClient({ csrfThrows: true })
    client.track({ event_type: 'navigation_error', surface: 'unknown' })
    await expect(client.flush()).resolves.toBeUndefined()
    expect(posts).toHaveLength(0) // never sent a guaranteed-reject POST
    expect(client.pendingCount).toBe(0) // dropped, not requeued unboundedly
  })

  it('a 403 POST triggers a token refresh + exactly one retry, then stops (no infinite loop)', async () => {
    // Both attempts 403 → after the bounded retry it gives up rather than spinning.
    const { client, fetchImpl, posts } = makeClient({ postStatuses: [403, 403] })
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'x' })
    await expect(client.flush()).resolves.toBeUndefined()

    // Exactly two POST attempts (initial + one retry); call count is bounded.
    expect(posts).toHaveLength(2)
    // GET (re-fetched after resetCsrfTokenCache) + POST per attempt = bounded total.
    const postCalls = (fetchImpl as any).mock.calls.filter((c: any[]) => c[0] === ENDPOINT)
    expect(postCalls.length).toBe(2)
    expect(client.pendingCount).toBe(0) // dropped after exhausting the bounded retry
  })

  it('a 403 then success recovers within the bounded retry', async () => {
    const { client, posts } = makeClient({ postStatuses: [403, 202] })
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'x' })
    await client.flush()
    expect(posts).toHaveLength(2)
    expect(client.pendingCount).toBe(0)
  })

  it('transport rejection drops the batch and never throws', async () => {
    const posts: PostCapture[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === CSRF_URL) {
        return new Response(JSON.stringify({ csrfToken: 'tok' }), { status: 200 })
      }
      throw new Error('network down')
    }) as unknown as typeof fetch
    const client = new NavigationAnalytics({ baseUrl: BASE, endpoint: ENDPOINT, fetchImpl })
    client.track({ event_type: 'navigation_error', surface: 'unknown' })
    await expect(client.flush()).resolves.toBeUndefined()
    expect(posts).toHaveLength(0)
    expect(client.pendingCount).toBe(0)
  })

  it('no event body or header-token ever leaks the token into an event object', async () => {
    setAuth({ 'x-session-token': 'sess', 'x-user-id': 'u' })
    const { client, posts } = makeClient()
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'x' })
    await client.flush()
    const serialized = JSON.stringify(posts[0].body)
    expect(serialized).not.toContain('tok') // token only ever lives in the header
    for (const ev of posts[0].body.events) {
      expect(Object.values(ev)).not.toContain('tok')
    }
  })

  // ---- flushBeacon (unload) ----------------------------------------------

  it('flushBeacon sends x-csrf-token via keepalive fetch (NOT sendBeacon) when a token is cached', async () => {
    setAuth({ 'x-session-token': 'sess', 'x-user-id': 'u' })
    const { client, posts, fetchImpl } = makeClient()
    // First a normal flush to populate lastCsrf for the current identity.
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'a' })
    await client.flush()
    expect(posts).toHaveLength(1)

    // Now queue more and fire the synchronous unload path.
    client.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs', node_id: 'home' })
    client.flushBeacon()
    // Let the in-flight keepalive fetch settle.
    await Promise.resolve()
    await Promise.resolve()

    expect(posts).toHaveLength(2)
    const beaconPost = posts[1]
    expect(beaconPost.headers['x-csrf-token']).toBe('tok')
    expect(beaconPost.headers['x-session-token']).toBe('sess')
    // It used the keepalive fetch path, not sendBeacon (which can't carry headers).
    const lastCall = (fetchImpl as any).mock.calls.at(-1)
    expect(lastCall[1].keepalive).toBe(true)
    expect(client.pendingCount).toBe(0)
  })

  it('flushBeacon drops (sends NO request) when no token is cached for the identity', async () => {
    setAuth({ 'x-session-token': 'sess', 'x-user-id': 'u' })
    const { client, fetchImpl } = makeClient()
    client.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs', node_id: 'home' })
    // No prior successful flush → lastCsrf is null → nothing can be sent synchronously.
    client.flushBeacon()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(client.pendingCount).toBe(0) // batch dropped, never blocks unload
  })

  it('flushBeacon drops when the identity changed since the cached token (stale identity)', async () => {
    setAuth({ 'x-session-token': 'sess-A', 'x-user-id': 'u' })
    const { client, fetchImpl, posts } = makeClient()
    client.track({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: 'a' })
    await client.flush()
    expect(posts).toHaveLength(1)

    // Identity changes (e.g. role switch / re-login) → cached token is not reusable.
    setAuth({ 'x-session-token': 'sess-B', 'x-user-id': 'u' })
    const callsBefore = (fetchImpl as any).mock.calls.length
    client.track({ event_type: 'navigation_tab_selected', surface: 'bottom_tabs', node_id: 'home' })
    client.flushBeacon()
    expect((fetchImpl as any).mock.calls.length).toBe(callsBefore) // no new request
    expect(client.pendingCount).toBe(0)
  })

  it('flushBeacon is a no-op on an empty queue', () => {
    const { client, fetchImpl } = makeClient()
    client.flushBeacon()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('auth provider that throws degrades to guest headers without throwing', async () => {
    setNavAnalyticsAuthProvider(() => { throw new Error('context not ready') })
    const { client, posts, csrfCalls } = makeClient()
    client.track({ event_type: 'navigation_error', surface: 'unknown' })
    await expect(client.flush()).resolves.toBeUndefined()
    expect(posts).toHaveLength(1)
    expect(posts[0].headers['x-csrf-token']).toBe('tok')
    expect(csrfCalls[0]['x-session-token']).toBeUndefined() // fell back to guest
  })
})
