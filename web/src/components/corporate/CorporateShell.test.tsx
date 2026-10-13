/**
 * CA-K3-01 tests C (rendered), F, K, L, N, O — the real Corporate shell and pages under the real
 * router, with only the authenticated identity mocked — and (CA-K3-AUTH-01) the SERVER's Corporate
 * access decision answered by a fake backend keyed on the session token, through the real API client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SERVER_DENIAL, SERVER_GRANT } from '@/test/corporateAccessFixture'

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  type U = { id: string; name: string; email: string; role: string } | null
  const Ctx = React.createContext<Record<string, unknown> | null>(null)
  const controls: { setUser: (u: U) => void } = { setUser: () => {} }
  function TestAuthProvider({ initialUser, children }: { initialUser: U; children: ReactNode }) {
    const [user, setUser] = React.useState<U>(initialUser)
    React.useEffect(() => { controls.setUser = setUser }, [])
    // The session token names the account, so the fake server below can decide per session.
    const value = { user, token: user ? `tok-${user.id}` : null, isAuthenticated: !!user, loading: false, logout: async () => { setUser(null); return 'revoked' } }
    return React.createElement(Ctx.Provider, { value }, children)
  }
  return { useAuth: () => React.useContext(Ctx), TestAuthProvider, controls }
})

const { TestAuthProvider, controls: authControls } = (await import('@/context/AuthContext')) as unknown as {
  TestAuthProvider: (p: { initialUser: unknown; children: ReactNode }) => JSX.Element
  controls: { setUser: (u: unknown) => void }
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

/**
 * The fake backend. By default it answers like the real one: the legacy platform-administrator
 * accounts get the compatibility grant, everyone else 403. A test may replace the answer for any token.
 * It sees only the request — never the local AuthContext role.
 */
const COMPAT_TOKENS = new Set(['tok-u-admin', 'tok-u-platform_admin', 'tok-u-super_admin'])
type Answer = { status: number; body: unknown } | 'network' | 'hang' | Promise<{ status: number; body: unknown }>
let answerFor: (token: string | null) => Answer
const accessCalls: Array<{ url: string; headers: Record<string, string> }> = []
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const defaultAnswer = (token: string | null): Answer =>
  !token ? { status: 401, body: { error: 'Unauthorized. No active user context.' } }
    : COMPAT_TOKENS.has(token) ? { status: 200, body: SERVER_GRANT } : { status: 403, body: SERVER_DENIAL }

beforeEach(() => {
  answerFor = defaultAnswer
  accessCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.endsWith('/corporate/access')) return json(404, { error: 'Route not found' })
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    accessCalls.push({ url, headers })
    const answer = answerFor(headers['x-session-token'] ?? null)
    if (answer === 'network') throw new TypeError('Failed to fetch')
    if (answer === 'hang') {
      return new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
    }
    const settled = await answer
    return json(settled.status, settled.body)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function tree(path: string, user: unknown) {
  return (
    <TestAuthProvider initialUser={user}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<CorporateLayout />}>
            {Object.entries(pages).map(([p, C]) => <Route key={p} path={p} element={<C />} />)}
          </Route>
          <Route path="/" element={<div data-testid="home">home</div>} />
          <Route path="/login" element={<div data-testid="login">login</div>} />
          <Route path="/dashboard" element={<div data-testid="owner-dashboard">owner</div>} />
          <Route path="/government" element={<div data-testid="gov-dashboard">gov</div>} />
          <Route path="/admin/*" element={<div data-testid="admin-surface">admin</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </TestAuthProvider>
  )
}

function renderAt(path: string, user: unknown = userFor('admin')) {
  return render(tree(path, user))
}

/** Render and wait until the SERVER has admitted the session and the shell is up. */
async function renderAdmitted(path: string, user: unknown = userFor('admin')) {
  const r = renderAt(path, user)
  await screen.findByTestId('corporate-shell')
  return r
}

/** Records whether a Corporate shell, navigation or page body was EVER in the document. */
function watchForCorporateContent() {
  const seen = { shell: false, nav: false, main: false }
  const check = () => {
    if (document.querySelector('[data-testid="corporate-shell"]')) seen.shell = true
    if (document.querySelector('[data-testid="corporate-nav"]')) seen.nav = true
    if (document.querySelector('[data-testid="corporate-main"]')) seen.main = true
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true })
  return { seen, check, stop: () => observer.disconnect() }
}

const expectNoCorporateContent = () => {
  expect(screen.queryByTestId('corporate-shell')).toBeNull()
  expect(screen.queryByTestId('corporate-nav')).toBeNull()
  expect(screen.queryByTestId('corporate-rail')).toBeNull()
  expect(screen.queryByTestId('corporate-main')).toBeNull()
  expect(screen.queryByTestId('management-question')).toBeNull()
  expect(screen.queryByText(/Corporate accounting system of record/)).toBeNull()
}

/** Visible text of the value positions on a page. */
const valueTexts = (root: HTMLElement) => within(root).queryAllByTestId('metric-slot-primary').map((n) => n.textContent ?? '')

describe('C · rendered: Corporate routes fail closed', () => {
  it.each(['owner', 'government', 'dealer'])('%s is refused by the server and sees no Corporate content', async (role) => {
    renderAt('/corporate/finance', userFor(role))
    await screen.findByTestId('corporate-denied')
    expectNoCorporateContent()
  })
  it('an anonymous visitor goes to sign in with a return-to the Corporate page, without asking the server', async () => {
    renderAt('/corporate/finance', null)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?returnTo=%2Fcorporate%2Ffinance'))
    expectNoCorporateContent()
    expect(accessCalls).toHaveLength(0)
  })
  it('an administrator the server grants gets the shell with all ten destinations', async () => {
    await renderAdmitted('/corporate')
    const nav = within(screen.getAllByTestId('corporate-nav')[0])
    expect(nav.getAllByRole('link').filter((a) => a.getAttribute('data-order'))).toHaveLength(10)
  })
})

describe('every destination renders as a real landing with its plane and question — and no number', () => {
  it.each(Object.keys(pages))('%s', async (path) => {
    await renderAdmitted(path)
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
  it('shows the authority statement and every strategic slot as blocked', async () => {
    await renderAdmitted('/corporate/finance')
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
  it('keeps product money facts in their own panel, explicitly not Corporate Finance', async () => {
    await renderAdmitted('/corporate/finance')
    const panel = screen.getByTestId('finance-product-money')
    expect(panel).toHaveTextContent('Product / operational money facts')
    expect(panel).toHaveTextContent('not Corporate Finance results')
    expect(panel.textContent).not.toMatch(/\d{2,}/)
  })
})

describe('L · Customers & Growth does not relabel accounts / inquiries / sessions', () => {
  it('no universal customer count, and source-accurate labels only', async () => {
    await renderAdmitted('/corporate/growth')
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
    await renderAdmitted('/corporate/finance')
    fireEvent.click(screen.getByTestId('corporate-drawer-open'))
    const drawer = await screen.findByTestId('corporate-drawer')
    const links = within(drawer).getAllByRole('link').filter((a) => a.getAttribute('data-order'))
    expect(links).toHaveLength(10)
    expect(links[2]).toHaveAccessibleName(/Finance.*Corporate Intelligence/)
    expect(links[9]).toHaveAccessibleName(/Platform.*Platform & Security/)
    expect(within(screen.getByTestId('corporate-main')).getAllByTestId('truth-state-badge').length).toBeGreaterThan(10)
  })
  it('the collapsed rail keeps every destination named, with its plane, for assistive technology', async () => {
    window.localStorage.setItem('carup.corporate.rail.collapsed', '1')
    await renderAdmitted('/corporate/operations')
    const rail = screen.getByTestId('corporate-rail')
    expect(rail.getAttribute('data-collapsed')).toBe('true')
    const ops = within(rail).getByTestId('corporate-nav-operations')
    expect(ops).toHaveAccessibleName(/Operations.*Business Operations/)
    window.localStorage.removeItem('carup.corporate.rail.collapsed')
  })
})

describe('O · keyboard-accessible navigation and current-page semantics', () => {
  it('one aria-current page, landmarks, and a skip link', async () => {
    await renderAdmitted('/corporate/people-access')
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
    await renderAdmitted('/corporate')
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
  it('cross-plane links say which plane they open in', async () => {
    await renderAdmitted('/corporate/business-units')
    const link = screen.getAllByTestId('operate-link')[0]
    expect(link.getAttribute('data-cross-plane')).toBe('true')
    expect(link).toHaveTextContent('Leaves Corporate Intelligence → opens in Business Operations')
  })
})

describe('CA-K3-01-R1 · Business Units are accepted management units, not proposals and not legal entities', () => {
  it.each(['/corporate', '/corporate/business-units'])('%s states accepted management BUs and asserts no legal status', async (path) => {
    await renderAdmitted(path)
    const main = screen.getByTestId('corporate-main')
    const text = main.textContent ?? ''
    expect(text).toMatch(/four accepted management Business Units/)
    expect(text).not.toMatch(/\bpropos(ed|al)\b/i)
    const statuses = within(main).getAllByTestId('bu-status')
    expect(statuses).toHaveLength(4)
    for (const s of statuses) {
      expect(s).toHaveTextContent('Accepted management BU')
      expect(s).toHaveTextContent('legal status not asserted')
    }
    expect(text).not.toMatch(/\b(subsidiary of|registered company|Ltd\b|Pvt\b|\(Pty\))/i)
  })
  it('keeps labels provisional and future splits open where the Owner decisions say so', async () => {
    await renderAdmitted('/corporate/business-units')
    const intro = screen.getByTestId('corporate-page-business-units').textContent ?? ''
    expect(intro).toMatch(/management labels remain provisional \(OD-CABU-001\)/)
    expect(intro).toMatch(/future splits remain open Owner decisions \(OD-CABU-002 to 006\)/)
    expect(intro).toMatch(/not legal entities or subsidiaries/)
  })
})

describe('CA-K3-01-R1 · Reports never present withdrawal as an available transition (OD-CAREPORT-038 unresolved)', () => {
  it('lists the accepted exception states without Withdrawn, and shows withdrawal as disabled pending Owner policy', async () => {
    await renderAdmitted('/corporate/reports')
    const main = screen.getByTestId('corporate-main')
    const states = within(main).getByTestId('report-exception-states')
    for (const s of ['Returned for Correction', 'Rejected', 'Superseded', 'Restated', 'Generation Failed']) expect(states).toHaveTextContent(s)
    expect(states.textContent).not.toMatch(/withdraw/i)
    const policy = within(main).getByTestId('report-withdrawal-policy')
    expect(policy).toHaveAttribute('aria-disabled', 'true')
    expect(policy).toHaveTextContent('Withdrawn — disabled pending Owner policy (OD-CAREPORT-038)')
    expect(policy).toHaveTextContent('Withdrawal is not an available transition')
    // No control anywhere offers withdrawal (or any other report mutation).
    expect(within(main).queryAllByRole('button').filter((b) => /withdraw|publish|approve|restate/i.test(b.textContent ?? ''))).toHaveLength(0)
    expect(within(main).queryAllByRole('link').filter((a) => /withdraw/i.test(a.textContent ?? ''))).toHaveLength(0)
    // The primary lifecycle is unchanged.
    expect(within(within(main).getByTestId('reports-lifecycle')).getByRole('list', { name: 'Report lifecycle stages' }).textContent).toBe('DraftGeneratedIn ReviewApprovedPublished')
  })
})

describe('CA-K3-01-R2 · accessibility / responsive recustody', () => {
  it('D-3 · the canonical "Trust / Risk / Compliance" label is shown in full and never truncated', async () => {
    await renderAdmitted('/corporate/trust-risk')
    const rail = screen.getByTestId('corporate-rail')
    const label = within(within(rail).getByTestId('corporate-nav-trust-risk')).getByTestId('rail-label')
    expect(label).toHaveTextContent(/^Trust \/ Risk \/ Compliance$/)
    // Recurrence guard for the proven defect: no rail label is clipped with an ellipsis.
    for (const l of within(rail).getAllByTestId('rail-label')) expect(l.className).not.toMatch(/\btruncate\b/)
    expect(within(rail).getAllByTestId('rail-label')).toHaveLength(10)
  })

  it('D-1 · plane markers and legend IDs no longer use the proven low-contrast slate-400 text', async () => {
    await renderAdmitted('/corporate/data-intelligence')
    const markers = [
      ...screen.getAllByTestId('rail-plane-marker'),
      ...screen.getAllByTestId('legend-plane-marker'),
      ...screen.getAllByTestId('legend-state-id'),
    ]
    expect(markers.length).toBeGreaterThanOrEqual(9 + 3 + 16)
    for (const m of markers) expect(m.className).not.toMatch(/\btext-slate-400\b/)
    // Plane identities and the CI / BO / PS semantics are unchanged.
    expect(screen.getAllByTestId('legend-plane-marker').map((m) => m.textContent)).toEqual(['CI', 'BO', 'PS'])
  })

  it('D-2 · "Current operational Admin" is a full-width target that still opens /admin', async () => {
    await renderAdmitted('/corporate')
    const link = within(screen.getByTestId('corporate-rail')).getByTestId('rail-operational-admin-link')
    expect(link).toHaveAttribute('href', '/admin')
    expect(link).toHaveTextContent('Current operational Admin')
    expect(link.className).toMatch(/min-h-\[44px\]/)
  })
})

describe('CA-K3-01-R3 · D-4 horizontally scrolling tables are keyboard-reachable labelled regions', () => {
  it.each([
    ['/corporate/business-units', 'Business unit comparison by measure and truth state'],
    ['/corporate/operations', 'Operational queues by domain and measure'],
    ['/corporate/data-intelligence', 'Truth states, what each shows, and what each means'],
  ])('%s', async (path, name) => {
    await renderAdmitted(path)
    const main = screen.getByTestId('corporate-main')
    const region = within(main).getByRole('region', { name })
    // Keyboard-focusable and actually takes focus.
    expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    expect(document.activeElement).toBe(region)
    // Still the horizontal scroll container, with a bounded visible-focus treatment.
    expect(region.className).toMatch(/\boverflow-x-auto\b/)
    expect(region.className).toMatch(/focus-visible:outline-orange-500/)
    // Table semantics and caption are preserved inside the region.
    const table = within(region).getByRole('table', { name })
    expect(table.querySelector('caption')).toHaveTextContent(name)
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(1)
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(1)
  })

  it('the region is reachable with Tab from the content before it', async () => {
    const u = userEvent.setup()
    await renderAdmitted('/corporate/operations')
    const main = screen.getByTestId('corporate-main')
    const region = within(main).getByRole('region', { name: 'Operational queues by domain and measure' })
    // Start from the last focusable element before the region (the breadcrumb link) and Tab once.
    within(main).getByRole('link', { name: 'Corporate Admin' }).focus()
    await u.tab()
    expect(document.activeElement).toBe(region)
  })
})

describe('CA-K3-AUTH-01 · the Corporate shell renders only from the SERVER Corporate access decision', () => {
  const DIRECT_ROUTES = ['/corporate', '/corporate/business-units', '/corporate/finance', '/corporate/people-access', '/corporate/platform']
  const DENIED_ROLES = ['owner', 'dealer', 'mechanic', 'bank', 'insurance', 'government', 'reviewer']

  it('1 · waits for the server decision: only a loading state, no shell, navigation or page body until it arrives', async () => {
    let release!: (a: { status: number; body: unknown }) => void
    answerFor = () => new Promise((resolve) => { release = resolve })
    const watch = watchForCorporateContent()
    renderAt('/corporate/finance')
    expect(await screen.findByTestId('auth-bootstrap-loading')).toBeInTheDocument()
    expectNoCorporateContent()
    watch.check()
    expect(watch.seen).toEqual({ shell: false, nav: false, main: false })
    await act(async () => { release({ status: 200, body: SERVER_GRANT }) })
    expect(await screen.findByTestId('corporate-shell')).toBeInTheDocument()
    watch.stop()
  })

  it('2 · a server denial prevents any Corporate render', async () => {
    const watch = watchForCorporateContent()
    renderAt('/corporate', userFor('owner'))
    expect(await screen.findByTestId('corporate-denied')).toHaveTextContent('Corporate Admin is not available to this account')
    expectNoCorporateContent()
    watch.check(); watch.stop()
    expect(watch.seen).toEqual({ shell: false, nav: false, main: false })
  })

  it('3 · a local AuthContext role of admin with a SERVER DENIAL is still denied — there is no local-role fallback', async () => {
    answerFor = () => ({ status: 403, body: SERVER_DENIAL })
    const watch = watchForCorporateContent()
    renderAt('/corporate/finance', userFor('admin'))
    await screen.findByTestId('corporate-denied')
    expectNoCorporateContent()
    watch.check(); watch.stop()
    expect(watch.seen, 'Corporate content must never have been in the document').toEqual({ shell: false, nav: false, main: false })
  })

  it.each([
    ['network failure', 'network' as const, 'network'],
    ['server error', { status: 500, body: { error: 'boom' } }, 'server'],
    ['bad gateway', { status: 502, body: {} }, 'server'],
  ])('4 · %s with a local admin → fails closed, nothing rendered', async (_label, answer, reason) => {
    answerFor = () => answer
    const watch = watchForCorporateContent()
    renderAt('/corporate/people-access', userFor('admin'))
    const unavailable = await screen.findByTestId('corporate-unavailable')
    expect(unavailable).toHaveAttribute('data-reason', reason)
    expect(unavailable).toHaveTextContent('Corporate Admin access could not be confirmed')
    expectNoCorporateContent()
    watch.check(); watch.stop()
    expect(watch.seen).toEqual({ shell: false, nav: false, main: false })
  })

  it('4 · a decision that never arrives times out and fails closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answerFor = () => 'hang'
    renderAt('/corporate', userFor('admin'))
    expect(await screen.findByTestId('auth-bootstrap-loading')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(await screen.findByTestId('corporate-unavailable')).toHaveAttribute('data-reason', 'timeout')
    expectNoCorporateContent()
  })

  it('4 · retry asks the server again and renders only if THAT answer grants', async () => {
    let n = 0
    answerFor = () => (++n === 1 ? 'network' : { status: 200, body: SERVER_GRANT })
    renderAt('/corporate', userFor('admin'))
    fireEvent.click(await screen.findByTestId('corporate-access-retry'))
    expect(await screen.findByTestId('corporate-shell')).toBeInTheDocument()
    expect(accessCalls).toHaveLength(2)
  })

  it.each([
    ['not read-only', { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, read_only: false } }],
    ['a wildcard capability', { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, capabilities: ['corporate.*'] } }],
    ['a manage capability', { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, capabilities: [...SERVER_GRANT.grant.capabilities, 'corporate.finance.manage'] } }],
    ['another grant source', { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, source: 'corporate_membership' } }],
    ['no grant', { contract: SERVER_GRANT.contract, decision: 'granted' }],
    ['an empty object', {}],
  ])('5 · a 200 carrying a malformed grant (%s) fails closed', async (_label, body) => {
    answerFor = () => ({ status: 200, body })
    renderAt('/corporate', userFor('admin'))
    expect(await screen.findByTestId('corporate-unavailable')).toHaveAttribute('data-reason', 'malformed')
    expectNoCorporateContent()
  })

  it.each(['admin', 'platform_admin', 'super_admin'])('6 · a successful server compatibility grant (%s session) renders the permitted destinations', async (role) => {
    await renderAdmitted('/corporate', userFor(role))
    const rail = screen.getByTestId('corporate-rail')
    expect(within(rail).getAllByRole('link').filter((a) => a.getAttribute('data-order'))).toHaveLength(10)
    fireEvent.click(screen.getByTestId('topbar-account'))
    expect(screen.getByTestId('access-explanation')).toHaveTextContent('legacy Admin compatibility bridge')
    expect(screen.getByTestId('access-explanation')).toHaveTextContent('not a Corporate membership')
  })

  it('6 · the request carries the session token only — the browser sends no role, user or tenant claim', async () => {
    await renderAdmitted('/corporate')
    expect(accessCalls).toHaveLength(1)
    expect(accessCalls[0].url).toMatch(/\/corporate\/access$/)
    expect(accessCalls[0].headers['x-session-token']).toBe('tok-u-admin')
    for (const h of ['x-user-id', 'x-stakeholder-role', 'x-tenant-id']) expect(accessCalls[0].headers[h], h).toBeUndefined()
  })

  it('7 · a direct URL cannot bypass: every direct Corporate route is denied for every refused account', async () => {
    for (const path of DIRECT_ROUTES) {
      for (const role of DENIED_ROLES) {
        const { unmount } = renderAt(path, userFor(role))
        await screen.findByTestId('corporate-denied')
        expectNoCorporateContent()
        expect(screen.getByTestId('where').textContent, `${role} at ${path}`).toBe(path)
        unmount()
      }
    }
  })

  it('8 · navigation follows the server capabilities, and a page outside them is refused inside the shell', async () => {
    const subset = { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, capabilities: ['corporate.overview.read', 'corporate.report.read'] } }
    answerFor = () => ({ status: 200, body: subset })
    await renderAdmitted('/corporate/finance')
    const rail = screen.getByTestId('corporate-rail')
    expect(within(rail).getAllByRole('link').filter((a) => a.getAttribute('data-order')).map((a) => a.textContent)).toEqual([
      expect.stringContaining('Corporate Overview'), expect.stringContaining('Reports'),
    ])
    expect(screen.getByTestId('corporate-forbidden')).toHaveTextContent('You do not have access to this page.')
    expect(screen.queryByTestId('finance-authority-statement')).toBeNull()
  })

  it('8 · the decision is asked once per session, not per navigation click, and a refresh / deep link asks again', async () => {
    const u = userEvent.setup()
    const first = await renderAdmitted('/corporate')
    await u.click(within(screen.getByTestId('corporate-rail')).getByTestId('corporate-nav-finance'))
    expect(await screen.findByTestId('finance-authority-statement')).toBeInTheDocument()
    expect(accessCalls).toHaveLength(1)
    first.unmount()
    await renderAdmitted('/corporate/finance')
    expect(accessCalls).toHaveLength(2)
  })

  it('9 · sign-out removes the admitted Corporate state at once', async () => {
    const u = userEvent.setup()
    await renderAdmitted('/corporate/finance')
    await u.click(screen.getByTestId('topbar-account'))
    await u.click(screen.getByTestId('corporate-sign-out'))
    await waitFor(() => expect(screen.queryByTestId('corporate-shell')).toBeNull())
    expectNoCorporateContent()
  })

  it('10 · a changed identity cannot keep the previous grant: the old grant stops counting in the same render', async () => {
    await renderAdmitted('/corporate/finance', userFor('admin'))
    expect(screen.getByTestId('finance-authority-statement')).toBeInTheDocument()
    act(() => { authControls.setUser(userFor('owner')) })
    // Synchronously after the switch — before the server has answered for the new session.
    expectNoCorporateContent()
    expect(await screen.findByTestId('corporate-denied')).toBeInTheDocument()
    expectNoCorporateContent()
    expect(accessCalls.map((c) => c.headers['x-session-token'])).toEqual(['tok-u-admin', 'tok-u-owner'])
  })

  it('10 · switching from a denied account to an administrator asks the server; nothing carries over from the denial', async () => {
    renderAt('/corporate', userFor('owner'))
    await screen.findByTestId('corporate-denied')
    act(() => { authControls.setUser(userFor('admin')) })
    expect(screen.queryByTestId('corporate-denied')).toBeNull()
    expect(await screen.findByTestId('corporate-shell')).toBeInTheDocument()
  })

  it('CA-CERT-AUTH-001 · an authenticated subject without a server grant is denied, whatever its local role says', async () => {
    for (const role of [...DENIED_ROLES, 'admin']) {
      answerFor = () => ({ status: 403, body: SERVER_DENIAL })
      const { unmount } = renderAt('/corporate', userFor(role))
      await screen.findByTestId('corporate-denied')
      expectNoCorporateContent()
      unmount()
    }
  })

  it('CA-CERT-UX-003 · a direct route is denied by the server authority, not merely hidden from navigation', async () => {
    for (const path of DIRECT_ROUTES) {
      // Local admin, so local navigation WOULD show the link — only the server's answer decides.
      answerFor = (token) => (token === 'tok-u-admin' ? { status: 403, body: SERVER_DENIAL } : defaultAnswer(token))
      const { unmount } = renderAt(path, userFor('admin'))
      await screen.findByTestId('corporate-denied')
      expectNoCorporateContent()
      unmount()
    }
    expect(accessCalls).toHaveLength(DIRECT_ROUTES.length)
  })
})
