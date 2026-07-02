import { describe, it, expect } from 'vitest'
import {
  getDashboardItems,
  resolveFeatureVisibility,
  type EffectiveFeatureState,
  type FeatureLifecycleState,
  type NavigationContext,
} from '@/config/featureRegistry'
import { evaluateRouteAccess } from '@/lib/routeAccess'

/**
 * TASK 2 — the DashboardLayout sidebar filters its items through the SHARED
 * resolveFeatureVisibility (no duplicated logic). This proves the filter
 * excludes disabled / hidden / tenant-denied / role-denied items, keeps beta,
 * and agrees with the route-boundary decision.
 */
const ctx = (effectiveStates?: Record<string, EffectiveFeatureState>): NavigationContext => ({
  isAuthenticated: true,
  role: 'owner',
  effectiveStates,
})

// Mirror of the DashboardLayout sidebar filter.
const sidebar = (role: 'owner', c: NavigationContext) =>
  getDashboardItems(role).filter((item) => resolveFeatureVisibility(item, c).visible).map((i) => i.id)

const eff = (state: FeatureLifecycleState, extra: Partial<EffectiveFeatureState> = {}): Record<string, EffectiveFeatureState> => ({
  'owner.garage': { featureId: 'owner.garage', state, enabled: state !== 'disabled', visible: false, accessible: false, beta: state === 'beta', ...extra },
})

describe('DashboardLayout sidebar effective-visibility filter (TASK 2)', () => {
  it('allowed item remains visible by default (no override)', () => {
    expect(sidebar('owner', ctx())).toContain('owner.garage')
  })

  it('disabled item is absent from the sidebar', () => {
    expect(sidebar('owner', ctx(eff('disabled', { enabled: false })))).not.toContain('owner.garage')
  })

  it('hidden item is absent from the sidebar', () => {
    expect(sidebar('owner', ctx(eff('hidden')))).not.toContain('owner.garage')
  })

  it('tenant/role-denied item (backend visible:false, still active) is absent', () => {
    expect(sidebar('owner', ctx(eff('active', { enabled: true, visible: false, accessible: false })))).not.toContain('owner.garage')
  })

  it('a kill-switch (enabled:false) item is absent even when state stays active', () => {
    expect(sidebar('owner', ctx(eff('active', { enabled: false })))).not.toContain('owner.garage')
  })

  it('beta item remains visible and is flagged beta', () => {
    const c = ctx(eff('beta', { enabled: true, visible: true, accessible: true }))
    expect(sidebar('owner', c)).toContain('owner.garage')
    const vis = resolveFeatureVisibility(getDashboardItems('owner').find((i) => i.id === 'owner.garage')!, c)
    expect(vis.beta).toBe(true)
  })

  it('reset to static default restores the item', () => {
    // no effectiveStates entry → static visible
    expect(sidebar('owner', ctx({}))).toContain('owner.garage')
  })

  it('no cross-role leakage: every sidebar item belongs to the role', () => {
    for (const id of sidebar('owner', ctx())) {
      const feature = getDashboardItems('owner').find((i) => i.id === id)!
      expect(feature.roles).toContain('owner')
    }
  })

  it('sidebar visibility AGREES with the direct-route decision for a disabled item', () => {
    const states = eff('disabled', { enabled: false })
    // Not in the sidebar
    expect(sidebar('owner', ctx(states))).not.toContain('owner.garage')
    // …and direct access is blocked
    const decision = evaluateRouteAccess({
      route: '/dashboard/garage',
      isBootstrapping: false,
      isAuthenticated: true,
      role: 'owner',
      effectiveStates: states,
    })
    expect(decision.kind).toBe('disabled')
  })
})
