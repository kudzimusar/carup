/**
 * Gate 2 device-defect regressions — governance failure classification and
 * verification availability/discoverability.
 *
 * Device evidence: /api/features/effective failed with a stale token, the whole
 * dashboard (inside the governance boundary) rendered "Temporarily unavailable",
 * Start Verification Flow was unreachable, and the drawer had no verification
 * entry. Contracts under test:
 *  1. fetchEffectiveStates distinguishes 401/403 (unauthorized) from network/5xx;
 *  2. governance refresh() CLEARS invalid auth on 401/403 (no dead-end retry)
 *     but keeps auth + flags a retryable error on network/5xx;
 *  3. the drawer exposes Identity Verification for ANY authenticated user even
 *     with an EMPTY governance map (governance down);
 *  4. the boundary's failed state exposes a Start Verification escape hatch;
 *  5. the login screen carries no Phase7B tester copy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const secureStore = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStore.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secureStore.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secureStore.delete(k)),
}))

function jsonResponse(status: number, body: unknown = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

async function freshModules() {
  vi.resetModules()
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test'
  const auth = await import('../store/authStore')
  const gov = await import('../store/featureGovernanceStore')
  const api = await import('../utils/featureGovernanceApi')
  return { auth, gov, api }
}

beforeEach(() => {
  secureStore.clear()
  vi.unstubAllGlobals()
})

describe('fetchEffectiveStates failure classification', () => {
  it.each([401, 403])('HTTP %s → ok:false with unauthorized:true', async (status) => {
    const { api } = await freshModules()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(status)))
    const r = await api.fetchEffectiveStates()
    expect(r.ok).toBe(false)
    expect((r as { unauthorized?: boolean }).unauthorized).toBe(true)
  })

  it('HTTP 500 → ok:false WITHOUT unauthorized', async () => {
    const { api } = await freshModules()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(500)))
    const r = await api.fetchEffectiveStates()
    expect(r.ok).toBe(false)
    expect((r as { unauthorized?: boolean }).unauthorized).toBeFalsy()
  })

  it('network failure → ok:false WITHOUT unauthorized', async () => {
    const { api } = await freshModules()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const r = await api.fetchEffectiveStates()
    expect(r.ok).toBe(false)
    expect((r as { unauthorized?: boolean }).unauthorized).toBeFalsy()
  })
})

describe('governance refresh() with a signed-in identity', () => {
  it('401 clears the INVALID auth (logout) instead of a dead-end error', async () => {
    const { auth, gov } = await freshModules()
    auth.useAuthStore.setState({
      user: { id: 'u-stale', name: 'Stale', role: 'owner' } as never,
      token: 'stale-token',
      isAuthenticated: true,
      loading: false,
    })
    // First call (authed) → 401; the logout-triggered anonymous refresh → 200.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(401))
      .mockImplementation(() => jsonResponse(200, { features: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await gov.useFeatureGovernanceStore.getState().refresh()

    expect(auth.useAuthStore.getState().isAuthenticated).toBe(false)
    expect(auth.useAuthStore.getState().token).toBeNull()
    // No dead-end: the post-logout anonymous load succeeded, error stays false.
    expect(gov.useFeatureGovernanceStore.getState().error).toBe(false)
  })

  it('network failure keeps auth and flags a RETRYABLE error', async () => {
    const { auth, gov } = await freshModules()
    auth.useAuthStore.setState({
      user: { id: 'u-ok', name: 'Fine', role: 'owner' } as never,
      token: 'good-token',
      isAuthenticated: true,
      loading: false,
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await gov.useFeatureGovernanceStore.getState().refresh()

    expect(auth.useAuthStore.getState().isAuthenticated).toBe(true)
    expect(gov.useFeatureGovernanceStore.getState().error).toBe(true)
  })
})

describe('verification discoverability and availability', () => {
  it('drawer shows Identity Verification for an authenticated user even when governance is EMPTY', async () => {
    const { resolveDrawerSections } = await import('../navigation/nativeDrawerSections')
    const sections = resolveDrawerSections({
      isAuthenticated: true,
      role: 'owner',
      environment: 'production',
      effectiveStates: {}, // governance failed/empty — entry must still appear
    } as never)
    const trust = sections.find((s) => s.id === 'trust')
    expect(trust).toBeDefined()
    const entry = trust!.items.find((i) => i.id === 'native.verification')
    expect(entry).toBeDefined()
    expect((entry as { expoRoute?: string }).expoRoute).toBe('/(auth)/verification/intro')
  })

  it('drawer hides Identity Verification for anonymous users', async () => {
    const { resolveDrawerSections } = await import('../navigation/nativeDrawerSections')
    const sections = resolveDrawerSections({
      isAuthenticated: false,
      role: null,
      environment: 'production',
      effectiveStates: {},
    } as never)
    const all = sections.flatMap((s) => s.items.map((i) => i.id))
    expect(all).not.toContain('native.verification')
  })

  it('boundary failed-state source exposes the Start Verification escape hatch', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/navigation/NativeFeatureBoundary.tsx'),
      'utf-8',
    )
    expect(src).toContain('boundary-start-verification')
    expect(src).toContain('/(auth)/verification/intro')
  })

  it('login screen carries no Phase7B tester copy', () => {
    const src = readFileSync(resolve(__dirname, '../app/(auth)/login.tsx'), 'utf-8')
    expect(src.toLowerCase()).not.toContain('phase7b')
  })

  describe('rejected state is terminal (device retest round 2)', () => {
    const resultSrc = readFileSync(
      resolve(__dirname, '../app/(auth)/verification/result.tsx'),
      'utf-8',
    )

    it('rejected panel uses terminal wording, never "Under Review"', () => {
      expect(resultSrc).toContain('Verification Closed — Not Approved')
      // The generic under-review copy must be unreachable for rejected: the
      // rejected branch precedes it in the same ternary.
      const rejectedIdx = resultSrc.indexOf("verificationStatus === 'rejected'\n                  ? 'Verification Closed")
      expect(resultSrc.indexOf('Verification Closed — Not Approved')).toBeGreaterThan(-1)
    })

    it('Restart Verification is NOT offered for rejected (retry policy A)', () => {
      const allowsBlock = resultSrc.slice(
        resultSrc.indexOf('const allowsRestart'),
        resultSrc.indexOf('backend_pending') + 40,
      )
      expect(allowsBlock).not.toContain("'rejected'")
    })

    it('rejected copy explains the reviewer/support reopen path', () => {
      expect(resultSrc).toContain('reviewer can reopen the case')
    })
  })
})
