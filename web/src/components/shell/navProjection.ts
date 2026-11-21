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
 * R4-2 / RX03-P2 — Dealer destinations inside the unified dealer workspace slice.
 * `/dealer/dashboard` is wrapped by its own route family; the five canonical
 * `/dealers/*` operations pages (route-authority register R017–R021, all
 * WorkspaceShell(dealer)) are routed under MainLayout, and the public-family
 * switch renders them inside the SAME server-verified dealer workspace guard
 * when opted in (see UnifiedRouteShell). Anything not listed here stays a
 * non-navigating "Soon" entry in the unified rail.
 */
export const DEALER_UNIFIED_SLICE: ReadonlySet<string> = new Set([
  '/dealer/dashboard',
  '/dealers/operating-details',
  '/dealers/staff',
  '/dealers/stock',
  '/dealers/inquiries',
  '/dealers/billing',
])

/** Governed rail item: omitted when the registry hides it; "Soon" unless active/beta. */
function governedItem(
  id: string,
  label: string,
  href: string,
  ctx: NavigationContext,
  registryRoute: string = href,
): ShellNavItem | null {
  const feature = getFeatureByRoute(registryRoute)
  const vis = feature ? resolveFeatureVisibility(feature, ctx) : null
  if (vis && !vis.visible) return null
  return {
    id,
    label,
    href,
    icon: feature?.icon ?? null,
    planned: !!vis && !(vis.state === 'active' || vis.state === 'beta'),
  }
}

/**
 * RX-06 (Owner decision, 2026-11-21) — a Trade tool that is built and that this account may open, but that
 * governance still HIDES, is listed under "Built · not yet released" — and only in a build whose fail-closed
 * release flag for it is ON (the preview). In a production build the flag is OFF (`isHidden`), so the tool
 * stays hidden until it is released. Never shown to an account the server refuses.
 */
function unreleasedItem(id: string, label: string, href: string, ctx: NavigationContext): ShellNavItem | null {
  const feature = getFeatureByRoute(href)
  if (!feature || feature.isHidden) return null
  const vis = resolveFeatureVisibility(feature, ctx)
  if (vis.visible || !vis.accessible || vis.state !== 'hidden') return null
  return { id, label, href, icon: feature.icon ?? null, planned: false }
}

/**
 * RX-06 — Trade workspace rail (register R038–R056). Every Trade capability, grouped by what a trader is
 * doing, and projected from the registry for THIS account: an importer sees imports + sourcing + account;
 * a dealer/exporter also sees selling tools; an operator sees SafeTrade operations. A tool the account
 * cannot use is omitted (never advertised); one switched off by governance or a release flag is omitted
 * or shown as planned exactly as `governedItem` decides. An open order still adds its own real
 * sub-routes (used only when the caller passes a server-confirmed order id). Presentation only: every page
 * keeps its own server checks.
 */
export function projectTradeRail(
  ctx: NavigationContext & { orderId?: string | null },
): ShellNavSection[] {
  const sessionCtx: NavigationContext = { isAuthenticated: true, ...ctx }
  const section = (title: string, items: Array<ShellNavItem | null>): ShellNavSection => ({
    title,
    items: items.filter((x): x is ShellNavItem => x !== null),
  })
  const sections: ShellNavSection[] = [
    section('Imports', [
      governedItem('imports', 'Import orders', '/diaspora/imports', sessionCtx),
      governedItem('imports-new', 'Start an import', '/diaspora/imports/new', sessionCtx),
    ]),
    section('Sourcing', [
      governedItem('rfq', 'Sourcing requests', '/diaspora/rfq', sessionCtx),
      governedItem('containers', 'Shared containers', '/diaspora/containers', sessionCtx),
    ]),
    section('Selling', [
      governedItem('stock', 'Stock', '/diaspora/stock', sessionCtx),
      governedItem('workbook-import', 'Workbook import', '/diaspora/workbook/import', sessionCtx),
      governedItem('ai-commands', 'AI command centre', '/diaspora/ai-commands', sessionCtx),
    ]),
    section('Protection', [
      governedItem('safetrade', 'SafeTrade', '/diaspora/safetrade', sessionCtx),
      governedItem('safetrade-operations', 'SafeTrade operations', '/diaspora/safetrade/operations', sessionCtx),
    ]),
    section('Account & insight', [
      governedItem('trade-profile', 'Trade profile', '/diaspora/trade-profile', sessionCtx),
      governedItem('subscription', 'Plan & entitlements', '/diaspora/subscription', sessionCtx),
      governedItem('drive', 'Drive connections', '/diaspora/drive', sessionCtx),
      governedItem('trade-graph', 'Trade graph', '/diaspora/trade-graph', sessionCtx),
    ]),
  ].filter(s => s.items.length > 0)
  const listed = new Set(sections.flatMap(s => s.items.map(i => i.href)))
  const unreleased = [
    unreleasedItem('safetrade', 'SafeTrade', '/diaspora/safetrade', sessionCtx),
    // Operator roles only (registry: admin, government); shares SafeTrade's release flag.
    unreleasedItem('safetrade-operations', 'SafeTrade operations', '/diaspora/safetrade/operations', sessionCtx),
    unreleasedItem('subscription', 'Plan & entitlements', '/diaspora/subscription', sessionCtx),
    unreleasedItem('trade-graph', 'Trade graph', '/diaspora/trade-graph', sessionCtx),
    unreleasedItem('workbook-import', 'Workbook import', '/diaspora/workbook/import', sessionCtx),
  ].filter((x): x is ShellNavItem => x !== null && !listed.has(x.href))
  if (unreleased.length) sections.push({ title: 'Built · not yet released', items: unreleased })
  const id = ctx.orderId
  if (id) {
    const base = `/diaspora/imports/${encodeURIComponent(id)}`
    const order = [
      governedItem('order', 'Order overview', base, sessionCtx, '/diaspora/imports/:id'),
      governedItem('order-documents', 'Documents', `${base}/documents`, sessionCtx, '/diaspora/imports/:id/documents'),
      governedItem('order-shipment', 'Shipment', `${base}/shipment`, sessionCtx, '/diaspora/imports/:id/shipment'),
      governedItem('order-passport', 'Order passport', `${base}/passport`, sessionCtx, '/diaspora/imports/:id/passport'),
    ].filter((x): x is ShellNavItem => x !== null)
    if (order.length) sections.push({ title: 'This order', items: order })
  }
  return sections
}

/**
 * RX03-P2 — Independent review workbench rail (register R131–R138,
 * ReviewWorkbench). Exactly the eight existing reviewer workbenches; the
 * reviewer layout's own guard decides access and every action keeps its
 * server-side reviewer session + step-up checks.
 */
export const REVIEW_WORKBENCH_LINKS: ReadonlyArray<{ id: string; label: string; href: string }> = [
  { id: 'claims', label: 'Claims', href: '/admin/dealer-claims' },
  { id: 'sources', label: 'Source reviews', href: '/admin/dealer-research-review' },
  { id: 'applications', label: 'Application evidence', href: '/admin/dealer-compliance-submissions' },
  { id: 'legal', label: 'Legal activation', href: '/admin/dealer-legal-activation' },
  { id: 'storefront', label: 'Public storefront decisions', href: '/admin/dealer-full-storefront-review' },
  { id: 'feedback', label: 'Buyer complaints', href: '/admin/dealer-buyer-feedback' },
  { id: 'vehicle-documents', label: 'Vehicle documents', href: '/admin/dealer-vehicle-evidence' },
  { id: 'lifecycle', label: 'Operating lifecycle', href: '/admin/dealer-operating-lifecycle' },
]

export function projectReviewRail(): ShellNavSection[] {
  return [{
    title: 'Dealership review',
    items: REVIEW_WORKBENCH_LINKS.map(l => ({ id: l.id, label: l.label, href: l.href, icon: null, planned: false })),
  }]
}

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

/* ── RX03-P2-R4 — purpose-grouped presentations of the SAME governed projections ──────────── */

/** Split one projected section into named groups by item id (order kept; unknown ids go last). */
function regroup(section: ShellNavSection | undefined, groups: ReadonlyArray<{ title: string; ids: ReadonlyArray<string> }>): ShellNavSection[] {
  if (!section) return []
  const used = new Set<string>()
  const out: ShellNavSection[] = []
  for (const group of groups) {
    const items = section.items.filter(item => group.ids.includes(item.id))
    items.forEach(item => used.add(item.id))
    if (items.length) out.push({ title: group.title, items })
  }
  const rest = section.items.filter(item => !used.has(item.id))
  if (rest.length) out.push({ title: 'More', items: rest })
  return out
}

/**
 * Dealer OS destinations grouped by job: day-to-day operating work first, organisation set-up
 * second. Same governed items as `projectDealerOperationsRail` (visibility, Soon states).
 */
export function projectDealerOperationsGroups(ctx: NavigationContext = {}): ShellNavSection[] {
  return regroup(projectDealerOperationsRail(ctx)[0], [
    { title: 'Operate', ids: ['dashboard', 'stock', 'inquiries'] },
    { title: 'Organisation', ids: ['operating-details', 'staff', 'billing'] },
  ])
}

/** The eight reviewer workbenches grouped by the dealer's lifecycle stage. */
export function projectReviewGroups(): ShellNavSection[] {
  return regroup(projectReviewRail()[0], [
    { title: 'Onboarding', ids: ['claims', 'sources', 'applications', 'legal'] },
    { title: 'Operating dealers', ids: ['storefront', 'feedback', 'vehicle-documents', 'lifecycle'] },
  ])
}

/**
 * Sections of ONE import order, for the order header tabs. Call it only with an order id the
 * server has just returned to this session (never with an id taken from the URL alone).
 */
export function projectTradeOrderTabs(ctx: NavigationContext & { orderId: string }): ShellNavItem[] {
  const [, orderSection] = projectTradeRail(ctx)
  if (!orderSection) return []
  return orderSection.items.map(item => (item.id === 'order' ? { ...item, label: 'Overview' } : item))
}
