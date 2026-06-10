import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  apiRequest,
  fetchCsrfToken,
  resetCsrfTokenCache,
  setUnauthorizedHandler,
  SessionExpiredError,
  SESSION_INVALID_MESSAGE,
  CSRF_ERROR_MESSAGE,
  resolveApiBaseUrl,
  DEFAULT_PRODUCTION_API_BASE_URL,
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

describe('apiClient invalid-session handling', () => {
  beforeEach(() => setUnauthorizedHandler(null))

  it('throws SessionExpiredError and invokes the unauthorized handler on a 401 invalid session', async () => {
    let handlerCalls = 0
    setUnauthorizedHandler(() => { handlerCalls++ })
    const { impl } = makeFetch({ api: () => makeResponse({ error: SESSION_INVALID_MESSAGE }, { ok: false, status: 401 }) })

    await expect(
      apiRequest({ baseUrl: BASE, path: '/notifications/me', authHeaders: BUYER, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(SessionExpiredError)
    expect(handlerCalls).toBe(1)
  })

  it('clears auth for any "Unauthorized." 401 (e.g. no active user context)', async () => {
    let cleared = false
    setUnauthorizedHandler(() => { cleared = true })
    const { impl } = makeFetch({ api: () => makeResponse({ error: 'Unauthorized. No active user context.' }, { ok: false, status: 401 }) })

    await expect(
      apiRequest({ baseUrl: BASE, path: '/vehicles/me', authHeaders: BUYER, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(SessionExpiredError)
    expect(cleared).toBe(true)
  })

  it('does NOT clear auth on a 403 (permission error, not a session error)', async () => {
    let cleared = false
    setUnauthorizedHandler(() => { cleared = true })
    const { impl } = makeFetch({ api: () => makeResponse({ error: 'Forbidden.' }, { ok: false, status: 403 }) })

    await expect(
      apiRequest({ baseUrl: BASE, path: '/admin/thing', authHeaders: BUYER, fetchImpl: impl }),
    ).rejects.toThrow('Forbidden.')
    await expect(
      apiRequest({ baseUrl: BASE, path: '/admin/thing', authHeaders: BUYER, fetchImpl: makeFetch({ api: () => makeResponse({ error: 'Forbidden.' }, { ok: false, status: 403 }) }).impl }),
    ).rejects.not.toBeInstanceOf(SessionExpiredError)
    expect(cleared).toBe(false)
  })

  it('a protected GET with an invalid session rejects cleanly (no unhandled crash) even with no handler', async () => {
    setUnauthorizedHandler(null)
    const { impl } = makeFetch({ api: () => makeResponse({ error: SESSION_INVALID_MESSAGE }, { ok: false, status: 401 }) })
    await expect(
      apiRequest({ baseUrl: BASE, path: '/safepay/list', authHeaders: BUYER, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(SessionExpiredError)
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

describe('resolveApiBaseUrl', () => {
  it('uses VITE_API_URL when set, on any host (staging → staging backend)', () => {
    expect(resolveApiBaseUrl('https://carup-backend-aca7.vercel.app/api', 'carup-staging.vercel.app'))
      .toBe('https://carup-backend-aca7.vercel.app/api')
    expect(resolveApiBaseUrl('https://carup-backend.vercel.app/api', 'localhost'))
      .toBe('https://carup-backend.vercel.app/api')
  })

  it('falls back to same-origin /api on a localhost host with no override', () => {
    expect(resolveApiBaseUrl(undefined, 'localhost')).toBe('/api')
    expect(resolveApiBaseUrl('', '127.0.0.1')).toBe('/api')
    expect(resolveApiBaseUrl('   ', 'localhost')).toBe('/api') // whitespace-only is ignored
  })

  it('falls back to the production backend for non-localhost hosts with no override', () => {
    expect(resolveApiBaseUrl(undefined, 'carup-staging.vercel.app')).toBe(DEFAULT_PRODUCTION_API_BASE_URL)
    expect(resolveApiBaseUrl(null, 'carup.vercel.app')).toBe(DEFAULT_PRODUCTION_API_BASE_URL)
    expect(resolveApiBaseUrl(undefined, undefined)).toBe(DEFAULT_PRODUCTION_API_BASE_URL)
  })

  it('trims a configured URL', () => {
    expect(resolveApiBaseUrl('  https://staging.example/api  ', 'localhost')).toBe('https://staging.example/api')
  })

  it('appends the /api suffix when a configured base omits it (resilient to misconfig)', () => {
    // Bare backend origin (the staging misconfiguration) gets /api appended.
    expect(resolveApiBaseUrl('https://carup-backend-staging.vercel.app', 'carup-staging.vercel.app'))
      .toBe('https://carup-backend-staging.vercel.app/api')
    expect(resolveApiBaseUrl('https://carup-backend-aca7.vercel.app', 'carup-staging.vercel.app'))
      .toBe('https://carup-backend-aca7.vercel.app/api')
    // Local dev pointed at a bare backend origin.
    expect(resolveApiBaseUrl('http://localhost:5001', 'localhost')).toBe('http://localhost:5001/api')
    // Trailing slash is stripped before appending.
    expect(resolveApiBaseUrl('https://host/', 'localhost')).toBe('https://host/api')
  })

  it('leaves a configured base that already targets /api unchanged', () => {
    expect(resolveApiBaseUrl('https://host/api', 'localhost')).toBe('https://host/api')
    expect(resolveApiBaseUrl('https://host/api/', 'localhost')).toBe('https://host/api')
    expect(resolveApiBaseUrl('http://localhost:5001/api', 'localhost')).toBe('http://localhost:5001/api')
  })
})
