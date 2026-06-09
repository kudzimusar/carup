import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  apiRequest,
  fetchCsrfToken,
  resetCsrfTokenCache,
  CSRF_ERROR_MESSAGE,
  type AuthHeaders,
} from './apiClient'

const BASE = 'https://api.test/api'
const BUYER: AuthHeaders = { 'x-user-id': 'buyer-1', 'x-session-token': 'sess-1' }

interface RecordedCall {
  url: string
  init: RequestInit
}

function makeResponse(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

/**
 * Build a mock fetch that records calls and routes the CSRF token endpoint vs. everything else.
 */
function makeFetch(opts: {
  csrf?: () => Response | Promise<Response>
  api?: () => Response | Promise<Response>
} = {}) {
  const calls: RecordedCall[] = []
  const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    if (u.endsWith('/security/csrf-token')) {
      return opts.csrf ? opts.csrf() : makeResponse({ csrfToken: 'csrf-tok-123' })
    }
    return opts.api ? opts.api() : makeResponse({ id: 'dio-1001' }, { status: 201 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

beforeEach(() => {
  resetCsrfTokenCache()
})

describe('apiClient CSRF flow', () => {
  it('does NOT fetch a CSRF token for safe (GET) requests', async () => {
    const { impl, calls } = makeFetch({ api: () => makeResponse([{ vin: 'V1' }]) })
    await apiRequest({ baseUrl: BASE, path: '/vehicles', authHeaders: BUYER, fetchImpl: impl })
    expect(calls.some(c => c.url.includes('/security/csrf-token'))).toBe(false)
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined()
  })

  it('fetches the CSRF token BEFORE the unsafe POST and includes x-csrf-token', async () => {
    const { impl, calls } = makeFetch()
    const result = await apiRequest({
      baseUrl: BASE,
      path: '/diaspora/import-orders',
      options: { method: 'POST', body: JSON.stringify({ order_type: 'vehicle' }) },
      authHeaders: BUYER,
      fetchImpl: impl,
    })

    // Ordering: CSRF token first, then the import-order POST.
    expect(calls[0].url).toContain('/security/csrf-token')
    expect(calls[1].url).toContain('/diaspora/import-orders')

    // The POST carries the freshly issued token and credentials.
    const postHeaders = calls[1].init.headers as Record<string, string>
    expect(postHeaders['x-csrf-token']).toBe('csrf-tok-123')
    expect(calls[1].init.credentials).toBe('include')
    expect(result).toEqual({ id: 'dio-1001' })
  })

  it('binds the CSRF token request to the user/session (sends identity headers + credentials)', async () => {
    const { impl, calls } = makeFetch()
    await apiRequest({
      baseUrl: BASE,
      path: '/diaspora/import-orders',
      options: { method: 'POST', body: '{}' },
      authHeaders: BUYER,
      fetchImpl: impl,
    })
    const csrfCall = calls.find(c => c.url.includes('/security/csrf-token'))!
    const csrfHeaders = csrfCall.init.headers as Record<string, string>
    expect(csrfHeaders['x-user-id']).toBe('buyer-1')
    expect(csrfHeaders['x-session-token']).toBe('sess-1')
    expect(csrfCall.init.credentials).toBe('include')
  })

  it('order creation succeeds when the token is present', async () => {
    const { impl } = makeFetch({ api: () => makeResponse({ id: 'dio-1001', status: 'IMPORT_REQUESTED' }, { status: 201 }) })
    const order = await apiRequest<{ id: string }>({
      baseUrl: BASE,
      path: '/diaspora/import-orders',
      options: { method: 'POST', body: '{}' },
      authHeaders: BUYER,
      fetchImpl: impl,
    })
    expect(order.id).toBe('dio-1001')
  })

  it('surfaces a clear error and does NOT send the POST when the CSRF token fetch fails (non-ok)', async () => {
    const { impl, calls } = makeFetch({ csrf: () => makeResponse({}, { ok: false, status: 503 }) })
    await expect(
      apiRequest({
        baseUrl: BASE,
        path: '/diaspora/import-orders',
        options: { method: 'POST', body: '{}' },
        authHeaders: BUYER,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(CSRF_ERROR_MESSAGE)
    // The unsafe POST must never have been attempted.
    expect(calls.some(c => c.url.includes('/diaspora/import-orders'))).toBe(false)
  })

  it('surfaces a clear error when the CSRF token request throws (network failure)', async () => {
    const { impl, calls } = makeFetch({ csrf: () => { throw new Error('network down') } })
    await expect(
      apiRequest({
        baseUrl: BASE,
        path: '/diaspora/import-orders',
        options: { method: 'POST', body: '{}' },
        authHeaders: BUYER,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(CSRF_ERROR_MESSAGE)
    expect(calls.some(c => c.url.includes('/diaspora/import-orders'))).toBe(false)
  })

  it('surfaces a clear error when the CSRF response omits csrfToken', async () => {
    const { impl } = makeFetch({ csrf: () => makeResponse({ notAToken: true }) })
    await expect(
      apiRequest({
        baseUrl: BASE,
        path: '/diaspora/import-orders',
        options: { method: 'POST', body: '{}' },
        authHeaders: BUYER,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(CSRF_ERROR_MESSAGE)
  })
})

describe('fetchCsrfToken caching', () => {
  it('reuses a cached token for the same identity but re-fetches for a different identity', async () => {
    const { impl, calls } = makeFetch()
    await fetchCsrfToken(BASE, BUYER, impl)
    await fetchCsrfToken(BASE, BUYER, impl)
    expect(calls.filter(c => c.url.includes('/security/csrf-token'))).toHaveLength(1)

    // A different user/session must NOT reuse the previous (wrong-bound) token.
    await fetchCsrfToken(BASE, { 'x-user-id': 'admin-9', 'x-session-token': 'sess-9' }, impl)
    expect(calls.filter(c => c.url.includes('/security/csrf-token'))).toHaveLength(2)
  })
})
