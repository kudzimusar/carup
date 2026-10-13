/**
 * PC01-K1 — no rendered shell navigation control may lead to "Page not found".
 *
 * The registry's own routes are already checked against App.tsx
 * (featureRegistry.route-validation.test.ts). The owner's 404 came from somewhere that check cannot
 * see: a HARD-CODED `/settings` in the dashboard footer. This sweep checks what the shells actually
 * RENDER, for every role and for a signed-out visitor, plus every literal destination written into
 * the shell source, against the routes App.tsx declares.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { ROLE_METADATA, getVisiblePublicNavigationItems, type NavigationContext } from '@/config/featureRegistry'
import { getDesktopMegaMenu } from '@/config/navigationManifest'
import type { UserRole } from '@shared/types'

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  const Ctx = React.createContext<Record<string, unknown> | null>(null)
  function TestAuthProvider({ user, children }: { user: unknown; children: ReactNode }) {
    const value = { user, token: user ? 't' : null, isAuthenticated: !!user, loading: false, login() {}, logout() {}, switchRole: async () => {}, selectActiveTenant: async () => {}, refreshSession: async () => {} }
    return React.createElement(Ctx.Provider, { value }, children)
  }
  return { useAuth: () => React.useContext(Ctx), TestAuthProvider }
})
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))
vi.mock('@/components/layout/OrganisationSwitcher', () => ({
  ActiveOrganisationPrompt: () => null, OrganisationBadge: () => null, OrganisationMenuSection: () => null,
}))
vi.mock('@/App', () => ({ useApp: () => ({ currency: 'USD', setCurrency: () => {} }) }))
const api = { fetchMarketplaceNavCoverage: async () => null, fetchNotifications: async () => [] }
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const { TestAuthProvider } = (await import('@/context/AuthContext')) as unknown as {
  TestAuthProvider: (p: { user: unknown; children: ReactNode }) => JSX.Element
}
const DashboardLayout = (await import('./DashboardLayout')).default
const Navbar = (await import('./Navbar')).default
const MobileNavDrawer = (await import('./MobileNavDrawer')).default
const CompactBottomNav = (await import('./CompactBottomNav')).default

// ── The routes App.tsx declares ────────────────────────────────────────────────────────────────
const SRC = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
const declared = [...SRC('../../App.tsx').matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/g)]
  .map((m) => m[1]).filter((p) => p.startsWith('/'))
const patterns = declared.map((p) => new RegExp(`^${p
  .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\/:[^/]+/g, '/[^/]+')
  .replace(/\/\*$/, '(?:/.*)?')}/?$`))
const resolves = (href: string) => /^(https?:|mailto:|tel:)/.test(href) || patterns.some((r) => r.test(href.split(/[?#]/)[0]))

const ROLES = Object.keys(ROLE_METADATA) as UserRole[]
const userFor = (role: string) => ({ id: `u-${role}`, name: `Test ${role}`, email: `${role}@carup.test`, role, avatar: 'x' })
const hrefsIn = (root: ParentNode) => [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!)

function unresolved(surface: string, hrefs: string[]) {
  return [...new Set(hrefs)].filter((h) => !resolves(h)).map((h) => `${surface}: ${h}`)
}

describe('shell route integrity (PC01-K1)', () => {
  it('the declared-route parser sees the app (guard against a silently empty sweep)', () => {
    expect(declared.length).toBeGreaterThan(100)
    expect(resolves('/dashboard/garage/ABC123')).toBe(true)
    expect(resolves('/settings')).toBe(false)
  })

  it.each(ROLES)('every link the %s dashboard shell renders resolves to a route', (role) => {
    const home = ROLE_METADATA[role].dashboardRoute
    const { container } = render(
      <TestAuthProvider user={userFor(role)}>
        <MemoryRouter initialEntries={[home]}>
          <Routes>
            <Route element={<DashboardLayout role={role} />}>
              <Route path={home} element={<div />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestAuthProvider>,
    )
    const hrefs = hrefsIn(container)
    expect(hrefs.length).toBeGreaterThan(2)
    expect(unresolved(`${role} dashboard`, hrefs)).toEqual([])
  })

  it.each([...ROLES, null])('every link the compact bottom bar renders for %s resolves', (role) => {
    const { container } = render(
      <TestAuthProvider user={role ? userFor(role) : null}>
        <MemoryRouter initialEntries={['/']}><CompactBottomNav onOpenMore={() => {}} /></MemoryRouter>
      </TestAuthProvider>,
    )
    expect(unresolved(`bottom bar (${role ?? 'signed out'})`, hrefsIn(container))).toEqual([])
  })

  it.each([...ROLES, null])('every link the public drawer renders for %s resolves', (role) => {
    render(
      <TestAuthProvider user={role ? userFor(role) : null}>
        <MemoryRouter initialEntries={['/marketplace']}><MobileNavDrawer /></MemoryRouter>
      </TestAuthProvider>,
    )
    fireEvent.click(screen.getByTestId('mobile-menu-button'))
    const drawer = screen.getByTestId('mobile-nav-drawer')
    const hrefs = hrefsIn(drawer)
    expect(hrefs.length).toBeGreaterThan(3)
    expect(unresolved(`drawer (${role ?? 'signed out'})`, hrefs)).toEqual([])
  })

  it.each(ROLES)('every link in the %s account menu and header resolves', async (role) => {
    const { container } = render(
      <TestAuthProvider user={userFor(role)}>
        <MemoryRouter initialEntries={['/marketplace']}><Navbar /></MemoryRouter>
      </TestAuthProvider>,
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: new RegExp(`Account menu for Test ${role}`) }), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const menu = await screen.findByRole('menu')
    expect(unresolved(`${role} account menu`, [...hrefsIn(menu), ...hrefsIn(container)])).toEqual([])
  })

  it('every ACTIVE public navigation item resolves; planned items are not links', () => {
    const contexts: NavigationContext[] = [
      { isAuthenticated: false, role: null, environment: 'production' },
      ...ROLES.map((role): NavigationContext => ({ isAuthenticated: true, role, environment: 'production' })),
    ]
    const bad: string[] = []
    for (const ctx of contexts) {
      for (const menu of ['navbar-mega-buy', 'navbar-mega-sell', 'navbar-mega-verify', 'navbar-mega-parts', 'navbar-more']) {
        for (const section of getDesktopMegaMenu(menu, ctx)) {
          for (const item of section.items) if (item.active && !resolves(item.href)) bad.push(`${menu} (${ctx.role ?? 'public'}): ${item.href}`)
        }
      }
      for (const link of getVisiblePublicNavigationItems(ctx)) if (!resolves(link.route)) bad.push(`public nav (${ctx.role ?? 'public'}): ${link.route}`)
    }
    expect(bad).toEqual([])
  })

  it('every literal destination written into the shell source resolves (no hard-coded dead link)', () => {
    const files = ['DashboardLayout.tsx', 'Navbar.tsx', 'MobileNavDrawer.tsx', 'CompactBottomNav.tsx', 'compactNavDestinations.ts', 'useShellSignOut.ts']
    const literals: string[] = []
    for (const file of files) {
      const text = SRC(`./${file}`)
      for (const re of [/\bto=\{?["'`](\/[^"'`$]*)["'`]/g, /\bhref:\s*["'](\/[^"']*)["']/g, /navigate\(\s*["'](\/[^"']*)["']/g]) {
        for (const m of text.matchAll(re)) literals.push(`${file}|${m[1]}`)
      }
    }
    expect(literals.length).toBeGreaterThan(5)
    const bad = literals.filter((l) => !resolves(l.split('|')[1]))
    expect(bad).toEqual([])
  })
})
