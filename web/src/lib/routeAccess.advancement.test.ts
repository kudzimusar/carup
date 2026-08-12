/**
 * Advancement-pass regressions: routes that were declared in App.tsx but not
 * registered bounced authenticated admins/government to /login, and dealers
 * were locked out of the only listing-creation flow.
 */
import { describe, expect, it } from 'vitest'
import { evaluateRouteAccess } from './routeAccess'
import { canRoleAccessRoute, getFeatureByRoute } from '@/config/featureRegistry'

const authed = (role: string, route: string) =>
  evaluateRouteAccess({
    route,
    isBootstrapping: false,
    isAuthenticated: true,
    role: role as never,
    effectiveStates: {},
  })

describe('previously unreachable admin/government routes are registered and admitted', () => {
  it.each([
    ['admin', '/admin/fraud-queue'],
    ['admin', '/admin/dealer-compliance'],
    ['admin', '/admin/governance-review'],
    ['government', '/government/governance-review'],
  ])('%s can access %s', (role, route) => {
    expect(getFeatureByRoute(route), `${route} must be registered`).toBeTruthy()
    expect(canRoleAccessRoute(role as never, route)).toBe(true)
    expect(authed(role, route).kind).toBe('render')
  })

  it('non-privileged roles are still denied', () => {
    expect(canRoleAccessRoute('owner' as never, '/admin/fraud-queue')).toBe(false)
    expect(authed('owner', '/admin/fraud-queue').kind).toBe('redirect')
  })
})

describe('dealer listing creation', () => {
  it('dealer is admitted to the sell-vehicle flow (backend already tenant-stamps dealer creates)', () => {
    expect(canRoleAccessRoute('dealer' as never, '/dashboard/sell-vehicle')).toBe(true)
    expect(authed('dealer', '/dashboard/sell-vehicle').kind).toBe('render')
  })

  it('owner keeps access', () => {
    expect(authed('owner', '/dashboard/sell-vehicle').kind).toBe('render')
  })
})

describe('marketplace compare is a governed public route', () => {
  it('is registered (previously fell through to the ungoverned fallback)', () => {
    expect(getFeatureByRoute('/marketplace/compare')).toBeTruthy()
  })
})
