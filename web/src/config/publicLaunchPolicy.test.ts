import { describe, expect, it } from 'vitest'
import { PUBLIC_LAUNCH_ROUTES, isPublicLaunchNavigationRoute } from './publicLaunchPolicy'
import { getDesktopMegaMenu, getFooterNavigation, getMobileNavigation } from './navigationManifest'

describe('public launch exposure', () => {
  it('keeps legal disclosures visible while recording approval blockers', () => {
    for (const route of ['/privacy', '/terms']) {
      expect(PUBLIC_LAUNCH_ROUTES.find(row => row.route === route)?.state).toBe('LEGAL_BLOCKER')
      expect(isPublicLaunchNavigationRoute(route)).toBe(true)
    }
  })
  it('removes unready commercial/editorial promises from rendered navigation', () => {
    const hrefs = [
      ...getDesktopMegaMenu('navbar-more', {}).flatMap(section => section.items),
      ...getMobileNavigation({}).secondary,
      ...(['product', 'company', 'resources', 'stakeholders', 'legal'] as const).flatMap(group => getFooterNavigation(group, {})),
    ].map(item => item.href)
    for (const route of ['/insurance', '/pricing', '/press', '/careers', '/blog']) {
      expect(isPublicLaunchNavigationRoute(route)).toBe(false)
      expect(hrefs).not.toContain(route)
    }
  })
  it('retains meaningful discovery and does not hide private workspace destinations', () => {
    for (const route of ['/marketplace', '/search', '/contact', '/diaspora', '/dashboard/sell-vehicle']) {
      expect(isPublicLaunchNavigationRoute(route)).toBe(true)
    }
  })
})
