import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY, getFeatureByRoute } from './featureRegistry'
import { SHOWROOM_NAVIGATION, SHOWROOM_SUPPORT_LINKS, resolveShowroomNavigation, type ShowroomNavContext } from './showroomNavigation'

const guest: ShowroomNavContext = { isAuthenticated: false, role: null, effectiveStates: {}, launchPreview: false }
const owner: ShowroomNavContext = { isAuthenticated: true, role: 'owner', effectiveStates: {}, launchPreview: false }
const all = (ctx: ShowroomNavContext) => resolveShowroomNavigation(ctx).flatMap(g => g.columns.flatMap(c => c.links))
const hrefs = (ctx: ShowroomNavContext) => all(ctx).map(l => l.href)

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
