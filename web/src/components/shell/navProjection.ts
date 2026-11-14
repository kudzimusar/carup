/**
 * RX-02A S1-4B — Manifest-driven navigation projection (production-intent).
 *
 * Every navigation surface in the shells is PROJECTED FROM the production
 * authority sources — navigationManifest.ts + featureRegistry.ts — never
 * hand-written. If a feature is hidden/disabled/planned in the registry, the
 * shell reflects it truthfully (planned items render as non-navigating "Soon"
 * entries). No manifest or registry code is modified. This is presentation
 * projection only; it grants no access.
 */
import {
  getDesktopMegaMenu,
  getFooterNavigation,
  getMobileNavigation,
  type ResolvedNavItem,
} from '@/config/navigationManifest'
import {
  getDashboardItems,
  getFeatureByRoute,
  resolveFeatureVisibility,
  type NavigationContext,
} from '@/config/featureRegistry'
import { DEALER_OPERATION_LINKS } from '@/components/dealer/useDealerOperationalWorkspace'
import type { UserRole } from '@shared/types'
import type { ShellNavItem, ShellNavSection } from './contracts'

function toShellItem(item: ResolvedNavItem): ShellNavItem {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    // R4-3 — carry the registry icon through instead of dropping it.
    icon: item.icon ?? null,
    description: item.description,
    badge: item.badge,
    planned: !item.active,
  }
}

function toShellSections(sections: Array<{ title: string; items: ResolvedNavItem[] }>): ShellNavSection[] {
  return sections.map(s => ({ title: s.title, items: s.items.map(toShellItem) }))
}

/**
 * Desktop mega-menu for one navbar surface. The context is the real session
 * baseline (or an explicit caller-provided one); role-gated items resolve from
 * the shared visibility resolver. No access decision is implied.
 */
export function projectMegaMenu(
  surface: 'navbar-mega-buy' | 'navbar-mega-sell' | 'navbar-mega-verify' | 'navbar-mega-parts',
  ctx: NavigationContext = {},
): ShellNavSection[] {
  return toShellSections(getDesktopMegaMenu(surface, ctx))
}

/** Direct public header links (navbar-direct surface, e.g. Dealers/Garages). */
export function projectDirectPublicLinks(ctx: NavigationContext = {}): ShellNavItem[] {
  return getDesktopMegaMenu('navbar-direct', ctx).flatMap(s => s.items).map(toShellItem)
}

/** Projected public footer columns (product/company/resources/legal/stakeholders). */
export function projectFooterColumns(ctx: NavigationContext = {}): Array<{ column: string; items: ShellNavItem[] }> {
  const columns = ['product', 'company', 'resources', 'legal', 'stakeholders'] as const
  return columns.map(column => ({
    column,
    items: getFooterNavigation(column, ctx).map(toShellItem),
  }))
}

/** Projected mobile drawer surfaces (primary/secondary + role items when signed in). */
export function projectMobileSurfaces(ctx: NavigationContext = {}) {
  const nav = getMobileNavigation(ctx)
  return {
    primary: nav.primary.map(toShellItem),
    secondary: nav.secondary.map(toShellItem),
    roleItems: nav.roleItems.map(toShellItem),
    dashboardRoot: nav.dashboardRoot,
  }
}

/**
 * Workspace rail sections for a role — projected from the registry's
 * dashboard_sidebar placements through the shared visibility resolver, grouped
 * by feature domain.
 *
 * resolveFeatureVisibility requires an authenticated context or every item
 * resolves roleEligible:false; the session baseline below mirrors how the
 * production dashboard presents nav to a signed-in member of that role. It is
 * presentation-only: the real gate remains server-side. Only items for THIS
 * role are projected — no cross-family leakage.
 */
export function projectWorkspaceRail(
  role: UserRole,
  ctx: NavigationContext = {},
): ShellNavSection[] {
  const sessionCtx: NavigationContext = { isAuthenticated: true, role, ...ctx }
  const byDomain = new Map<string, ShellNavItem[]>()
  for (const f of getDashboardItems(role)) {
    const vis = resolveFeatureVisibility(f, sessionCtx)
    if (!vis.visible) continue
    const list = byDomain.get(f.domain) ?? []
    list.push({
      id: f.id,
      label: f.label,
      href: f.route,
      // R4-3 — preserve the feature's own icon metadata.
      icon: f.icon,
      planned: !(vis.state === 'active' || vis.state === 'beta'),
    })
    byDomain.set(f.domain, list)
  }
  return Array.from(byDomain.entries()).map(([title, items]) => ({ title, items }))
}

/**
 * R4-2 — The ONLY dealer destination that lives inside the approved unified
 * shell slice (App.tsx wraps exactly `/dealer/dashboard` for this family).
 * Every other dealer destination remains under the legacy MainLayout /
 * canonical layout chrome and must never be advertised as an active unified
 * action.
 */
export const DEALER_UNIFIED_SLICE: ReadonlySet<string> = new Set(['/dealer/dashboard'])

/**
 * R4-2 — Dealer operations rail projected through the CANONICAL feature
 * visibility / effective-state resolver (never a forced `planned: false`).
 *
 * Each static operations destination is governed:
 *  - when a registry feature backs the destination, the shared resolver decides
 *    visibility — a hidden/disabled feature is OMITTED from the rail;
 *  - a destination outside the approved unified slice renders truthfully as
 *    a non-navigating "Soon" entry (it stays reachable through the legacy
 *    chrome it actually lives in);
 *  - only an in-slice, resolver-active destination is a live navigable link.
 */
export function projectDealerOperationsRail(ctx: NavigationContext = {}): ShellNavSection[] {
  const sessionCtx: NavigationContext = { isAuthenticated: true, role: 'dealer', ...ctx }
  const items: ShellNavItem[] = []
  for (const link of DEALER_OPERATION_LINKS) {
    const feature = getFeatureByRoute(link.href)
    const vis = feature ? resolveFeatureVisibility(feature, sessionCtx) : null
    if (vis && !vis.visible) continue
    const inSlice = DEALER_UNIFIED_SLICE.has(link.href)
    const live = inSlice && (!vis || vis.state === 'active' || vis.state === 'beta')
    items.push({
      id: link.id,
      label: link.label,
      href: link.href,
      icon: feature?.icon ?? null,
      planned: !live,
    })
  }
  return [{ title: 'Operations', items }]
}
