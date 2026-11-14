/**
 * RX-02A S1-4B R4 — Navigation projection truth tests (R4-2 / R4-3).
 *
 *   R4-2  The dealer operations rail is governed by the canonical feature
 *         visibility / effective-state resolver: in-slice destinations are live,
 *         out-of-slice destinations are non-navigating "Soon" entries, and
 *         governance-hidden destinations are omitted.
 *   R4-3  Each feature's registry icon metadata is preserved through
 *         ShellNavItem — items keep their OWN distinct icons instead of
 *         collapsing to a single fallback.
 */
import { describe, it, expect } from 'vitest'
import {
  getDashboardItems,
  getFeatureByRoute,
  resolveFeatureVisibility,
} from '@/config/featureRegistry'
import {
  projectWorkspaceRail,
  projectDealerOperationsRail,
  DEALER_UNIFIED_SLICE,
} from './navProjection'

describe('R4-3 — registry icons preserved through the projection', () => {
  it('personal workspace rail items carry their own registry icon (never dropped to null)', () => {
    const items = projectWorkspaceRail('owner').flatMap(s => s.items)
    expect(items.length).toBeGreaterThanOrEqual(5)
    for (const item of items) {
      const feature = getFeatureByRoute(item.href)
      expect(feature, `feature for ${item.href}`).toBeDefined()
      expect(item.icon).toBe(feature!.icon)
    }
  })

  it('the projected owner rail has genuinely DISTINCT feature icons', () => {
    const items = projectWorkspaceRail('owner').flatMap(s => s.items)
    const icons = items.map(i => i.icon)
    // The registry deliberately reuses some icons; require real variety
    // (not a single collapsed fallback) and spot-check known features.
    expect(new Set(icons).size).toBeGreaterThanOrEqual(4)
    const garage = items.find(i => i.href === '/dashboard/garage')
    const history = items.find(i => i.href === '/dashboard/service-history')
    expect(garage?.icon).toBe('Car')
    expect(history?.icon).toBe('Wrench')
    expect(garage?.icon).not.toBe(history?.icon)
  })
})

describe('R4-2 — dealer operations rail governance', () => {
  it('only the approved unified slice is a live destination', () => {
    const [section] = projectDealerOperationsRail()
    for (const item of section.items) {
      if (DEALER_UNIFIED_SLICE.has(item.href)) {
        expect(item.planned).toBe(false)
      } else {
        expect(item.planned).toBe(true)
      }
    }
    const live = section.items.filter(i => !i.planned)
    expect(live.map(i => i.href)).toEqual(['/dealer/dashboard'])
  })

  it('a registry-backed destination hidden by governance is omitted entirely', () => {
    const disabled = {
      'dealer.inventory': {
        featureId: 'dealer.inventory', state: 'disabled' as const,
        enabled: false, visible: true, accessible: false, beta: false,
      },
    }
    // Sanity: with the same context the shared resolver says not visible.
    const feature = getDashboardItems('dealer').find(f => f.id === 'dealer.inventory')!
    const vis = resolveFeatureVisibility(feature, {
      isAuthenticated: true, role: 'dealer', effectiveStates: disabled,
    })
    expect(vis.visible).toBe(false)
    // The projection omits it (via the same resolver path exercised in the
    // route-shell test with an explicit operations link to /dealer/inventory).
    // Invariant under the disabled context: every projected item's backing
    // feature still resolves VISIBLE through the same resolver.
    const [section] = projectDealerOperationsRail({ effectiveStates: disabled })
    for (const item of section.items) {
      const f = getFeatureByRoute(item.href)
      if (!f) continue
      const vis = resolveFeatureVisibility(f, {
        isAuthenticated: true, role: 'dealer', effectiveStates: disabled,
      })
      expect(vis.visible).toBe(true)
    }
  })
})
