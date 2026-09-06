import { getDashboardItems, getDashboardRoute, normalizeFrontendRole, resolveFeatureVisibility, type NavigationContext } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

/**
 * What the compact bottom bar should offer, for whoever is actually operating.
 *
 * WHY THIS EXISTS. `CompactBottomNav` carried its own `ROLE_HOME` map — a second role→home
 * inference beside `ROLE_METADATA[].dashboardRoute` in the feature registry. CarUp has now been bitten
 * seven times by one fact being decided in more than one place, so this derives every authenticated
 * destination from the registry and from `resolveFeatureVisibility` — the same resolver the sidebar,
 * the drawer and the route boundary use.
 *
 * WHY IT IS NOT `GarageBottomNav` / `MechanicBottomNav`. Those would be competing systems, and the
 * navigation lane already rejected that shape. The native app's governed tabs
 * (`docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md`) resolve from one manifest with
 * a ≤5 ceiling and a "More" surface holding the remainder; this is the web analogue of that contract,
 * not a second one.
 *
 * ROLE, NOT ROLES. A garage employee is `owner` platform-wide and `mechanic` in their garage. The bar
 * follows the role they are OPERATING as, because a bottom bar is a statement about the current task,
 * not an inventory of everything the person could ever do. Secondary destinations stay in the drawer.
 */

export type CompactDestination = {
  id: string
  label: string
  href: string
  icon: string
}

/** The ceiling the native lane holds itself to, and the reason a "More" entry always exists. */
export const COMPACT_NAV_MAX = 5

/**
 * The highest-value destinations per operating context, named by registry feature id.
 *
 * Ids only — never hardcoded routes, labels or eligibility. Whatever the registry says a feature's
 * route and label are is what the bar shows, and anything the registry hides never appears. An id
 * listed here that the actor cannot access is simply dropped, so this list expresses PRIORITY, not
 * permission.
 */
const PRIORITY_BY_ROLE: Partial<Record<UserRole, string[]>> = {
  owner: ['owner.overview', 'owner.garage', 'owner.service-requests', 'owner.communications'],
  mechanic: ['garage.workshop', 'mechanic.work-orders', 'garage.customers'],
  dealer: ['dealer.overview', 'dealer.inventory', 'dealer.leads'],
  admin: ['admin.overview'],
  insurance: ['insurance.overview'],
  government: ['government.overview'],
  bank: ['bank.overview'],
}

/**
 * Resolve the bar for an authenticated context.
 *
 * Returns at most `COMPACT_NAV_MAX - 1` destinations so the caller can always append "More" without
 * breaching the ceiling. Everything is filtered through `resolveFeatureVisibility`, so a destination
 * the person cannot reach is never offered — navigation visibility and route admission stay the same
 * decision, which is the invariant this whole area keeps failing.
 */
export function resolveCompactDestinations(ctx: NavigationContext): CompactDestination[] {
  const platformRole = normalizeFrontendRole(ctx.role)
  const tenantRole = normalizeFrontendRole(ctx.tenantRole)
  // Operating context wins: a garage employee on shift wants the workshop, not their own car.
  const operating = tenantRole ?? platformRole
  if (!ctx.isAuthenticated || !operating) return []

  const priority = PRIORITY_BY_ROLE[operating] ?? []
  // The registry entries this person can actually see, from BOTH true roles — the priority list
  // decides order, the resolver decides admission.
  const available = new Map<string, ReturnType<typeof getDashboardItems>[number]>()
  for (const role of [operating, platformRole].filter(Boolean) as UserRole[]) {
    for (const item of getDashboardItems(role)) {
      if (!available.has(item.id) && resolveFeatureVisibility(item, ctx).visible) available.set(item.id, item)
    }
  }

  const chosen: CompactDestination[] = []
  for (const id of priority) {
    const item = available.get(id)
    if (item) chosen.push({ id: item.id, label: item.label, href: item.route, icon: item.icon })
    if (chosen.length >= COMPACT_NAV_MAX - 1) break
  }

  // A context with no priority list still deserves a usable bar rather than an empty one, so fall
  // back to whatever the registry gives that role, in its own order.
  if (chosen.length === 0) {
    for (const item of available.values()) {
      chosen.push({ id: item.id, label: item.label, href: item.route, icon: item.icon })
      if (chosen.length >= COMPACT_NAV_MAX - 1) break
    }
  }
  return chosen
}

/** Where "home" is for whoever is operating — from the registry, never a second map. */
export function resolveCompactHome(ctx: NavigationContext): string {
  const operating = normalizeFrontendRole(ctx.tenantRole) ?? normalizeFrontendRole(ctx.role)
  return operating ? getDashboardRoute(operating) : '/login'
}
