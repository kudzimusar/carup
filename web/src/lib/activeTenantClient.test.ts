/**
 * OC-5D — the client's copy of its organisation follows the SERVER, never a stale guess.
 *
 *   · withServerTenantContext REPLACES the client's organisation with the server's answer — an older
 *     build stored the organisation login used to guess, and that guess must not survive the boot /me;
 *   · a request refused because the selection changed under it (TENANT_CONTEXT_REVOKED /
 *     TENANT_CONTEXT_MISMATCH) signals AuthContext to re-read the session — on the direct failure path
 *     AND the CSRF-retry path every unsafe 403 takes; any other 403 does not.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AuthUser } from '@shared/types'
import { withServerTenantContext } from './authSession'
import { apiRequest, resetCsrfTokenCache, setTenantContextHandler, type AuthHeaders } from './apiClient'

const BASE = 'https://api.test/api'
const AUTH: AuthHeaders = { 'x-user-id': 'u-1', 'x-session-token': 'sess-1', 'x-tenant-id': 't-garage' }
const GARAGE = { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic', selectable: true }

function makeResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

function refusing(body: unknown, status = 403) {
  return vi.fn(async (url: unknown) => {
    if (String(url).endsWith('/security/csrf-token')) return makeResponse({ csrfToken: 'csrf' })
    return makeResponse(body, { ok: false, status })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  resetCsrfTokenCache()
  setTenantContextHandler(null)
})

describe('withServerTenantContext', () => {
  const stored: AuthUser = {
    id: 'u-1', name: 'Farai', email: 'f@example.invalid', role: 'owner',
    // what an older build stored: the organisation login GUESSED (the sole membership)
    active_tenant_id: 't-garage', tenant_role: 'mechanic',
  }

  it('a server with no selection clears the guessed organisation', () => {
    const next = withServerTenantContext(stored, { active_tenant_id: null, tenant_context: 'none', memberships: [GARAGE] })
    expect(next.active_tenant_id).toBeNull()
    expect(next.tenant_role).toBeNull()
    expect(next.active_tenant).toBeNull()
    expect(next.tenant_context).toBe('none')
    expect(next.memberships).toEqual([GARAGE])
    expect(next.name).toBe('Farai')
  })

  it('a revoked selection reads as revoked, with no organisation', () => {
    const next = withServerTenantContext(stored, { active_tenant_id: null, tenant_context: 'revoked', memberships: [] })
    expect(next.active_tenant_id).toBeNull()
    expect(next.tenant_context).toBe('revoked')
  })

  it('an answer without memberships (the selection endpoint) keeps the known list', () => {
    const withList = { ...stored, memberships: [GARAGE], memberships_unavailable: false }
    const next = withServerTenantContext(withList, {
      active_tenant_id: 't-garage', tenant_role: 'mechanic', tenant_context: 'selected',
      active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' },
    })
    expect(next.memberships).toEqual([GARAGE])
    expect(next.active_tenant?.name).toBe('Mbare Motors')
  })

  it('an unreadable membership list is carried as unavailable, never as "none"', () => {
    const next = withServerTenantContext(stored, { active_tenant_id: null, memberships: [], memberships_unavailable: true })
    expect(next.memberships_unavailable).toBe(true)
  })

  it('no server answer leaves the user untouched', () => {
    expect(withServerTenantContext(stored, null)).toBe(stored)
  })
})

describe('tenant-context refusals signal a session re-read', () => {
  for (const code of ['TENANT_CONTEXT_REVOKED', 'TENANT_CONTEXT_MISMATCH']) {
    it(`${code} on a read (direct path) signals, and still throws`, async () => {
      const handler = vi.fn()
      setTenantContextHandler(handler)
      const failure = await apiRequest({ baseUrl: BASE, path: '/garage/jobs', authHeaders: AUTH, fetchImpl: refusing({ error: 'changed', code }) })
        .catch((e) => e)
      expect(failure.code).toBe(code)
      expect(handler).toHaveBeenCalledWith(code)
    })

    it(`${code} on a write (CSRF-retry path) signals too`, async () => {
      const handler = vi.fn()
      setTenantContextHandler(handler)
      const failure = await apiRequest({
        baseUrl: BASE, path: '/garage/jobs', options: { method: 'POST', body: '{}' }, authHeaders: AUTH,
        fetchImpl: refusing({ error: 'changed', code }),
      }).catch((e) => e)
      expect(failure.code).toBe(code)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  }

  it('an ordinary 403 (a permission refusal) does not', async () => {
    const handler = vi.fn()
    setTenantContextHandler(handler)
    await apiRequest({ baseUrl: BASE, path: '/garage/jobs', authHeaders: AUTH, fetchImpl: refusing({ error: 'no', code: 'ACTIVE_TENANT_ROLE' }) })
      .catch(() => {})
    await apiRequest({ baseUrl: BASE, path: '/garage/jobs', authHeaders: AUTH, fetchImpl: refusing({ error: 'Forbidden.' }) })
      .catch(() => {})
    expect(handler).not.toHaveBeenCalled()
  })

  it('a throwing handler never masks the original failure', async () => {
    setTenantContextHandler(() => { throw new Error('boom') })
    const failure = await apiRequest({ baseUrl: BASE, path: '/x', authHeaders: AUTH, fetchImpl: refusing({ error: 'changed', code: 'TENANT_CONTEXT_REVOKED' }) })
      .catch((e) => e)
    expect(failure.code).toBe('TENANT_CONTEXT_REVOKED')
  })
})
