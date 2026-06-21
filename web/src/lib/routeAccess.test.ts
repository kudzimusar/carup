import { describe, it, expect } from 'vitest'
import { evaluateRouteAccess, loginWithReturnTo, type RouteAccessInput } from './routeAccess'
import type { EffectiveFeatureState, FeatureLifecycleState } from '@/config/featureRegistry'

const base: RouteAccessInput = {
  route: '/insurance',
  isBootstrapping: false,
  isAuthenticated: false,
  role: null,
}

function override(featureId: string, state: FeatureLifecycleState, extra: Partial<EffectiveFeatureState> = {}): Record<string, EffectiveFeatureState> {
  return { [featureId]: { featureId, state, enabled: state !== 'disabled', visible: false, accessible: false, beta: state === 'beta', ...extra } }
}

describe('evaluateRouteAccess (Milestone 5)', () => {
  it('1. auth bootstrap → loading (only when enforcing auth)', () => {
    expect(evaluateRouteAccess({ ...base, isBootstrapping: true }).kind).toBe('loading')
    // public/lifecycle-only evaluation does not wait on bootstrap
    expect(evaluateRouteAccess({ ...base, isBootstrapping: true, enforceAuth: false }).kind).toBe('render')
  })

  it('2. unregistered public route renders; unregistered protected route → login', () => {
    expect(evaluateRouteAccess({ ...base, route: '/totally-unknown-public' }).kind).toBe('render')
    const d = evaluateRouteAccess({ ...base, route: '/dashboard/does-not-exist' })
    expect(d.kind).toBe('redirect')
    if (d.kind === 'redirect') expect(d.reason).toBe('auth')
  })

  it('public active route renders', () => {
    expect(evaluateRouteAccess({ ...base, route: '/insurance' }).kind).toBe('render')
  })

  it('protected route + no user → login with sanitized return-to', () => {
    const d = evaluateRouteAccess({ ...base, route: '/dashboard/garage' })
    expect(d.kind).toBe('redirect')
    if (d.kind === 'redirect') {
      expect(d.reason).toBe('auth')
      expect(d.to).toBe('/login?returnTo=%2Fdashboard%2Fgarage')
    }
  })

  it('protected route + correct role → render', () => {
    expect(evaluateRouteAccess({ route: '/dashboard/garage', isBootstrapping: false, isAuthenticated: true, role: 'owner' }).kind).toBe('render')
  })

  it('protected route + wrong role → safe redirect to that role dashboard', () => {
    const d = evaluateRouteAccess({ route: '/dashboard/garage', isBootstrapping: false, isAuthenticated: true, role: 'dealer' })
    expect(d.kind).toBe('redirect')
    if (d.kind === 'redirect') {
      expect(d.reason).toBe('role')
      expect(d.to).toBe('/dealer')
    }
  })

  it('planned route → planned page (regardless of auth)', () => {
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'planned') }).kind).toBe('planned')
  })

  it('disabled route → disabled page', () => {
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'disabled') }).kind).toBe('disabled')
  })

  it('beta route → render with beta notice', () => {
    const d = evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'beta', { reasonCode: 'pilot' }) })
    expect(d.kind).toBe('render-beta')
    if (d.kind === 'render-beta') expect(d.message).toBe('pilot')
  })

  it('deprecated route with target → redirect; same-route target does not loop', () => {
    const redirect = evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'deprecated', { deprecatedTo: '/pricing' }) })
    expect(redirect.kind).toBe('redirect')
    if (redirect.kind === 'redirect') { expect(redirect.reason).toBe('deprecated'); expect(redirect.to).toBe('/pricing') }
    // self-target → no redirect loop, renders
    const noLoop = evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'deprecated', { deprecatedTo: '/insurance' }) })
    expect(noLoop.kind).toBe('render')
  })

  it('lifecycle-only mode (enforceAuth=false) gates lifecycle but never redirects for auth/role', () => {
    // protected route, no user, but enforceAuth false → no auth redirect (renders)
    expect(evaluateRouteAccess({ ...base, route: '/dashboard/garage', enforceAuth: false }).kind).toBe('render')
    // …yet a disabled override still blocks
    expect(evaluateRouteAccess({ ...base, route: '/insurance', enforceAuth: false, effectiveStates: override('product.insurance', 'disabled') }).kind).toBe('disabled')
  })

  it('loginWithReturnTo sanitizes and encodes the return target', () => {
    expect(loginWithReturnTo('/dashboard/garage')).toBe('/login?returnTo=%2Fdashboard%2Fgarage')
    // unsafe values can never be produced from a pathname, but the helper still refuses them
    expect(loginWithReturnTo('//evil.com')).toBe('/login')
    expect(loginWithReturnTo('https://evil.com')).toBe('/login')
  })
})
