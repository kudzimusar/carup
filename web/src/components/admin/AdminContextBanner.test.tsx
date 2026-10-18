/**
 * CA-OWNER-02 — the operational Admin says where the Owner is, which authority applies, and the way back to Corporate Admin.
 *
 * The real banner and the real DashboardLayout under the real router. Only the authenticated identity is mocked; the
 * SERVER's Corporate access decision is answered by a fake backend through the real API client, exactly as the shipped
 * GET /api/corporate/access answers it. Every account here has the local platform role it names, so a test that withholds
 * the way back while the local role is `admin` proves the decision is the server's, not the client's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SERVER_DENIAL, SERVER_GRANT } from '@/test/corporateAccessFixture'
import { phoneBox } from '@/components/corporate/touchTarget.testutil'

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  const Ctx = React.createContext<Record<string, unknown> | null>(null)
  function TestAuthProvider({ user, children }: { user: { id: string } | null; children: ReactNode }) {
    const value = {
      user, token: user ? `tok-${user.id}` : null, isAuthenticated: !!user, loading: false,
      logout: async () => 'revoked', switchRole: async () => {}, selectActiveTenant: async () => {}, refreshSession: async () => {},
    }
    return React.createElement(Ctx.Provider, { value }, children)
  }
  return { useAuth: () => React.useContext(Ctx), TestAuthProvider }
})
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))
vi.mock('@/components/layout/OrganisationSwitcher', () => ({ ActiveOrganisationPrompt: () => null, OrganisationBadge: () => null, OrganisationMenuSection: () => null }))
vi.mock('@/App', () => ({ useApp: () => ({ currency: 'USD', setCurrency: () => {} }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchMarketplaceNavCoverage: async () => null, fetchNotifications: async () => [] }) }))

const { TestAuthProvider } = (await import('@/context/AuthContext')) as unknown as {
  TestAuthProvider: (p: { user: unknown; children: ReactNode }) => JSX.Element
}
const { AdminContextBanner } = await import('./AdminContextBanner')
const DashboardLayout = (await import('@/components/layout/DashboardLayout')).default

const userFor = (role: string) => ({ id: `u-${role}`, name: `Test ${role}`, email: `${role}@carup.test`, role, avatar: 'x' })
const STATEMENT = 'Operational Admin — live operational records. Access here comes from your platform role (users.role), not from Corporate memberships or permissions.'

/** The fake backend for GET /api/corporate/access. It sees only the request — never the local AuthContext role. */
type Settled = { status: number; body: unknown }
let answer: Settled | 'hang' | Promise<Settled>
const accessCalls: Array<Record<string, string>> = []
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  answer = { status: 200, body: SERVER_GRANT }
  accessCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    if (!String(input).endsWith('/corporate/access')) return json(404, { error: 'Route not found' })
    accessCalls.push(Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])))
    if (answer === 'hang') return new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
    const settled = await answer
    return json(settled.status, settled.body)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function renderBanner(path: string, user: unknown = userFor('admin')) {
  return render(
    <TestAuthProvider user={user}>
      <MemoryRouter initialEntries={[path]}><AdminContextBanner /></MemoryRouter>
    </TestAuthProvider>,
  )
}

const HOME: Record<'admin' | 'owner', string> = { admin: '/admin', owner: '/dashboard' }
function renderDashboard(layoutRole: 'admin' | 'owner', path: string, user: unknown = userFor(layoutRole)) {
  const other = layoutRole === 'admin' ? 'owner' : 'admin'
  return render(
    <TestAuthProvider user={user}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<DashboardLayout role={layoutRole} />}>
            <Route path={HOME[layoutRole]} element={<div data-testid="private-page">{layoutRole} page</div>} />
          </Route>
          <Route path={HOME[other]} element={<div data-testid={`${other}-home`} />} />
          <Route path="/login" element={<div data-testid="login" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </TestAuthProvider>,
  )
}

describe('the operational authority model is always stated', () => {
  it('names the records and the authority, whatever the Corporate decision — even before it arrives', () => {
    answer = 'hang'
    renderBanner('/admin')
    const banner = screen.getByRole('region', { name: 'Operational Admin context' })
    expect(within(banner).getByTestId('admin-context-statement').textContent).toBe(STATEMENT)
  })
})

describe('the way back to Corporate Admin follows the SERVER decision for this session, and nothing else', () => {
  it('granted: "Return to Corporate Admin" opens /corporate — asked with the session token alone', async () => {
    renderBanner('/admin/users')
    const link = await screen.findByRole('link', { name: 'Return to Corporate Admin' })
    expect(link).toHaveAttribute('href', '/corporate')
    expect(accessCalls).toHaveLength(1)
    expect(accessCalls[0]['x-session-token']).toBe('tok-u-admin')
    for (const h of ['x-user-id', 'x-stakeholder-role', 'x-tenant-id']) expect(accessCalls[0][h], h).toBeUndefined()
  })

  it('pending: no way back while the server has not answered; it appears only when the answer is a grant', async () => {
    let release!: (a: Settled) => void
    answer = new Promise<Settled>((resolve) => { release = resolve })
    renderBanner('/admin')
    const banner = screen.getByTestId('admin-context-banner')
    expect(banner).toHaveAttribute('data-corporate-decision', 'pending')
    expect(within(banner).queryByRole('link')).toBeNull()
    await act(async () => { release({ status: 200, body: SERVER_GRANT }) })
    expect(await within(banner).findByRole('link', { name: 'Return to Corporate Admin' })).toHaveAttribute('href', '/corporate')
  })

  it.each([
    ['denied (403) although the local account role is admin', { status: 403, body: SERVER_DENIAL }, 'denied'],
    ['unavailable (500)', { status: 500, body: { error: 'boom' } }, 'unavailable'],
    ['unauthenticated (401)', { status: 401, body: { error: 'Unauthorized. Session is invalid or expired.' } }, 'unauthenticated'],
    ['a 200 that is not a valid read-only grant', { status: 200, body: { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, read_only: false } } }, 'unavailable'],
  ])('%s: the context is stated without the way back', async (_label, settled, status) => {
    answer = settled
    renderBanner('/admin', userFor('admin'))
    const banner = screen.getByTestId('admin-context-banner')
    await waitFor(() => expect(banner).toHaveAttribute('data-corporate-decision', status))
    expect(within(banner).queryByRole('link')).toBeNull()
    expect(within(banner).getByTestId('admin-context-statement').textContent).toBe(STATEMENT)
  })
})

describe('arrival from Corporate Admin — the /admin?from=corporate marker', () => {
  it('says "You came from Corporate Admin." when the visit arrived with the marker', async () => {
    renderBanner('/admin?from=corporate')
    expect(screen.getByTestId('admin-context-arrival')).toHaveTextContent(/^You came from Corporate Admin\.$/)
    expect(await screen.findByRole('link', { name: 'Return to Corporate Admin' })).toBeInTheDocument()
  })

  it.each(['/admin', '/admin?from=elsewhere', '/admin?from=Corporate', '/admin?origin=corporate'])('%s carries no marker: no arrival line', async (path) => {
    renderBanner(path)
    await screen.findByRole('link', { name: 'Return to Corporate Admin' })
    expect(screen.queryByTestId('admin-context-arrival')).toBeNull()
  })

  it('the marker is never authority: arriving "from Corporate Admin" with a server denial offers no way back', async () => {
    answer = { status: 403, body: SERVER_DENIAL }
    renderBanner('/admin?from=corporate')
    await waitFor(() => expect(screen.getByTestId('admin-context-banner')).toHaveAttribute('data-corporate-decision', 'denied'))
    expect(screen.queryByRole('link', { name: 'Return to Corporate Admin' })).toBeNull()
  })
})

describe('DashboardLayout — the banner heads the operational Admin content area, and only there', () => {
  it('admin: it is the first thing in the content area, above the page, with the way back when granted', async () => {
    renderDashboard('admin', '/admin?from=corporate')
    const main = screen.getByRole('main')
    const banner = within(main).getByTestId('admin-context-banner')
    expect(main.firstElementChild).toBe(banner)
    expect(banner.compareDocumentPosition(within(main).getByTestId('private-page')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(banner).getByTestId('admin-context-arrival')).toBeInTheDocument()
    expect(await within(banner).findByRole('link', { name: 'Return to Corporate Admin' })).toHaveAttribute('href', '/corporate')
  })

  it('admin: the page renders at once while the Corporate decision is still pending — the banner never gates it', () => {
    answer = 'hang'
    renderDashboard('admin', '/admin')
    expect(screen.getByTestId('private-page')).toBeInTheDocument()
    expect(screen.getByTestId('admin-context-banner')).toHaveAttribute('data-corporate-decision', 'pending')
  })

  it('another portal (owner): no banner, and no Corporate decision is requested', async () => {
    renderDashboard('owner', '/dashboard')
    expect(screen.getByTestId('private-page')).toBeInTheDocument()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByTestId('admin-context-banner')).toBeNull()
    expect(accessCalls).toHaveLength(0)
  })

  it('the operational Admin gate is unchanged: a Corporate grant does not let a platform owner into /admin', async () => {
    answer = { status: 200, body: SERVER_GRANT }
    renderDashboard('admin', '/admin', userFor('owner'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/dashboard$/))
    expect(screen.getByTestId('owner-home')).toBeInTheDocument()
    expect(screen.queryByTestId('private-page')).toBeNull()
    expect(screen.queryByTestId('admin-context-banner')).toBeNull()
  })
})

describe('at a 390 px viewport', () => {
  it('the banner wraps (its statement may shrink and wrap) and the way back is a 44 px target', async () => {
    renderBanner('/admin?from=corporate')
    const banner = screen.getByTestId('admin-context-banner')
    expect(banner.className.split(/\s+/)).toContain('flex-wrap')
    expect(screen.getByTestId('admin-context-statement').closest('div')?.className.split(/\s+/)).toContain('min-w-0')
    const link = await within(banner).findByRole('link', { name: 'Return to Corporate Admin' })
    expect(phoneBox(link).height).toBeGreaterThanOrEqual(44)
  })
})
