import { describe, it, expect } from 'vitest'
import { evaluateRouteAccess, loginWithReturnTo, type RouteAccessInput } from './routeAccess'
import { resolveFeatureVisibility, getFeatureById, getFeatureByRoute, isLifecycleVisible, isLifecycleAccessible, type EffectiveFeatureState, type FeatureLifecycleState } from '@/config/featureRegistry'

const base: RouteAccessInput = {
  route: '/insurance',
  isBootstrapping: false,
  isAuthenticated: false,
  role: null,
}

function override(featureId: string, state: FeatureLifecycleState, extra: Partial<EffectiveFeatureState> = {}): Record<string, EffectiveFeatureState> {
  // Realistic defaults mirroring the backend evaluator (visible/accessible derive
  // from the lifecycle state); individual tests override fields explicitly.
  return { [featureId]: { featureId, state, enabled: state !== 'disabled', visible: isLifecycleVisible(state), accessible: isLifecycleAccessible(state), beta: state === 'beta', ...extra } }
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

  it('beta route → render with beta notice carrying the sanitized betaMessage', () => {
    const d = evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: override('product.insurance', 'beta', { betaMessage: 'Insurance pilot' }) })
    expect(d.kind).toBe('render-beta')
    if (d.kind === 'render-beta') expect(d.message).toBe('Insurance pilot')
  })

  it('kill-switch: an override enabled:false disables DIRECT access even when state stays active', () => {
    // Mirrors the nav selector (which removes the link) so a link you cannot see
    // and a URL you type resolve the same way.
    const states = override('product.insurance', 'active', { enabled: false })
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: states }).kind).toBe('disabled')
  })

  it('P2: protected tenant/extra denial (accessible:false, role-eligible) → unavailable (disabled)', () => {
    // owner.garage requires owner; backend says not accessible for THIS user
    // (e.g. tenant deny) even though the role is eligible → unavailable.
    const states = override('owner.garage', 'active', { enabled: true, visible: false, accessible: false })
    expect(evaluateRouteAccess({ route: '/dashboard/garage', isBootstrapping: false, isAuthenticated: true, role: 'owner', effectiveStates: states }).kind).toBe('disabled')
  })

  it('P2: protected accessible:true for a role-eligible authenticated user renders', () => {
    const states = override('owner.garage', 'active', { enabled: true, visible: true, accessible: true })
    expect(evaluateRouteAccess({ route: '/dashboard/garage', isBootstrapping: false, isAuthenticated: true, role: 'owner', effectiveStates: states }).kind).toBe('render')
  })

  // ── TASK 2: effective accessibility applies to PUBLIC routes too ──────────
  it('TASK 2: PUBLIC active route with accessible:false is blocked (no longer skipped)', () => {
    // product.insurance is public (requiresAuth false); a tenant/env restriction
    // makes it not accessible → unavailable for direct access.
    const states = override('product.insurance', 'active', { enabled: true, visible: false, accessible: false })
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: states }).kind).toBe('disabled')
    // …even under the lifecycle-only (public) boundary.
    expect(evaluateRouteAccess({ ...base, route: '/insurance', enforceAuth: false, effectiveStates: states }).kind).toBe('disabled')
  })

  it('TASK 2: PUBLIC active route with enabled:false is blocked', () => {
    const states = override('product.insurance', 'active', { enabled: false })
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: states }).kind).toBe('disabled')
  })

  it('TASK 2: PUBLIC active route with accessible:true renders without login', () => {
    const states = override('product.insurance', 'active', { enabled: true, visible: true, accessible: true })
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: states }).kind).toBe('render')
  })

  it('TASK 2: PUBLIC route static fallback (no effective state) renders', () => {
    expect(evaluateRouteAccess({ ...base, route: '/insurance' }).kind).toBe('render')
  })

  it('TASK 2: navigation visibility AGREES with direct access for a PUBLIC tenant-denied route', () => {
    const feature = getFeatureById('product.insurance')!
    const states = override('product.insurance', 'active', { enabled: true, visible: false, accessible: false })
    expect(evaluateRouteAccess({ ...base, route: '/insurance', effectiveStates: states }).kind).toBe('disabled')
    const vis = resolveFeatureVisibility(feature, { isAuthenticated: false, role: null, effectiveStates: states })
    expect(vis.visible).toBe(false)
  })

  // ── P2: legacy /marketplace/* vehicle-detail sub-routes are governed by ──
  // product.marketplace (no duplicate competing active feature is introduced).
  describe('P2: legacy vehicle-detail sub-routes bind to product.marketplace', () => {
    const VIN = '/marketplace/0x1234VIN'
    const LISTING = '/marketplace/listing/abc'

    it('active Marketplace (no override / static fallback) → renders vehicle detail', () => {
      // No effectiveStates at all (pre-hydration): falls back to the owning
      // feature's STATIC lifecycle (product.marketplace is active) → render.
      expect(evaluateRouteAccess({ ...base, route: VIN }).kind).toBe('render')
      expect(evaluateRouteAccess({ ...base, route: LISTING }).kind).toBe('render')
      // …and with an explicit active override too.
      const active = override('product.marketplace', 'active', { enabled: true, visible: true, accessible: true })
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: active }).kind).toBe('render')
      expect(evaluateRouteAccess({ ...base, route: LISTING, effectiveStates: active }).kind).toBe('render')
    })

    it('Marketplace override enabled:false → unavailable (disabled) for the legacy sub-route', () => {
      const states = override('product.marketplace', 'active', { enabled: false })
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: states }).kind).toBe('disabled')
      expect(evaluateRouteAccess({ ...base, route: LISTING, effectiveStates: states }).kind).toBe('disabled')
    })

    it('Marketplace override accessible:false (tenant/env denial) → disabled', () => {
      const states = override('product.marketplace', 'active', { enabled: true, visible: false, accessible: false })
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: states }).kind).toBe('disabled')
      expect(evaluateRouteAccess({ ...base, route: LISTING, effectiveStates: states }).kind).toBe('disabled')
    })

    it('Marketplace lifecycle planned/disabled propagates to the legacy sub-route', () => {
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: override('product.marketplace', 'planned') }).kind).toBe('planned')
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: override('product.marketplace', 'disabled') }).kind).toBe('disabled')
    })

    it('static fallback when effectiveStates is undefined → render (Marketplace is active)', () => {
      expect(evaluateRouteAccess({ ...base, route: VIN, effectiveStates: undefined }).kind).toBe('render')
    })

    it('direct-refresh shape (same evaluateRouteAccess call, lifecycle-only boundary) → render', () => {
      // A direct URL refresh hits the very same evaluator; under the public
      // (enforceAuth:false) boundary an active Marketplace still renders.
      expect(evaluateRouteAccess({ ...base, route: VIN, enforceAuth: false }).kind).toBe('render')
      // …and a disabled Marketplace still blocks on direct refresh.
      const states = override('product.marketplace', 'active', { enabled: false })
      expect(evaluateRouteAccess({ ...base, route: VIN, enforceAuth: false, effectiveStates: states }).kind).toBe('disabled')
    })

    it('VIN/param value is preserved deterministically (different ids, same Marketplace gate)', () => {
      const states = override('product.marketplace', 'active', { enabled: false })
      for (const r of ['/marketplace/JH4KA8260MC000000', '/marketplace/42', '/marketplace/listing/xyz-789']) {
        expect(evaluateRouteAccess({ ...base, route: r, effectiveStates: states }).kind).toBe('disabled')
      }
    })

    it('an unrelated dynamic route (/dashboard/garage/:id) is NOT bound to product.marketplace', () => {
      // It keeps its OWN registered protected behavior: no user → login (auth),
      // and a Marketplace disable override does NOT affect it.
      const mkDisabled = override('product.marketplace', 'disabled')
      const d = evaluateRouteAccess({ ...base, route: '/dashboard/garage/42', effectiveStates: mkDisabled })
      expect(d.kind).toBe('redirect')
      if (d.kind === 'redirect') expect(d.reason).toBe('auth')
      // correct role + a denial on its OWN feature → disabled (its own governance).
      const ownGarageDenied = override('owner.garage-detail', 'active', { enabled: true, visible: false, accessible: false })
      expect(evaluateRouteAccess({ route: '/dashboard/garage/42', isBootstrapping: false, isAuthenticated: true, role: 'owner', effectiveStates: ownGarageDenied }).kind).toBe('disabled')
    })

    it('STRUCTURAL: registered marketplace siblings still resolve to their OWN features (not the legacy fallback)', () => {
      // /marketplace/parts and /marketplace/services are first-class registered
      // features; getFeatureByRoute resolves them directly, so they never fall
      // through to the legacy product.marketplace binding.
      expect(getFeatureByRoute('/marketplace/parts')?.id).toBe('product.marketplace-parts')
      expect(getFeatureByRoute('/marketplace/services')?.id).toBe('product.marketplace-services')
      // A Marketplace disable override must NOT cascade onto the sibling features
      // (they have independent effective states).
      const mkDisabled = override('product.marketplace', 'disabled')
      expect(evaluateRouteAccess({ ...base, route: '/marketplace/parts', effectiveStates: mkDisabled }).kind).toBe('render')
      expect(evaluateRouteAccess({ ...base, route: '/marketplace/services', effectiveStates: mkDisabled }).kind).toBe('render')
      // …whereas disabling the parts feature itself does block it.
      expect(evaluateRouteAccess({ ...base, route: '/marketplace/parts', effectiveStates: override('product.marketplace-parts', 'disabled') }).kind).toBe('disabled')
    })
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
