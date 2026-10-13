/**
 * CA-K3-01 tests C (rendered), F, K, L, N, O — the real Corporate shell and pages under the real
 * router, with only the authenticated identity mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  type U = { id: string; name: string; email: string; role: string } | null
  const Ctx = React.createContext<Record<string, unknown> | null>(null)
  function TestAuthProvider({ initialUser, children }: { initialUser: U; children: ReactNode }) {
    const value = { user: initialUser, token: initialUser ? 't' : null, isAuthenticated: !!initialUser, loading: false, logout: async () => 'revoked' }
    return React.createElement(Ctx.Provider, { value }, children)
  }
  return { useAuth: () => React.useContext(Ctx), TestAuthProvider }
})

const { TestAuthProvider } = (await import('@/context/AuthContext')) as unknown as {
  TestAuthProvider: (p: { initialUser: unknown; children: ReactNode }) => JSX.Element
}
const CorporateLayout = (await import('./CorporateLayout')).default
const pages = {
  '/corporate': (await import('@/pages/corporate/CorporateOverview')).default,
  '/corporate/business-units': (await import('@/pages/corporate/CorporateBusinessUnits')).default,
  '/corporate/finance': (await import('@/pages/corporate/CorporateFinance')).default,
  '/corporate/growth': (await import('@/pages/corporate/CorporateGrowth')).default,
  '/corporate/operations': (await import('@/pages/corporate/CorporateOperations')).default,
  '/corporate/trust-risk': (await import('@/pages/corporate/CorporateTrustRisk')).default,
  '/corporate/data-intelligence': (await import('@/pages/corporate/CorporateDataIntelligence')).default,
  '/corporate/people-access': (await import('@/pages/corporate/CorporatePeopleAccess')).default,
  '/corporate/reports': (await import('@/pages/corporate/CorporateReports')).default,
  '/corporate/platform': (await import('@/pages/corporate/CorporatePlatform')).default,
}
const { ProvenanceFreshness } = await import('./ProvenanceFreshness')
const { MetricSlotView } = await import('./TruthState')

const userFor = (role: string) => ({ id: `u-${role}`, name: `Test ${role}`, email: `${role}@carup.test`, role })

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function renderAt(path: string, user: unknown = userFor('admin')) {
  return render(
    <TestAuthProvider initialUser={user}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<CorporateLayout />}>
            {Object.entries(pages).map(([p, C]) => <Route key={p} path={p} element={<C />} />)}
          </Route>
          <Route path="/login" element={<div data-testid="login">login</div>} />
          <Route path="/dashboard" element={<div data-testid="owner-dashboard">owner</div>} />
          <Route path="/government" element={<div data-testid="gov-dashboard">gov</div>} />
          <Route path="/admin/*" element={<div data-testid="admin-surface">admin</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </TestAuthProvider>,
  )
}

/** Visible text of the value positions on a page. */
const valueTexts = (root: HTMLElement) => within(root).queryAllByTestId('metric-slot-primary').map((n) => n.textContent ?? '')

describe('C · rendered: Corporate routes fail closed', () => {
  it.each(['owner', 'government', 'dealer'])('%s is redirected away and sees no Corporate content', async (role) => {
    renderAt('/corporate/finance', userFor(role))
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toMatch(/^\/corporate/))
    expect(screen.queryByTestId('corporate-shell')).toBeNull()
    expect(screen.queryByText(/Corporate accounting system of record/)).toBeNull()
  })
  it('an anonymous visitor goes to sign in with a return-to the Corporate page', async () => {
    renderAt('/corporate/finance', null)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?returnTo=%2Fcorporate%2Ffinance'))
    expect(screen.queryByTestId('corporate-shell')).toBeNull()
  })
  it('an administrator gets the shell with all ten destinations', () => {
    renderAt('/corporate')
    const nav = within(screen.getAllByTestId('corporate-nav')[0])
    expect(nav.getAllByRole('link').filter((a) => a.getAttribute('data-order'))).toHaveLength(10)
  })
})

describe('every destination renders as a real landing with its plane and question — and no number', () => {
  it.each(Object.keys(pages))('%s', (path) => {
    renderAt(path)
    const main = screen.getByTestId('corporate-main')
    expect(within(main).getByTestId('plane-indicator')).toBeInTheDocument()
    expect(within(main).getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(within(main).getByTestId('management-question').textContent).toMatch(/\?$/)
    // No slot on any landing renders a governed value in this slice.
    for (const t of valueTexts(main)) expect(t).not.toMatch(/\d/)
    expect(within(main).queryAllByTestId('metric-slot').every((s) => s.getAttribute('data-is-value') === 'false')).toBe(true)
  })
})

describe('F · Finance renders blocked states, never a fake value', () => {
  it('shows the authority statement and every strategic slot as blocked', () => {
    renderAt('/corporate/finance')
    const main = screen.getByTestId('corporate-main')
    expect(within(main).getByTestId('finance-authority-statement')).toHaveTextContent('Corporate accounting system of record not yet established.')
    const rows = within(within(main).getByTestId('finance-strategic-slots')).getAllByTestId('blocked-slot-row')
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'GMV', 'Recognized revenue', 'Revenue by business unit', 'Direct cost', 'Gross profit', 'Gross margin',
      'Operating expense', 'Operating profit', 'Net profit', 'Cash', 'Receivables', 'Payables', 'Take rate', 'Contribution margin',
    ])
    for (const r of rows) {
      expect(r.getAttribute('data-truth-state')).toBe('PENDING_CA_FIN')
      expect(r.textContent).not.toMatch(/[$€£]\s?\d|\bUSD\s?\d|\d+\.\d{2}/)
    }
  })
  it('keeps product money facts in their own panel, explicitly not Corporate Finance', () => {
    renderAt('/corporate/finance')
    const panel = screen.getByTestId('finance-product-money')
    expect(panel).toHaveTextContent('Product / operational money facts')
    expect(panel).toHaveTextContent('not Corporate Finance results')
    expect(panel.textContent).not.toMatch(/\d{2,}/)
  })
})

describe('L · Customers & Growth does not relabel accounts / inquiries / sessions', () => {
  it('no universal customer count, and source-accurate labels only', () => {
    renderAt('/corporate/growth')
    const main = screen.getByTestId('corporate-main')
    const labels = within(main).getAllByTestId('metric-slot').map((s) => s.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => /^Registered accounts \(not customers\)/.test(l))).toBe(true)
    expect(labels.some((l) => /^Marketplace inquiries \(not sales\)/.test(l))).toBe(true)
    // "Customers" exists only as a blocked, authority-unknown slot — never a value.
    const customers = within(within(main).getByTestId('growth-blocked')).getAllByTestId('blocked-slot-row').find((r) => within(r).getByRole('rowheader').textContent === 'Customers')
    expect(customers?.getAttribute('data-truth-state')).toBe('UNKNOWN_AUTHORITY')
    // No value-bearing position is labelled as customers / sales / users / visitors / conversion, unless
    // the label itself negates it ("(not customers)", "(not sales)").
    for (const l of labels) {
      const name = l.split(':')[0]
      const negated = name.replace(/\(not (customers|sales)\)/i, '')
      expect(negated, name).not.toMatch(/\b(customers?|sales?|users?|visitors?|conversion rate)\b/i)
    }
    const text = main.textContent ?? ''
    expect(text).not.toMatch(/customers acquired|acquired customers|total customers|unique visitors|active users|conversion rate/i)
    expect(within(main).getByTestId('growth-navigation')).toHaveTextContent('Top rendered routes by recorded Navigation events')
  })
})

describe('K · the provenance/freshness component displays, never classifies', () => {
  it('shows only supplied counts and never derives operational = raw − excluded', () => {
    render(<ProvenanceFreshness provenance="certified_k2b" freshness="current" excludedNonOperational={361} needsReview={2} />)
    const rows = screen.getByTestId('provenance-rows')
    expect(rows).toHaveTextContent('Excluded (non-operational):361')
    expect(rows).toHaveTextContent('Needs review (not counted):2')
    expect(rows.textContent).not.toMatch(/Operational:|363|359|\b1\b/)
  })
  it('accepts no rows — its contract is governed summary fields only', async () => {
    const src = (await import('node:fs')).readFileSync(`${process.cwd()}/src/components/corporate/ProvenanceFreshness.tsx`, 'utf8')
    expect(src).not.toMatch(/rows\?:|records\?:|\.filter\(|\.reduce\(|classify/)
  })
  it('states pending K2B consumption in words', () => {
    render(<ProvenanceFreshness provenance="pending_k2b_consumption" freshness="not_connected" />)
    expect(screen.getByTestId('provenance-state')).toHaveTextContent('Operational provenance integration not certified for this source')
    expect(screen.getByTestId('freshness-state')).toHaveTextContent('No governed source connected')
  })
})

describe('G/I rendered · a slot never shows a forbidden value, and zero reads as measured', () => {
  it('forbidden slot shows the access message only', () => {
    render(<MetricSlotView label="Cash" slot={{ state: 'FORBIDDEN', value: 5000 } as never} />)
    expect(screen.getByTestId('metric-slot-primary')).toHaveTextContent('You do not have access to this data.')
    expect(screen.getByTestId('metric-slot').textContent).not.toMatch(/5000|5,000/)
  })
  it('measured zero shows 0 with its badge and complete-read note', () => {
    render(<MetricSlotView label="Open escalations" slot={{ state: 'MEASURED_ZERO' }} />)
    expect(screen.getByTestId('metric-slot-primary')).toHaveTextContent(/^0$/)
    expect(screen.getByTestId('truth-state-badge')).toHaveTextContent('Actual')
    expect(screen.getByTestId('metric-slot-detail')).toHaveTextContent('Complete read — measured zero')
  })
})

describe('N · responsive navigation keeps plane and truth-state context', () => {
  it('the drawer holds every destination with its plane, and truth labels stay on the page', async () => {
    renderAt('/corporate/finance')
    fireEvent.click(screen.getByTestId('corporate-drawer-open'))
    const drawer = await screen.findByTestId('corporate-drawer')
    const links = within(drawer).getAllByRole('link').filter((a) => a.getAttribute('data-order'))
    expect(links).toHaveLength(10)
    expect(links[2]).toHaveAccessibleName(/Finance.*Corporate Intelligence/)
    expect(links[9]).toHaveAccessibleName(/Platform.*Platform & Security/)
    expect(within(screen.getByTestId('corporate-main')).getAllByTestId('truth-state-badge').length).toBeGreaterThan(10)
  })
  it('the collapsed rail keeps every destination named, with its plane, for assistive technology', () => {
    window.localStorage.setItem('carup.corporate.rail.collapsed', '1')
    renderAt('/corporate/operations')
    const rail = screen.getByTestId('corporate-rail')
    expect(rail.getAttribute('data-collapsed')).toBe('true')
    const ops = within(rail).getByTestId('corporate-nav-operations')
    expect(ops).toHaveAccessibleName(/Operations.*Business Operations/)
    window.localStorage.removeItem('carup.corporate.rail.collapsed')
  })
})

describe('O · keyboard-accessible navigation and current-page semantics', () => {
  it('one aria-current page, landmarks, and a skip link', () => {
    renderAt('/corporate/people-access')
    const rail = screen.getByTestId('corporate-rail')
    const current = within(rail).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('People & Access')
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: 'Corporate Admin' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#corporate-main')
  })
  it('Tab reaches the destinations in canonical order; Escape closes the drawer and returns focus', async () => {
    const u = userEvent.setup()
    renderAt('/corporate')
    const rail = screen.getByTestId('corporate-rail')
    const ordered = within(rail).getAllByRole('link').filter((a) => a.getAttribute('data-order'))
    ordered[0].focus()
    await u.tab()
    expect(document.activeElement).toBe(ordered[1])
    const opener = screen.getByTestId('corporate-drawer-open')
    opener.focus()
    await u.keyboard('{Enter}')
    expect(await screen.findByTestId('corporate-drawer')).toBeInTheDocument()
    await u.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('corporate-drawer')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })
  it('cross-plane links say which plane they open in', () => {
    renderAt('/corporate/business-units')
    const link = screen.getAllByTestId('operate-link')[0]
    expect(link.getAttribute('data-cross-plane')).toBe('true')
    expect(link).toHaveTextContent('Leaves Corporate Intelligence → opens in Business Operations')
  })
})
