/**
 * GMO-3/4 (OC-5E) — who the reviewer surface is offered to, and where its calls go.
 *
 * The server's garage review capability is platform administration only (OC-5E owner decision;
 * #209 would have handed it to `government` through the shared people set). The registry must offer
 * the page to exactly that audience — a sidebar entry the route then refuses is a broken promise,
 * and one the server refuses is worse. And the page's calls must reach the routes the server
 * actually mounts: the page tests mock the API client, so a wrong path would pass them all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { getFeatureByRoute } from '@/config/featureRegistry'
import type { AuthUser } from '@shared/types'

const ROUTE = '/admin/garage-applications'
const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined, activeTenant: null }

describe('the reviewer surface is the platform administrator\'s', () => {
  it('is registered as a platform-admin feature with no tenant scope', () => {
    const feature = getFeatureByRoute(ROUTE)
    expect(feature?.id).toBe('admin.garage-applications')
    expect(feature?.roles).toEqual(['admin'])
    expect(feature?.tenantRoles ?? []).toEqual([])
    expect(feature?.tenantTypes ?? []).toEqual([])
  })

  it('opens for the platform admin, and for nobody else — government included', () => {
    expect(evaluateRouteAccess({ ...base, route: ROUTE, role: 'admin' }).kind).toBe('render')
    for (const role of ['government', 'owner', 'mechanic', 'dealer', 'insurance', 'bank'] as const) {
      expect(evaluateRouteAccess({ ...base, route: ROUTE, role }).kind, role).toBe('redirect')
    }
  })

  it('a garage\'s own admin is not a CarUp reviewer', () => {
    const decision = evaluateRouteAccess({ ...base, route: ROUTE, role: 'owner', activeTenant: { type: 'garage', role: 'admin' } })
    expect(decision.kind).toBe('redirect')
  })
})

// ── the wire ──────────────────────────────────────────────────────────────────────────────────────

let auth: { user: AuthUser | null; token: string | null }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
const sent: Array<{ path: string; method: string; body?: string }> = []
vi.mock('@/lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/apiClient')>('@/lib/apiClient')
  return {
    ...actual,
    apiRequest: vi.fn(async ({ path, options }: { path: string; options?: RequestInit }) => {
      sent.push({ path, method: String(options?.method || 'GET'), body: options?.body ? String(options.body) : undefined })
      return {}
    }),
  }
})

const { useCarUpApi } = await import('@/hooks/useCarUpApi')

beforeEach(() => {
  sent.length = 0
  auth = { user: { id: 'admin-1', name: 'A', email: 'a@example.invalid', role: 'admin' }, token: 'tok' }
})

describe('the reviewer calls reach the routes the server mounts', () => {
  it('queue, detail, decision, activation and preview', async () => {
    const { result } = renderHook(() => useCarUpApi())
    await result.current.fetchGarageApplicationsForReview()
    await result.current.fetchGarageApplicationsForReview(['approved', 'rejected'])
    await result.current.fetchGarageApplicationForReview('app 1')
    await result.current.decideGarageApplication('app 1', { decision: 'reject', reason: 'Not a garage.' })
    await result.current.activateGarageApplication('app 1')
    await result.current.previewGarageEvidenceForReview('app 1', 'doc/2')
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /admin/garage-applications',
      'GET /admin/garage-applications?status=approved%2Crejected',
      'GET /admin/garage-applications/app%201',
      'POST /admin/garage-applications/app%201/decision',
      'POST /admin/garage-applications/app%201/activate',
      'GET /admin/garage-applications/app%201/evidence/doc%2F2/preview',
    ])
    expect(JSON.parse(sent[3].body as string)).toEqual({ decision: 'reject', reason: 'Not a garage.' })
  })
})
