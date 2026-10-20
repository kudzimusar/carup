/**
 * OC-NATIVE-FINAL-02-R1 P2-D — the tablet/phone drawer offered links that a route refuses.
 *
 * 1. "Sell" (mobile.sell) carried no roles, so every signed-in platform mechanic, insurer, government
 *    officer, bank officer and administrator was offered /dashboard/sell-vehicle — a route admitted
 *    only to owners and dealers — and was redirected away when they tapped it.
 * 2. The drawer built its navigation context WITHOUT the selected organisation, so
 *    getMobileNavigation (already taught both roles of a garage employee) was never told a garage
 *    member was one: their drawer listed owner items and pointed "Dashboard" at the owner dashboard,
 *    while the navbar, sidebar and compact bar — which do pass it — did not.
 *
 * Drawer DENSITY (about 33 items for an owner) is design debt, not role exposure, and is not changed.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getMobileNavigation } from '@/config/navigationManifest'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import type { NavigationContext } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user, logout: vi.fn(async () => 'revoked') }) }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const MobileNavDrawer = (await import('./MobileNavDrawer')).default

const PLATFORM_ROLES: UserRole[] = ['owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'admin']
const signedIn = (role: UserRole): NavigationContext => ({ isAuthenticated: true, role, environment: 'test' })
const path = (href: string) => href.split('?')[0]

describe('the drawer offers only routes the signed-in person can open (OC-NATIVE-FINAL-02-R1 P2-D)', () => {
  it.each(PLATFORM_ROLES)('every Browse and dashboard link offered to %s is admitted by its route', (role) => {
    const nav = getMobileNavigation(signedIn(role))
    const hrefs = [...nav.primary, ...nav.roleItems].map((item) => item.href)
    if (nav.dashboardRoot) hrefs.push(nav.dashboardRoot.href)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      const decision = evaluateRouteAccess({ route: path(href), isBootstrapping: false, isAuthenticated: true, role, activeTenant: null })
      expect(['render', 'render-beta'], `${href} is offered to ${role} but the route answers ${decision.kind}`).toContain(decision.kind)
    }
  })

  it('Sell is offered to owners, dealers and guests, and to no other signed-in role', () => {
    const sellFor = (ctx: NavigationContext) => getMobileNavigation(ctx).primary.find((item) => item.id === 'mobile.sell')
    expect(sellFor(signedIn('owner'))?.href).toBe('/dashboard/sell-vehicle')
    expect(sellFor(signedIn('dealer'))?.href).toBe('/dashboard/sell-vehicle')
    expect(sellFor({ isAuthenticated: false, role: null, environment: 'test' })?.href).toBe('/sell')
    for (const role of ['mechanic', 'insurance', 'government', 'bank', 'admin'] as UserRole[]) {
      expect(sellFor(signedIn(role)), `${role} must not be offered Sell`).toBeUndefined()
    }
  })

  it('a garage member’s drawer shows their garage and points Dashboard at where they operate', () => {
    auth.user = {
      id: 'u-garage-member', name: 'Garage Member', email: 'member@carup.test', role: 'owner',
      active_tenant: { id: 'tenant-garage-1', type: 'garage', role: 'mechanic' },
    }
    render(<MemoryRouter initialEntries={['/marketplace']}><MobileNavDrawer /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('mobile-menu-button'))
    const drawer = screen.getByTestId('mobile-nav-drawer')
    expect(within(drawer).getByTestId('mobile-navitem-garage.workshop')).toBeInTheDocument()
    expect(within(drawer).getByTestId('mobile-dashboard-root').getAttribute('href')).toBe('/garage')
  })

  it('a plain owner’s drawer still shows no garage surface', () => {
    auth.user = { id: 'u-owner', name: 'Plain Owner', email: 'owner@carup.test', role: 'owner' }
    render(<MemoryRouter initialEntries={['/marketplace']}><MobileNavDrawer /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('mobile-menu-button'))
    const drawer = screen.getByTestId('mobile-nav-drawer')
    expect(drawer.querySelector('[data-testid^="mobile-navitem-garage."]')).toBeNull()
    expect(within(drawer).getByTestId('mobile-dashboard-root').getAttribute('href')).toBe('/dashboard')
  })
})
