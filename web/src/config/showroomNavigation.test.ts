import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Trade views (unified UI) and the showroom pages decide which public Trade pages exist in a build.
const fx = vi.hoisted(() => ({ unified: true, pages: false }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/lib/presentationFlags', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/presentationFlags')>()),
  isShowroomPagesEnabled: () => fx.pages,
}))

import { FEATURE_REGISTRY, getFeatureByRoute } from './featureRegistry'
import { SHOWROOM_NAVIGATION, SHOWROOM_SUPPORT_LINKS, resolveShowroomNavigation, type ShowroomNavContext } from './showroomNavigation'

const guest: ShowroomNavContext = { isAuthenticated: false, role: null, effectiveStates: {}, launchPreview: false }
const owner: ShowroomNavContext = { isAuthenticated: true, role: 'owner', effectiveStates: {}, launchPreview: false }
const dealer: ShowroomNavContext = { ...owner, role: 'dealer' }
const all = (ctx: ShowroomNavContext) => resolveShowroomNavigation(ctx).flatMap(g => g.columns.flatMap(c => c.links))
const hrefs = (ctx: ShowroomNavContext) => all(ctx).map(l => l.href)
const importLinks = (ctx: ShowroomNavContext) =>
  resolveShowroomNavigation(ctx).find(g => g.id === 'import')?.columns.flatMap(c => c.links) ?? []
const importIds = (ctx: ShowroomNavContext) => importLinks(ctx).map(l => l.id)
const importLink = (ctx: ShowroomNavContext, id: string) => importLinks(ctx).find(l => l.id === id)
/** A governance override as the loader delivers it for one feature. */
const governed = (featureId: string, state: 'active' | 'beta' | 'hidden' | 'planned' | 'disabled', extra: Record<string, unknown> = {}) => ({
  [featureId]: { featureId, state, enabled: true, visible: state === 'active' || state === 'beta', accessible: state !== 'planned' && state !== 'disabled', beta: state === 'beta', ...extra },
})

beforeEach(() => {
  fx.unified = true
  fx.pages = false
})

describe('showroom navigation taxonomy', () => {
  it('has five purpose groups with unique link ids', () => {
    expect(SHOWROOM_NAVIGATION.map(g => g.id)).toEqual(['explore', 'sell', 'intelligence', 'import', 'services'])
    const ids = [...SHOWROOM_NAVIGATION.flatMap(g => g.columns.flatMap(c => c.links)), ...SHOWROOM_SUPPORT_LINKS].map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every destination is a real route, governed by the feature it names', () => {
    for (const link of [...SHOWROOM_NAVIGATION.flatMap(g => g.columns.flatMap(c => c.links)), ...SHOWROOM_SUPPORT_LINKS]) {
      const path = link.href.split(/[?#]/)[0]
      if (path === '/' || path === '/sell') continue // Home anchors and the guest sell entry (App.tsx routes)
      // The public sample import: an App.tsx route registered under the same switches as the link's `when`.
      if (path === '/diaspora/sample') { expect(link.featureId).toBe('product.diaspora'); continue }
      const feature = FEATURE_REGISTRY.find(f => f.route === path) ?? getFeatureByRoute(path)
      expect(feature, `${link.id} → ${path}`).toBeTruthy()
      expect(feature!.id, link.id).toBe(link.featureId)
    }
  })

  it('a feature switched off removes its links; a switched-off group feature removes the group', () => {
    expect(hrefs({ ...guest, effectiveStates: { 'product.insurance': { enabled: false } } })).not.toContain('/insurance')
    const groups = resolveShowroomNavigation({ ...guest, effectiveStates: { 'product.diaspora': { enabled: false } } })
    expect(groups.map(g => g.id)).not.toContain('import')
  })

  it('signed-in links need a signed-in person whose role may open the route', () => {
    expect(hrefs(guest)).not.toContain('/dashboard/saved')
    // A role left over without a signed-in session never unlocks signed-in links.
    expect(hrefs({ ...owner, isAuthenticated: false })).not.toContain('/dashboard/saved')
    expect(hrefs(owner)).toContain('/dashboard/saved')
    expect(hrefs({ ...owner, role: 'dealer' })).not.toContain('/dashboard/saved')
    expect(hrefs(guest)).toContain('/sell')
    expect(hrefs(owner)).not.toContain('/sell')
  })

  it('launch-preview links appear only with the preview switch', () => {
    expect(hrefs(guest)).not.toContain('/#scan-to-start')
    expect(hrefs({ ...guest, launchPreview: true })).toContain('/#scan-to-start')
  })

  it('offers nothing marked "Soon" and no label that lands on an unrelated page', () => {
    for (const link of all({ ...owner, launchPreview: true })) {
      expect(link.label).not.toMatch(/soon/i)
      if (/(SUV|Pickup|Sedan|Hatchback|MPV)/.test(link.label)) expect(link.href).toMatch(/bodyStyle=/)
    }
  })
})

describe('Import & Trade menu (RX06-LR03)', () => {
  it('a visitor gets every public Trade page and each account tool as an explicit sign-in', () => {
    expect(importIds(guest)).toEqual([
      'import.start', 'import.orders', 'import.sample', 'import.how',
      'import.rfq', 'import.containers', 'import.seller',
      'import.profile',
    ])
    expect(importLink(guest, 'import.sample')).toMatchObject({ href: '/diaspora/sample' })
    // The sourcing explainer is a public page in the Trade views: no sign-in in between.
    expect(importLink(guest, 'import.rfq')).toMatchObject({ href: '/diaspora/rfq', description: 'How sellers quote on what you ask for' })
    // Account tools say they need an account and return to the tool after sign-in.
    expect(importLink(guest, 'import.orders')).toMatchObject({ href: '/login?returnTo=%2Fdiaspora%2Fimports', description: 'Sign in to see your orders' })
    expect(importLink(guest, 'import.containers')).toMatchObject({ href: '/login?returnTo=%2Fdiaspora%2Fcontainers', description: 'Sign in to book space' })
    expect(importLink(guest, 'import.profile')).toMatchObject({ href: '/login?returnTo=%2Fdiaspora%2Ftrade-profile', description: 'Sign in to see yours' })
    expect(importLink(guest, 'import.seller')).toMatchObject({ href: '/login?returnTo=%2Fdiaspora%2Frfq', description: 'Sign in with an approved seller account' })
    // Seller-only and unreleased tools are never offered to a visitor.
    for (const href of hrefs(guest)) expect(href).not.toMatch(/stock|ai-commands|workbook|safetrade|subscription|trade-graph|drive/)
  })

  it('every sign-in link says so in its description', () => {
    const signIns = importLinks(guest).filter(l => l.href.startsWith('/login'))
    expect(signIns).toHaveLength(4)
    for (const link of signIns) expect(link.description).toMatch(/^Sign in/)
  })

  it('without the Trade views a visitor is sent to sign in for sourcing, and the sample appears only where its route exists', () => {
    fx.unified = false
    expect(importLink(guest, 'import.rfq')).toMatchObject({ href: '/login?returnTo=%2Fdiaspora%2Frfq', description: 'Sign in to see your requests' })
    expect(importIds(guest)).not.toContain('import.sample')
    fx.pages = true
    expect(importIds(guest)).toContain('import.sample')
  })

  it('an importer sees their own tools, by the Trade rail labels, and no seller tools', () => {
    expect(importIds(owner)).toEqual([
      'import.start', 'import.orders', 'import.sample', 'import.how',
      'import.rfq', 'import.containers',
      'import.profile', 'import.drive',
    ])
    expect(importLink(owner, 'import.orders')).toMatchObject({ href: '/diaspora/imports' })
    expect(importLink(owner, 'import.rfq')).toMatchObject({ label: 'Sourcing requests', href: '/diaspora/rfq' })
    expect(importLink(owner, 'import.containers')).toMatchObject({ label: 'Shared containers', href: '/diaspora/containers' })
    expect(hrefs(owner).some(h => h.startsWith('/login'))).toBe(false)
  })

  it('a seller sees the selling tools and never an importer-only order list', () => {
    expect(importIds(dealer)).toEqual([
      'import.start', 'import.sample', 'import.how',
      'import.rfq', 'import.containers', 'import.stock', 'import.ai',
      'import.profile', 'import.drive',
    ])
  })

  it('a tool built but not released is not advertised, whatever governance says', () => {
    // The release build flags are off in this test build (featureRegistry isHidden), so SafeTrade, plan,
    // Trade graph and workbook import never show — even when governance calls them active.
    const allOn = { ...governed('diaspora.safetrade', 'active'), ...governed('diaspora.subscription', 'active'), ...governed('diaspora.trade-graph', 'active'), ...governed('diaspora.workbook-import', 'active') }
    for (const ctx of [owner, dealer, { ...owner, role: 'admin' as const }]) {
      const ids = importIds({ ...ctx, effectiveStates: allOn })
      for (const id of ['import.safetrade', 'import.plan', 'import.graph', 'import.workbook']) expect(ids).not.toContain(id)
    }
  })

  it('with its build flag on, a tool appears once governance releases it, and only for the roles that may open it', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DIASPORA_SAFETRADE_UI_ENABLED', 'true')
    vi.stubEnv('VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED', 'true')
    vi.stubEnv('VITE_DIASPORA_WORKBOOK_IMPORT_UI_ENABLED', 'true')
    try {
      const nav = await import('./showroomNavigation')
      const ids = (ctx: ShowroomNavContext) => nav.resolveShowroomNavigation(ctx).find(g => g.id === 'import')?.columns.flatMap(c => c.links.map(l => l.id)) ?? []
      // Built, but governance still hides it ("Built · not yet released" on the Trade rail): not offered.
      expect(ids({ ...owner, effectiveStates: governed('diaspora.safetrade', 'hidden') })).not.toContain('import.safetrade')
      // Governance not loaded yet (the map starts empty per identity, and stays empty if the request fails):
      // a built tool is not offered on its static default, so nothing flashes before governance answers.
      for (const ctx of [owner, dealer]) {
        const ids0 = ids({ ...ctx, effectiveStates: {} })
        for (const id of ['import.safetrade', 'import.plan', 'import.graph', 'import.workbook']) expect(ids0).not.toContain(id)
      }
      // Tools with no release flag keep their static default while governance loads.
      expect(ids({ ...dealer, effectiveStates: {} })).toEqual(expect.arrayContaining(['import.stock', 'import.ai', 'import.profile']))
      // Released: offered to the roles the registry lists, never to a visitor (no visitor offer).
      expect(ids({ ...owner, effectiveStates: governed('diaspora.safetrade', 'active') })).toContain('import.safetrade')
      expect(ids({ ...guest, effectiveStates: governed('diaspora.safetrade', 'active') })).not.toContain('import.safetrade')
      expect(ids({ ...dealer, effectiveStates: governed('diaspora.trade-graph', 'active') })).toContain('import.graph')
      // Workbook import is for sellers and operators only (registry roles: admin, dealer).
      expect(ids({ ...dealer, effectiveStates: governed('diaspora.workbook-import', 'active') })).toContain('import.workbook')
      expect(ids({ ...owner, effectiveStates: governed('diaspora.workbook-import', 'active') })).not.toContain('import.workbook')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('governance decides released tools for accounts and visitors alike', () => {
    const profileHidden = governed('diaspora.trade-profile', 'hidden')
    expect(importIds({ ...owner, effectiveStates: profileHidden })).not.toContain('import.profile')
    expect(importIds({ ...guest, effectiveStates: profileHidden })).not.toContain('import.profile')
    // Planned is not openable, so it is not offered.
    expect(importIds({ ...owner, effectiveStates: governed('diaspora.container-marketplace', 'planned') })).not.toContain('import.containers')
    expect(importIds({ ...guest, effectiveStates: governed('diaspora.container-marketplace', 'planned') })).not.toContain('import.containers')
    // Switched off disappears.
    expect(importIds({ ...guest, effectiveStates: { 'diaspora.container-marketplace': { enabled: false } } })).not.toContain('import.containers')
    expect(importIds({ ...owner, effectiveStates: { 'diaspora.container-marketplace': { enabled: false } } })).not.toContain('import.containers')
    // Beta is released.
    expect(importIds({ ...owner, effectiveStates: governed('diaspora.trade-profile', 'beta') })).toContain('import.profile')
    // A visitor is never role-eligible, so the loader's anonymous `visible: false` does not hide a released tool.
    expect(importIds({ ...guest, effectiveStates: governed('diaspora.trade-profile', 'active', { visible: false }) })).toContain('import.profile')
  })

  it('the server refusing this account a tool removes it, even when its role is listed', () => {
    const refused = governed('diaspora.reverse-rfq', 'active', { visible: false, accessible: false })
    expect(importIds({ ...owner, effectiveStates: refused })).not.toContain('import.rfq')
  })
})
