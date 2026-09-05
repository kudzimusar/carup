/**
 * CarUp Intelligence 1.0 — web activity client (I3b).
 *
 * The properties under test are the ones a metric depends on: that a page view is
 * the unit of "one view", that impressions do not repeat while a shopper scrolls,
 * that the pseudonymous session is dropped at logout, and that the api client
 * actually carries the context — without it, a server-emitted view could never be
 * attributed to a shopper and unique-viewer counts would be uncomputable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getSessionKey,
  getPageViewId,
  rotatePageView,
  resetActivityIdentity,
  activityContextHeaders,
  track,
  flush,
  _resetForTests,
  _pendingForTests,
} from './intelligenceActivity'
import { apiRequest, setActivityContextProvider, resetCsrfTokenCache } from './apiClient'

const OPAQUE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/

beforeEach(() => {
  _resetForTests()
  resetCsrfTokenCache()
  setActivityContextProvider(null)
  try { globalThis.localStorage?.clear() } catch { /* ignore */ }
})

afterEach(() => {
  setActivityContextProvider(null)
  vi.restoreAllMocks()
})

describe('pseudonymous identity', () => {
  it('mints an opaque session key the backend will accept', () => {
    const key = getSessionKey()
    expect(key).toMatch(OPAQUE_KEY_RE)
    expect(getSessionKey()).toBe(key)
  })

  it('is not derived from any identifier and carries no personal data', () => {
    const key = getSessionKey()
    expect(key).not.toContain('@')
    expect(key.startsWith('s')).toBe(true)
  })

  it('persists across reloads so a returning shopper is one shopper', () => {
    const key = getSessionKey()
    _resetForTests()
    expect(getSessionKey()).toBe(key)
  })

  it('is dropped at logout so a shared device does not carry one person into the next', () => {
    const key = getSessionKey()
    resetActivityIdentity()
    expect(getSessionKey()).not.toBe(key)
  })

  it('survives blocked storage by falling back to a memory-only key', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    _resetForTests()
    expect(getSessionKey()).toMatch(OPAQUE_KEY_RE)
    spy.mockRestore()
  })
})

describe('page views are the unit of one view', () => {
  it('rotates to a new id, so a soft navigation is a new view', () => {
    const first = getPageViewId()
    const second = rotatePageView()
    expect(second).not.toBe(first)
    expect(second).toMatch(OPAQUE_KEY_RE)
  })

  it('does not rotate on its own, so a refetch within a screen is not a second view', () => {
    const id = getPageViewId()
    expect(getPageViewId()).toBe(id)
    expect(getPageViewId()).toBe(id)
  })
})

describe('activity context headers', () => {
  it('supplies exactly the three context headers the backend reads', () => {
    const headers = activityContextHeaders()
    expect(Object.keys(headers).sort()).toEqual([
      'x-carup-page-view', 'x-carup-platform', 'x-carup-session-key',
    ])
    expect(headers['x-carup-platform']).toBe('web')
    expect(headers['x-carup-session-key']).toMatch(OPAQUE_KEY_RE)
  })

  it('reaches the wire through the shared api client, so every page is instrumented', async () => {
    setActivityContextProvider(activityContextHeaders)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    await apiRequest({ baseUrl: 'https://api.test', path: '/api/marketplace/listings/VIN1', fetchImpl })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['x-carup-session-key']).toMatch(OPAQUE_KEY_RE)
    expect(init.headers['x-carup-page-view']).toMatch(OPAQUE_KEY_RE)
    expect(init.headers['x-carup-platform']).toBe('web')
  })

  it('an auth header always wins a name clash with activity context', async () => {
    setActivityContextProvider(() => ({ 'x-user-id': 'spoofed-by-telemetry' }))
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    }) as unknown as typeof fetch

    await apiRequest({
      baseUrl: 'https://api.test', path: '/x',
      authHeaders: { 'x-user-id': 'real-user' }, fetchImpl,
    })
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['x-user-id']).toBe('real-user')
  })

  it('a throwing context provider never breaks a product request', async () => {
    setActivityContextProvider(() => { throw new Error('telemetry exploded') })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    await expect(
      apiRequest({ baseUrl: 'https://api.test', path: '/x', fetchImpl }),
    ).resolves.toEqual({ ok: true })
  })

  it('requests are unaffected when no provider is registered at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }) as unknown as typeof fetch
    await apiRequest({ baseUrl: 'https://api.test', path: '/x', fetchImpl })
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['x-carup-session-key']).toBeUndefined()
  })
})

describe('client event queue', () => {
  it('stamps every event with the page view it happened in', () => {
    const pageView = getPageViewId()
    track({ event_type: 'marketplace_listing_shared', listing_id: 'VIN1', source_surface: 'marketplace_detail' })
    const [event] = _pendingForTests()
    expect(event.page_view_id).toBe(pageView)
    expect(event.schema_version).toBe(1)
    expect(event.event_nonce).toMatch(OPAQUE_KEY_RE)
  })

  it('suppresses repeat impressions within one page view (scrolling is not demand)', () => {
    const impression = {
      event_type: 'marketplace_listing_impression' as const,
      listing_id: 'VIN1',
      source_surface: 'marketplace_list' as const,
    }
    track(impression); track(impression); track(impression)
    expect(_pendingForTests()).toHaveLength(1)
  })

  it('counts the same listing again after a route change', () => {
    const impression = {
      event_type: 'marketplace_listing_impression' as const,
      listing_id: 'VIN1',
      source_surface: 'marketplace_list' as const,
    }
    track(impression)
    rotatePageView()
    track(impression)
    expect(_pendingForTests()).toHaveLength(2)
  })

  it('treats the same listing on a different surface as a distinct impression', () => {
    track({ event_type: 'marketplace_listing_impression', listing_id: 'VIN1', source_surface: 'marketplace_list' })
    track({ event_type: 'marketplace_listing_impression', listing_id: 'VIN1', source_surface: 'saved' })
    expect(_pendingForTests()).toHaveLength(2)
  })

  it('bounds the queue and keeps the most recent behaviour', () => {
    for (let i = 0; i < 130; i += 1) {
      track({ event_type: 'marketplace_contact_clicked', listing_id: `VIN${i}` })
    }
    const pending = _pendingForTests()
    expect(pending.length).toBeLessThanOrEqual(100)
    expect(pending[pending.length - 1].listing_id).toBe('VIN129')
  })

  it('never throws on a malformed event', () => {
    expect(() => track({} as never)).not.toThrow()
    expect(_pendingForTests()).toHaveLength(0)
  })
})

describe('flush', () => {
  it('posts the batch with the session key and drains the queue', async () => {
    track({ event_type: 'marketplace_listing_shared', listing_id: 'VIN1' })
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('csrf')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ csrfToken: 'tok' }) })
      }
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ ok: true }) })
    }) as unknown as typeof fetch

    await flush(fetchImpl)

    const post = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find(([url]) => String(url).includes('/api/intelligence/activity'))
    expect(post).toBeDefined()
    const body = JSON.parse(post![1].body)
    expect(body.session_key).toMatch(OPAQUE_KEY_RE)
    expect(body.events).toHaveLength(1)
    expect(_pendingForTests()).toHaveLength(0)
  })

  it('does nothing when there is nothing to send', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await flush(fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('drops the batch after bounded retries rather than looping forever', async () => {
    track({ event_type: 'marketplace_listing_shared', listing_id: 'VIN1' })
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    await expect(flush(fetchImpl)).resolves.toBeUndefined()
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(6)
  })
})
