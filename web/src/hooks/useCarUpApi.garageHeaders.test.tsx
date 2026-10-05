/**
 * OC-5D — the browser claims nothing about a garage.
 *
 * #197 kept a client-side list of "garage-side" paths and, on those, sent the person's TENANT role as
 * `x-stakeholder-role` — a role header the browser assembled to get past a platform-role gate. OC-5D
 * moved the decision to the server (requireActiveTenant re-verifies the session's SELECTED garage on
 * every request), so the client sends exactly what it is: the platform role it signed in with, and
 * the organisation it selected, which the server treats as an assertion to check.
 *
 * The source pin in tenantRoleAccess.test.ts catches the old identifiers; this catches the BEHAVIOUR
 * under any name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AuthUser } from '@shared/types'

const GARAGE_ID = '11111111-2222-4333-8444-555555555555'
let auth: { user: AuthUser | null; token: string | null }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const sent: Array<{ path: string; headers: Record<string, string> }> = []
vi.mock('@/lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/apiClient')>('@/lib/apiClient')
  return {
    ...actual,
    apiRequest: vi.fn(async ({ path, authHeaders }: { path: string; authHeaders: Record<string, string> }) => {
      sent.push({ path, headers: { ...authHeaders } })
      return {}
    }),
  }
})

const { useCarUpApi } = await import('./useCarUpApi')

const garageMember = (role: string): AuthUser => ({
  id: 'u-garage', name: 'Tendai', email: 't@example.invalid', role: 'owner',
  active_tenant_id: GARAGE_ID,
  tenant_role: role,
  active_tenant: { id: GARAGE_ID, name: 'Msasa Motors', type: 'garage', status: 'active', role },
  tenant_context: 'selected',
})

beforeEach(() => { sent.length = 0 })

describe('every garage call carries the platform role and the selected organisation — nothing else', () => {
  it('the workshop, a case, the customers and the profile', async () => {
    auth = { user: garageMember('mechanic'), token: 'tok' }
    const { result } = renderHook(() => useCarUpApi())
    await result.current.fetchGarageQueue()
    await result.current.fetchServiceRequest('case-1')
    await result.current.fetchGarageCustomers()
    expect(sent.length).toBe(3)
    for (const { path, headers } of sent) {
      expect(headers['x-stakeholder-role'], `${path}: the browser must not claim the tenant role as a platform role`)
        .toBe('owner')
      expect(headers['x-tenant-id'], `${path}: the selected organisation is asserted for the server to verify`)
        .toBe(GARAGE_ID)
    }
  })

  it('a garage ADMIN is still an owner to the platform', async () => {
    auth = { user: garageMember('admin'), token: 'tok' }
    const { result } = renderHook(() => useCarUpApi())
    await result.current.fetchGarageQueue()
    expect(sent[0].headers['x-stakeholder-role']).toBe('owner')
  })

  it('no selection, no organisation header — the browser does not guess one', async () => {
    auth = {
      user: { id: 'u-owner', name: 'O', email: 'o@example.invalid', role: 'owner', active_tenant_id: null, active_tenant: null },
      token: 'tok',
    }
    const { result } = renderHook(() => useCarUpApi())
    await result.current.fetchGarageQueue()
    expect(sent[0].headers['x-stakeholder-role']).toBe('owner')
    expect('x-tenant-id' in sent[0].headers).toBe(false)
  })
})
