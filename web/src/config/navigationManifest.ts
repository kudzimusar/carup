/**
 * CarUp Navigation Manifest — registry-backed navigation placement model.
 *
 * Desktop mega-menus, the footer, and the mobile drawer are driven by this
 * single typed manifest instead of hardcoded arrays inside Navbar/Footer. Each
 * NavigationNode is either:
 *   • feature-linked  (references a FEATURE_REGISTRY id; inherits route/auth), or
 *   • a standalone governed link (its own route + lifecycle).
 *
 * WHY a separate manifest (not FEATURE_REGISTRY entries)? Many mega-menu items
 * share a single route (e.g. dozens of Buy links resolve to /marketplace). The
 * registry enforces "no duplicate active route", so deep-links live here as
 * placements rather than as fake features.
 *
 * TRUTHFULNESS: lifecycle states are honest. Body-type links (SUVs, Sedans…)
 * have NO marketplace taxonomy, so they are `planned` — never rendered as a
 * working filter. Governed-trust links (passport_verified, partsentry_checked,
 * brand_new, second_hand) are coverage-gated against REAL eligibility, never
 * activated by heuristics.
 */
import type { UserRole } from '@shared/types'
import {
  type NavigationSurface,
  type NavigationContext,
  type FeatureLifecycleState,
  type LucideIconName,
  getFeatureById,
  getStaticLifecycle,
  getDashboardRoute,
  getFeaturesByPlacement,
  getAllRoles,
  getRoleMetadata,
  resolveFeatureVisibility,
  getDashboardItems,
} from './featureRegistry'

// ── Node model ──────────────────────────────────────────────────────────────
export interface NavigationNode {
  /** Stable id (e.g. 'buy.toyota'). */
  id: string
  surface: NavigationSurface
  /** Section title within a mega-menu / footer column. */
  section?: string
  sectionOrder?: number
  order: number
  label: string
  /** Link to a registry feature (inherits route / auth / lifecycle / roles). */
  featureId?: string
  /** Explicit route when not feature-linked. */
  route?: string
  /** Destination when authenticated (overrides route). */
  authDestination?: string
  /** Destination for guests (overrides route). */
  guestDestination?: string
  /** Static query params appended to the resolved route. */
  query?: Record<string, string>
  /** Coverage-gated category slug: activates ?category=slug only when live coverage marks it active. */
  coverageCategory?: string
  /** Coverage-gated trust-tag slug: activates ?tag=slug only when live coverage marks it active. */
  coverageTag?: string
  icon?: LucideIconName
  description?: string
  badge?: string
  external?: boolean
  /** Node-level lifecycle (overrides the linked feature's lifecycle for this placement). */
  lifecycle?: FeatureLifecycleState
  /** When authenticated, restrict this node to these roles (guests still see it via guestDestination). */
  roles?: UserRole[]
  /** Node requires authentication to be visible at all (default: publicly visible). */
  requiresAuth?: boolean
  /** Marks governed-trust items that must never be heuristically activated. */
  governedTrust?: boolean
}

/** Plan-compatible alias. */
export type FeatureNavigationPlacement = NavigationNode

// ── Resolved (rendering) shapes ─────────────────────────────────────────────
export interface ResolvedNavItem {
  id: string
  label: string
  href: string
  icon?: LucideIconName
  description?: string
  badge?: string
  external: boolean
  state: FeatureLifecycleState
  /** A live, navigable link (active or beta). Planned items are not active. */
  active: boolean
  beta: boolean
  governedTrust: boolean
}

export interface ResolvedNavSection {
  title: string
  order: number
  items: ResolvedNavItem[]
}

// ── The manifest ────────────────────────────────────────────────────────────
const REGISTER = '/register'

export const NAVIGATION_MANIFEST: NavigationNode[] = [
  // ═══ BUY ════════════════════════════════════════════════════════════════
  // Vehicles
  { id: 'buy.shop-all', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 1, label: 'Shop All Cars', route: '/marketplace', icon: 'ShoppingCart', description: 'Browse every eligible listing' },
  { id: 'buy.brand-new', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 2, label: 'Brand New Cars', route: '/marketplace', coverageCategory: 'brand_new', governedTrust: true, description: 'Coverage-gated: shown only when real brand-new inventory exists' },
  { id: 'buy.recently-imported', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 3, label: 'Recently Imported', route: '/marketplace', coverageCategory: 'recently_imported', description: 'Coverage-gated import inventory' },
  { id: 'buy.locally-used', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 4, label: 'Locally Used', route: '/marketplace', coverageCategory: 'locally_used', description: 'Coverage-gated locally-used inventory' },
  { id: 'buy.second-hand', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 5, label: 'Second Hand Cars', route: '/marketplace', coverageCategory: 'second_hand', governedTrust: true, description: 'Coverage-gated second-hand inventory' },
  { id: 'buy.dealer-verified', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 6, label: 'Dealer Verified Cars', route: '/marketplace', coverageTag: 'dealer_verified', governedTrust: true, description: 'Filtered by real dealer-verification signal' },
  { id: 'buy.passport-verified', surface: 'navbar-mega-buy', section: 'Vehicles', sectionOrder: 1, order: 7, label: 'Passport Verified Cars', route: '/marketplace', coverageTag: 'passport_verified', governedTrust: true, description: 'Filtered by real Vehicle Passport evidence' },
  // Popular Categories
  { id: 'buy.suvs', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 1, label: 'SUVs', route: '/marketplace', lifecycle: 'planned', description: 'Body-type filter not yet supported by the marketplace taxonomy' },
  { id: 'buy.pickups', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 2, label: 'Pickups', route: '/marketplace', lifecycle: 'planned', description: 'Body-type filter not yet supported' },
  { id: 'buy.hatchbacks', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 3, label: 'Hatchbacks', route: '/marketplace', lifecycle: 'planned', description: 'Body-type filter not yet supported' },
  { id: 'buy.sedans', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 4, label: 'Sedans', route: '/marketplace', lifecycle: 'planned', description: 'Body-type filter not yet supported' },
  { id: 'buy.toyota', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 5, label: 'Toyota', route: '/marketplace', query: { make: 'Toyota' }, description: 'Real make deep-link' },
  { id: 'buy.honda', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 6, label: 'Honda', route: '/marketplace', query: { make: 'Honda' } },
  { id: 'buy.mazda', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 7, label: 'Mazda', route: '/marketplace', query: { make: 'Mazda' } },
  { id: 'buy.under-5k', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 8, label: 'Under $5,000', route: '/marketplace', query: { maxPrice: '5000' } },
  { id: 'buy.under-10k', surface: 'navbar-mega-buy', section: 'Popular Categories', sectionOrder: 2, order: 9, label: 'Under $10,000', route: '/marketplace', query: { maxPrice: '10000' } },
  // Buyer Tools
  { id: 'buy.verify-before', surface: 'navbar-mega-buy', section: 'Buyer Tools', sectionOrder: 3, order: 1, label: 'Verify Before You Buy', route: '/search', icon: 'Shield' },
  { id: 'buy.view-passport', surface: 'navbar-mega-buy', section: 'Buyer Tools', sectionOrder: 3, order: 2, label: 'View Vehicle Passport', route: '/search', icon: 'FileText' },
  { id: 'buy.highest-trust', surface: 'navbar-mega-buy', section: 'Buyer Tools', sectionOrder: 3, order: 3, label: 'Highest Trust Listings', route: '/marketplace', query: { sort: 'trust' } },
  { id: 'buy.partsentry-checked', surface: 'navbar-mega-buy', section: 'Buyer Tools', sectionOrder: 3, order: 4, label: 'PartSentry Checked Vehicles', route: '/marketplace', coverageTag: 'partsentry_checked', governedTrust: true, description: 'Filtered by real PartSentry checks' },
  // Trust Guide
  { id: 'buy.guide-conditions', surface: 'navbar-mega-buy', section: 'Trust Guide', sectionOrder: 4, order: 1, label: 'Brand New vs Imported vs Locally Used', route: '/marketplace', description: 'Buyer education' },
  { id: 'buy.guide-passport', surface: 'navbar-mega-buy', section: 'Trust Guide', sectionOrder: 4, order: 2, label: 'How to check a vehicle Passport before paying', route: '/search', description: 'Buyer education' },

  // ═══ SELL ═══════════════════════════════════════════════════════════════
  // Sell Vehicles
  { id: 'sell.your-car', surface: 'navbar-mega-sell', section: 'Sell Vehicles', sectionOrder: 1, order: 1, label: 'Sell Your Car', authDestination: '/dashboard/sell-vehicle', guestDestination: REGISTER, icon: 'Car' },
  { id: 'sell.create-passport', surface: 'navbar-mega-sell', section: 'Sell Vehicles', sectionOrder: 1, order: 2, label: 'Create Vehicle Passport', authDestination: '/dashboard/garage', guestDestination: REGISTER },
  { id: 'sell.dealer-listing', surface: 'navbar-mega-sell', section: 'Sell Vehicles', sectionOrder: 1, order: 3, label: 'Dealer Listing', authDestination: '/dealer/inventory', guestDestination: REGISTER, roles: ['dealer'], description: 'Dealer inventory (dealers only when signed in)' },
  { id: 'sell.private-owner', surface: 'navbar-mega-sell', section: 'Sell Vehicles', sectionOrder: 1, order: 4, label: 'Sell as Private Owner', authDestination: '/dashboard/sell-vehicle', guestDestination: REGISTER },
  // Seller Tools
  { id: 'sell.start-plate-vin', surface: 'navbar-mega-sell', section: 'Seller Tools', sectionOrder: 2, order: 1, label: 'Start with Plate / VIN', authDestination: '/dashboard/sell-vehicle', guestDestination: REGISTER },
  { id: 'sell.upload-evidence', surface: 'navbar-mega-sell', section: 'Seller Tools', sectionOrder: 2, order: 2, label: 'Upload Vehicle Evidence', authDestination: '/dashboard/garage', guestDestination: REGISTER },
  { id: 'sell.service-history', surface: 'navbar-mega-sell', section: 'Seller Tools', sectionOrder: 2, order: 3, label: 'Add Service History', authDestination: '/dashboard/service-history', guestDestination: REGISTER },
  { id: 'sell.safepay-ready', surface: 'navbar-mega-sell', section: 'Seller Tools', sectionOrder: 2, order: 4, label: 'SafePay / Reservation Ready', authDestination: '/dashboard/listings', guestDestination: REGISTER },
  // Sell Parts & Accessories
  { id: 'sell.car-parts', surface: 'navbar-mega-sell', section: 'Sell Parts & Accessories', sectionOrder: 3, order: 1, label: 'Sell Car Parts', route: REGISTER, lifecycle: 'planned', description: 'Dedicated parts-selling flow not yet available' },
  { id: 'sell.accessories', surface: 'navbar-mega-sell', section: 'Sell Parts & Accessories', sectionOrder: 3, order: 2, label: 'Sell Accessories', route: REGISTER, lifecycle: 'planned', description: 'Dedicated accessory-selling flow not yet available' },
  { id: 'sell.garage-parts', surface: 'navbar-mega-sell', section: 'Sell Parts & Accessories', sectionOrder: 3, order: 3, label: 'Mechanic / Garage Parts Listing', route: '/garages', description: 'Garage & mechanic directory' },
  // Seller Guide
  { id: 'sell.guide-passport', surface: 'navbar-mega-sell', section: 'Seller Guide', sectionOrder: 4, order: 1, label: 'How to sell with a verified Passport', authDestination: '/dashboard/garage', guestDestination: REGISTER, description: 'Seller education' },
  { id: 'sell.guide-partsentry', surface: 'navbar-mega-sell', section: 'Seller Guide', sectionOrder: 4, order: 2, label: 'How PartSentry protects honest sellers', route: '/search', description: 'Seller education' },

  // ═══ VERIFY ═════════════════════════════════════════════════════════════
  { id: 'verify.plate', surface: 'navbar-mega-verify', section: 'Vehicle Verification', sectionOrder: 1, order: 1, label: 'Verify by Plate', route: '/search', icon: 'Search', description: 'Opens the unified vehicle search' },
  { id: 'verify.vin', surface: 'navbar-mega-verify', section: 'Vehicle Verification', sectionOrder: 1, order: 2, label: 'Verify by VIN', route: '/search', icon: 'Search', description: 'Opens the unified vehicle search' },
  { id: 'verify.chassis', surface: 'navbar-mega-verify', section: 'Vehicle Verification', sectionOrder: 1, order: 3, label: 'Verify by Chassis', route: '/search', icon: 'Search', description: 'Opens the unified vehicle search' },
  { id: 'verify.passport', surface: 'navbar-mega-verify', section: 'Vehicle Verification', sectionOrder: 1, order: 4, label: 'Open Vehicle Passport', route: '/search', icon: 'FileText' },
  { id: 'verify.ownership-privacy', surface: 'navbar-mega-verify', section: 'Trust Checks', sectionOrder: 2, order: 1, label: 'Ownership Privacy Summary', route: '/search' },
  { id: 'verify.evidence-timeline', surface: 'navbar-mega-verify', section: 'Trust Checks', sectionOrder: 2, order: 2, label: 'Evidence Timeline', authDestination: '/dashboard/garage', guestDestination: '/search' },
  { id: 'verify.duty', surface: 'navbar-mega-verify', section: 'Trust Checks', sectionOrder: 2, order: 3, label: 'ZIMRA / Duty Signals', route: '/search', description: 'Surfaced inside vehicle search results' },
  { id: 'verify.theft', surface: 'navbar-mega-verify', section: 'Trust Checks', sectionOrder: 2, order: 4, label: 'CID / Theft Signals', route: '/search', description: 'Surfaced inside vehicle search results' },
  { id: 'verify.odometer', surface: 'navbar-mega-verify', section: 'Trust Checks', sectionOrder: 2, order: 5, label: 'Odometer / Mileage Signals', route: '/search', description: 'Surfaced inside vehicle search results' },
  { id: 'verify.ps-history', surface: 'navbar-mega-verify', section: 'PartSentry Verification', sectionOrder: 3, order: 1, label: 'Check Part History', route: '/search' },
  { id: 'verify.ps-repair', surface: 'navbar-mega-verify', section: 'PartSentry Verification', sectionOrder: 3, order: 2, label: 'Check Repair Logs', route: '/search' },
  { id: 'verify.ps-swapped', surface: 'navbar-mega-verify', section: 'PartSentry Verification', sectionOrder: 3, order: 3, label: 'Check Swapped Parts', route: '/search' },
  { id: 'verify.ps-stolen', surface: 'navbar-mega-verify', section: 'PartSentry Verification', sectionOrder: 3, order: 4, label: 'Check Stolen/Suspicious Parts', route: '/search' },

  // ═══ PARTS ══════════════════════════════════════════════════════════════
  { id: 'parts.browse', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 1, label: 'Browse Car Parts', route: '/marketplace/parts', icon: 'Package' },
  { id: 'parts.verified', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 2, label: 'Verified Parts', route: '/marketplace/parts', description: 'Verified-parts filter pending parts data contract', lifecycle: 'planned' },
  { id: 'parts.engines', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 3, label: 'Engines', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.gearboxes', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 4, label: 'Gearboxes', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.ecus', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 5, label: 'ECUs', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.body-panels', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 6, label: 'Body Panels', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.lights', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 7, label: 'Lights', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.tyres', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 8, label: 'Tyres & Wheels', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.batteries', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 9, label: 'Batteries', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.accessories', surface: 'navbar-mega-parts', section: 'Buy Parts', sectionOrder: 1, order: 10, label: 'Accessories', route: '/marketplace/parts', lifecycle: 'planned', description: 'Parts-category filter not yet supported' },
  { id: 'parts.sell-part', surface: 'navbar-mega-parts', section: 'Sell Parts', sectionOrder: 2, order: 1, label: 'Sell a Part', route: REGISTER, lifecycle: 'planned', description: 'Dedicated parts-selling flow not yet available' },
  { id: 'parts.list-accessories', surface: 'navbar-mega-parts', section: 'Sell Parts', sectionOrder: 2, order: 2, label: 'List Accessories', route: REGISTER, lifecycle: 'planned', description: 'Dedicated accessory-selling flow not yet available' },
  { id: 'parts.garage-inventory', surface: 'navbar-mega-parts', section: 'Sell Parts', sectionOrder: 2, order: 3, label: 'Garage Parts Inventory', route: '/garages', description: 'Garage directory' },
  { id: 'parts.mechanic-catalog', surface: 'navbar-mega-parts', section: 'Sell Parts', sectionOrder: 2, order: 4, label: 'Mechanic Parts Catalog', route: '/marketplace/parts' },
  { id: 'parts.ps-origin', surface: 'navbar-mega-parts', section: 'PartSentry', sectionOrder: 3, order: 1, label: 'Verify Part Origin', route: '/search' },
  { id: 'parts.ps-repair', surface: 'navbar-mega-parts', section: 'PartSentry', sectionOrder: 3, order: 2, label: 'Check Repair History', route: '/search' },
  { id: 'parts.ps-report-stolen', surface: 'navbar-mega-parts', section: 'PartSentry', sectionOrder: 3, order: 3, label: 'Report Stolen Part', route: '/search' },
  { id: 'parts.ps-link-passport', surface: 'navbar-mega-parts', section: 'PartSentry', sectionOrder: 3, order: 4, label: 'Link Part to Vehicle Passport', route: '/search' },
  { id: 'parts.mechanic-work-orders', surface: 'navbar-mega-parts', section: 'PartSentry', sectionOrder: 3, order: 5, label: 'Mechanic Work Orders', authDestination: '/mechanic/work-orders', guestDestination: REGISTER, roles: ['mechanic'] },
  { id: 'parts.guide-buyers', surface: 'navbar-mega-parts', section: 'Parts Trust Guide', sectionOrder: 4, order: 1, label: 'How PartSentry protects parts buyers', route: '/search', description: 'Parts education' },
  { id: 'parts.guide-verified', surface: 'navbar-mega-parts', section: 'Parts Trust Guide', sectionOrder: 4, order: 2, label: 'Why verified parts matter for used cars', route: '/marketplace', description: 'Parts education' },

  // ═══ MORE / SERVICES ════════════════════════════════════════════════════
  { id: 'more.insurance', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 1, label: 'Insurance', featureId: 'product.insurance', icon: 'Shield' },
  { id: 'more.pricing', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 2, label: 'Pricing', featureId: 'product.pricing', icon: 'DollarSign' },
  { id: 'more.diaspora', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 3, label: 'Diaspora Trade', featureId: 'product.diaspora', icon: 'Globe' },
  { id: 'more.how-it-works', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 4, label: 'How It Works', route: '/', icon: 'Info' },
  { id: 'more.trust', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 5, label: 'Trust & Safety', featureId: 'resources.trust', icon: 'Shield' },
  { id: 'more.help', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 6, label: 'Help', featureId: 'resources.help', icon: 'HelpCircle' },
  { id: 'more.contact', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 7, label: 'Contact', featureId: 'company.contact', icon: 'Phone' },
  { id: 'more.blog', surface: 'navbar-more', section: 'More', sectionOrder: 1, order: 8, label: 'Blog', featureId: 'company.blog', icon: 'Newspaper' },

  // ═══ MOBILE PRIMARY (public quick links) ════════════════════════════════
  { id: 'mobile.buy', surface: 'mobile-primary', order: 1, label: 'Buy', route: '/marketplace', icon: 'ShoppingCart' },
  { id: 'mobile.sell', surface: 'mobile-primary', order: 2, label: 'Sell', authDestination: '/dashboard/sell-vehicle', guestDestination: REGISTER, icon: 'Car' },
  { id: 'mobile.verify', surface: 'mobile-primary', order: 3, label: 'Verify', route: '/search', icon: 'Shield' },
  { id: 'mobile.parts', surface: 'mobile-primary', order: 4, label: 'Parts', route: '/marketplace/parts', icon: 'Package' },
  { id: 'mobile.dealers', surface: 'mobile-primary', order: 5, label: 'Dealers', featureId: 'product.dealers', icon: 'Building2' },
  { id: 'mobile.garages', surface: 'mobile-primary', order: 6, label: 'Garages & Services', route: '/marketplace/services', icon: 'Wrench' },
]

// ── Selectors ───────────────────────────────────────────────────────────────

/** Resolve the base destination for a node, honouring auth/role-aware destinations. */
function resolveBaseRoute(node: NavigationNode, ctx: NavigationContext): string {
  if (node.authDestination || node.guestDestination) {
    if (ctx.isAuthenticated) {
      // Authenticated but role-restricted node: only matching roles get the auth destination.
      if (node.roles && ctx.role && !node.roles.includes(ctx.role)) {
        return ctx.role ? getDashboardRoute(ctx.role) : node.guestDestination ?? '/'
      }
      return node.authDestination ?? node.guestDestination ?? '/'
    }
    return node.guestDestination ?? node.authDestination ?? '/'
  }
  if (node.route) return node.route
  if (node.featureId) return getFeatureById(node.featureId)?.route ?? '/'
  return '/'
}

/**
 * Build the final href for a navigation node. Pure & deterministic. Coverage-
 * gated nodes only emit their filter query when live coverage marks the slug
 * active; otherwise they defer to the un-filtered base route (graceful defer).
 */
export function buildFeatureHref(node: NavigationNode, ctx: NavigationContext = {}): string {
  let base = resolveBaseRoute(node, ctx)
  const params = new URLSearchParams()

  // Coverage gating — category condition.
  if (node.coverageCategory) {
    if (ctx.coverage?.categories?.[node.coverageCategory]?.active) {
      base = '/marketplace'
      params.set('category', node.coverageCategory)
    } else {
      return base // deferred, no misleading filter
    }
  }
  // Coverage gating — trust tag.
  if (node.coverageTag) {
    if (ctx.coverage?.tags?.[node.coverageTag]?.active) {
      base = '/marketplace'
      params.set('tag', node.coverageTag)
    } else {
      return base
    }
  }
  // Static query params.
  if (node.query) {
    for (const [k, v] of Object.entries(node.query)) params.set(k, v)
  }

  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** Effective lifecycle for a node, overlaying runtime override on the linked feature. */
function resolveNodeState(node: NavigationNode, ctx: NavigationContext): FeatureLifecycleState {
  if (node.featureId) {
    const override = ctx.effectiveStates?.[node.featureId]
    if (override) return override.state
    const feature = getFeatureById(node.featureId)
    if (node.lifecycle) return node.lifecycle
    if (feature) return getStaticLifecycle(feature)
  }
  return node.lifecycle ?? 'active'
}

/**
 * A feature-linked node must NOT render when the sanitized backend effective
 * state for it is not enabled or not visible (a kill-switch, or a tenant/role
 * restriction that the lifecycle state alone does not express). Standalone
 * (non-feature) deep-links carry no backend effective state, so they fall
 * through to lifecycle handling. This is the single shared rule consumed by all
 * manifest surfaces.
 */
export function isNodeBackendBlocked(node: NavigationNode, ctx: NavigationContext): boolean {
  if (!node.featureId) return false
  const eff = ctx.effectiveStates?.[node.featureId]
  if (!eff) return false
  return eff.enabled === false || eff.visible === false
}

/** Whether a node is eligible to be shown for the given context (role/auth aware). */
function isNodeEligible(node: NavigationNode, ctx: NavigationContext): boolean {
  if (node.requiresAuth && !ctx.isAuthenticated) return false
  // Role restriction only constrains the AUTHENTICATED view; guests still see
  // the node (it routes them to a guest destination such as /register).
  if (ctx.isAuthenticated && node.roles && node.roles.length > 0) {
    return !!ctx.role && node.roles.includes(ctx.role)
  }
  return true
}

function resolveNavItem(node: NavigationNode, ctx: NavigationContext): ResolvedNavItem {
  const state = resolveNodeState(node, ctx)
  const active = state === 'active' || state === 'beta'
  return {
    id: node.id,
    label: node.label,
    href: buildFeatureHref(node, ctx),
    icon: node.icon,
    description: node.description,
    badge: node.badge,
    external: !!node.external,
    state,
    active,
    beta: state === 'beta',
    governedTrust: !!node.governedTrust,
  }
}

/**
 * Get a desktop mega-menu (or any sectioned surface) resolved for a context.
 * Hidden / disabled / deprecated nodes are excluded entirely; planned nodes are
 * returned with `active: false` so the menu still renders them truthfully
 * (e.g. as a muted "Soon" entry) rather than as a working link.
 */
export function getDesktopMegaMenu(surface: NavigationSurface, ctx: NavigationContext = {}): ResolvedNavSection[] {
  const nodes = NAVIGATION_MANIFEST
    .filter(n => n.surface === surface)
    .filter(n => isNodeEligible(n, ctx))

  const sections = new Map<string, ResolvedNavSection>()
  for (const node of nodes) {
    const state = resolveNodeState(node, ctx)
    if (state === 'hidden' || state === 'disabled' || state === 'deprecated') continue
    // Honor the backend effective state (enabled/visible) for feature-linked
    // nodes — covers Buy/Sell/Verify/Parts/More + (via flattenSurface) the mobile
    // primary/secondary surfaces. Footer + mobile role items already resolve
    // through resolveFeatureVisibility, which applies the same rule.
    if (isNodeBackendBlocked(node, ctx)) continue
    const title = node.section ?? 'More'
    if (!sections.has(title)) {
      sections.set(title, { title, order: node.sectionOrder ?? 999, items: [] })
    }
    sections.get(title)!.items.push(resolveNavItem(node, ctx))
  }

  return Array.from(sections.values())
    .map(s => ({ ...s, items: s.items.sort((a, b) => orderOf(a.id) - orderOf(b.id)) }))
    .sort((a, b) => a.order - b.order)
}

const ORDER_INDEX: Record<string, number> = Object.fromEntries(
  NAVIGATION_MANIFEST.map(n => [n.id, (n.sectionOrder ?? 0) * 1000 + n.order]),
)
function orderOf(id: string): number {
  return ORDER_INDEX[id] ?? 0
}

/** List section titles for a surface (deterministic order). */
export function getNavigationSections(surface: NavigationSurface, ctx: NavigationContext = {}): string[] {
  return getDesktopMegaMenu(surface, ctx).map(s => s.title)
}

/** Resolved items for a single section of a surface. */
export function getNavigationItems(surface: NavigationSurface, section: string, ctx: NavigationContext = {}): ResolvedNavItem[] {
  const found = getDesktopMegaMenu(surface, ctx).find(s => s.title === section)
  return found ? found.items : []
}

/** All manifest nodes that reference a given feature id (any surface). */
export function getNavigationPlacements(featureId: string): NavigationNode[] {
  return NAVIGATION_MANIFEST.filter(n => n.featureId === featureId)
}

/** All distinct surfaces present in the manifest. */
export function getManifestSurfaces(): NavigationSurface[] {
  return Array.from(new Set(NAVIGATION_MANIFEST.map(n => n.surface)))
}

// ── Footer navigation (Milestone 3) ─────────────────────────────────────────

export type FooterColumn = 'product' | 'company' | 'resources' | 'legal' | 'stakeholders'

/** Footer features whose intent is legal (split into their own column). */
const LEGAL_FEATURE_IDS = new Set(['resources.privacy', 'resources.terms'])

function stakeholderLabel(title: string): string {
  switch (title) {
    case 'Car Owner': return 'Car Owners'
    case 'Dealer': return 'Dealers'
    case 'Mechanic': return 'Mechanics'
    case 'Insurance': return 'Insurance'
    case 'Government': return 'Government'
    case 'Banker': return 'Bankers'
    default: return `${title}s`
  }
}

/**
 * Resolve a governed footer column for a context. Feature-backed columns apply
 * lifecycle/visibility (hidden/disabled/planned excluded). Stakeholder links
 * exclude platform admin from public promotion and route to each role's
 * dashboard root (the route boundary safely sends unauthenticated users to
 * login). Order is explicit (registry order for features, role order for
 * stakeholders).
 */
export function getFooterNavigation(column: FooterColumn, ctx: NavigationContext = {}): ResolvedNavItem[] {
  if (column === 'stakeholders') {
    return getAllRoles()
      .filter(role => role !== 'admin')
      .map(role => ({
        id: `stakeholder.${role}`,
        label: stakeholderLabel(getRoleMetadata(role).title),
        href: getDashboardRoute(role),
        external: false,
        state: 'active' as FeatureLifecycleState,
        active: true,
        beta: false,
        governedTrust: false,
      }))
  }

  const footerFeatures = getFeaturesByPlacement('footer')
  return footerFeatures
    .filter(f => {
      const isLegal = LEGAL_FEATURE_IDS.has(f.id)
      if (column === 'legal') return isLegal
      if (isLegal) return false
      return f.id.startsWith(column + '.')
    })
    .map(f => ({ f, vis: resolveFeatureVisibility(f, ctx) }))
    // Only render lifecycle-visible items (active/beta); hidden/disabled/planned excluded.
    .filter(({ vis }) => vis.visible)
    .map(({ f, vis }) => ({
      id: f.id,
      label: f.label,
      href: f.route,
      icon: f.icon,
      external: false,
      state: vis.state,
      active: true,
      beta: vis.beta,
      governedTrust: false,
    }))
}

/**
 * Governed social links. Represented as `planned` until real approved URLs are
 * configured (set `route` + `lifecycle: 'active'`). The footer renders planned
 * social as accessible-but-disabled (aria-labelled), never as href="#".
 */
export interface SocialLink {
  id: string
  label: string
  platform: 'facebook' | 'twitter' | 'instagram' | 'linkedin'
  url?: string
  state: FeatureLifecycleState
}

export const FOOTER_SOCIAL: SocialLink[] = [
  { id: 'social.facebook', label: 'Facebook', platform: 'facebook', state: 'planned' },
  { id: 'social.twitter', label: 'X (Twitter)', platform: 'twitter', state: 'planned' },
  { id: 'social.instagram', label: 'Instagram', platform: 'instagram', state: 'planned' },
  { id: 'social.linkedin', label: 'LinkedIn', platform: 'linkedin', state: 'planned' },
]

/** Visible social links (configured/active or planned-but-shown-disabled). Hidden/disabled excluded. */
export function getFooterSocial(): SocialLink[] {
  return FOOTER_SOCIAL.filter(s => s.state !== 'hidden' && s.state !== 'disabled')
}

// ── Mobile web navigation (Milestone 4) ─────────────────────────────────────

export interface MobileNavigation {
  /** Public primary quick links (Buy/Sell/Verify/Parts/Dealers/Garages). */
  primary: ResolvedNavItem[]
  /** Public secondary "More" links (Insurance/Pricing/Diaspora/Trust/Help/Contact/Blog). */
  secondary: ResolvedNavItem[]
  /** Authenticated role-specific dashboard items (empty for guests). */
  roleItems: ResolvedNavItem[]
  /** Dashboard root for the authenticated role (undefined for guests). */
  dashboardRoot?: { label: string; href: string }
}

/** Flatten a surface to active (or optionally planned) resolved items. */
function flattenSurface(surface: NavigationSurface, ctx: NavigationContext, includePlanned = false): ResolvedNavItem[] {
  return getDesktopMegaMenu(surface, ctx)
    .flatMap(s => s.items)
    .filter(i => includePlanned ? true : i.active)
}

/**
 * Compose the mobile drawer for a context. Uses the SAME registry/manifest as
 * desktop — no separate hardcoded mobile route arrays. Role-specific items come
 * from the registry dashboard sidebar for the authenticated role, so there is
 * NO cross-role leakage and hidden/disabled/planned features never appear.
 */
export function getMobileNavigation(ctx: NavigationContext = {}): MobileNavigation {
  const primary = flattenSurface('mobile-primary', ctx)
  const secondary = flattenSurface('navbar-more', ctx)

  let roleItems: ResolvedNavItem[] = []
  let dashboardRoot: { label: string; href: string } | undefined

  if (ctx.isAuthenticated && ctx.role) {
    roleItems = getDashboardItems(ctx.role)
      .map(f => ({ f, vis: resolveFeatureVisibility(f, ctx) }))
      .filter(({ vis }) => vis.visible)
      .map(({ f, vis }) => ({
        id: f.id,
        label: f.label,
        href: f.route,
        icon: f.icon,
        external: false,
        state: vis.state,
        active: true,
        beta: vis.beta,
        governedTrust: false,
      }))
    dashboardRoot = { label: 'Dashboard', href: getDashboardRoute(ctx.role) }
  }

  return { primary, secondary, roleItems, dashboardRoot }
}
