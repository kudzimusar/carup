/**
 * PC01-J-R1 §4 — deterministic navigation certification.
 *
 * Builds the complete rendered-item matrix — desktop navbar (public links + the five mega-menus), the
 * mobile-web drawer, the footer (Product / Company / Resources / Stakeholders / Legal) and the social
 * controls — for a GUEST and for a signed-in OWNER, from the same selectors the components render, and
 * classifies every item:
 *
 *   PUBLIC_ACTIVE     a page a guest can open
 *   AUTH_ACTION       an explicit account step (/login, /register — with returnTo when it carries intent)
 *   AUTH_WORKSPACE    a signed-in workspace (allowed for an authenticated viewer only)
 *   PLANNED_DISABLED  rendered disabled ("Soon" / "None yet"), never a working link
 *   BROKEN            a destination the router does not declare, or a placeholder href
 *
 * The rules the owner's Checkpoint 1 review set: no public-looking link silently becomes a private
 * dashboard; planned is disabled; active lands on a declared route; no `#` placeholders.
 *
 * Set NAV_MATRIX_OUT=/path/matrix.json to write the matrix as evidence.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { UserRole } from '@shared/types'
import { getDesktopMegaMenu, getMobileNavigation, getFooterNavigation, getFooterSocial, type ResolvedNavItem } from './navigationManifest'
import { getVisiblePublicNavigationItems, matchRoutePattern, isPublicRoute, type NavigationContext } from './featureRegistry'
import { evaluateRouteAccess } from '../lib/routeAccess'

const APP = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf-8')
const APP_ROUTES = [...APP.matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/g)].map(m => m[1])

const GUEST: NavigationContext = { isAuthenticated: false, role: null, environment: 'production' }
const OWNER: NavigationContext = { isAuthenticated: true, role: 'owner' as UserRole, environment: 'production' }
const MEGA_MENUS = ['navbar-mega-buy', 'navbar-mega-sell', 'navbar-mega-verify', 'navbar-mega-parts', 'navbar-more'] as const
const FOOTER_COLUMNS = ['product', 'company', 'resources', 'stakeholders', 'legal'] as const

type Classification = 'PUBLIC_ACTIVE' | 'AUTH_ACTION' | 'AUTH_WORKSPACE' | 'PLANNED_DISABLED' | 'BROKEN'
interface Row {
  viewer: 'guest' | 'owner'
  surface: string
  id: string
  label: string
  href: string
  lifecycle: string
  badge?: string
  routeDeclared: boolean
  access: string
  classification: Classification
}

const AUTH_STEPS = new Set(['/login', '/register'])

function classify(item: Pick<ResolvedNavItem, 'href' | 'active' | 'state'>, ctx: NavigationContext): Omit<Row, 'viewer' | 'surface' | 'id' | 'label' | 'href' | 'lifecycle' | 'badge'> {
  const pathOnly = item.href.split('?')[0]
  const routeDeclared = item.href.startsWith('/') && APP_ROUTES.some(r => matchRoutePattern(r, pathOnly))
  if (!item.active) return { routeDeclared, access: 'not-navigable', classification: 'PLANNED_DISABLED' }
  if (!item.href.startsWith('/') || item.href.includes('#') || !routeDeclared) return { routeDeclared, access: 'none', classification: 'BROKEN' }
  if (AUTH_STEPS.has(pathOnly)) return { routeDeclared, access: 'render', classification: 'AUTH_ACTION' }
  const decision = evaluateRouteAccess({
    route: pathOnly,
    isAuthenticated: !!ctx.isAuthenticated,
    role: (ctx.role ?? null) as UserRole | null,
    isBootstrapping: false,
    enforceAuth: !isPublicRoute(pathOnly),
  })
  const access = decision.kind === 'redirect' ? `redirect:${decision.reason}` : decision.kind
  if (decision.kind === 'planned' || decision.kind === 'disabled') return { routeDeclared, access, classification: 'BROKEN' }
  if (decision.kind === 'redirect') return { routeDeclared, access, classification: 'AUTH_WORKSPACE' }
  return { routeDeclared, access, classification: isPublicRoute(pathOnly) ? 'PUBLIC_ACTIVE' : 'AUTH_WORKSPACE' }
}

function matrix(viewer: 'guest' | 'owner', ctx: NavigationContext): Row[] {
  const out: Row[] = []
  const add = (surface: string, item: ResolvedNavItem) =>
    out.push({ viewer, surface, id: item.id, label: item.label, href: item.href, lifecycle: item.state, badge: item.badge, ...classify(item, ctx) })

  for (const f of getVisiblePublicNavigationItems(ctx)) {
    add('navbar-link', { id: f.id, label: f.label, href: f.route, external: false, state: 'active', active: true, beta: false, governedTrust: false })
  }
  for (const surface of MEGA_MENUS) {
    for (const section of getDesktopMegaMenu(surface, ctx)) for (const item of section.items) add(surface, item)
  }
  const mobile = getMobileNavigation(ctx)
  for (const item of mobile.primary) add('mobile-drawer:browse', item)
  for (const item of mobile.secondary) add('mobile-drawer:more', item)
  for (const item of mobile.roleItems) add('mobile-drawer:dashboard', item)
  for (const column of FOOTER_COLUMNS) for (const item of getFooterNavigation(column, ctx)) add(`footer:${column}`, item)
  for (const social of getFooterSocial()) {
    out.push({
      viewer, surface: 'footer:social', id: social.id, label: social.label, href: social.url ?? '',
      lifecycle: social.state, routeDeclared: false, access: 'not-navigable',
      classification: social.state === 'active' && social.url ? 'PUBLIC_ACTIVE' : 'PLANNED_DISABLED',
    })
  }
  return out
}

const GUEST_ROWS = matrix('guest', GUEST)
const OWNER_ROWS = matrix('owner', OWNER)

if (process.env.NAV_MATRIX_OUT) {
  fs.writeFileSync(process.env.NAV_MATRIX_OUT, JSON.stringify({ generated_from: 'navigationManifest + featureRegistry + App.tsx', guest: GUEST_ROWS, owner: OWNER_ROWS }, null, 1))
}

describe('navigation certification (PC01-J-R1 §4)', () => {
  it('covers every surface the brief names', () => {
    const surfaces = new Set(GUEST_ROWS.map(r => r.surface.split(':')[0] === 'footer' ? r.surface : r.surface.split(':')[0]))
    for (const s of ['navbar-link', ...MEGA_MENUS, 'mobile-drawer', 'footer:product', 'footer:company', 'footer:resources', 'footer:stakeholders', 'footer:legal', 'footer:social']) {
      expect(surfaces, s).toContain(s)
    }
  })

  it('nothing is BROKEN — every live item lands on a route the router declares, and no href is a placeholder', () => {
    const broken = [...GUEST_ROWS, ...OWNER_ROWS].filter(r => r.classification === 'BROKEN').map(r => `${r.viewer} ${r.surface} ${r.id} → ${r.href} (${r.access})`)
    expect(broken).toEqual([])
  })

  it('no public-looking link sends a guest into a private workspace', () => {
    const leaks = GUEST_ROWS.filter(r => r.classification === 'AUTH_WORKSPACE').map(r => `${r.surface} ${r.id} → ${r.href}`)
    expect(leaks).toEqual([])
  })

  it('a guest account step that stands for a destination carries it in returnTo', () => {
    const bare = GUEST_ROWS
      .filter(r => r.classification === 'AUTH_ACTION' && r.href.startsWith('/register') && !r.href.includes('returnTo='))
      .map(r => `${r.surface} ${r.id}`)
    expect(bare).toEqual([])
  })

  it('planned items are never live links, and social stays planned until real URLs are approved', () => {
    for (const r of GUEST_ROWS.filter(r => r.lifecycle === 'planned')) expect(r.classification, r.id).toBe('PLANNED_DISABLED')
    const social = GUEST_ROWS.filter(r => r.surface === 'footer:social')
    expect(social).toHaveLength(4)
    for (const s of social) expect(s.classification).toBe('PLANNED_DISABLED')
  })

  it('coverage-gated Buy items with no live coverage are disabled with "None yet", not links to the unfiltered Marketplace', () => {
    const gated = GUEST_ROWS.filter(r => ['buy.brand-new', 'buy.recently-imported', 'buy.locally-used', 'buy.second-hand', 'buy.dealer-verified', 'buy.passport-verified', 'buy.partsentry-checked'].includes(r.id))
    expect(gated).toHaveLength(7)
    for (const r of gated) {
      expect(r.classification, r.id).toBe('PLANNED_DISABLED')
      expect(r.badge, r.id).toBe('None yet')
    }
    const withCoverage = getDesktopMegaMenu('navbar-mega-buy', { ...GUEST, coverage: { categories: { brand_new: { active: true } } } })
      .flatMap(s => s.items).find(i => i.id === 'buy.brand-new')!
    expect(withCoverage.active).toBe(true)
    expect(withCoverage.href).toBe('/marketplace?category=brand_new')
  })

  it('the footer Stakeholders column is public entry points for every viewer', () => {
    for (const rows of [GUEST_ROWS, OWNER_ROWS]) {
      const stakeholders = rows.filter(r => r.surface === 'footer:stakeholders')
      expect(stakeholders.map(r => r.href)).toEqual(['/sell', '/dealers', '/garages', '/diaspora'])
      for (const r of stakeholders) expect(r.classification).toBe('PUBLIC_ACTIVE')
    }
  })

  it('the signed-in owner reaches their workspace only through workspace-labelled surfaces', () => {
    const ownerWorkspace = OWNER_ROWS.filter(r => r.classification === 'AUTH_WORKSPACE')
    for (const r of ownerWorkspace) expect(['navbar-mega-sell', 'navbar-mega-verify', 'navbar-mega-parts', 'mobile-drawer:dashboard', 'mobile-drawer:browse']).toContain(r.surface)
    expect(OWNER_ROWS.filter(r => r.surface.startsWith('footer:') && r.classification === 'AUTH_WORKSPACE')).toEqual([])
  })
})
