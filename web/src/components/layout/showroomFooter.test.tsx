/**
 * RX03-P1b FOOTER-IDENTITY-AND-INTELLIGENT-NAVIGATION-RECONCILIATION-LR01 — exact-source tests.
 * Identity comes from config/publicIdentity.ts (PR #222 edd6b745), navigation from the governed manifest.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { act } from 'react'
import type { EffectiveFeatureState } from '@/config/featureRegistry'
import { isPublicRoute } from '@/config/featureRegistry'
import { FeatureGovernanceContext } from '@/context/featureGovernanceStore'
import { PUBLIC_CONTACTS, PUBLIC_IDENTITY, PUBLIC_LOCATION_LINE } from '@/config/publicIdentity'
import { ShowroomFooter, ShowroomUtilityFooter } from './ShowroomFooter'
import { mainLayoutFooterMode } from './footerPresentation'
import { useClaimBottomBar } from '@/lib/bottomBarClaim'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: false, logout: () => {}, login: () => {}, switchRole: async () => {} }),
}))

const PRIVATE_DASHBOARDS = /^\/(dashboard|dealer|mechanic|insurance-dash|government|bank|admin)(\/|$)/
const disabled = (featureId: string): EffectiveFeatureState => ({ featureId, state: 'disabled', enabled: false, visible: false, accessible: false, beta: false })

function renderFooter(states: Record<string, EffectiveFeatureState> = {}, node = <ShowroomFooter />) {
  return render(
    <FeatureGovernanceContext.Provider value={states}>
      <MemoryRouter>{node}</MemoryRouter>
    </FeatureGovernanceContext.Provider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('corporate identity (frozen contract)', () => {
  it('renders CarUp Technologies, the descriptor, the tagline, HQ + regional office and carup.dev', () => {
    renderFooter()
    const full = screen.getByTestId('footer-full')
    expect(within(full).getByTestId('footer-descriptor')).toHaveTextContent(PUBLIC_IDENTITY.descriptor)
    expect(within(full).getByTestId('footer-tagline')).toHaveTextContent('Know the car. Trust the journey.')
    expect(within(full).getByTestId('footer-location')).toHaveTextContent(PUBLIC_LOCATION_LINE)
    expect(PUBLIC_LOCATION_LINE).toBe('HQ: Tokyo, Japan · Regional office: Harare, Zimbabwe')
    expect(within(full).getByText(/© \d{4} CarUp Technologies\. All rights reserved\./)).toBeInTheDocument()
    expect(within(full).getByTestId('footer-website')).toHaveAttribute('href', 'https://carup.dev')
  })

  it('general and support contacts are real mailto links to the certified aliases; the rest live on /contact', () => {
    renderFooter()
    const full = screen.getByTestId('footer-full')
    expect(within(full).getByTestId('footer-mail-info')).toHaveAttribute('href', `mailto:${PUBLIC_CONTACTS.info}`)
    expect(within(full).getByTestId('footer-mail-support')).toHaveAttribute('href', `mailto:${PUBLIC_CONTACTS.support}`)
    expect(PUBLIC_CONTACTS.info).toBe('info@carup.dev')
    expect(PUBLIC_CONTACTS.support).toBe('support@carup.dev')
    expect(within(full).getByTestId('footer-all-contacts')).toHaveAttribute('href', '/contact')
    // Not every internal alias is dumped into the footer.
    expect(full.textContent).not.toMatch(/dpo@|legal@|press@|questions@|security@|privacy@carup/)
  })

  it('no obsolete or invented identity: no carup.co.zw, phone, street, hours, CarUp Zimbabwe or social profile', () => {
    const { container } = renderFooter()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/carup\.co\.zw/i)
    expect(text).not.toMatch(/\+263|\+\d{2,3}[\s-]?\d{3}/)
    expect(text).not.toMatch(/CarUp Zimbabwe|\(Pvt\)|Ltd\b/)
    expect(text).not.toMatch(/Mon(day)?\s*[-–]\s*Fri|opening hours|\b\d{1,2}:\d{2}\s*(AM|PM)?/i)
    expect(text).not.toMatch(/Street|Avenue|Road\b|Batanai|Samora/i)
    expect(container.querySelectorAll('[data-testid^="footer-social-"]')).toHaveLength(0)
    expect(text).not.toMatch(/Facebook|Instagram|LinkedIn|X \(Twitter\)/)
  })

  it('uses the official Option 5 reversed (on-dark) stacked logo, not a generic icon', () => {
    const { container } = renderFooter()
    const logos = Array.from(container.querySelectorAll('img[data-brand-role="stacked"]'))
    expect(logos.length).toBeGreaterThanOrEqual(1)
    for (const img of logos) {
      expect(img).toHaveAttribute('data-brand-surface', 'dark')
      expect(img).toHaveAttribute('data-brand-file', 'carup-logo-stacked-on-dark.svg')
    }
    expect(container.querySelector('svg.lucide-car')).toBeNull()
  })
})

describe('navigation and route truth (governed manifest)', () => {
  it('every footer link is a genuine public page — no private role dashboard, no href="#"', () => {
    const { container } = renderFooter()
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map(a => a.getAttribute('href')!)
    expect(hrefs.length).toBeGreaterThan(10)
    expect(hrefs).not.toContain('#')
    for (const href of hrefs.filter(h => h.startsWith('/'))) {
      expect(href, href).not.toMatch(PRIVATE_DASHBOARDS)
      expect(isPublicRoute(href.split('?')[0]), `${href} must be a public route`).toBe(true)
    }
    for (const href of hrefs.filter(h => !h.startsWith('/'))) expect(href).toMatch(/^(mailto:[a-z]+@carup\.dev|https:\/\/carup\.dev)$/)
  })

  it('stakeholders are the public entry points (sell, dealers, garages, diaspora)', () => {
    renderFooter()
    const nav = within(screen.getByTestId('footer-full')).getByRole('navigation', { name: 'Footer Who CarUp serves' })
    expect(Array.from(nav.querySelectorAll('a')).map(a => a.getAttribute('href'))).toEqual(['/sell', '/dealers', '/garages', '/diaspora'])
  })

  it('a governance-disabled feature disappears from the columns and from the phone essentials', () => {
    renderFooter({ 'company.careers': disabled('company.careers'), 'resources.help': disabled('resources.help'), 'product.dealers': disabled('product.dealers') })
    expect(screen.queryAllByTestId('footer-link-company.careers')).toHaveLength(0)
    expect(screen.queryByTestId('footer-essential-resources.help')).toBeNull()
    // The stakeholder entry point governed by the same registry feature drops out too.
    const nav = within(screen.getByTestId('footer-full')).getByRole('navigation', { name: 'Footer Who CarUp serves' })
    expect(Array.from(nav.querySelectorAll('a')).map(a => a.getAttribute('href'))).not.toContain('/dealers')
  })

  it('one footer navigation authority: the phone and desktop views list the same governed destinations', () => {
    const { container } = renderFooter()
    const ids = (root: Element) => new Set(Array.from(root.querySelectorAll('[data-testid^="footer-link-"]')).map(a => a.getAttribute('data-testid')))
    const compact = ids(screen.getByTestId('footer-compact'))
    const full = ids(screen.getByTestId('footer-full'))
    // Legal lives in the essentials row on phones; every other governed link appears in both.
    for (const id of full) if (!/resources\.(privacy|terms)/.test(id!)) expect(compact.has(id), id!).toBe(true)
    expect(container.querySelectorAll('footer')).toHaveLength(1)
  })
})

describe('phones: purpose-built compact footer', () => {
  it('Help, Contact, Terms and Privacy are up front with 44px targets; the rest sits in one disclosure', () => {
    renderFooter()
    const compact = screen.getByTestId('footer-compact')
    for (const id of ['resources.help', 'company.contact', 'resources.terms', 'resources.privacy']) {
      const link = within(compact).getByTestId(`footer-essential-${id}`)
      expect(link.className).toMatch(/min-h-11/)
    }
    const more = within(compact).getByTestId('footer-more')
    expect(more.tagName).toBe('DETAILS')
    expect(more.hasAttribute('open')).toBe(false)
    expect(within(more).getByText('More about CarUp').closest('summary')).not.toBeNull()
  })

  it('clears whichever single bottom bar is showing (tab bar, or a page action bar that claimed it)', () => {
    renderFooter()
    expect(screen.getByTestId('showroom-footer').className).toMatch(/pb-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/)
    function Claim() { useClaimBottomBar(true); return null }
    act(() => { render(<Claim />) })
    expect(screen.getByTestId('showroom-footer').className).toMatch(/pb-\[calc\(6\.25rem\+env\(safe-area-inset-bottom\)\)\]/)
    expect(screen.getByTestId('showroom-footer').className).toMatch(/lg:pb-0/)
  })
})

describe('Public / Workspace / Focused footer policy (route → shell register)', () => {
  it.each([
    ['/', 'public'], ['/marketplace', 'public'], ['/marketplace/ABC', 'public'], ['/contact', 'public'],
    ['/dealers', 'public'], ['/dealers/zw-deal-0001', 'public'], ['/privacy', 'public'],
    ['/dealers/stock', 'utility'], ['/dealers/inquiries', 'utility'], ['/diaspora/imports', 'utility'],
    ['/diaspora/imports/7f3c', 'utility'], ['/diaspora/imports/7f3c/shipment', 'utility'], ['/admin/diaspora/compliance', 'utility'],
    ['/sell', 'none'], ['/dealers/zw-deal-0001/claim', 'none'], ['/dealers/claims', 'none'], ['/diaspora/imports/new', 'none'], ['/kyc', 'none'],
  ])('%s → %s', (path, mode) => {
    expect(mainLayoutFooterMode(path)).toBe(mode)
  })

  it('the utility footer carries identity + help/legal only — no marketing sitemap', () => {
    const { container } = renderFooter({}, <ShowroomUtilityFooter />)
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(['/help', '/contact', '/privacy', '/terms'])
    expect(container.textContent).toMatch(/© \d{4} CarUp Technologies/)
    expect(container.textContent).not.toMatch(/Who CarUp serves|Product|Company/)
  })
})

describe('MainLayout composition', { timeout: 30000 }, () => {
  async function renderLayout(path: string, chrome: boolean) {
    vi.resetModules()
    if (chrome) vi.stubGlobal('__CARUP_SHOWROOM_CHROME__', true)
    const { default: MainLayout } = await import('./MainLayout')
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="*" element={<div>page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  }

  it('flags OFF: the accepted legacy desktop-only footer, exactly one, no showroom footer', async () => {
    const { container } = await renderLayout('/', false)
    expect(container.querySelector('[data-testid="showroom-footer"]')).toBeNull()
    expect(container.querySelector('div.hidden.lg\\:block > footer')).not.toBeNull()
    expect(container.querySelectorAll('footer')).toHaveLength(1)
    expect(container.querySelector('main')!.className).toBe('flex-1 pb-20 lg:pb-0')
  })

  it('showroom chrome ON: Home gets exactly one public footer, visible on phones too', async () => {
    const { container } = await renderLayout('/', true)
    expect(container.querySelectorAll('footer')).toHaveLength(1)
    const footer = container.querySelector('[data-testid="showroom-footer"]')!
    expect(footer.parentElement?.className ?? '').not.toMatch(/hidden/)
  })

  it('showroom chrome ON: a dealer operations route gets the utility footer, a focused flow gets none', async () => {
    let r = await renderLayout('/dealers/stock', true)
    expect(r.container.querySelector('[data-testid="showroom-utility-footer"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="showroom-footer"]')).toBeNull()
    r.unmount()
    r = await renderLayout('/diaspora/imports/new', true)
    expect(r.container.querySelectorAll('footer')).toHaveLength(0)
    expect(r.container.querySelector('main')!.className).toMatch(/pb-20/)
  })
})
