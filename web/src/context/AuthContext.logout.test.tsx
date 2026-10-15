/**
 * PC01-K1-R1 — Sign Out ends the session on the SERVER, and says truthfully when it could not.
 *
 * Runs the REAL AuthProvider over a mocked fetch. logout() must: clear local auth at once and
 * unconditionally; POST /auth/logout exactly once with the token it held; and report what the server
 * established — 'revoked', 'already_ended' (401), or 'unconfirmed' (unreachable / refused).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth, type SignOutOutcome } from './AuthContext'
import { resetCsrfTokenCache } from '@/lib/apiClient'

const STORED_TOKEN = 'sk_live_stored_logout_token'
const STORED_USER = { id: 'u_admin_1', name: 'Admin One', email: 'a@staging.test', role: 'admin' }

let logoutCalls: Array<{ headers: Record<string, string> }>
let logoutBehaviour: 'ok' | '401' | 'network' | '503'

const latest: { auth: ReturnType<typeof useAuth> | null } = { auth: null }
function Probe() {
  const auth = useAuth()
  useEffect(() => { latest.auth = auth })
  return <span data-testid="who">{auth.user ? auth.user.id : 'anonymous'}</span>
}

beforeEach(() => {
  localStorage.clear()
  resetCsrfTokenCache()
  localStorage.setItem('carup_user', JSON.stringify(STORED_USER))
  localStorage.setItem('carup_token', STORED_TOKEN)
  logoutCalls = []
  logoutBehaviour = 'ok'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/auth/me')) return json({ user: STORED_USER })
    if (url.includes('/security/csrf-token')) return json({ csrfToken: 'csrf-1' })
    if (url.includes('/auth/logout')) {
      logoutCalls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()) })
      if (logoutBehaviour === 'network') throw new TypeError('Failed to fetch')
      if (logoutBehaviour === '401') return json({ error: 'Unauthorized. Session is invalid or expired.' }, 401)
      if (logoutBehaviour === '503') return json({ error: 'Your session could not be ended right now.', code: 'SESSION_REVOCATION_UNAVAILABLE' }, 503)
      return json({ success: true, revoked: true })
    }
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

async function signedInThenLogout(): Promise<SignOutOutcome> {
  render(<AuthProvider><Probe /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('u_admin_1'))
  let outcome!: SignOutOutcome
  await act(async () => { outcome = await latest.auth!.logout() })
  return outcome
}

describe('AuthContext.logout — server session revocation', () => {
  it('posts /auth/logout exactly once with the session it held, clears local auth and reports revoked', async () => {
    const outcome = await signedInThenLogout()
    expect(outcome).toBe('revoked')
    expect(logoutCalls).toHaveLength(1)
    expect(logoutCalls[0].headers['x-session-token']).toBe(STORED_TOKEN)
    expect(screen.getByTestId('who').textContent).toBe('anonymous')
    expect(localStorage.getItem('carup_token')).toBeNull()
    expect(localStorage.getItem('carup_user')).toBeNull()
  })

  it('a network failure still signs the person out locally, and reports the server side as unconfirmed', async () => {
    logoutBehaviour = 'network'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await signedInThenLogout()
    expect(outcome).toBe('unconfirmed')
    expect(screen.getByTestId('who').textContent).toBe('anonymous')
    expect(localStorage.getItem('carup_token')).toBeNull()
    expect(warn.mock.calls.flat().join(' ')).not.toContain(STORED_TOKEN)
  })

  it('a server refusal (503) is unconfirmed, never claimed as revoked', async () => {
    logoutBehaviour = '503'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await signedInThenLogout()).toBe('unconfirmed')
    expect(screen.getByTestId('who').textContent).toBe('anonymous')
  })

  it('a 401 means the server no longer accepts the session — already ended, nothing left to revoke', async () => {
    logoutBehaviour = '401'
    expect(await signedInThenLogout()).toBe('already_ended')
    expect(logoutCalls).toHaveLength(1)
    expect(screen.getByTestId('who').textContent).toBe('anonymous')
  })

  it('with no session there is no server call', async () => {
    localStorage.clear()
    render(<AuthProvider><Probe /></AuthProvider>)
    let outcome!: SignOutOutcome
    await act(async () => { outcome = await latest.auth!.logout() })
    expect(outcome).toBe('already_ended')
    expect(logoutCalls).toHaveLength(0)
  })
})
