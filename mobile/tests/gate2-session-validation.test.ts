/**
 * Gate 2 device-defect regressions — startup session validation.
 *
 * Device evidence: Expo restored a stale "Phase7B Tester" SecureStore session;
 * every governed fetch then 401'd and the dashboard dead-ended on
 * "Temporarily unavailable". Contract under test: a restored token is
 * validated against /api/auth/me — purged on 401/403, kept on success, and
 * kept (offline tolerance) when the backend is unreachable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const secureStore = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStore.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secureStore.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secureStore.delete(k)),
}))

const USER = JSON.stringify({ id: 'u-stale-1', name: 'Phase7B Tester', role: 'owner' })

function respond(status: number) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status } as Response)
}

async function freshAuthStore() {
  vi.resetModules()
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test'
  const mod = await import('../store/authStore')
  return mod
}

beforeEach(() => {
  secureStore.clear()
  vi.unstubAllGlobals()
})

describe('validateSessionToken classification', () => {
  it.each([
    [401, 'invalid'],
    [403, 'invalid'],
    [200, 'valid'],
    [500, 'unknown'],
  ])('HTTP %s → %s', async (status, expected) => {
    const { validateSessionToken } = await freshAuthStore()
    const fetchImpl = vi.fn(() => respond(status as number)) as unknown as typeof fetch
    expect(await validateSessionToken('tok', 'u1', fetchImpl)).toBe(expected)
  })

  it('network failure → unknown (offline tolerance)', async () => {
    const { validateSessionToken } = await freshAuthStore()
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    expect(await validateSessionToken('tok', 'u1', fetchImpl)).toBe('unknown')
  })
})

describe('initialize() with a restored SecureStore session', () => {
  it('purges a STALE token (401) and stays signed out', async () => {
    secureStore.set('carup_secure_user', USER)
    secureStore.set('carup_secure_token', 'stale-token')
    vi.stubGlobal('fetch', vi.fn(() => respond(401)))

    const { useAuthStore } = await freshAuthStore()
    await useAuthStore.getState().initialize()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.token).toBeNull()
    expect(secureStore.has('carup_secure_token')).toBe(false)
    expect(secureStore.has('carup_secure_user')).toBe(false)
  })

  it('keeps a VALID session (200)', async () => {
    secureStore.set('carup_secure_user', USER)
    secureStore.set('carup_secure_token', 'good-token')
    vi.stubGlobal('fetch', vi.fn(() => respond(200)))

    const { useAuthStore } = await freshAuthStore()
    await useAuthStore.getState().initialize()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.token).toBe('good-token')
  })

  it('keeps the session when the backend is UNREACHABLE (offline tolerance)', async () => {
    secureStore.set('carup_secure_user', USER)
    secureStore.set('carup_secure_token', 'maybe-token')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const { useAuthStore } = await freshAuthStore()
    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
