/**
 * OC-5R-REL-02 B — two responsive navigation systems, each truthful about its own active destination.
 *
 * The signed-in dashboard renders BOTH a sidebar (an `<aside>` holding a `<nav>`) and the compact
 * bottom bar. Each marks the current destination with `aria-current="page"`. The bar is `lg:hidden`
 * (CSS only), so at desktop widths it is hidden but still in the DOM.
 *
 * The deployed navigation spec (41, E1.2) originally asserted `nav a[aria-current="page"]` had a
 * count of exactly 1 across the page. That counted both systems and could never hold; what the spec
 * set out to prove is that the SIDEBAR has exactly one active destination. The product is correct and
 * unchanged — this test pins the facts the corrected, sidebar-scoped assertion relies on, against the
 * real components, so the harness fix cannot drift from the product:
 *
 *   · the sidebar has exactly one active destination, and it is the current route;
 *   · the compact bar marks its OWN current destination at the same time — that is not a defect;
 *   · therefore an unscoped count is > 1 by design, and a sidebar-scoped count is the contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u_seller', name: 'Golden Seller', email: 'seller@example.test', role: 'owner' },
    isAuthenticated: true,
    loading: false,
    switchRole: vi.fn(),
  }),
}))
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))
vi.mock('@/components/layout/OrganisationSwitcher', () => ({
  ActiveOrganisationPrompt: () => null,
  OrganisationBadge: () => null,
}))

const DashboardLayout = (await import('./DashboardLayout')).default

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout role="owner" />}>
          <Route path={path} element={<div data-testid="page" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const SIDEBAR_CURRENT = 'aside > nav a[aria-current="page"]'
const COMPACT_CURRENT = '[data-testid="compact-bottom-nav"] a[aria-current="page"]'
const ANY_NAV_CURRENT = 'nav a[aria-current="page"]'

beforeEach(() => { document.body.innerHTML = '' })

describe('REL-02 B — the sidebar contract survives a compact bar that marks its own destination', () => {
  for (const route of ['/dashboard/garage', '/dashboard/evidence']) {
    it(`${route}: the sidebar has exactly ONE active destination — the current route`, () => {
      const { container } = renderAt(route)
      const current = container.querySelectorAll(SIDEBAR_CURRENT)
      expect(current.length, 'the sidebar must mark exactly one destination').toBe(1)
      expect(current[0].getAttribute('href')).toBe(route)
    })
  }

  it('the compact bar marks its OWN current destination at the same time (not a defect)', () => {
    const { container } = renderAt('/dashboard/garage')
    const compact = container.querySelectorAll(COMPACT_CURRENT)
    expect(compact.length, 'the compact bar truthfully marks its own active destination').toBe(1)
    expect(compact[0].getAttribute('href')).toBe('/dashboard/garage')
  })

  it('so an UNSCOPED count is more than one by design — the assertion that was wrong', () => {
    const { container } = renderAt('/dashboard/garage')
    expect(container.querySelectorAll(ANY_NAV_CURRENT).length).toBeGreaterThan(1)
    // …while the sidebar-scoped contract still reads exactly one.
    expect(container.querySelectorAll(SIDEBAR_CURRENT).length).toBe(1)
  })

  it('the bar is hidden by CSS above the large breakpoint yet stays in the DOM', () => {
    const { container } = renderAt('/dashboard/garage')
    const bar = container.querySelector('[data-testid="compact-bottom-nav"]')
    expect(bar, 'present in the DOM').not.toBeNull()
    expect(bar!.className).toContain('lg:hidden')
  })

  it('the sidebar scope is unambiguous: one aside, one direct nav', () => {
    const { container } = renderAt('/dashboard/garage')
    expect(container.querySelectorAll('aside').length).toBe(1)
    expect(container.querySelectorAll('aside > nav').length).toBe(1)
    // The compact bar is not inside the aside, so the scope cannot capture it.
    expect(container.querySelector('aside [data-testid="compact-bottom-nav"]')).toBeNull()
  })
})
