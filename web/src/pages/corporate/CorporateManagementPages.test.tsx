/**
 * CA-OWNER-02 — the Corporate destinations rendered from the server's management read models
 * (GET /api/corporate/management/:area), under the real Corporate layout and router, with only the signed-in identity mocked
 * and the server answered by a fake backend through the real API client.
 *
 * What these tests pin: every figure states its source, as-of time, scope and truth state; unknown is never shown as zero;
 * the Overview reads Needs attention → position → risk & queues → platform health → recent change, with what is unavailable
 * kept lower; and a refused or unreadable read model shows no number at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PEOPLE_ACCESS_PROJECTION, SERVER_GRANT } from '@/test/corporateAccessFixture'
import { MANAGEMENT_FIXTURES } from '@/test/corporateManagementFixture'

vi.mock('@/context/AuthContext', () => {
  const user = { id: 'u-admin', name: 'Test admin', email: 'admin@carup.test', role: 'admin' }
  const value = { user, token: 'tok-u-admin', isAuthenticated: true, loading: false, logout: async () => 'revoked' }
  return { useAuth: () => value }
})

const CorporateLayout = (await import('@/components/corporate/CorporateLayout')).default
const { resetManagementAreaCache } = await import('@/lib/corporate/useManagementArea')
const pages = {
  '/corporate': (await import('./CorporateOverview')).default,
  '/corporate/finance': (await import('./CorporateFinance')).default,
  '/corporate/growth': (await import('./CorporateGrowth')).default,
  '/corporate/operations': (await import('./CorporateOperations')).default,
  '/corporate/trust-risk': (await import('./CorporateTrustRisk')).default,
  '/corporate/data-intelligence': (await import('./CorporateDataIntelligence')).default,
  '/corporate/reports': (await import('./CorporateReports')).default,
  '/corporate/platform': (await import('./CorporatePlatform')).default,
  '/corporate/people-access': (await import('./CorporatePeopleAccess')).default,
}

type Answer = { status: number; body: unknown } | 'network' | 'hang'
let management: (area: string) => Answer
const managementCalls: Array<{ area: string; headers: Record<string, string> }> = []
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  // CA-OWNER-02-R3 D3: the session keeps each area's last answer for an instant re-render; every test starts without one.
  resetManagementAreaCache()
  management = (area) => ({ status: 200, body: MANAGEMENT_FIXTURES[area] })
  managementCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    if (url.endsWith('/corporate/access')) return json(200, SERVER_GRANT)
    if (url.endsWith('/corporate/people-access')) return json(200, PEOPLE_ACCESS_PROJECTION)
    const area = url.match(/\/corporate\/management\/([a-z-]+)$/)?.[1]
    if (area) {
      managementCalls.push({ area, headers })
      const answer = management(area)
      if (answer === 'network') throw new TypeError('Failed to fetch')
      if (answer === 'hang') return new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
      return json(answer.status, answer.body)
    }
    return json(404, { error: 'Route not found' })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CorporateLayout />}>
          {Object.entries(pages).map(([p, C]) => <Route key={p} path={p} element={<C />} />)}
        </Route>
        <Route path="/admin/*" element={<div data-testid="admin-surface">admin</div>} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByTestId('corporate-shell')
  return screen.getByTestId('corporate-main')
}

/** Every management fact rendered on the page, with its value position and metadata. */
const facts = (root: HTMLElement) => within(root).queryAllByTestId('management-fact')
const factById = (root: HTMLElement, id: string) => {
  const found = facts(root).find((f) => f.getAttribute('data-fact-id') === id)
  if (!found) throw new Error(`fact ${id} not rendered`)
  return found
}
const isBefore = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('A · L · Corporate Overview is actionable and ordered by what needs a decision', () => {
  it('reads Needs attention → position → risk & queues → platform health → recent change, with data quality and the unavailable kept lower', async () => {
    const main = await open('/corporate')
    await within(main).findByTestId('overview-attention')
    const order = ['overview-attention', 'overview-position', 'overview-queues', 'overview-platform', 'overview-recent', 'overview-data', 'overview-unavailable']
      .map((id) => within(main).getByTestId(id))
    for (let i = 1; i < order.length; i += 1) expect(isBefore(order[i - 1], order[i]), `${order[i - 1].dataset.testid} before ${order[i].dataset.testid}`).toBe(true)
  })

  it('every attention item names its count, how long work has waited, the rule that decides it, and where to work it', async () => {
    const main = await open('/corporate')
    const items = await within(main).findAllByTestId('attention-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('2 operational conversations awaiting a reply (1 past the reply target)')
    expect(within(items[0]).getByTestId('attention-age')).toHaveTextContent('Waiting since 2026-10-12 · 6 days')
    expect(within(items[0]).getByTestId('attention-rule')).toHaveTextContent('no governed SLA policy is configured')
    expect(within(items[0]).getByTestId('attention-meta')).toHaveTextContent('message_threads + messages')
    expect(within(items[0]).getByTestId('attention-meta')).toHaveTextContent('As of 2026-10-18 00:00 UTC')
    const operate = within(items[0]).getByRole('link', { name: /Open communications inbox/ })
    expect(operate).toHaveAttribute('href', '/admin/communications?from=corporate')
    expect(operate.className).toMatch(/min-h-\[44px\]/)
    expect(items[1]).toHaveTextContent('Identity verification cases awaiting a reviewer')
    expect(within(items[1]).getByTestId('attention-age')).toHaveTextContent('Waiting since 2026-09-20 · 28 days')
  })

  it('every figure carries its source, as-of time, scope and truth state; values read "Live read", "Technical" or "Actual" — never a bare number', async () => {
    const main = await open('/corporate')
    await within(main).findByTestId('overview-position')
    const valued = facts(main).filter((f) => within(f).getByTestId('metric-slot').getAttribute('data-is-value') === 'true')
    expect(valued.length).toBeGreaterThan(10)
    for (const f of valued) {
      const id = f.getAttribute('data-fact-id')
      expect(within(f).getByTestId('fact-source').textContent, id ?? '').toMatch(/\S/)
      expect(within(f).getByTestId('fact-as-of'), id ?? '').toHaveTextContent('2026-10-18 00:00 UTC')
      expect(within(f).getByTestId('fact-scope').textContent, id ?? '').toMatch(/\S/)
      expect(['Live read', 'Technical', 'Actual']).toContain(within(f).getByTestId('truth-state-badge').textContent)
    }
  })

  it('governance records are Actual and scoped to the organisation nodes the reader governs', async () => {
    const main = await open('/corporate')
    const memberships = factById(await within(main).findByTestId('overview-position'), 'corporate.governance.membership.active')
    expect(within(memberships).getByTestId('metric-slot-primary')).toHaveTextContent(/^2$/)
    expect(within(memberships).getByTestId('truth-state-badge')).toHaveTextContent('Actual')
    expect(within(memberships).getByTestId('fact-scope')).toHaveTextContent('Organisation nodes you govern: CARUP_CORPORATE')
    expect(within(factById(main, 'corporate.governance.assignment.active')).getByTestId('metric-slot-primary')).toHaveTextContent(/^4$/)
  })

  it('a degraded source shows no number and says why — unknown is never zero', async () => {
    const main = await open('/corporate')
    const degraded = factById(await within(main).findByTestId('overview-position'), 'trade.order.open')
    const slot = within(degraded).getByTestId('metric-slot')
    expect(slot.getAttribute('data-is-value')).toBe('false')
    expect(within(degraded).getByTestId('metric-slot-primary').textContent).not.toMatch(/\d/)
    expect(degraded).toHaveTextContent('could not be read')
  })

  it('K2B provenance is shown exactly as the authority reported it — never recomputed from raw and excluded', async () => {
    const main = await open('/corporate')
    const open_ = factById(await within(main).findByTestId('overview-queues'), 'communications.conversation.open')
    const provenance = within(open_).getByTestId('fact-provenance')
    expect(provenance).toHaveTextContent('4 operational of 654 records')
    expect(provenance).toHaveTextContent('610 excluded (non-operational)')
    expect(provenance).toHaveTextContent('40 need review (not counted)')
    expect(provenance.textContent).not.toMatch(/\b44\b/)
  })

  it('states that these are staging operational facts, not certified Corporate results', async () => {
    const main = await open('/corporate')
    expect(await within(main).findByTestId('management-environment')).toHaveTextContent(/Staging/)
    expect(within(main).getByTestId('management-environment')).toHaveTextContent('not certified Corporate results')
    // CA-OWNER-02-R3 D2: the note names the read-state badges actually used.
    expect(within(main).getByTestId('management-environment')).toHaveTextContent('everything else says Live read or Technical')
  })

  it('keeps every unavailable measure visible below, each with its reason and never as zero', async () => {
    const main = await open('/corporate')
    const unavailable = await within(main).findByTestId('overview-unavailable')
    const rows = within(unavailable).getAllByTestId('unavailable-measure')
    expect(rows.map((r) => r.getAttribute('data-measure-id'))).toEqual(['finance.accounting', 'growth.customers'])
    expect(rows[0]).toHaveTextContent('Corporate accounting system of record not yet established.')
    for (const r of rows) expect(within(r).queryAllByTestId('metric-slot-primary')).toHaveLength(0)
  })

  it('asks the server with the session token only', async () => {
    await open('/corporate')
    await waitFor(() => expect(managementCalls.length).toBeGreaterThan(0))
    expect(managementCalls[0].area).toBe('overview')
    expect(managementCalls[0].headers['x-session-token']).toBe('tok-u-admin')
    for (const h of ['x-user-id', 'x-stakeholder-role', 'x-tenant-id']) expect(managementCalls[0].headers[h], h).toBeUndefined()
  })

  it.each([
    ['server error', { status: 503, body: { decision: 'unavailable' } } as Answer],
    ['network failure', 'network' as Answer],
    ['an altered answer', { status: 200, body: { ...MANAGEMENT_FIXTURES.overview, read_only: false } } as Answer],
  ])('with the read model unavailable (%s) nothing shows a number, the page says so, and retry asks again', async (_label, answer) => {
    management = () => answer
    const main = await open('/corporate')
    const panel = await within(main).findByTestId('management-unavailable')
    expect(panel).toHaveTextContent('could not be read')
    expect(panel).toHaveTextContent('no figure is assumed zero')
    expect(within(main).queryAllByTestId('management-fact')).toHaveLength(0)
    expect(within(main).queryAllByTestId('metric-slot').every((s) => s.getAttribute('data-is-value') === 'false')).toBe(true)
    const before = managementCalls.length
    management = (area) => ({ status: 200, body: MANAGEMENT_FIXTURES[area] })
    fireEvent.click(within(panel).getByRole('button', { name: /Try again/ }))
    await within(main).findByTestId('overview-attention')
    expect(managementCalls.length).toBe(before + 1)
  })

  it('a refusal reads as restricted, not as unavailable', async () => {
    management = () => ({ status: 403, body: { code: 'CORPORATE_CAPABILITY_REQUIRED' } })
    const main = await open('/corporate')
    expect(await within(main).findByTestId('management-denied')).toHaveTextContent('You do not have access to this data.')
    expect(within(main).queryByTestId('management-unavailable')).toBeNull()
  })
})

describe('B · Operations and Trust show named queues from their own authorities', () => {
  it('Operations lists each queue with what is waiting, since when, the attention rule, its owner and where to work it', async () => {
    const main = await open('/corporate/operations')
    const region = await within(main).findByRole('region', { name: 'Operational queues by domain and measure' })
    const rows = within(region).getAllByTestId('queue-row')
    expect(rows.map((r) => r.getAttribute('data-queue-id'))).toEqual(['ops.marketplace_moderation', 'ops.garage_applications'])
    expect(within(rows[0]).getByTestId('metric-slot-primary')).toHaveTextContent(/^2$/)
    expect(rows[0]).toHaveTextContent('Waiting since 2026-10-01')
    expect(rows[0]).toHaveTextContent('No governed target exists for this queue, so nothing is called late.')
    expect(rows[0]).toHaveTextContent('Marketplace Operations')
    expect(within(rows[0]).getByRole('link', { name: /Open Listings awaiting moderation review/ })).toHaveAttribute('href', '/admin/moderation?from=corporate')
    expect(rows[1]).toHaveTextContent('Nothing is waiting (complete read).')
  })

  it('Operations shows communications truth with its reply-target source named', async () => {
    const main = await open('/corporate/operations')
    const comms = await within(main).findByTestId('operations-communications')
    const overdue = factById(comms, 'communications.conversation.overdue')
    expect(overdue).toHaveTextContent('no governed SLA policy is configured')
    expect(factById(comms, 'communications.conversation.non_operational')).toHaveTextContent('Certification, UAT, automation and historical conversations')
  })

  it('Trust keeps each queue separate, an unreadable queue says unknown with no number, and no combined score exists', async () => {
    const main = await open('/corporate/trust-risk')
    const region = await within(main).findByRole('region', { name: 'Risk and compliance queues by measure' })
    const rows = within(region).getAllByTestId('queue-row')
    expect(rows.map((r) => r.getAttribute('data-queue-id'))).toEqual(['trust.identity_verification', 'trust.fraud', 'trust.partsentry'])
    const partsentry = rows[2]
    expect(within(partsentry).getByTestId('metric-slot').getAttribute('data-is-value')).toBe('false')
    expect(partsentry).toHaveTextContent('whether work is waiting is unknown')
    const labels = within(main).queryAllByTestId('metric-slot').map((s) => s.getAttribute('aria-label') ?? '')
    for (const l of labels) expect(l.split(':')[0]).not.toMatch(/score|%|percent/i)
  })
})

describe('C · Finance separates live product money facts from accounting', () => {
  it('shows product money facts with their own names, breakdowns and source currency — and keeps every accounting measure blocked', async () => {
    const main = await open('/corporate/finance')
    const panel = await within(main).findByTestId('finance-product-money')
    expect(panel).toHaveTextContent('not Corporate Finance results')
    const escrow = factById(panel, 'finance.escrow.sessions')
    expect(within(escrow).getByTestId('metric-slot-primary')).toHaveTextContent(/^3$/)
    expect(within(escrow).getByTestId('fact-breakdown')).toHaveTextContent('Sandbox · created3')
    expect(escrow).toHaveTextContent('Sandbox escrow is never a settlement, cash or revenue.')
    const applications = factById(panel, 'finance.application.status')
    expect(within(applications).getByTestId('fact-breakdown')).toHaveTextContent('Requested amount (USD)USD 18,500')
    expect(within(main).getByTestId('finance-authority-statement')).toHaveTextContent('Corporate accounting system of record not yet established.')
    const strategic = within(within(main).getByTestId('finance-strategic-slots')).getAllByTestId('blocked-slot-row')
    expect(strategic).toHaveLength(14)
    for (const r of strategic) expect(r.getAttribute('data-truth-state')).toBe('PENDING_CA_FIN')
    // Accounting statements never travel in the product panel, and no amount is summed across currencies.
    expect(within(panel).queryAllByTestId('management-fact').map((f) => f.getAttribute('data-fact-id'))).not.toContain('finance.accounting.gmv')
    expect(panel.textContent).not.toMatch(/total (amount|value)|all currencies/i)
  })

  it('finance exceptions come from the live sources, and a missing billing provider is unavailable — not zero', async () => {
    const main = await open('/corporate/finance')
    const exceptions = await within(main).findByTestId('finance-exceptions')
    expect(within(factById(exceptions, 'finance.exceptions.escrow')).getByTestId('metric-slot-primary')).toHaveTextContent(/^0$/)
    const billing = factById(within(main).getByTestId('finance-product-money'), 'finance.billing.subscriptions')
    expect(within(billing).getByTestId('metric-slot').getAttribute('data-truth-state')).toBe('UNAVAILABLE_NO_SOURCE')
    expect(billing).toHaveTextContent('No live billing provider is connected.')
  })
})

describe('D · Customers & Growth names demand facts for what they are', () => {
  it('accounts are not customers, inquiries are not sales, route renders are technical — and Customers stays blocked', async () => {
    const main = await open('/corporate/growth')
    await within(main).findByTestId('growth-demand')
    const accounts = factById(main, 'growth.account.operational')
    expect(within(accounts).getByTestId('metric-slot').getAttribute('aria-label')).toMatch(/^Operational accounts \(not customers\): 12/)
    expect(within(factById(main, 'marketplace.inquiry.open')).getByTestId('metric-slot').getAttribute('aria-label')).toMatch(/^Open Marketplace inquiries \(not sales\): 0/)
    expect(within(factById(main, 'growth.navigation.route_render')).getByTestId('truth-state-badge')).toHaveTextContent('Technical')
    const customers = within(within(main).getByTestId('growth-blocked')).getAllByTestId('blocked-slot-row').find((r) => within(r).getByRole('rowheader').textContent === 'Customers')
    expect(customers?.getAttribute('data-truth-state')).toBe('UNKNOWN_AUTHORITY')
    expect(main.textContent).not.toMatch(/customers acquired|total customers|unique visitors|active users|conversion rate/i)
  })
})

describe('E · Platform shows live runtime facts', () => {
  it('build, environment, session authority, the kill switch, providers — and certification sessions as unavailable with the reason', async () => {
    const main = await open('/corporate/platform')
    const runtime = await within(main).findByTestId('platform-runtime')
    expect(within(factById(runtime, 'platform.communications.kill_switch')).getByTestId('metric-slot-primary')).toHaveTextContent('active — external sends disabled')
    expect(within(factById(runtime, 'platform.build.commit')).getByTestId('truth-state-badge')).toHaveTextContent('Technical')
    const sessions = factById(main, 'platform.certification_sessions')
    expect(within(sessions).getByTestId('metric-slot').getAttribute('data-truth-state')).toBe('UNAVAILABLE_NO_SOURCE')
    expect(sessions).toHaveTextContent('AUTH-05 closed user_sessions to the service role.')
    const providers = within(main).getByRole('table', { name: 'Communication providers and their configuration state' })
    expect(within(providers).getAllByRole('row')).toHaveLength(3)
    expect(providers).toHaveTextContent('whatsapp')
    expect(providers).toHaveTextContent('meta_cloud')
  })
})

describe('F · Data & Intelligence projects the metric and source registry', () => {
  it('lists each measure with its source, state, as-of and whether it may be used — and keeps the truth-state legend', async () => {
    const main = await open('/corporate/data-intelligence')
    const registry = await within(main).findByRole('table', { name: 'Metric and source registry' })
    const rows = within(registry).getAllByTestId('registry-row')
    expect(rows.map((r) => r.getAttribute('data-measure-id'))).toEqual([
      'marketplace.listing.public', 'trade.order.open', 'growth.customers', 'corporate.governance.membership.active', 'platform.session_authority',
    ])
    expect(rows[0]).toHaveTextContent('vehicles · Admin publication projection')
    expect(rows[0]).toHaveTextContent('K2B applied')
    expect(rows[0].getAttribute('data-usable')).toBe('true')
    expect(rows[1].getAttribute('data-usable')).toBe('false')
    expect(rows[2]).toHaveTextContent('No accepted customer definition (OD-CAMETRIC-001).')
    expect(within(main).getByRole('region', { name: 'Truth states, what each shows, and what each means' })).toBeInTheDocument()
  })

  it('D5: "may be used" says what each row is — a governance record is never called an operational read', async () => {
    const main = await open('/corporate/data-intelligence')
    const registry = await within(main).findByRole('table', { name: 'Metric and source registry' })
    const usable = (id: string) => within(within(registry).getAllByTestId('registry-row').find((r) => r.getAttribute('data-measure-id') === id) as HTMLElement).getByTestId('registry-usable')
    expect(usable('corporate.governance.membership.active')).toHaveTextContent(/^Yes — governance record$/)
    expect(usable('marketplace.listing.public')).toHaveTextContent(/^Yes — live read$/)
    expect(usable('platform.session_authority')).toHaveTextContent(/^Yes — live technical read$/)
    expect(usable('trade.order.open').textContent).toMatch(/^No/)
    expect(registry.textContent).not.toMatch(/live operational read/)
    // D2 in the registry too: a live record read is badged "Live read", never "Operational".
    const badges = within(registry).getAllByTestId('truth-state-badge').map((b) => b.textContent)
    expect(badges).toContain('Live read')
    expect(badges).not.toContain('Operational')
  })

  it('Owner UAT R3 F3: the registry introduction never calls live rows "operational reads" — some are certification or UAT populations', async () => {
    const main = await open('/corporate/data-intelligence')
    await within(main).findByRole('table', { name: 'Metric and source registry' })
    const intro = within(main).getByText(/^Every measure Corporate Admin serves/)
    expect(intro.textContent).toMatch(/Live rows are read live from their source/)
    expect(intro.textContent).not.toMatch(/operational read/i)
  })

  it('D4: the legend says what Technical and Advisory figures really are, and shows the read-state badges management facts use', async () => {
    const main = await open('/corporate/data-intelligence')
    const legend = within(main).getByRole('region', { name: 'Truth states, what each shows, and what each means' })
    const row = (state: string) => within(legend).getAllByTestId('legend-row').find((r) => r.getAttribute('data-truth-state') === state) as HTMLElement
    for (const state of ['TECHNICAL_OPERATIONAL', 'ADVISORY']) expect(row(state).textContent, state).not.toMatch(/A governed value/)
    expect(row('GOVERNED_ACTUAL')).toHaveTextContent('A governed value')
    const live = row('TECHNICAL_OPERATIONAL')
    expect(within(live).getAllByTestId('truth-state-badge').map((b) => b.textContent)).toEqual(['Live read', 'Technical'])
    expect(live).toHaveTextContent('A live value, read from its source when the page loaded')
    expect(live).toHaveTextContent('never says a population is operational')
    expect(row('ADVISORY')).toHaveTextContent('An advisory value — never a governed figure')
    expect(legend.textContent).not.toMatch(/\bOperational\b/)
  })
})

describe('D3 · the management read is fast to show, patient with a slow source, and honest about its age', () => {
  it('a page already read in this session renders at once from its last answer, and says it is checking for a newer one', async () => {
    const main = await open('/corporate')
    await within(main).findByTestId('overview-attention')
    fireEvent.click(screen.getByTestId('corporate-nav-operations'))
    await within(screen.getByTestId('corporate-main')).findByTestId('operations-communications')
    management = (area) => (area === 'overview' ? 'hang' : { status: 200, body: MANAGEMENT_FIXTURES[area] })
    fireEvent.click(screen.getByTestId('corporate-nav-overview'))
    // No await: the previous answer is on screen in the same render, while the new read is still running.
    const now = screen.getByTestId('corporate-main')
    expect(within(now).getByTestId('overview-attention')).toBeInTheDocument()
    expect(within(now).getByTestId('management-revalidating')).toHaveTextContent('Checking for a newer read')
    expect(within(now).queryByTestId('management-pending')).toBeNull()
  })

  it('a slow source is waited for: the page says so, keeps waiting past the old 20 s limit, and gives up only at 45 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    management = () => 'hang'
    const main = await open('/corporate/growth')
    expect(within(main).getByTestId('management-pending')).toHaveTextContent('Reading live figures')
    await act(async () => { vi.advanceTimersByTime(9_000) })
    expect(within(main).getByTestId('management-pending')).toHaveTextContent('Still reading live figures')
    await act(async () => { vi.advanceTimersByTime(13_000) })
    expect(within(main).queryByTestId('management-unavailable'), 'not given up at 22 s').toBeNull()
    await act(async () => { vi.advanceTimersByTime(25_000) })
    expect(await within(main).findByTestId('management-unavailable')).toBeInTheDocument()
  })

  it('figures served from the last snapshot while it refreshes say so, with the snapshot\'s age as it was when this page read it', async () => {
    const snapshot = { generated_at: '2026-10-18T00:00:00.000Z', age_seconds: 95, stale: true, refreshing: true }
    management = (area) => ({ status: 200, body: { ...MANAGEMENT_FIXTURES[area], snapshot } })
    const main = await open('/corporate')
    const note = await within(main).findByTestId('management-environment')
    expect(note).toHaveTextContent('From the shared snapshot read 2026-10-18 00:00 UTC, which was 1 min 35 s old when this page read it — a newer read was then running in the background.')
    // Owner UAT R3 F4: a page left open must not go on stating that age, or a refresh, as if it were current.
    expect(note.textContent).not.toMatch(/1 min 35 s old —|refreshing in the background/)
  })
})

describe('D2 · a population read live keeps its own classification', () => {
  it('the certification, UAT, automation and historical conversations read "Live read" — never "Operational" — and keep their label', async () => {
    const main = await open('/corporate/operations')
    const comms = await within(main).findByTestId('operations-communications')
    const population = factById(comms, 'communications.conversation.non_operational')
    expect(population).toHaveTextContent('Certification, UAT, automation and historical conversations')
    expect(within(population).getByTestId('truth-state-badge')).toHaveTextContent(/^Live read$/)
    expect(within(population).getByTestId('metric-slot').getAttribute('aria-label')).not.toMatch(/\(Operational/)
    for (const badge of within(main).getAllByTestId('truth-state-badge')) expect(badge.textContent, 'no badge calls a population operational').not.toBe('Operational')
  })
})

describe('G · Reports shows the Corporate Staging Management Summary as a live view — generation is not approval', () => {
  it('renders the summary with its definition, digest and statement, and offers no generate, approve or publish control', async () => {
    const main = await open('/corporate/reports')
    const summary = await within(main).findByTestId('management-summary')
    expect(within(summary).getByRole('heading', { name: 'Corporate Staging Management Summary' })).toBeInTheDocument()
    expect(summary).toHaveTextContent('Current live view — not a generated report instance.')
    expect(summary).toHaveTextContent('REPORT_CORPORATE_STAGING_MANAGEMENT_SUMMARY · version 1')
    expect(within(summary).getByTestId('management-summary-digest')).toHaveTextContent('sha256:0f1e2d3c4b5a6978')
    expect(within(summary).getAllByTestId('management-summary-section').map((s) => s.getAttribute('data-section-id'))).toEqual(['governance', 'operations'])
    expect(within(main).queryAllByRole('button').filter((b) => /generate|approve|publish|withdraw|restate/i.test(b.textContent ?? ''))).toHaveLength(0)
    expect(within(within(main).getByTestId('reports-lifecycle')).getByRole('list', { name: 'Report lifecycle stages' }).textContent).toBe('DraftGeneratedIn ReviewApprovedPublished')
  })
})

describe('K · J · links into the operational Admin', () => {
  it.each(['/corporate', '/corporate/operations', '/corporate/trust-risk', '/corporate/growth', '/corporate/platform'])('on %s every one is a 44 px target that carries the "came from Corporate Admin" marker', async (path) => {
    const main = await open(path)
    await waitFor(() => expect(within(main).queryAllByTestId('management-fact').length).toBeGreaterThan(0))
    const links = within(main).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/admin'))
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) {
      expect(a.className, a.textContent ?? '').toMatch(/min-h-\[44px\]/)
      expect(new URLSearchParams(a.getAttribute('href')?.split('?')[1] ?? '').get('from'), a.textContent ?? '').toBe('corporate')
    }
  })

  it('cross-plane operate links name the operational Admin and that the platform role applies there', async () => {
    const main = await open('/corporate/operations')
    await within(main).findByTestId('operations-communications')
    const link = within(within(main).getByTestId('operations-operate')).getAllByTestId('operate-link')[0]
    expect(link).toHaveTextContent('Operational Admin — your platform role applies there')
    expect(link.textContent).not.toMatch(/current operational Admin/)
  })
})
