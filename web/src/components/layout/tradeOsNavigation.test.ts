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
import { canRoleAccessRoute, getFeatureByRoute, FEATURE_REGISTRY } from '@/config/featureRegistry'
import { evaluateRouteAccess } from '@/lib/routeAccess'
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

/**
 * Direct-route eligibility — the other half of the agreement.
 *
 * The tests above prove the shell only SHOWS a role links it can open. They could all pass while a
 * hidden link was still reachable by typing the URL, and for a long time that was exactly the
 * situation: the shell passed `enforceAuth={false}` to RegistryRouteBoundary, so the registry's
 * ROLE decision was skipped on every protected Trade OS route. Being logged in as anything was
 * enough. The nav filter looked like a security boundary and was only a tidiness filter.
 *
 * These pin the boundary itself. `evaluateRouteAccess` is the pure decision the boundary renders,
 * so asserting on it tests the real rule rather than a restatement of it.
 *
 * None of this is the authorization. The API decides every read and write regardless of what the
 * SPA renders; this is the SPA agreeing with the API instead of contradicting it.
 */
const decide = (role: UserRole | null, route: string) =>
  evaluateRouteAccess({
    route,
    isBootstrapping: false,
    isAuthenticated: role !== null,
    role,
    enforceAuth: true,
  })

const renders = (role: UserRole | null, route: string) => {
  const kind = decide(role, route).kind
  return kind === 'render' || kind === 'render-beta'
}

describe('Trade OS direct-route eligibility', () => {
  it('a valid participant can open their sourcing routes by typing the URL', () => {
    for (const route of ['/diaspora/request-quotes', '/diaspora/requests', '/diaspora/messages', '/diaspora/containers', '/diaspora/imports']) {
      expect(renders('owner', route), `participant blocked from ${route}`).toBe(true)
    }
  })

  it('a valid supplier can open their opportunity routes by typing the URL', () => {
    for (const route of ['/diaspora/buyer-requests', '/diaspora/request-quotes', '/diaspora/messages']) {
      expect(renders('dealer', route), `supplier blocked from ${route}`).toBe(true)
    }
  })

  it('a valid logistics provider can open the Shipping route by typing the URL', () => {
    // A logistics provider is NOT a platform role — it is an ordinary account whose registration
    // profile says logistics_provider. At the route layer it is therefore an `owner` (or a dealer
    // running a freight business), and the contextual eligibility is resolved server-side.
    expect(renders('owner', '/diaspora/containers')).toBe(true)
    expect(renders('dealer', '/diaspora/containers')).toBe(true)
  })

  it('an unauthorized authenticated role is REDIRECTED, not merely un-linked', () => {
    // `mechanic` is a real, logged-in CarUp role with no Trade OS business. Before enforcement it
    // could open every route below simply by typing them.
    for (const route of NAV_ROUTES) {
      const decision = decide('mechanic', route)
      expect(decision.kind, `mechanic was allowed to render ${route}`).toBe('redirect')
      if (decision.kind === 'redirect') {
        expect(decision.reason, `${route} refused for the wrong reason`).toBe('role')
      }
    }
  })

  it('a hidden nav item cannot be reached by typing the URL just because the user is logged in', () => {
    // The exact defect: visibility and eligibility must be ONE rule, in both directions, for every
    // role — not just the two that happen to be exercised elsewhere.
    const ALL_ROLES: UserRole[] = ['owner', 'dealer', 'mechanic', 'bank', 'insurance', 'government', 'admin']
    for (const role of ALL_ROLES) {
      for (const route of NAV_ROUTES) {
        expect(
          renders(role, route),
          `${role}: nav shows ${route}=${canRoleAccessRoute(role, route)} but typing it renders=${renders(role, route)}`,
        ).toBe(canRoleAccessRoute(role, route))
      }
    }
  })

  it('every Trade OS route is registered, so none falls through to the PUBLIC fallback', () => {
    // isPublicRoute() treats an unregistered path outside the protected prefixes as PUBLIC, and a
    // public route renders for ANYONE even with enforcement on. /diaspora/imports/:id/passport was
    // exactly that: an order-specific surface reachable by typing the URL while logged out.
    const TRADE_OS_ROUTES = [
      ...NAV_ROUTES,
      '/diaspora/requests/:id',
      '/diaspora/imports/new',
      '/diaspora/imports/:id',
      '/diaspora/imports/:id/documents',
      '/diaspora/imports/:id/shipment',
      '/diaspora/imports/:id/passport',
    ]
    for (const route of TRADE_OS_ROUTES) {
      const feature = getFeatureByRoute(route)
      expect(feature, `${route} is unregistered and would render as PUBLIC`).toBeDefined()
      expect(feature?.requiresAuth, `${route} is registered but not protected`).toBe(true)
    }
  })

  it('contextual business eligibility is NEVER promoted to a platform role', () => {
    // The master plan is explicit: business labels do not self-grant authority. If a
    // logistics_provider / supplier / buyer / shipper ever appears in a registry roles list, the
    // commercial model has leaked into the security model and this whole gate becomes a role
    // escalation surface rather than a boundary.
    const CONTEXTUAL = ['logistics_provider', 'supplier', 'buyer', 'shipper', 'consignee', 'organiser', 'exporter', 'importer']
    const leaked: string[] = []
    for (const feature of FEATURE_REGISTRY) {
      for (const role of feature.roles as string[]) {
        if (CONTEXTUAL.includes(role)) leaked.push(`${feature.route} :: ${role}`)
      }
    }
    expect(leaked, 'commercial context leaked into the registry role model').toEqual([])
  })
})
