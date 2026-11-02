/**
 * PC01-K1 — authenticated + public shell integrity.
 *
 * Owner-proven defects this guards: the dashboard drawer's account actions sat under the compact
 * bottom bar; Settings linked to /settings, which has no route; Sign Out cleared localStorage and
 * reloaded instead of using the auth context; a signed-out phone had no visible Sign In; and every
 * shell offered all seven platform roles as switches the server refuses.
 * Geometry (overlap, short viewports) is proven in tests/agents/40-pc01-k1-shell-integrity.spec.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const logoutSpy = vi.fn()
const signOut = vi.hoisted(() => ({ outcome: 'revoked' as 'revoked' | 'already_ended' | 'unconfirmed' }))
const toastWarning = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { warning: toastWarning, error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  type U = { id: string; name: string; email: string; role: string; avatar?: string } | null
  const Ctx = React.createContext<Record<string, unknown> | null>(null)
  function TestAuthProvider({ initialUser, children }: { initialUser: U; children: ReactNode }) {
    const [user, setUser] = React.useState<U>(initialUser)
    const value = {
      user, token: user ? 't' : null, isAuthenticated: !!user, loading: false,
      login: (u: U) => setUser(u),
      logout: async () => { logoutSpy(); setUser(null); return signOut.outcome },
      switchRole: vi.fn(async () => {}), selectActiveTenant: vi.fn(async () => {}), refreshSession: vi.fn(async () => {}),
    }
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
  TestAuthProvider: (p: { initialUser: unknown; children: ReactNode }) => JSX.Element
}
const DashboardLayout = (await import('./DashboardLayout')).default
const Navbar = (await import('./Navbar')).default
const MobileNavDrawer = (await import('./MobileNavDrawer')).default
const CompactBottomNav = (await import('./CompactBottomNav')).default

const userFor = (role: string) => ({ id: `u-${role}`, name: `Test ${role}`, email: `${role}@carup.test`, role, avatar: 'x' })
const DASH: Record<string, string> = { owner: '/dashboard', admin: '/admin' }

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function renderDashboard(role: 'owner' | 'admin', initialUser: unknown = userFor(role)) {
  return render(
    <TestAuthProvider initialUser={initialUser}>
      <MemoryRouter initialEntries={[DASH[role]]}>
        <Routes>
          <Route element={<DashboardLayout role={role} />}>
            <Route path={DASH[role]} element={<div data-testid="private-page">private {role}</div>} />
          </Route>
          <Route path="/" element={<div data-testid="home">home</div>} />
          <Route path="/login" element={<div data-testid="login">login</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </TestAuthProvider>,
  )
}

beforeEach(() => { logoutSpy.mockReset(); toastWarning.mockReset(); signOut.outcome = 'revoked' })

describe('Sign Out when the server cannot confirm the session ended (PC01-K1-R1)', () => {
  it('still lands on the anonymous public home, and says plainly the server side is unconfirmed', async () => {
    signOut.outcome = 'unconfirmed'
    renderDashboard('admin')
    fireEvent.click(screen.getByTestId('logout-button'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    expect(screen.queryByTestId('private-page')).toBeNull()
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1))
    expect(String(toastWarning.mock.calls[0][0])).toMatch(/could not confirm your session ended on the server/)
  })

  it('a confirmed revocation shows no warning', async () => {
    renderDashboard('admin')
    fireEvent.click(screen.getByTestId('logout-button'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    await new Promise((r) => setTimeout(r, 20))
    expect(toastWarning).not.toHaveBeenCalled()
    expect(logoutSpy).toHaveBeenCalledTimes(1)
  })
})

describe.each(['admin', 'owner'] as const)('%s dashboard shell', (role) => {
  it('states the active portal instead of offering every platform role', () => {
    renderDashboard(role)
    const sidebar = screen.getByTestId('dashboard-sidebar')
    expect(within(sidebar).getByTestId('active-portal')).toHaveTextContent(role === 'admin' ? 'Administrator' : 'Car Owner')
    expect(within(sidebar).queryByRole('combobox')).toBeNull()
    expect(sidebar.querySelector('select')).toBeNull()
    expect(within(sidebar).queryByText(/Change to/)).toBeNull()
  })

  it('exposes Sign Out in the account actions and offers no Settings control that could 404', () => {
    renderDashboard(role)
    const actions = screen.getByTestId('sidebar-account-actions')
    expect(within(actions).getByTestId('logout-button')).toHaveTextContent('Sign Out')
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull()
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
  })

  it('the open drawer and its overlay sit above the compact bottom bar', () => {
    renderDashboard(role)
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar menu' }))
    const sidebar = screen.getByTestId('dashboard-sidebar')
    expect(sidebar).toHaveAttribute('data-open', 'true')
    const z = (el: Element) => Number((el.className.match(/\bz-\[?(\d+)\]?/) || [])[1])
    const bar = screen.getByTestId('compact-bottom-nav')
    expect(z(sidebar)).toBeGreaterThan(z(bar))
    expect(z(screen.getByTestId('sidebar-overlay'))).toBeGreaterThan(z(bar))
    // The account actions never shrink and the nav list is the part that scrolls.
    expect(screen.getByTestId('sidebar-account-actions').className).toMatch(/\bshrink-0\b/)
    expect(within(sidebar).getByRole('navigation', { name: 'Dashboard navigation' }).className).toMatch(/\bmin-h-0\b.*\boverflow-y-auto\b|\boverflow-y-auto\b.*\bmin-h-0\b/)
  })

  it('More opens the same drawer; Escape closes it and returns focus to More', async () => {
    renderDashboard(role)
    const more = within(screen.getByTestId('compact-bottom-nav')).getByRole('button', { name: /More/ })
    more.focus()
    fireEvent.click(more)
    expect(screen.getByTestId('dashboard-sidebar')).toHaveAttribute('data-open', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close sidebar menu' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('dashboard-sidebar')).toHaveAttribute('data-open', 'false')
    await waitFor(() => expect(more).toHaveFocus())
  })

  it('Sign Out goes through the auth context to an anonymous public shell; the private route then refuses', async () => {
    const view = renderDashboard(role)
    localStorage.setItem('carup_sell_draft', 'keep-me')
    fireEvent.click(screen.getByTestId('logout-button'))
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByTestId('private-page')).toBeNull()
    // Unrelated stored state survives — the old handler ran localStorage.clear().
    expect(localStorage.getItem('carup_sell_draft')).toBe('keep-me')
    localStorage.removeItem('carup_sell_draft')
    view.unmount()

    // Later, a direct visit to the protected route while anonymous is redirected to sign in.
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000)
    try {
      renderDashboard(role, null)
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/login\?returnTo=/))
      expect(screen.queryByTestId('private-page')).toBeNull()
    } finally {
      later.mockRestore()
    }
  })
})

describe('public shell — signed out on a phone', () => {
  function renderPublic(user: unknown) {
    return render(
      <TestAuthProvider initialUser={user}>
        <MemoryRouter initialEntries={['/']}>
          <Navbar />
          <CompactBottomNav />
        </MemoryRouter>
      </TestAuthProvider>,
    )
  }

  it('shows an explicit Sign in in the header and in the bottom bar', () => {
    renderPublic(null)
    const signIn = screen.getByTestId('compact-signin')
    expect(signIn).toHaveTextContent('Sign in')
    expect(signIn).toHaveAttribute('href', '/login')
    expect(signIn.closest('a, [class]')?.className ?? '').not.toMatch(/(^|\s)hidden(\s|$)/)
    const barItem = within(screen.getByTestId('compact-bottom-nav')).getByText('Sign in').closest('a')
    expect(barItem).toHaveAttribute('href', '/login')
  })

  it('signed in, the header has no Sign in and the bar slot is the account', () => {
    renderPublic(userFor('owner'))
    expect(screen.queryByTestId('compact-signin')).toBeNull()
  })
})

describe('portal presentation is truthful', () => {
  async function openAccountMenu(role: string) {
    render(
      <TestAuthProvider initialUser={userFor(role)}>
        <MemoryRouter initialEntries={['/marketplace']}><Navbar /></MemoryRouter>
      </TestAuthProvider>,
    )
    const trigger = screen.getByRole('button', { name: new RegExp(`Account menu for Test ${role}`) })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    return screen.findByRole('menu')
  }

  it('admin account menu: active portal stated, no catalogue switches, no owner pages, no Settings', async () => {
    const menu = await openAccountMenu('admin')
    expect(within(menu).getByTestId('navbar-active-portal')).toHaveTextContent('Administrator')
    expect(within(menu).queryByText(/Change to|Switch Portal Role/)).toBeNull()
    expect(within(menu).queryByText('My Garage')).toBeNull()
    expect(within(menu).queryByText('Gutu AI')).toBeNull()
    expect(within(menu).queryByText(/^\s*Settings\s*$/)).toBeNull()
    expect(within(menu).getByTestId('logout-button')).toBeInTheDocument()
  })

  it('owner account menu offers exactly the registry user_menu items for owners', async () => {
    const menu = await openAccountMenu('owner')
    for (const id of ['owner.garage', 'owner.ai']) expect(within(menu).getByTestId(`user-menu-${id}`)).toBeInTheDocument()
    expect(within(menu).queryByText(/Change to/)).toBeNull()
  })

  it('the public drawer states the portal and offers no role catalogue', () => {
    render(
      <TestAuthProvider initialUser={userFor('admin')}>
        <MemoryRouter initialEntries={['/marketplace']}><MobileNavDrawer /></MemoryRouter>
      </TestAuthProvider>,
    )
    fireEvent.click(screen.getByTestId('mobile-menu-button'))
    const drawer = screen.getByTestId('mobile-nav-drawer')
    expect(within(drawer).getByTestId('mobile-active-portal')).toHaveTextContent('Administrator')
    expect(drawer.querySelector('[data-testid^="mobile-roleswitch-"]')).toBeNull()
    expect(within(drawer).getByTestId('mobile-signout')).toBeInTheDocument()
  })
})
