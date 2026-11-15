/**
 * TI-10 — web sign-out integrates server-side revocation of the presenting session.
 *
 * Proves that `logout()`:
 *   1. clears the local session immediately (auth keys gone from storage, context unauthenticated),
 *      and leaves continuity keys (guest Sell draft, saved cars) alone — TI-24;
 *   2. issues POST /api/auth/logout carrying the PRESENTING token (server-side target selection —
 *      the client does not name a session id), with keepalive;
 *   3. RESOLVES only after the server answered, so callers can await it before leaving the page
 *      (a hard navigation started earlier aborted the request in a real browser);
 *   4. on failure, timeout or an unconfirmed answer still clears the local session, returns
 *      'failed', and tells the user honestly instead of claiming success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { AuthProvider, useAuth, SIGN_OUT_REVOCATION_TIMEOUT_MS, SIGN_OUT_UNCONFIRMED_MESSAGE } from './AuthContext'

const apiRequestMock = vi.fn()
const toastWarning = vi.fn()

vi.mock('@/lib/apiClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/apiClient')>()
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  }
})
vi.mock('sonner', () => ({ toast: { warning: (...a: unknown[]) => toastWarning(...a), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  const api = useAuth()
  onReady(api)
  return null
}

function setup() {
  let api!: ReturnType<typeof useAuth>
  render(
    <AuthProvider>
      <Probe onReady={a => { api = a }} />
    </AuthProvider>,
  )
  return { getApi: () => api }
}

function signIn(getApi: () => ReturnType<typeof useAuth>) {
  act(() => {
    getApi().login(
      { id: 'u1', name: 'Fictional Owner', email: 'owner@example.invalid', role: 'owner' } as never,
      'presenting-token-123',
    )
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('TI-10 — logout revokes the presenting server session', () => {
  beforeEach(() => {
    localStorage.clear()
    apiRequestMock.mockReset()
    toastWarning.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears local auth at once, keeps continuity keys, and resolves "revoked" only after the server answers', async () => {
    const { getApi } = setup()
    signIn(getApi)
    localStorage.setItem('carup_guest_sell_draft_durable_v1', '{"make":"Fictional"}')
    localStorage.setItem('carup_favorites', '["RX27TESTVIN000001"]')
    const server = deferred<{ success: boolean }>()
    apiRequestMock.mockReturnValueOnce(server.promise)

    let settled = false
    let outcome: string | undefined
    let pending!: Promise<string>
    act(() => {
      pending = getApi().logout()
      void pending.then((o) => { settled = true; outcome = o })
    })

    // 1. Local session ended immediately; continuity keys untouched.
    expect(getApi().isAuthenticated).toBe(false)
    expect(localStorage.getItem('carup_token')).toBeNull()
    expect(localStorage.getItem('carup_user')).toBeNull()
    expect(localStorage.getItem('carup_guest_sell_draft_durable_v1')).not.toBeNull()
    expect(localStorage.getItem('carup_favorites')).not.toBeNull()

    // 2. Server revocation issued with the presenting credential only, keepalive on.
    expect(apiRequestMock).toHaveBeenCalledTimes(1)
    const call = apiRequestMock.mock.calls[0][0] as { path: string; options: { method: string; keepalive?: boolean }; authHeaders: Record<string, string> }
    expect(call.path).toBe('/auth/logout')
    expect(call.options.method).toBe('POST')
    expect(call.options.keepalive).toBe(true)
    expect(call.authHeaders['x-session-token']).toBe('presenting-token-123')
    expect(JSON.stringify(call)).not.toContain('sessionId')

    // 3. Not settled until the server answers — callers can await it before leaving the page.
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)
    await act(async () => { server.resolve({ success: true }); await pending })
    expect(outcome).toBe('revoked')
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('a revocation failure still clears the local session, returns "failed" and tells the user', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getApi } = setup()
    signIn(getApi)
    apiRequestMock.mockRejectedValueOnce(new Error('backend unavailable'))

    let outcome: string | undefined
    await act(async () => { outcome = await getApi().logout() })

    expect(outcome).toBe('failed')
    expect(getApi().isAuthenticated).toBe(false)
    expect(localStorage.getItem('carup_token')).toBeNull()
    expect(toastWarning).toHaveBeenCalledWith(SIGN_OUT_UNCONFIRMED_MESSAGE)
    expect(SIGN_OUT_UNCONFIRMED_MESSAGE).toMatch(/could not confirm/i)
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/may remain valid/i)
    consoleError.mockRestore()
  })

  it('an unresponsive backend cannot hang sign-out: the revocation budget expires as "failed"', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getApi } = setup()
    signIn(getApi)
    apiRequestMock.mockReturnValueOnce(new Promise(() => {}))

    let outcome: string | undefined
    let pending!: Promise<string>
    act(() => { pending = getApi().logout() })
    await act(async () => { vi.advanceTimersByTime(SIGN_OUT_REVOCATION_TIMEOUT_MS + 1); outcome = await pending })

    expect(outcome).toBe('failed')
    expect(toastWarning).toHaveBeenCalledWith(SIGN_OUT_UNCONFIRMED_MESSAGE)
    expect(getApi().isAuthenticated).toBe(false)
    consoleError.mockRestore()
  })

  it('a 2xx without a success confirmation is not claimed as revoked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getApi } = setup()
    signIn(getApi)
    apiRequestMock.mockResolvedValueOnce({})

    let outcome: string | undefined
    await act(async () => { outcome = await getApi().logout() })
    expect(outcome).toBe('failed')
    consoleError.mockRestore()
  })

  it('logout without a token performs no server call (guests have nothing to revoke)', async () => {
    const { getApi } = setup()
    let outcome: string | undefined
    await act(async () => { outcome = await getApi().logout() })
    expect(outcome).toBe('no-session')
    expect(apiRequestMock).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })
})
