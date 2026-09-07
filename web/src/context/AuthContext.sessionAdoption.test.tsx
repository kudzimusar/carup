/**
 * The session must ADOPT what the server says it is.
 *
 * THE DEFECT THIS PINS — and it is a wiring defect, which is the kind that survives a green suite.
 *
 * Round 2 owner UAT found a real garage tenant-member redirected off their own workspace. The
 * backend was extended to report the caller's tenant membership, the fix was unit-tested, and the
 * SAME redirect happened again on the deployed candidate. `validateStoredSession` had always
 * returned the authoritative user from `/auth/me`; `AuthContext` threw it away and kept whatever
 * localStorage held. A server that is asked and ignored is the same as one that was never asked.
 *
 * So this asserts the wire, not the calculation: what `/auth/me` answers reaches `user`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const STORED_TOKEN = 'sk_live_stored_token'

/** The stale identity in localStorage: no membership, exactly as it was before the server knew. */
const STORED_USER = { id: 'u_garage_1', name: 'SN garage', email: 'g@staging.test', role: 'owner' }

/** What the server actually knows about this session. */
const FRESH_USER = {
  ...STORED_USER,
  active_tenant_id: '330e9aca-db24-4c2b-9595-1dcce72ccfa0',
  active_tenant_role: 'mechanic',
  active_tenant_name: 'SN Closure Garage',
  active_tenant_type: 'garage',
}

function Probe() {
  const { user } = useAuth()
  return (
    <div>
      <span data-testid="role">{user?.role ?? '-'}</span>
      <span data-testid="tenant-role">{user?.active_tenant_role ?? '-'}</span>
      <span data-testid="tenant-id">{user?.active_tenant_id ?? '-'}</span>
    </div>
  )
}

let meResponse: unknown
let meStatus = 200

beforeEach(() => {
  localStorage.clear()
  // The real storage shape: two keys, not one blob.
  localStorage.setItem('carup_user', JSON.stringify(STORED_USER))
  localStorage.setItem('carup_token', STORED_TOKEN)
  meStatus = 200
  meResponse = { user: FRESH_USER }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input)
    if (url.includes('/auth/me')) {
      return new Response(JSON.stringify(meResponse), {
        status: meStatus, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
})

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('the session adopts the server’s answer', () => {
  it('the tenant membership /auth/me reports reaches the session', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    // Before validation the stored identity is used, so the tenant is initially absent — that is
    // the optimistic restore, and it is why this must be awaited rather than read synchronously.
    await waitFor(() => expect(screen.getByTestId('tenant-role').textContent).toBe('mechanic'))
    expect(screen.getByTestId('tenant-id').textContent).toBe(FRESH_USER.active_tenant_id)
    // The platform role is unchanged — the membership is additional, not a replacement.
    expect(screen.getByTestId('role').textContent).toBe('owner')
  })

  it('the adopted identity is persisted, so a reload keeps it', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('tenant-role').textContent).toBe('mechanic'))
    const storedUser = JSON.parse(localStorage.getItem('carup_user') || '{}')
    expect(storedUser.active_tenant_role).toBe('mechanic')
    expect(localStorage.getItem('carup_token'), 'the token must not be disturbed by adopting the user')
      .toBe(STORED_TOKEN)
  })

  it('a session with no membership stays plain — nothing is invented', async () => {
    meResponse = { user: STORED_USER }
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('owner'))
    expect(screen.getByTestId('tenant-role').textContent).toBe('-')
    expect(screen.getByTestId('tenant-id').textContent).toBe('-')
  })

  it('a transient failure keeps the session rather than logging anyone out', async () => {
    meStatus = 500
    meResponse = { error: 'upstream unavailable' }
    render(<AuthProvider><Probe /></AuthProvider>)
    // Fail open: a network blip must never clear auth. The stored identity survives.
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('owner'))
    expect(localStorage.getItem('carup_token'), 'a blip must never clear the session').toBe(STORED_TOKEN)
  })
})
