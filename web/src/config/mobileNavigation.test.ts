import { describe, it, expect } from 'vitest'
import { getMobileNavigation } from './navigationManifest'
import { getDashboardItems, getAllRoles, getDashboardRoute, getStaticLifecycle, isLifecycleVisible, type NavigationContext } from './featureRegistry'
import type { UserRole } from '@shared/types'

const GUEST: NavigationContext = { isAuthenticated: false, role: null }
const ctxFor = (role: UserRole): NavigationContext => ({ isAuthenticated: true, role })

describe('Mobile navigation (Milestone 4)', () => {
  it('public drawer exposes the six primary quick links and no role items', () => {
    const nav = getMobileNavigation(GUEST)
    expect(nav.primary.map(i => i.id)).toEqual([
      'mobile.buy', 'mobile.sell', 'mobile.verify', 'mobile.parts', 'mobile.dealers', 'mobile.garages',
    ])
    expect(nav.roleItems).toEqual([])
    expect(nav.dashboardRoot).toBeUndefined()
    // Secondary mirrors the public "More" links
    expect(nav.secondary.map(i => i.id)).toContain('more.insurance')
  })

  it('mobile Sell uses guest vs authenticated destination', () => {
    expect(getMobileNavigation(GUEST).primary.find(i => i.id === 'mobile.sell')!.href).toBe('/register')
    expect(getMobileNavigation(ctxFor('owner')).primary.find(i => i.id === 'mobile.sell')!.href).toBe('/dashboard/sell-vehicle')
  })

  describe('role matrix — items match the registry and never leak across roles', () => {
    for (const role of getAllRoles()) {
      it(`${role}: role items are the lifecycle-visible dashboard sidebar; dashboardRoot correct`, () => {
        const nav = getMobileNavigation(ctxFor(role))
        const sidebar = getDashboardItems(role)
        // Expected = dashboard items whose static lifecycle is visible (active/beta).
        const expectedIds = sidebar.filter(f => isLifecycleVisible(getStaticLifecycle(f))).map(f => f.id)
        expect(nav.roleItems.map(i => i.id)).toEqual(expectedIds)
        expect(nav.dashboardRoot?.href).toBe(getDashboardRoute(role))
        // No cross-role leakage: every role item belongs to THIS role.
        for (const item of nav.roleItems) {
          const feature = sidebar.find(f => f.id === item.id)!
          expect(feature.roles).toContain(role)
        }
        // Planned/hidden dashboard items must NOT appear in the drawer.
        const hidden = sidebar.filter(f => !isLifecycleVisible(getStaticLifecycle(f))).map(f => f.id)
        for (const id of hidden) expect(nav.roleItems.map(i => i.id)).not.toContain(id)
      })
    }

    it('owner drawer contains no dealer/mechanic/admin-only items', () => {
      const ids = getMobileNavigation(ctxFor('owner')).roleItems.map(i => i.id)
      expect(ids.some(id => id.startsWith('dealer.'))).toBe(false)
      expect(ids.some(id => id.startsWith('mechanic.'))).toBe(false)
      expect(ids.some(id => id.startsWith('admin.'))).toBe(false)
    })

    it('dealer drawer contains dealer items but not owner-only garage', () => {
      const ids = getMobileNavigation(ctxFor('dealer')).roleItems.map(i => i.id)
      expect(ids).toContain('dealer.inventory')
      expect(ids).not.toContain('owner.garage')
    })
  })

  it('hidden/disabled/planned role features are excluded from the drawer (runtime override)', () => {
    const target = getDashboardItems('owner')[1] // a real owner item
    const ctx: NavigationContext = {
      isAuthenticated: true,
      role: 'owner',
      effectiveStates: {
        [target.id]: { featureId: target.id, state: 'disabled', enabled: false, visible: false, accessible: false, beta: false },
      },
    }
    expect(getMobileNavigation(ctx).roleItems.map(i => i.id)).not.toContain(target.id)
  })
})
