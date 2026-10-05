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
 *
 * OC-5D: the answer is the shape the server actually emits — the session's SELECTED, verified
 * organisation (`active_tenant`) and the memberships it may choose from — not #197's flat
 * `active_tenant_role`, which no server sends any more. A fake that answers a shape the server never
 * produces would keep this green while the real wire broke. (Dropping a stale stored organisation is
 * pinned by AuthContext.activeTenant.test.tsx.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const STORED_TOKEN = 'sk_live_stored_token'

/** The stale identity in localStorage: no membership, exactly as it was before the server knew. */
const STORED_USER = { id: 'u_garage_1', name: 'SN garage', email: 'g@staging.test', role: 'owner' }

/** What the server actually knows about this session. */
const GARAGE_ID = '330e9aca-db24-4c2b-9595-1dcce72ccfa0'
const FRESH_USER = {
  ...STORED_USER,
  active_tenant_id: GARAGE_ID,
  tenant_role: 'mechanic',
  active_tenant: { id: GARAGE_ID, name: 'SN Closure Garage', type: 'garage', status: 'active', role: 'mechanic' },
  tenant_context: 'selected',
  memberships: [{ id: GARAGE_ID, name: 'SN Closure Garage', type: 'garage', status: 'active', role: 'mechanic', selectable: true }],
}

function Probe() {
  const { user } = useAuth()
  return (
    <div>
      <span data-testid="role">{user?.role ?? '-'}</span>
      <span data-testid="name">{user?.name ?? '-'}</span>
      <span data-testid="tenant-role">{user?.active_tenant?.role ?? '-'}</span>
      <span data-testid="tenant-type">{user?.active_tenant?.type ?? '-'}</span>
      <span data-testid="tenant-id">{user?.active_tenant_id ?? '-'}</span>
      <span data-testid="memberships">{user?.memberships?.length ?? '-'}</span>
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
    expect(screen.getByTestId('tenant-id').textContent).toBe(GARAGE_ID)
    expect(screen.getByTestId('tenant-type').textContent).toBe('garage')
    expect(screen.getByTestId('memberships').textContent).toBe('1')
    // The platform role is unchanged — the membership is additional, not a replacement.
    expect(screen.getByTestId('role').textContent).toBe('owner')
  })

  it('the whole identity is the server\'s — a renamed account does not outlive the session', async () => {
    meResponse = { user: { ...FRESH_USER, name: 'SN garage (renamed)' } }
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('SN garage (renamed)'))
  })

  it('the adopted identity is persisted, so a reload keeps it', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('tenant-role').textContent).toBe('mechanic'))
    const storedUser = JSON.parse(localStorage.getItem('carup_user') || '{}')
    expect(storedUser.active_tenant).toEqual(FRESH_USER.active_tenant)
    expect(storedUser.active_tenant_id).toBe(GARAGE_ID)
    expect(localStorage.getItem('carup_token'), 'the token must not be disturbed by adopting the user')
      .toBe(STORED_TOKEN)
  })

  it('a session with no membership stays plain — nothing is invented', async () => {
    meResponse = { user: STORED_USER }
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('owner'))
    expect(screen.getByTestId('tenant-role').textContent).toBe('-')
    expect(screen.getByTestId('tenant-type').textContent).toBe('-')
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
