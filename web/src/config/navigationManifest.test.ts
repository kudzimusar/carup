import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  NAVIGATION_MANIFEST,
  getDesktopMegaMenu,
  getNavigationSections,
  buildFeatureHref,
  getNavigationPlacements,
  getMobileNavigation,
  getFooterNavigation,
  isNodeBackendBlocked,
  resolveNodeOwnerFeatureId,
  findUnownedInternalNodes,
  type NavigationNode,
} from './navigationManifest'
import { matchRoutePattern, getFeatureById, getFeatureByRoute, type NavigationContext } from './featureRegistry'
import { evaluateRouteAccess } from '../lib/routeAccess'

const GUEST: NavigationContext = { isAuthenticated: false, role: null }
const OWNER: NavigationContext = { isAuthenticated: true, role: 'owner' }
const DEALER: NavigationContext = { isAuthenticated: true, role: 'dealer' }
const MECHANIC: NavigationContext = { isAuthenticated: true, role: 'mechanic' }

describe('Navigation manifest — desktop mega-menus (Milestone 2)', () => {
  it('every desktop mega-menu surface renders its prior sections in order', () => {
    expect(getNavigationSections('navbar-mega-buy', GUEST)).toEqual([
      'Vehicles', 'Popular Categories', 'Buyer Tools', 'Trust Guide',
    ])
    expect(getNavigationSections('navbar-mega-sell', GUEST)).toEqual([
      'Sell Vehicles', 'Seller Tools', 'Sell Parts & Accessories', 'Seller Guide',
    ])
    expect(getNavigationSections('navbar-mega-verify', GUEST)).toEqual([
      'Vehicle Verification', 'Trust Checks', 'PartSentry Verification',
    ])
    expect(getNavigationSections('navbar-mega-parts', GUEST)).toEqual([
      'Buy Parts', 'Sell Parts', 'PartSentry', 'Parts Trust Guide',
    ])
    expect(getNavigationSections('navbar-more', GUEST)).toEqual(['More'])
  })

  it('preserves declared item ordering within a section', () => {
    const vehicles = getDesktopMegaMenu('navbar-mega-buy', GUEST).find(s => s.title === 'Vehicles')!
    expect(vehicles.items.map(i => i.label)).toEqual([
      'Shop All Cars', 'Brand New Cars', 'Recently Imported', 'Locally Used',
      'Second Hand Cars', 'Dealer Verified Cars', 'Passport Verified Cars',
    ])
  })

  it('active items resolve to their intended pathname and query', () => {
    const href = (id: string, ctx: NavigationContext = GUEST) => {
      const node = NAVIGATION_MANIFEST.find(n => n.id === id)!
      return buildFeatureHref(node, ctx)
    }
    expect(href('buy.shop-all')).toBe('/marketplace')
    expect(href('buy.toyota')).toBe('/marketplace?make=Toyota')
    expect(href('buy.under-5k')).toBe('/marketplace?maxPrice=5000')
    expect(href('buy.under-10k')).toBe('/marketplace?maxPrice=10000')
    expect(href('buy.highest-trust')).toBe('/marketplace?sort=trust')
    expect(href('verify.plate')).toBe('/search')
    expect(href('parts.browse')).toBe('/marketplace/parts')
  })

  it('coverage-gated category links activate only when coverage is active, else defer', () => {
    const brandNew = NAVIGATION_MANIFEST.find(n => n.id === 'buy.brand-new')!
    // No coverage → deferred to base /marketplace (no misleading filter)
    expect(buildFeatureHref(brandNew, GUEST)).toBe('/marketplace')
    // Coverage active → real category deep-link
    const ctx: NavigationContext = { coverage: { categories: { brand_new: { active: true } } } }
    expect(buildFeatureHref(brandNew, ctx)).toBe('/marketplace?category=brand_new')
  })

  it('coverage-gated trust-tag links (governed trust) never activate by heuristics', () => {
    const passport = NAVIGATION_MANIFEST.find(n => n.id === 'buy.passport-verified')!
    expect(passport.governedTrust).toBe(true)
    // No coverage / no signal → MUST NOT emit ?tag=passport_verified
    expect(buildFeatureHref(passport, GUEST)).toBe('/marketplace')
    // Only the real coverage signal activates it
    const ctx: NavigationContext = { coverage: { tags: { passport_verified: { active: true } } } }
    expect(buildFeatureHref(passport, ctx)).toBe('/marketplace?tag=passport_verified')
  })

  it('all governed-trust nodes are coverage-gated and never carry a static activating query', () => {
    const governed = NAVIGATION_MANIFEST.filter(n => n.governedTrust)
    expect(governed.length).toBeGreaterThanOrEqual(4)
    for (const n of governed) {
      expect(buildFeatureHref(n, GUEST)).not.toMatch(/[?&](tag|category)=/)
    }
  })

  it('planned items render but are not presented as active links', () => {
    const popular = getDesktopMegaMenu('navbar-mega-buy', GUEST).find(s => s.title === 'Popular Categories')!
    const suvs = popular.items.find(i => i.id === 'buy.suvs')!
    expect(suvs.state).toBe('planned')
    expect(suvs.active).toBe(false)
    // Body-type planned items present across the menu
    const partsBuy = getDesktopMegaMenu('navbar-mega-parts', GUEST).find(s => s.title === 'Buy Parts')!
    expect(partsBuy.items.find(i => i.id === 'parts.engines')!.active).toBe(false)
  })

  it('auth-aware destinations resolve correctly for guest vs authenticated', () => {
    const sellYourCar = NAVIGATION_MANIFEST.find(n => n.id === 'sell.your-car')!
    expect(buildFeatureHref(sellYourCar, GUEST)).toBe('/register')
    expect(buildFeatureHref(sellYourCar, OWNER)).toBe('/dashboard/sell-vehicle')
  })

  it('role-restricted nodes: dealer listing visible to guests + dealers, hidden from non-dealer authed users', () => {
    const dealerItems = (ctx: NavigationContext) =>
      getDesktopMegaMenu('navbar-mega-sell', ctx)
        .flatMap(s => s.items)
        .map(i => i.id)
    expect(dealerItems(GUEST)).toContain('sell.dealer-listing') // guest sees it (→ /register)
    expect(dealerItems(DEALER)).toContain('sell.dealer-listing') // dealer sees it
    expect(dealerItems(OWNER)).not.toContain('sell.dealer-listing') // owner does NOT
    // Destinations
    const node = NAVIGATION_MANIFEST.find(n => n.id === 'sell.dealer-listing')!
    expect(buildFeatureHref(node, GUEST)).toBe('/register')
    expect(buildFeatureHref(node, DEALER)).toBe('/dealer/inventory')
    // Mechanic work orders gated to mechanics
    const mechItems = getDesktopMegaMenu('navbar-mega-parts', MECHANIC).flatMap(s => s.items).map(i => i.id)
    expect(mechItems).toContain('parts.mechanic-work-orders')
    expect(getDesktopMegaMenu('navbar-mega-parts', OWNER).flatMap(s => s.items).map(i => i.id))
      .not.toContain('parts.mechanic-work-orders')
  })

  it('hidden/disabled features (runtime override) are excluded from feature-linked menus', () => {
    const hide = (id: string): NavigationContext => ({
      effectiveStates: { [id]: { featureId: id, state: 'hidden', enabled: false, visible: false, accessible: false, beta: false } },
    })
    const ids = (ctx: NavigationContext) => getDesktopMegaMenu('navbar-more', ctx).flatMap(s => s.items).map(i => i.id)
    expect(ids({})).toContain('more.insurance')
    expect(ids(hide('product.insurance'))).not.toContain('more.insurance')
  })

  // ── TASK 1: feature-linked nodes honor the sanitized backend effective state ─
  describe('TASK 1 — backend effective state (enabled/visible) is honored on every manifest surface', () => {
    const moreIds = (ctx: NavigationContext) => getDesktopMegaMenu('navbar-more', ctx).flatMap(s => s.items).map(i => i.id)
    const mobileIds = (ctx: NavigationContext) => getMobileNavigation(ctx).secondary.map(i => i.id)
    const footerIds = (ctx: NavigationContext) => getFooterNavigation('product', ctx).map(i => i.id)
    const eff = (extra: object): NavigationContext => ({
      effectiveStates: { 'product.insurance': { featureId: 'product.insurance', state: 'active', enabled: true, visible: true, accessible: true, beta: false, ...extra } },
    })

    it('lifecycle active + enabled:false → absent', () => {
      expect(moreIds(eff({ enabled: false }))).not.toContain('more.insurance')
    })
    it('lifecycle active + visible:false → absent', () => {
      expect(moreIds(eff({ visible: false }))).not.toContain('more.insurance')
    })
    it('tenant/role-denied effective state (visible:false, accessible:false) → absent', () => {
      expect(moreIds(eff({ visible: false, accessible: false }))).not.toContain('more.insurance')
    })
    it('active + visible → present', () => {
      expect(moreIds(eff({}))).toContain('more.insurance')
    })
    it('beta + visible → present and flagged beta', () => {
      const ctx = eff({ state: 'beta', beta: true })
      const item = getDesktopMegaMenu('navbar-more', ctx).flatMap(s => s.items).find(i => i.id === 'more.insurance')!
      expect(item.beta).toBe(true)
    })
    it('reset to static default (no effective state) → present', () => {
      expect(moreIds({})).toContain('more.insurance')
    })
    it('the SAME state hides it from the More menu AND the mobile secondary AND the footer', () => {
      const ctx = eff({ enabled: false })
      expect(moreIds(ctx)).not.toContain('more.insurance')   // desktop More
      expect(mobileIds(ctx)).not.toContain('more.insurance') // mobile secondary
      expect(footerIds(ctx)).not.toContain('product.insurance') // footer
    })
    it('no regression: coverage-gated Marketplace items still defer/activate correctly', () => {
      const brandNew = NAVIGATION_MANIFEST.find(n => n.id === 'buy.brand-new')!
      // coverage gating is unaffected by backend effective state (href is pure)
      expect(buildFeatureHref(brandNew, {})).toBe('/marketplace')
      expect(buildFeatureHref(brandNew, { coverage: { categories: { brand_new: { active: true } } } })).toBe('/marketplace?category=brand_new')
      // owned by product.marketplace (not product.insurance), so disabling
      // product.insurance does NOT remove it from the Buy menu
      const buyIds = getDesktopMegaMenu('navbar-mega-buy', eff({ enabled: false })).flatMap(s => s.items).map(i => i.id)
      expect(buyIds).toContain('buy.brand-new')
    })
  })

  it('manifest has unique node ids (no duplicate placements)', () => {
    const ids = NAVIGATION_MANIFEST.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getNavigationPlacements returns feature-linked nodes', () => {
    expect(getNavigationPlacements('product.insurance').map(n => n.id)).toContain('more.insurance')
  })
})

// ── TASK 4: structural ownership gate (governance-bypass cannot return) ───────
describe('Navigation manifest — structural ownership gate (Milestone 8)', () => {
  it('every internal registered-route node carries an explicit owning featureId (no bypass)', () => {
    // The authoritative assertion: the SHIPPING manifest has zero un-owned
    // internal nodes. If this ever fails, the message names exactly what to fix.
    const violations = findUnownedInternalNodes()
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  it('the gate DETECTS a live internal link into a registered feature with no owner', () => {
    const offender: NavigationNode = {
      id: 'buy.bogus', surface: 'navbar-mega-buy', order: 99,
      label: 'Bogus', route: '/marketplace', // enters product.marketplace, no featureId
    }
    const violations = findUnownedInternalNodes([offender])
    expect(violations).toHaveLength(1)
    // failure output must include id, route, surface, expected governing feature
    expect(violations[0]).toEqual({
      id: 'buy.bogus',
      surface: 'navbar-mega-buy',
      route: '/marketplace',
      expectedFeatureId: 'product.marketplace',
    })
  })

  it('the gate detects an un-owned auth-aware node by its AUTH destination', () => {
    const offender: NavigationNode = {
      id: 'sell.bogus', surface: 'navbar-mega-sell', order: 99, label: 'Bogus',
      authDestination: '/dashboard/sell-vehicle', guestDestination: '/register',
    }
    const [v] = findUnownedInternalNodes([offender])
    expect(v.expectedFeatureId).toBe('owner.sell-vehicle')
    expect(v.route).toBe('/dashboard/sell-vehicle')
  })

  it('the gate EXEMPTS planned placeholders and external links', () => {
    const planned: NavigationNode = {
      id: 'x.planned', surface: 'navbar-mega-buy', order: 99, label: 'Soon',
      route: '/marketplace', lifecycle: 'planned',
    }
    const external: NavigationNode = {
      id: 'x.external', surface: 'navbar-more', order: 99, label: 'Docs',
      route: '/marketplace', external: true,
    }
    expect(findUnownedInternalNodes([planned, external])).toEqual([])
  })

  it('resolveNodeOwnerFeatureId: explicit featureId is authoritative; route is the fallback; external → none', () => {
    const explicit = NAVIGATION_MANIFEST.find(n => n.id === 'buy.shop-all')!
    expect(resolveNodeOwnerFeatureId(explicit)).toBe('product.marketplace')
    // un-annotated node resolves deterministically by route
    const fallback: NavigationNode = { id: 't', surface: 'navbar-mega-parts', order: 1, label: 't', route: '/marketplace/parts' }
    expect(resolveNodeOwnerFeatureId(fallback)).toBe('product.marketplace-parts')
    // external never resolves to a governed owner
    const ext: NavigationNode = { id: 't', surface: 'navbar-more', order: 1, label: 't', route: '/marketplace', external: true }
    expect(resolveNodeOwnerFeatureId(ext)).toBeUndefined()
  })

  it('the route the gate expects is the route the feature actually registers', () => {
    // sanity: the deterministic resolver agrees with the registry both ways
    for (const node of NAVIGATION_MANIFEST) {
      if (!node.featureId) continue
      const f = getFeatureById(node.featureId)
      if (!f) continue
      // a node whose own static route matches a registered feature must agree with its owner
      if (node.route && !node.coverageCategory && !node.coverageTag && !node.query) {
        const byRoute = getFeatureByRoute(node.route)
        if (byRoute) expect(node.featureId).toBe(byRoute.id)
      }
    }
  })
})

// ── TASK 5: governance regression — owned variants obey their owner ──────────
describe('Navigation manifest — owned-variant governance regression', () => {
  const ACTIVE = { state: 'active' as const, enabled: true, visible: true, accessible: true, beta: false }
  const eff = (id: string, over: object): NavigationContext => ({
    effectiveStates: { [id]: { featureId: id, ...ACTIVE, ...over } },
  })
  const menuIds = (surface: Parameters<typeof getDesktopMegaMenu>[0], ctx: NavigationContext) =>
    getDesktopMegaMenu(surface, ctx).flatMap(s => s.items).map(i => i.id)
  const mobilePrimary = (ctx: NavigationContext) => getMobileNavigation(ctx).primary.map(i => i.id)
  const footerProduct = (ctx: NavigationContext) => getFooterNavigation('product', ctx).map(i => i.id)

  const MARKETPLACE_OWNED = ['buy.shop-all', 'buy.toyota', 'buy.under-5k', 'buy.highest-trust', 'buy.brand-new', 'buy.passport-verified']

  it('1) disabling product.marketplace hides shop-all, make/price/trust-sort links, mobile Buy and the footer link', () => {
    const ctx = eff('product.marketplace', { state: 'disabled', enabled: false, visible: false, accessible: false })
    const buy = menuIds('navbar-mega-buy', ctx)
    for (const id of MARKETPLACE_OWNED) expect(buy, id).not.toContain(id)
    expect(mobilePrimary(ctx)).not.toContain('mobile.buy')
    expect(footerProduct(ctx)).not.toContain('product.marketplace')
    // a sibling owned by a different feature is unaffected
    expect(buy).toContain('buy.verify-before') // product.verify
  })

  it('2) product.marketplace visible:false (enabled stays true) hides the same entries', () => {
    const ctx = eff('product.marketplace', { visible: false })
    const buy = menuIds('navbar-mega-buy', ctx)
    for (const id of MARKETPLACE_OWNED) expect(buy, id).not.toContain(id)
    expect(mobilePrimary(ctx)).not.toContain('mobile.buy')
  })

  it('3) disabling product.marketplace-parts hides parts.browse, mobile Parts and the parts category entries', () => {
    const ctx = eff('product.marketplace-parts', { state: 'disabled', enabled: false, visible: false, accessible: false })
    const parts = menuIds('navbar-mega-parts', ctx)
    expect(parts).not.toContain('parts.browse')
    expect(parts).not.toContain('parts.mechanic-catalog')
    expect(parts).not.toContain('parts.engines') // planned, but owned → governed out
    expect(mobilePrimary(ctx)).not.toContain('mobile.parts')
    // PartSentry parts links are owned by product.verify → still present
    expect(parts).toContain('parts.ps-origin')
  })

  it('4) tenant denial (enabled:true, visible:false, accessible:false) hides ALL owned marketplace variants', () => {
    const ctx = eff('product.marketplace', { visible: false, accessible: false })
    const buy = menuIds('navbar-mega-buy', ctx)
    for (const id of MARKETPLACE_OWNED) expect(buy, id).not.toContain(id)
    expect(mobilePrimary(ctx)).not.toContain('mobile.buy')
    expect(footerProduct(ctx)).not.toContain('product.marketplace')
  })

  it('5) active/visible state restores every owned entry', () => {
    const ctx = eff('product.marketplace', {}) // explicit active+visible
    const buy = menuIds('navbar-mega-buy', ctx)
    for (const id of MARKETPLACE_OWNED) expect(buy, id).toContain(id)
    expect(mobilePrimary(ctx)).toContain('mobile.buy')
    expect(footerProduct(ctx)).toContain('product.marketplace')
    // and the no-override default is identical for these entries
    const def = menuIds('navbar-mega-buy', {})
    for (const id of MARKETPLACE_OWNED) expect(def, id).toContain(id)
  })

  it('6) planned links stay planned and are never activated by an owner override', () => {
    // even an explicit ACTIVE override on the owner must NOT activate a planned node
    const ctx = eff('product.marketplace', {})
    const suvs = getDesktopMegaMenu('navbar-mega-buy', ctx).flatMap(s => s.items).find(i => i.id === 'buy.suvs')!
    expect(suvs.state).toBe('planned')
    expect(suvs.active).toBe(false)
  })

  it('7) coverage-gated links still obey their coverage thresholds (href unchanged by ownership)', () => {
    const brandNew = NAVIGATION_MANIFEST.find(n => n.id === 'buy.brand-new')!
    expect(buildFeatureHref(brandNew, {})).toBe('/marketplace') // no coverage → defer
    expect(buildFeatureHref(brandNew, { coverage: { categories: { brand_new: { active: true } } } }))
      .toBe('/marketplace?category=brand_new')
  })

  it('8) governed-trust tags remain fail-closed even when the owner is active', () => {
    const passport = NAVIGATION_MANIFEST.find(n => n.id === 'buy.passport-verified')!
    expect(passport.governedTrust).toBe(true)
    const ownerActive = eff('product.marketplace', {})
    // owner active does NOT fabricate the trust tag — only real coverage does
    expect(buildFeatureHref(passport, ownerActive)).toBe('/marketplace')
  })

  it('9) external links are never removed by a same-route owner disable', () => {
    const external: NavigationNode = {
      id: 'x.ext', surface: 'navbar-more', order: 1, label: 'External',
      route: '/marketplace', external: true,
    }
    const ctx = eff('product.marketplace', { enabled: false, visible: false })
    expect(isNodeBackendBlocked(external, ctx)).toBe(false)
  })

  it('10) direct-route access and the owned navigation entries AGREE under a disable', () => {
    const ctx = eff('product.marketplace', { state: 'disabled', enabled: false, visible: false, accessible: false })
    // nav: every owned marketplace entry is gone
    const buy = menuIds('navbar-mega-buy', ctx)
    for (const id of MARKETPLACE_OWNED) expect(buy, id).not.toContain(id)
    // direct route: typing /marketplace resolves to the SAME unavailable outcome
    const decision = evaluateRouteAccess({
      route: '/marketplace', isBootstrapping: false, isAuthenticated: false, role: null,
      effectiveStates: ctx.effectiveStates, enforceAuth: false,
    })
    expect(decision.kind).toBe('disabled')
  })
})

// ── Guest CTA visibility through governance hydration ────────────────────────
describe('Navigation manifest — guest registration CTAs survive governance hydration', () => {
  // owner.sell-vehicle effective state as the backend returns it to an ANONYMOUS
  // session: lifecycle active, but visible:false because no authenticated role is
  // eligible. enabled stays true (not a kill-switch).
  const ownerSell = (over: object = {}) => ({
    featureId: 'owner.sell-vehicle', state: 'active' as const,
    enabled: true, visible: false, accessible: false, beta: false, ...over,
  })
  const anon = (over: object = {}): NavigationContext => ({
    isAuthenticated: false, role: null,
    effectiveStates: { 'owner.sell-vehicle': ownerSell(over) },
  })
  const sellMenuIds = (ctx: NavigationContext) =>
    getDesktopMegaMenu('navbar-mega-sell', ctx).flatMap(s => s.items).map(i => i.id)
  const mobilePrimaryIds = (ctx: NavigationContext) => getMobileNavigation(ctx).primary.map(i => i.id)
  const node = (id: string) => NAVIGATION_MANIFEST.find(n => n.id === id)!

  it('anonymous Sell CTA is visible BEFORE governance hydration (no effective state)', () => {
    expect(sellMenuIds({ isAuthenticated: false, role: null })).toContain('sell.your-car')
  })

  it('anonymous Sell CTA stays visible AFTER hydration (role-derived visible:false ignored for guests)', () => {
    expect(sellMenuIds(anon())).toContain('sell.your-car')
    expect(isNodeBackendBlocked(node('sell.your-car'), anon())).toBe(false)
  })

  it('anonymous Mobile Sell CTA stays visible after hydration', () => {
    expect(mobilePrimaryIds(anon())).toContain('mobile.sell')
  })

  it('the guest CTA routes to /register (never the protected destination)', () => {
    expect(buildFeatureHref(node('sell.your-car'), { isAuthenticated: false, role: null })).toBe('/register')
    expect(buildFeatureHref(node('mobile.sell'), { isAuthenticated: false, role: null })).toBe('/register')
  })

  it('a globally disabled (enabled:false) owner feature hides its guest CTA for everyone', () => {
    expect(isNodeBackendBlocked(node('sell.your-car'), anon({ enabled: false }))).toBe(true)
    expect(sellMenuIds(anon({ enabled: false }))).not.toContain('sell.your-car')
  })

  it('an authenticated wrong-role user does NOT receive the protected destination (CTA hidden)', () => {
    const mechanic: NavigationContext = {
      isAuthenticated: true, role: 'mechanic',
      effectiveStates: { 'owner.sell-vehicle': ownerSell() }, // visible:false (role denied)
    }
    expect(isNodeBackendBlocked(node('sell.your-car'), mechanic)).toBe(true)
    expect(sellMenuIds(mechanic)).not.toContain('sell.your-car')
  })

  it('login as the owner shows the CTA (now resolving to the authenticated destination)', () => {
    const owner: NavigationContext = {
      isAuthenticated: true, role: 'owner',
      effectiveStates: { 'owner.sell-vehicle': ownerSell({ visible: true, accessible: true }) },
    }
    expect(sellMenuIds(owner)).toContain('sell.your-car')
    expect(buildFeatureHref(node('sell.your-car'), owner)).toBe('/dashboard/sell-vehicle')
  })

  it('a planned guest CTA remains planned (not activated) after hydration', () => {
    const sellParts = getDesktopMegaMenu('navbar-mega-sell', anon())
      .flatMap(s => s.items).find(i => i.id === 'sell.car-parts')!
    expect(sellParts.state).toBe('planned')
    expect(sellParts.active).toBe(false)
  })

  it('tenant denial expressed as enabled:false still hides for an authenticated tenant context', () => {
    const deniedTenant: NavigationContext = {
      isAuthenticated: true, role: 'owner',
      effectiveStates: { 'owner.sell-vehicle': ownerSell({ enabled: false }) },
    }
    expect(isNodeBackendBlocked(node('sell.your-car'), deniedTenant)).toBe(true)
  })
})

describe('Navigation manifest — dead-link gate (no fabricated routes)', () => {
  const appContent = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf-8')
  const declaredRoutes: string[] = []
  const re = /<Route\s+[^>]*path=["']([^"']+)["']/g
  let m
  while ((m = re.exec(appContent)) !== null) declaredRoutes.push(m[1])

  const candidateRoutes = (n: NavigationNode): string[] => {
    const routes: string[] = []
    if (n.route) routes.push(n.route)
    if (n.authDestination) routes.push(n.authDestination)
    if (n.guestDestination) routes.push(n.guestDestination)
    if (n.featureId) {
      const f = getFeatureById(n.featureId)
      if (f) routes.push(f.route)
    }
    // coverage-gated nodes resolve to /marketplace
    if (n.coverageCategory || n.coverageTag) routes.push('/marketplace')
    return routes.map(r => r.split('?')[0])
  }

  it('every manifest node resolves only to routes declared in App.tsx', () => {
    const orphans: string[] = []
    for (const node of NAVIGATION_MANIFEST) {
      for (const route of candidateRoutes(node)) {
        const ok = declaredRoutes.some(d => matchRoutePattern(d, route))
        if (!ok) orphans.push(`${node.id} → ${route}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('feature-linked nodes reference existing registry features', () => {
    const missing = NAVIGATION_MANIFEST
      .filter(n => n.featureId && !getFeatureById(n.featureId))
      .map(n => `${n.id} → ${n.featureId}`)
    expect(missing).toEqual([])
  })
})
