import {
  FEATURE_REGISTRY,
  getDashboardItemsFor,
  resolveOperatingHome,
  isFeatureRoleEligible,
  normalizeFrontendRole,
  resolveFeatureVisibility,
  type FeatureRegistryItem,
  type NavigationContext,
} from '@/config/featureRegistry'
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
 * follows the context they are OPERATING in, because a bottom bar is a statement about the current
 * task, not an inventory of everything the person could ever do. Secondary destinations stay in the
 * drawer. OC-5D: the operating context is the person's SELECTED, verified organisation when the
 * registry admits them to its workspace — never a tenant role read as a platform role (#197's F4).
 */

export type CompactDestination = {
  id: string
  /** Already the short form where the registry declares one — the bar never re-decides a name. */
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
type OperatingContext = UserRole | 'garage'

const PRIORITY_BY_ROLE: Partial<Record<OperatingContext, string[]>> = {
  owner: ['owner.overview', 'owner.garage', 'owner.service-requests', 'owner.communications'],
  // Acting for a garage (the selected organisation), whatever the platform role.
  garage: ['garage.workshop', 'garage.customers', 'garage.profile'],
  mechanic: ['mechanic.work-orders', 'mechanic.overview'],
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
const GARAGE_WORKSPACE_FEATURE = 'garage.workshop'

/** The operating context: the selected garage when the registry admits them to its workspace. */
function operatingContext(ctx: NavigationContext): OperatingContext | null {
  const platformRole = normalizeFrontendRole(ctx.role)
  if (!ctx.isAuthenticated || !platformRole) return null
  const workshop = FEATURE_REGISTRY.find((f) => f.id === GARAGE_WORKSPACE_FEATURE)
  if (workshop && ctx.activeTenant && isFeatureRoleEligible({ ...workshop, roles: [] }, { activeTenant: ctx.activeTenant })) {
    return 'garage'
  }
  return platformRole
}

export function resolveCompactDestinations(ctx: NavigationContext): CompactDestination[] {
  const platformRole = normalizeFrontendRole(ctx.role)
  // Operating context wins: a garage employee on shift wants the workshop, not their own car.
  const operating = operatingContext(ctx)
  if (!operating || !platformRole) return []

  const priority = PRIORITY_BY_ROLE[operating] ?? []
  // The registry entries this person can actually see — their platform role's and their active
  // organisation's, through the ONE eligibility rule; the priority list decides order, the resolver
  // decides admission.
  const available = new Map<string, FeatureRegistryItem>()
  for (const item of getDashboardItemsFor({ role: platformRole, activeTenant: ctx.activeTenant })) {
    if (!available.has(item.id) && resolveFeatureVisibility(item, ctx).visible) available.set(item.id, item)
  }

  const chosen: CompactDestination[] = []
  for (const id of priority) {
    const item = available.get(id)
    if (item) chosen.push({ id: item.id, label: item.shortLabel ?? item.label, href: item.route, icon: item.icon })
    if (chosen.length >= COMPACT_NAV_MAX - 1) break
  }

  // A context with no priority list still deserves a usable bar rather than an empty one, so fall
  // back to whatever the registry gives that role, in its own order.
  if (chosen.length === 0) {
    for (const item of available.values()) {
      chosen.push({ id: item.id, label: item.shortLabel ?? item.label, href: item.route, icon: item.icon })
      if (chosen.length >= COMPACT_NAV_MAX - 1) break
    }
  }
  return chosen
}

/** Where "home" is for whoever is operating — from the registry, never a second map. */
export function resolveCompactHome(ctx: NavigationContext): string {
  if (!ctx.isAuthenticated) return '/login'
  return resolveOperatingHome({ role: normalizeFrontendRole(ctx.role), activeTenant: ctx.activeTenant }) ?? '/login'
}
