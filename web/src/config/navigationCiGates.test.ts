import { describe, it, expect } from 'vitest'
import { FEATURE_REGISTRY, getFeatureById, FEATURE_LIFECYCLE_STATES, getStaticLifecycle } from './featureRegistry'
import { NAVIGATION_MANIFEST, FOOTER_SOCIAL, getManifestSurfaces } from './navigationManifest'
import { ICON_MAP } from './featureIcons'

/**
 * Structural CI gates (Milestone 8.2) — fast unit validation that fails the
 * build on navigation/registry integrity violations. Complements:
 *  - featureRegistry.route-validation.test.ts (dead links, duplicate routes, dashboard roots)
 *  - featureManifest.drift.test.ts (frontend/backend manifest drift)
 *  - navigationManifest.test.ts (manifest nodes resolve to declared routes)
 */

const VALID_SURFACES = new Set([
  'navbar-direct', 'navbar-mega-buy', 'navbar-mega-sell', 'navbar-mega-verify',
  'navbar-mega-parts', 'navbar-mega-services', 'navbar-more',
  'footer-product', 'footer-company', 'footer-resources', 'footer-stakeholders',
  'footer-legal', 'footer-social', 'dashboard-sidebar', 'user-menu',
  'mobile-primary', 'mobile-secondary', 'mobile-account',
])

const PUBLIC_NAV_SURFACES = new Set([
  'navbar-direct', 'navbar-mega-buy', 'navbar-mega-sell', 'navbar-mega-verify',
  'navbar-mega-parts', 'navbar-mega-services', 'navbar-more',
  'footer-product', 'footer-company', 'footer-resources', 'footer-legal', 'mobile-primary', 'mobile-secondary',
])

describe('Navigation CI gates (M8.2)', () => {
  it('every manifest node uses a valid NavigationSurface', () => {
    const bad = getManifestSurfaces().filter(s => !VALID_SURFACES.has(s))
    expect(bad).toEqual([])
  })

  it('every registry feature icon exists in the shared icon map (no invalid icon)', () => {
    const bad = FEATURE_REGISTRY.filter(f => !(f.icon in ICON_MAP)).map(f => `${f.id}:${f.icon}`)
    expect(bad).toEqual([])
  })

  it('every manifest node icon (when set) exists in the icon map', () => {
    const bad = NAVIGATION_MANIFEST.filter(n => n.icon && !(n.icon in ICON_MAP)).map(n => `${n.id}:${n.icon}`)
    expect(bad).toEqual([])
  })

  it('every registry feature has a valid lifecycle state', () => {
    const bad = FEATURE_REGISTRY.filter(f => !FEATURE_LIFECYCLE_STATES.includes(getStaticLifecycle(f))).map(f => f.id)
    expect(bad).toEqual([])
  })

  it('every manifest node lifecycle (when set) is valid', () => {
    const bad = NAVIGATION_MANIFEST.filter(n => n.lifecycle && !FEATURE_LIFECYCLE_STATES.includes(n.lifecycle)).map(n => n.id)
    expect(bad).toEqual([])
  })

  it('no duplicate menu order within a surface section', () => {
    const seen = new Map<string, Set<number>>()
    const dupes: string[] = []
    for (const n of NAVIGATION_MANIFEST) {
      const key = `${n.surface}::${n.section ?? ''}`
      if (!seen.has(key)) seen.set(key, new Set())
      const set = seen.get(key)!
      if (set.has(n.order)) dupes.push(`${key}#${n.order} (${n.id})`)
      set.add(n.order)
    }
    expect(dupes).toEqual([])
  })

  it('no auth-required feature is exposed as a public, feature-linked nav node without a guest destination', () => {
    const leaks: string[] = []
    for (const n of NAVIGATION_MANIFEST) {
      if (!PUBLIC_NAV_SURFACES.has(n.surface)) continue
      if (!n.featureId) continue
      const f = getFeatureById(n.featureId)
      if (f && f.requiresAuth && !n.guestDestination) leaks.push(`${n.id} -> ${n.featureId}`)
    }
    expect(leaks).toEqual([])
  })

  it('manifest node ids are globally unique', () => {
    const ids = NAVIGATION_MANIFEST.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no node declares BOTH a coverageCategory and a coverageTag (mutually exclusive)', () => {
    // buildFeatureHref applies one coverage gate; declaring both would let an
    // inactive gate drop the other gate’s accumulated query param.
    const both = NAVIGATION_MANIFEST.filter(n => n.coverageCategory && n.coverageTag).map(n => n.id)
    expect(both).toEqual([])
  })

  it('social links carry no placeholder href and are governed by lifecycle', () => {
    for (const s of FOOTER_SOCIAL) {
      expect(s.url === '#').toBe(false)
      // active social must have a real URL; otherwise it must be planned/hidden/disabled
      if (s.state === 'active') expect(typeof s.url === 'string' && s.url.startsWith('http')).toBe(true)
      else expect(FEATURE_LIFECYCLE_STATES.includes(s.state)).toBe(true)
    }
  })
})
