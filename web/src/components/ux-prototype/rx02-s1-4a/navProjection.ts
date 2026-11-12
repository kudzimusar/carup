/**
 * RX-02A S1-4A — Manifest-driven navigation projection (DEV-only).
 *
 * Every navigation surface in the shell prototypes is PROJECTED FROM the
 * production authority sources — navigationManifest.ts + featureRegistry.ts —
 * never hand-written. If a feature is hidden/disabled/planned in the registry,
 * the prototype reflects it truthfully (planned items render as non-navigating
 * "Soon" entries). No manifest or registry code is modified.
 */
import {
  getDesktopMegaMenu,
  getFooterNavigation,
  getMobileNavigation,
  type ResolvedNavItem,
} from '@/config/navigationManifest'
import {
  getDashboardItems,
  resolveFeatureVisibility,
  type NavigationContext,
} from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'
import type { ShellNavItem, ShellNavSection } from './contracts'

function toShellItem(item: ResolvedNavItem): ShellNavItem {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    description: item.description,
    badge: item.badge,
    planned: !item.active,
  }
}

function toShellSections(sections: Array<{ title: string; items: ResolvedNavItem[] }>): ShellNavSection[] {
  return sections.map(s => ({ title: s.title, items: s.items.map(toShellItem) }))
}

/**
 * Desktop mega-menu for one navbar surface. The context is a FICTIONAL
 * session baseline so role-gated items resolve deterministically for chrome
 * inspection; no real access decision is implied.
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
 * a presentation-only fixture: the real gate remains server-side. Only items
 * for THIS role are projected — no cross-family leakage.
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
      planned: !(vis.state === 'active' || vis.state === 'beta'),
    })
    byDomain.set(f.domain, list)
  }
  return Array.from(byDomain.entries()).map(([title, items]) => ({ title, items }))
}
