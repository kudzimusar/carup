/**
 * OC-5D — who the owner dashboard MOVES to the garage workspace.
 *
 * `useGarageOperator` is the only thing that relocates a signed-in person: OwnerDashboard sends
 * `state === 'garage'` to /garage. Under #197 it read a tenant role the server GUESSED at login (the
 * sole membership), so belonging to a garage was enough to be moved into it. OC-5D: only the
 * organisation the person SELECTED and the server verified (`active_tenant`) counts, and only when
 * the registry's own workshop rule admits them — the same rule the route gate applies, so nobody is
 * sent to a workspace that would refuse them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AuthUser } from '@shared/types'

let auth: { user: AuthUser | null; loading: boolean }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const { useGarageOperator } = await import('./useGarageOperator')

const GARAGE_ID = '11111111-2222-4333-8444-555555555555'
const owner = (extra: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u-1', name: 'Tendai', email: 't@example.invalid', role: 'owner', ...extra,
})
const selected = (type: string, role: string, extra: Partial<AuthUser> = {}): AuthUser => owner({
  active_tenant_id: GARAGE_ID,
  tenant_role: role,
  active_tenant: { id: GARAGE_ID, name: 'Msasa Motors', type, status: 'active', role },
  tenant_context: 'selected',
  ...extra,
})

function Probe() {
  const { state, garageName } = useGarageOperator()
  return <span data-testid="operator">{state}|{garageName ?? '-'}</span>
}
const read = () => {
  const view = render(<Probe />)
  const text = screen.getByTestId('operator').textContent
  view.unmount()
  return text
}

beforeEach(() => { auth = { user: null, loading: false } })

describe('who is operating as a garage', () => {
  it('a session that has not finished restoring moves nobody', () => {
    auth = { user: selected('garage', 'mechanic'), loading: true }
    expect(read()).toBe('checking|-')
  })

  it('a signed-out visitor is not a garage operator', () => {
    expect(read()).toBe('not_garage|-')
  })

  it('a person who SELECTED their garage, in a workspace role, is', () => {
    auth = { user: selected('garage', 'mechanic'), loading: false }
    expect(read()).toBe('garage|Msasa Motors')
    auth = { user: selected('garage', 'admin'), loading: false }
    expect(read()).toContain('garage|')
  })

  it('belonging to a garage without selecting it is NOT operating as it — offered, never moved', () => {
    auth = {
      user: owner({
        memberships: [{ id: GARAGE_ID, name: 'Msasa Motors', type: 'garage', status: 'active', role: 'mechanic' } as never],
        active_tenant_id: null, active_tenant: null, tenant_context: 'none',
      }),
      loading: false,
    }
    expect(read()).toBe('not_garage|-')
  })

  it('the display-only tenant_role grants nothing on its own', () => {
    auth = { user: owner({ tenant_role: 'mechanic', active_tenant: null, active_tenant_id: null }), loading: false }
    expect(read()).toBe('not_garage|-')
  })

  it('a workspace role in another KIND of organisation is not a garage', () => {
    auth = { user: selected('dealership', 'mechanic'), loading: false }
    expect(read()).toBe('not_garage|-')
  })

  it('a garage role outside the workspace roles is not moved to a workspace that refuses it', () => {
    auth = { user: selected('garage', 'member'), loading: false }
    expect(read()).toBe('not_garage|-')
  })

  it('an organisation the session does not carry an id for is not trusted', () => {
    auth = { user: selected('garage', 'mechanic', { active_tenant_id: null }), loading: false }
    expect(read()).toBe('not_garage|-')
  })
})

describe('the one consumer that moves people', () => {
  it('OwnerDashboard sends a selected garage operator to /garage, and nobody else', async () => {
    vi.resetModules()
    vi.doMock('@/context/AuthContext', () => ({ useAuth: () => auth }))
    vi.doMock('@/hooks/useCarUpApi', () => ({
      useCarUpApi: () => ({
        fetchSafePayEscrows: vi.fn().mockResolvedValue([]),
        fetchOwnedVehicles: vi.fn().mockResolvedValue([]),
        fetchNotifications: vi.fn().mockResolvedValue([]),
      }),
    }))
    const { default: OwnerDashboard } = await import('@/pages/dashboard/owner/OwnerDashboard')
    const at = () => (
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<OwnerDashboard />} />
          <Route path="/garage" element={<span data-testid="workshop">workshop</span>} />
        </Routes>
      </MemoryRouter>
    )

    auth = { user: selected('garage', 'mechanic'), loading: false }
    const moved = render(at())
    expect(await moved.findByTestId('workshop')).toBeTruthy()
    moved.unmount()

    auth = { user: selected('dealership', 'mechanic'), loading: false }
    const stayed = render(at())
    expect(stayed.queryByTestId('workshop'), 'a dealership member must not be moved to a garage workspace').toBeNull()
    stayed.unmount()

    // A session still restoring has no verified selection yet: moving on it is how people bounce.
    auth = { user: selected('garage', 'mechanic'), loading: true }
    const restoring = render(at())
    expect(restoring.queryByTestId('workshop'), 'nobody is moved before the server has answered').toBeNull()
    restoring.unmount()
  })
})
