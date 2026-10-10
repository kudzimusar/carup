import { describe, it, expect } from 'vitest'
import {
  getFooterNavigation,
  getFooterSocial,
  FOOTER_SOCIAL,
} from './navigationManifest'
import { getFeatureByRoute, isPublicRoute, type NavigationContext } from './featureRegistry'

describe('Footer navigation (Milestone 3)', () => {
  it('Product/Company/Resources columns are registry-backed with real routes', () => {
    for (const col of ['product', 'company', 'resources'] as const) {
      const items = getFooterNavigation(col)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.href.startsWith('/')).toBe(true)
        // route is registered AND public
        const feature = getFeatureByRoute(item.href)
        expect(feature, `${item.id} → ${item.href} should resolve to a registered feature`).toBeDefined()
        expect(isPublicRoute(item.href)).toBe(true)
      }
    }
  })

  it('Legal column contains exactly the privacy + terms links (split out of Resources)', () => {
    const legal = getFooterNavigation('legal').map(i => i.id).sort()
    expect(legal).toEqual(['resources.privacy', 'resources.terms'])
    // …and Resources no longer contains them
    const resources = getFooterNavigation('resources').map(i => i.id)
    expect(resources).not.toContain('resources.privacy')
    expect(resources).not.toContain('resources.terms')
  })

  it('Stakeholders are public entry points — never a role dashboard (PC01-J-R1)', () => {
    // This column used to link /dashboard, /dealer, /mechanic, /insurance-dash, /government and /bank:
    // public-looking footer links that sent a guest to Sign In and a signed-in person of any other
    // role back to their own dashboard. Every stakeholder link must now be a page a guest can open.
    const stake = getFooterNavigation('stakeholders')
    expect(stake.map(s => [s.id, s.href])).toEqual([
      ['stakeholder.owners', '/sell'],
      ['stakeholder.dealers', '/dealers'],
      ['stakeholder.garages', '/garages'],
      ['stakeholder.diaspora', '/diaspora'],
    ])
    for (const s of stake) {
      expect(isPublicRoute(s.href), `${s.id} → ${s.href} must be public`).toBe(true)
      expect(s.href).not.toMatch(/^\/(dashboard|dealer|mechanic|insurance-dash|government|bank|admin)(\/|$)/)
      expect(s.active).toBe(true)
    }
  })

  it('hidden/disabled/planned features are excluded from footer columns (runtime override)', () => {
    const override = (id: string, state: 'hidden' | 'disabled' | 'planned'): NavigationContext => ({
      effectiveStates: { [id]: { featureId: id, state, enabled: state !== 'disabled', visible: false, accessible: false, beta: false } },
    })
    expect(getFooterNavigation('product').map(i => i.id)).toContain('product.insurance')
    for (const state of ['hidden', 'disabled', 'planned'] as const) {
      expect(getFooterNavigation('product', override('product.insurance', state)).map(i => i.id))
        .not.toContain('product.insurance')
    }
  })

  it('social links are governed (planned until configured) and never use href="#"', () => {
    const social = getFooterSocial()
    expect(social.length).toBe(4)
    for (const s of social) {
      expect(['facebook', 'twitter', 'instagram', 'linkedin']).toContain(s.platform)
      // planned by default → no fabricated URL
      expect(s.state).toBe('planned')
      expect(s.url).toBeUndefined()
    }
    // No placeholder anchors in the source-of-truth
    expect(FOOTER_SOCIAL.some(s => s.url === '#')).toBe(false)
  })
})
