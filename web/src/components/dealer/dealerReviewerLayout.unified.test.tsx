/**
 * RX03-P2 — ReviewWorkbench presentation of DealerReviewerLayout (register R131–R138).
 * The guard is unchanged and runs FIRST in both modes; the unified chrome is
 * presentation only, shows exactly the eight reviewer workbenches and never
 * another role's menu.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'

const KEY = 'carup-unified-ui'
/** RX03-P2-R4 — the family navigation: a desktop rail (many destinations) or a grouped tab bar. */
const workspaceNav = () =>
  (document.getElementById('shell-ws-rail') ?? document.querySelector('[data-testid="shell-ws-tabs"]')) as HTMLElement
function auth(role: string | null) {
  return {
    useAuth: () => role
      ? { user: { id: 'r1', name: 'Fictional Independent Reviewer', email: 'r@example.invalid', role, phone: '' },
          token: 'tok', isAuthenticated: true, loading: false, login: () => {}, logout: () => {}, switchRole: async () => {} }
      : { user: null, token: null, isAuthenticated: false, loading: false, login: () => {}, logout: () => {}, switchRole: async () => {} },
  }
}
async function load() {
  vi.resetModules()
  return (await import('./DealerReviewerLayout')).default
}
function LoginProbe() {
  const [p] = useSearchParams()
  return <div>login returnTo={p.get('returnTo')}</div>
}
function renderAt(Layout: () => JSX.Element | null, path = '/admin/dealer-claims') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/admin/dealer-claims" element={<div>claim review workbench</div>} />
        </Route>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => window.sessionStorage.clear())
afterEach(() => { window.sessionStorage.clear(); vi.doUnmock('@/context/AuthContext') })

describe('DealerReviewerLayout — ReviewWorkbench (opted in)', () => {
  it('a reviewer gets the workbench chrome with exactly the eight reviewer workbenches and the independence notice', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => auth('reviewer'))
    const Layout = await load()
    const { container } = renderAt(Layout)
    expect(screen.getByText('claim review workbench')).toBeInTheDocument()
    expect(screen.getByTestId('review-workbench-independence')).toHaveTextContent('never grants legal status')
    const rail = workspaceNav()
    const hrefs = Array.from(rail.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
      .filter(h => h !== '/admin/dealer-claims' || true)
    expect(new Set(hrefs)).toEqual(new Set([
      '/admin/dealer-claims', '/admin/dealer-research-review', '/admin/dealer-compliance-submissions',
      '/admin/dealer-legal-activation', '/admin/dealer-full-storefront-review', '/admin/dealer-buyer-feedback',
      '/admin/dealer-vehicle-evidence', '/admin/dealer-operating-lifecycle',
    ]))
    // No dealer, owner or admin destinations are inherited.
    for (const h of hrefs) expect(h!.startsWith('/admin/dealer-')).toBe(true)
    expect(container.textContent).toContain('Independent review')
  })

  it('a member (claimant) is still sent away before any chrome renders', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => auth('member'))
    const Layout = await load()
    const { container } = renderAt(Layout)
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByText('claim review workbench')).toBeNull()
    expect(container.querySelector('#shell-ws-rail')).toBeNull()
  })

  it('a dealer role is sent away too (reviewer isolation, never a dealer action)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => auth('dealer'))
    const Layout = await load()
    renderAt(Layout)
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByText('claim review workbench')).toBeNull()
  })

  it('a guest goes to login with returnTo', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => auth(null))
    const Layout = await load()
    renderAt(Layout)
    expect(await screen.findByText('login returnTo=/admin/dealer-claims')).toBeInTheDocument()
  })
})

describe('DealerReviewerLayout — default (not opted in)', () => {
  it('keeps the legacy reviewer header and navigation', async () => {
    vi.doMock('@/context/AuthContext', () => auth('reviewer'))
    const Layout = await load()
    const { container } = renderAt(Layout)
    expect(screen.getByRole('navigation', { name: 'Dealership review workbenches' })).toBeInTheDocument()
    expect(screen.getByText('CarUp Dealership Review')).toBeInTheDocument()
    expect(container.querySelector('#shell-ws-rail')).toBeNull()
  })
})
