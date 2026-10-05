/**
 * OC-5D — AuthContext keeps the client's organisation equal to the SERVER's verified selection.
 *
 *   · boot: a stored user from an older build carries the organisation login used to guess; the boot
 *     /auth/me answer replaces it (in memory and in storage);
 *   · selectActiveTenant PUTs the choice — CSRF-protected, never asserting x-tenant-id while changing
 *     it — and adopts the server's answer, keeping the known membership list;
 *   · a request refused with TENANT_CONTEXT_REVOKED makes the client re-read the session, so it stops
 *     asserting an organisation the person no longer acts for.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { apiRequest, resetCsrfTokenCache } from '@/lib/apiClient'

const GARAGE = { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic', selectable: true }
const STORED = { id: 'u-1', name: 'Farai', email: 'f@example.invalid', role: 'owner', active_tenant_id: 't-garage', tenant_role: 'mechanic' }

type Seen = { url: string; init?: RequestInit }
let seen: Seen[] = []
let meAnswer: Record<string, unknown> = {}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function installBackend(extra: Record<string, (init?: RequestInit) => Response> = {}) {
  seen = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    seen.push({ url: u, init })
    for (const [suffix, handler] of Object.entries(extra)) if (u.includes(suffix)) return handler(init)
    if (u.endsWith('/security/csrf-token')) return json(200, { csrfToken: 'csrf-1' })
    if (u.endsWith('/auth/me')) return json(200, { user: meAnswer })
    return json(200, {})
  }))
}

type AuthApi = ReturnType<typeof useAuth>
let api: AuthApi | null = null
const exposeApi = (value: AuthApi) => { api = value }
function Probe({ onAuth }: { onAuth: (value: AuthApi) => void }) {
  const auth = useAuth()
  useEffect(() => { onAuth(auth) }, [auth, onAuth])
  return (
    <div>
      <span data-testid="tenant">{auth.user?.active_tenant_id ?? 'none'}</span>
      <span data-testid="context">{auth.user?.tenant_context ?? 'unset'}</span>
      <span data-testid="memberships">{(auth.user?.memberships ?? []).length}</span>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  resetCsrfTokenCache()
  api = null
  meAnswer = { ...STORED, active_tenant_id: null, tenant_role: null, active_tenant: null, tenant_context: 'none', memberships: [GARAGE] }
})
afterEach(() => { vi.unstubAllGlobals() })

describe('AuthContext — the server decides the session\'s organisation', () => {
  it('boot replaces the organisation an older build stored with the server\'s answer', async () => {
    localStorage.setItem('carup_user', JSON.stringify(STORED))
    localStorage.setItem('carup_token', 'tok-1')
    installBackend()
    render(<AuthProvider><Probe onAuth={exposeApi} /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('tenant')).toHaveTextContent('none'))
    expect(screen.getByTestId('memberships')).toHaveTextContent('1')
    expect(JSON.parse(localStorage.getItem('carup_user')!).active_tenant_id).toBeNull()
  })

  it('selectActiveTenant PUTs the choice without asserting x-tenant-id, and adopts the server\'s answer', async () => {
    localStorage.setItem('carup_user', JSON.stringify(STORED))
    localStorage.setItem('carup_token', 'tok-1')
    installBackend({
      '/auth/active-tenant': () => json(200, {
        active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' },
        user: { active_tenant_id: 't-garage', tenant_role: 'mechanic', tenant_context: 'selected', active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' } },
      }),
    })
    render(<AuthProvider><Probe onAuth={exposeApi} /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('tenant')).toHaveTextContent('none'))

    await act(async () => { await api!.selectActiveTenant('t-garage') })

    const put = seen.find((c) => c.url.endsWith('/auth/active-tenant'))!
    expect(put.init?.method).toBe('PUT')
    expect(JSON.parse(String(put.init?.body))).toEqual({ tenantId: 't-garage' })
    const headers = put.init?.headers as Record<string, string>
    expect(headers['x-csrf-token']).toBe('csrf-1')
    expect(headers['x-session-token']).toBe('tok-1')
    expect('x-tenant-id' in headers).toBe(false)
    expect(screen.getByTestId('tenant')).toHaveTextContent('t-garage')
    expect(screen.getByTestId('context')).toHaveTextContent('selected')
    expect(screen.getByTestId('memberships')).toHaveTextContent('1')
    expect(JSON.parse(localStorage.getItem('carup_user')!).active_tenant_id).toBe('t-garage')
  })

  it('a refused selection is thrown to the caller and changes nothing', async () => {
    localStorage.setItem('carup_user', JSON.stringify({ ...STORED, active_tenant_id: null }))
    localStorage.setItem('carup_token', 'tok-1')
    installBackend({ '/auth/active-tenant': () => json(403, { error: 'This organisation is not active.', code: 'TENANT_INACTIVE' }) })
    render(<AuthProvider><Probe onAuth={exposeApi} /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('memberships')).toHaveTextContent('1'))
    let thrown: unknown
    await act(async () => { await api!.selectActiveTenant('t-garage').catch((e) => { thrown = e }) })
    expect((thrown as { code?: string }).code).toBe('TENANT_INACTIVE')
    expect(screen.getByTestId('tenant')).toHaveTextContent('none')
  })

  it('a TENANT_CONTEXT_REVOKED refusal anywhere makes the client re-read its session', async () => {
    localStorage.setItem('carup_user', JSON.stringify(STORED))
    localStorage.setItem('carup_token', 'tok-1')
    meAnswer = { ...STORED, active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' }, tenant_context: 'selected', memberships: [GARAGE] }
    installBackend({ '/garage/jobs': () => json(403, { error: 'changed', code: 'TENANT_CONTEXT_REVOKED' }) })
    render(<AuthProvider><Probe onAuth={exposeApi} /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('selected'))
    const meCallsBefore = seen.filter((c) => c.url.endsWith('/auth/me')).length

    meAnswer = { ...STORED, active_tenant_id: null, tenant_role: null, active_tenant: null, tenant_context: 'revoked', memberships: [] }
    await act(async () => {
      await apiRequest({ baseUrl: '/api', path: '/garage/jobs', authHeaders: { 'x-session-token': 'tok-1', 'x-tenant-id': 't-garage' } }).catch(() => {})
    })

    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('revoked'))
    expect(seen.filter((c) => c.url.endsWith('/auth/me')).length).toBe(meCallsBefore + 1)
    expect(screen.getByTestId('tenant')).toHaveTextContent('none')
  })
})
