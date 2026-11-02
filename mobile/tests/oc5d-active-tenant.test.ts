/**
 * OC-5D — the native client's organisation follows the SERVER's verified selection.
 *
 *   · a restored session adopts /api/auth/me's answer: the organisation an older build stored (the one
 *     login used to guess) is dropped unless the session really has a selection;
 *   · selectActiveTenant is the only way to choose one — PUT /api/auth/active-tenant, CSRF-protected,
 *     never asserting x-tenant-id while changing it — and a refusal leaves the person where they were;
 *   · a role switch records the organisation the SERVER verified, never the one the client asked for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const secureStore = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStore.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secureStore.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secureStore.delete(k)),
}))

const GARAGE = { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic', selectable: true }

// What an older build stored: the organisation login GUESSED (the sole membership).
const STORED_USER = { id: 'u-1', name: 'Farai', email: 'f@example.invalid', role: 'owner', active_tenant_id: 't-garage', tenant_role: 'mechanic' }

type Call = { url: string; init?: RequestInit }

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function stubBackend(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    for (const [suffix, handler] of Object.entries(routes)) {
      if (String(url).includes(suffix)) return handler(init)
    }
    return json(200, {})
  }))
  return calls
}

async function freshAuthStore() {
  vi.resetModules()
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test'
  return import('../store/authStore')
}

beforeEach(() => {
  secureStore.clear()
  vi.unstubAllGlobals()
})

describe('initialize() adopts the server\'s organisation', () => {
  it('drops the organisation an older build stored when the session has no selection', async () => {
    secureStore.set('carup_secure_user', JSON.stringify(STORED_USER))
    secureStore.set('carup_secure_token', 'tok')
    stubBackend({ '/api/auth/me': () => json(200, { user: { ...STORED_USER, active_tenant_id: null, tenant_role: null, active_tenant: null, tenant_context: 'none', memberships: [GARAGE] } }) })

    const { useAuthStore } = await freshAuthStore()
    await useAuthStore.getState().initialize()

    const user = useAuthStore.getState().user!
    expect(user.active_tenant_id).toBeNull()
    expect(user.tenant_role).toBeNull()
    expect(user.memberships).toEqual([GARAGE])
    expect(JSON.parse(secureStore.get('carup_secure_user')!).active_tenant_id).toBeNull()
  })

  it('an unreadable /me body keeps the session and the stored user (offline-tolerant)', async () => {
    secureStore.set('carup_secure_user', JSON.stringify(STORED_USER))
    secureStore.set('carup_secure_token', 'tok')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 } as Response)))

    const { useAuthStore } = await freshAuthStore()
    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user!.active_tenant_id).toBe('t-garage')
  })
})

describe('selectActiveTenant()', () => {
  async function signedIn() {
    const mod = await freshAuthStore()
    mod.useAuthStore.setState({ user: { ...STORED_USER, active_tenant_id: null, memberships: [GARAGE] } as never, token: 'tok', isAuthenticated: true })
    return mod
  }

  it('PUTs the choice with a CSRF token and WITHOUT x-tenant-id, then adopts the server\'s answer', async () => {
    const calls = stubBackend({
      '/api/security/csrf-token': () => json(200, { csrfToken: 'csrf-1' }),
      '/api/auth/active-tenant': () => json(200, {
        active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' },
        user: { active_tenant_id: 't-garage', tenant_role: 'mechanic', tenant_context: 'selected', active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' } },
      }),
    })
    const { useAuthStore } = await signedIn()
    const result = await useAuthStore.getState().selectActiveTenant('t-garage')

    expect(result).toEqual({ ok: true })
    const put = calls.find((c) => c.url.includes('/api/auth/active-tenant'))!
    expect(put.init?.method).toBe('PUT')
    expect(JSON.parse(String(put.init?.body))).toEqual({ tenantId: 't-garage' })
    const headers = put.init?.headers as Record<string, string>
    expect(headers['x-csrf-token']).toBe('csrf-1')
    expect(headers['x-session-token']).toBe('tok')
    expect('x-tenant-id' in headers).toBe(false)
    const user = useAuthStore.getState().user!
    expect(user.active_tenant_id).toBe('t-garage')
    expect(user.memberships).toEqual([GARAGE])
    expect(JSON.parse(secureStore.get('carup_secure_user')!).active_tenant_id).toBe('t-garage')
  })

  it('a refusal is reported with the server\'s reason and leaves the person where they were', async () => {
    stubBackend({
      '/api/security/csrf-token': () => json(200, { csrfToken: 'csrf-1' }),
      '/api/auth/active-tenant': () => json(403, { error: 'This organisation is not active.', code: 'TENANT_INACTIVE' }),
    })
    const { useAuthStore } = await signedIn()
    const result = await useAuthStore.getState().selectActiveTenant('t-garage')
    expect(result).toEqual({ ok: false, error: 'This organisation is not active.' })
    expect(useAuthStore.getState().user!.active_tenant_id).toBeNull()
  })
})

describe('switchRole() records the server-verified organisation only', () => {
  it('no client-side fallback to the requested tenant', async () => {
    stubBackend({
      '/api/security/csrf-token': () => json(200, { csrfToken: 'csrf-1' }),
      '/api/auth/switch-role': () => json(200, { token: 'tok-2', user: { id: 'u-1', role: 'owner', active_tenant_id: null, tenant_role: null } }),
    })
    const mod = await freshAuthStore()
    mod.useAuthStore.setState({ user: { ...STORED_USER, active_tenant_id: null } as never, token: 'tok', isAuthenticated: true })
    const result = await mod.useAuthStore.getState().switchRole('owner', 't-someone-elses')
    expect(result.ok).toBe(true)
    expect(mod.useAuthStore.getState().user!.active_tenant_id).toBeNull()
  })
})
