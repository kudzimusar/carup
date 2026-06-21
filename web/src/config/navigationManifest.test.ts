import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  NAVIGATION_MANIFEST,
  getDesktopMegaMenu,
  getNavigationSections,
  buildFeatureHref,
  getNavigationPlacements,
  type NavigationNode,
} from './navigationManifest'
import { matchRoutePattern, getFeatureById, type NavigationContext } from './featureRegistry'

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

  it('manifest has unique node ids (no duplicate placements)', () => {
    const ids = NAVIGATION_MANIFEST.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getNavigationPlacements returns feature-linked nodes', () => {
    expect(getNavigationPlacements('product.insurance').map(n => n.id)).toContain('more.insurance')
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
