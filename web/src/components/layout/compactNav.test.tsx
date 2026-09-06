/**
 * The compact (mobile) navigation bar — one component, driven by the registry.
 *
 * WHAT THIS PINS.
 *
 * 1. The authenticated shell had NO compact navigation at all. `CompactBottomNav` was mounted only
 *    in `MainLayout` (the public shell), so every signed-in workspace on a phone had a hamburger
 *    drawer and nothing else — no persistent route to the work.
 *
 * 2. `getMobileNavigation` resolved role items from the PLATFORM role alone. A real garage
 *    tenant-member's drawer showed nineteen owner items, zero garage items, and a "Dashboard"
 *    pointing at the owner dashboard they had just been routed away from. That was the SEVENTH
 *    place in CarUp to judge a person by one of their two true roles.
 *
 * 3. `CompactBottomNav` carried its own `ROLE_HOME` map — a second role→home inference beside the
 *    registry's. Destinations now come from the registry and are filtered by the same
 *    `resolveFeatureVisibility` the sidebar, drawer and route boundary use.
 *
 * The invariant under test throughout: **navigation visibility and route admission derive from the
 * same facts.** A bar that offers what a route refuses is worse than no bar.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resolveCompactDestinations, resolveCompactHome, COMPACT_NAV_MAX } from './compactNavDestinations'
import { getMobileNavigation } from '@/config/navigationManifest'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import type { NavigationContext } from '@/config/featureRegistry'

const OWNER: NavigationContext = { isAuthenticated: true, role: 'owner', environment: 'test' }
const GARAGE_MEMBER: NavigationContext = {
  isAuthenticated: true, role: 'owner', tenantRole: 'mechanic' as never, environment: 'test',
}

describe('the bar follows the role the person is OPERATING as', () => {
  it('a garage employee gets garage destinations, not their own car', () => {
    const ids = resolveCompactDestinations(GARAGE_MEMBER).map((d) => d.id)
    expect(ids, 'the workshop is the garage operator’s primary destination').toContain('garage.workshop')
    expect(ids).not.toContain('owner.garage')
  })

  it('an ordinary owner gets owner destinations and NO garage destination', () => {
    const ids = resolveCompactDestinations(OWNER).map((d) => d.id)
    expect(ids).toContain('owner.overview')
    expect(ids.filter((i) => i.startsWith('garage.')), 'a plain owner must never be offered a garage surface')
      .toEqual([])
  })

  it('home comes from the registry, not a second role map', () => {
    // CompactBottomNav used to carry its own ROLE_HOME. Both answers must now agree with the
    // registry's dashboardRoute, which is what every other surface uses.
    expect(resolveCompactHome(GARAGE_MEMBER)).toBe('/mechanic')
    expect(resolveCompactHome(OWNER)).toBe('/dashboard')
  })

  it('leaves room for More within the ceiling the native lane holds', () => {
    for (const ctx of [OWNER, GARAGE_MEMBER]) {
      expect(resolveCompactDestinations(ctx).length).toBeLessThanOrEqual(COMPACT_NAV_MAX - 1)
    }
  })
})

describe('what the bar offers, the route admits', () => {
  it('every destination the bar shows is a route this actor can actually open', () => {
    for (const ctx of [OWNER, GARAGE_MEMBER]) {
      for (const d of resolveCompactDestinations(ctx)) {
        const decision = evaluateRouteAccess({
          route: d.href,
          isBootstrapping: false,
          isAuthenticated: true,
          role: ctx.role ?? null,
          tenantRole: (ctx.tenantRole as string | undefined) ?? null,
        })
        expect(decision.kind, `${d.href} is offered to ${ctx.tenantRole ?? ctx.role} but the route refuses it`)
          .toBe('render')
      }
    }
  })

  it('an anonymous visitor is offered no authenticated destination', () => {
    expect(resolveCompactDestinations({ isAuthenticated: false, role: null })).toEqual([])
  })
})

describe('the mobile drawer sees both true roles too', () => {
  it('a garage member finds their garage surfaces in the drawer', () => {
    const nav = getMobileNavigation(GARAGE_MEMBER)
    const ids = nav.roleItems.map((i) => i.id)
    expect(ids, 'the drawer showed 19 owner items and no garage items').toContain('garage.workshop')
  })

  it('and is pointed at where they actually operate', () => {
    expect(getMobileNavigation(GARAGE_MEMBER).dashboardRoot?.href).toBe('/mechanic')
  })

  it('a plain owner is unaffected — the control case', () => {
    const ids = getMobileNavigation(OWNER).roleItems.map((i) => i.id)
    expect(ids.filter((i) => i.startsWith('garage.'))).toEqual([])
    expect(getMobileNavigation(OWNER).dashboardRoot?.href).toBe('/dashboard')
  })
})

describe('the rendered bar', () => {
  function renderBar(user: Record<string, unknown> | null, path = '/dashboard') {
    vi.doMock('@/context/AuthContext', () => ({ useAuth: () => ({ user, isAuthenticated: !!user }) }))
    return path
  }

  it('renders public wayfinding when signed out, with safe-area padding and touch targets', async () => {
    vi.resetModules()
    vi.doMock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }))
    const { default: Bar } = await import('./CompactBottomNav')
    render(<MemoryRouter><Bar /></MemoryRouter>)

    const nav = screen.getByTestId('compact-bottom-nav')
    expect(nav.getAttribute('data-context')).toBe('public')
    // DESIGN.md §10: mobile-only, safe-area aware, adequate touch targets.
    expect(nav.className).toContain('lg:hidden')
    expect(nav.className).toContain('safe-area-inset-bottom')
    for (const item of screen.getAllByTestId('compact-nav-item')) {
      expect(item.className, 'touch targets must be at least 56px tall').toContain('min-h-14')
    }
    renderBar(null)
  })
})
