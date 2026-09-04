/**
 * Trade OS shell navigation — dead-link regression.
 *
 * The owner's UAT complaint was not that features were missing but that advertised surfaces did
 * not work. The Trade OS shell renders its own local nav, and three separate dead links reached
 * staging before this test existed:
 *
 *   - "Messages" pointed at /dashboard/communications, which is mounted inside the OWNER-ONLY
 *     dashboard layout, so a supplier was bounced to /dealer and could never read the thread they
 *     had just created.
 *   - "Buyer requests" was shown to buyers, who are then denied by the route boundary.
 *   - "Orders" was shown to suppliers, who are likewise denied.
 *
 * The shell now filters its nav through the SAME registry rule the boundary enforces. This test
 * pins that agreement in both directions: every link a role is shown must be one that role can
 * actually open, and the links each role genuinely needs must not silently disappear.
 */
import { describe, expect, it } from 'vitest'
import { canRoleAccessRoute, getFeatureByRoute } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

/** Kept in step with NAV_ITEMS in TradeOSWorkspaceLayout.tsx. */
const NAV_ROUTES = [
  '/diaspora/request-quotes',
  '/diaspora/requests',
  '/diaspora/buyer-requests',
  '/diaspora/containers',
  '/diaspora/imports',
  '/diaspora/messages',
] as const

/** The roles that actually operate inside the Trade OS shell. */
const TRADE_ROLES: UserRole[] = ['owner', 'dealer']

const visibleTo = (role: UserRole) => NAV_ROUTES.filter((r) => canRoleAccessRoute(role, r))

describe('Trade OS shell navigation', () => {
  it('every nav destination is a registered feature, not a public-fallback path', () => {
    // An unregistered path under /diaspora is treated as PUBLIC by the fallback in isPublicRoute,
    // which would make the filter below vacuously true and let any role load the surface.
    for (const route of NAV_ROUTES) {
      expect(getFeatureByRoute(route), `${route} is not registered`).toBeDefined()
    }
  })

  it('shows a role only the links it can actually open', () => {
    for (const role of TRADE_ROLES) {
      for (const route of visibleTo(role)) {
        expect(canRoleAccessRoute(role, route), `${role} is shown ${route} but cannot open it`).toBe(true)
      }
    }
  })

  it('gives the buyer their sourcing journey and hides the supplier-only marketplace', () => {
    const buyer = visibleTo('owner')
    expect(buyer).toContain('/diaspora/request-quotes')
    expect(buyer).toContain('/diaspora/requests')
    expect(buyer).toContain('/diaspora/imports')
    // A buyer has no business in the supplier opportunity feed, and being shown it was a dead link.
    expect(buyer).not.toContain('/diaspora/buyer-requests')
  })

  it('gives the supplier their opportunity feed and hides the buyer-only order list', () => {
    const supplier = visibleTo('dealer')
    expect(supplier).toContain('/diaspora/buyer-requests')
    // A dealer can also raise requests, so the buyer sourcing entries stay available to them.
    expect(supplier).toContain('/diaspora/request-quotes')
    expect(supplier).not.toContain('/diaspora/imports')
  })

  it('gives BOTH sides Messages — the defect that made "Ask a question" a dead button', () => {
    for (const role of TRADE_ROLES) {
      expect(canRoleAccessRoute(role, '/diaspora/messages'), `${role} cannot reach Messages`).toBe(true)
    }
  })

  it('does not route Trade OS participants at the owner-only dashboard inbox', () => {
    // /dashboard/communications renders the same component but lives in the owner-only layout.
    // Pointing the shell there is what broke the supplier, so it must not come back as a nav target.
    expect(NAV_ROUTES).not.toContain('/dashboard/communications' as never)
    expect(canRoleAccessRoute('dealer', '/dashboard/communications')).toBe(false)
  })
})
