/**
 * RX06-LR06 (Owner decision N2) — a dealership status check that could not be done is never worded as "not approved".
 *
 *  - The server's real "no approved dealership" answers (404 / 403 authority not active / an ineligible workspace)
 *    keep the existing "Dealership operating access unavailable" page.
 *  - Every other failure (could not answer, too many requests, no connection, ended session, a different refusal,
 *    more than one dealership) says what happened, shows no dealer data, and offers the right next step.
 *  - The legacy presentation (flags off) is unchanged.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { classifyDealerStatusFailure } from './useDealerOperationalWorkspace'

const fx = vi.hoisted(() => ({ answers: [] as Array<() => unknown>, workspaceCalls: 0 }))
const ELIGIBLE = {
  actor_id: 'u1', operational: true, owner_membership_confirmed: true,
  tenant_id: 'tenant-fx', organization_id: 'org-fx', dealer_profile_id: 'dp-fx', profile: { trading_name: 'Fixture Motors (fictional)' },
}
const fail = (status: number | undefined, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), status === undefined ? {} : { status }, extra)
const NOT_APPROVED_WORDS = /does not currently have an active, independently approved/

function mockModules() {
  vi.doMock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1', name: 'Fictional Owner', role: 'member' }, token: 'tok', isAuthenticated: true, loading: false,
      login: () => {}, logout: () => {}, switchRole: async () => {} }),
  }))
  vi.doMock('@/lib/apiClient', () => ({
    apiRequest: async (req: { path: string }) => {
      if (req.path !== '/dealer/operational-workspace') return {}
      fx.workspaceCalls += 1
      const next = fx.answers.shift()
      if (!next) throw new Error('no answer queued')
      return next()
    },
    resolveApiBaseUrl: () => '/api',
    setUnauthorizedHandler: () => {},
    SessionExpiredError: class extends Error {},
  }))
  vi.doMock('@/components/layout/DashboardLayout', () => ({ default: () => <div>legacy dealer layout</div> }))
}
const answer = (fn: () => unknown) => fx.answers.push(fn)
/** Waits for whichever end state renders, so a wrong state fails on an assertion instead of a timeout. */
async function endState(): Promise<HTMLElement> {
  let found: HTMLElement | null = null
  await waitFor(() => {
    found = screen.queryByTestId('dealer-workspace-check-failed') ?? screen.queryByTestId('dealer-workspace-unavailable') ??
      screen.queryByText('dealer dashboard body') ?? screen.queryByText('legacy dealer layout') ?? screen.queryByText('Dealership operating access unavailable')
    expect(found).not.toBeNull()
  }, { timeout: 2500 }) // well inside the 5 s test timeout, so a wrong state fails on this assertion
  return found as unknown as HTMLElement
}

async function mountUnifiedShell() {
  window.sessionStorage.setItem('carup-unified-ui', '1')
  mockModules(); vi.resetModules()
  const { UnifiedRouteShell } = await import('@/components/shell/UnifiedRouteShell')
  render(
    <MemoryRouter initialEntries={['/dealer/dashboard']}>
      <Routes>
        <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
          <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { fx.answers = []; fx.workspaceCalls = 0; window.sessionStorage.clear() })
afterEach(() => { cleanup(); vi.doUnmock('@/context/AuthContext'); vi.doUnmock('@/lib/apiClient'); vi.doUnmock('@/components/layout/DashboardLayout') })

describe('classifyDealerStatusFailure', () => {
  it.each([
    ['404 no membership', fail(404, 'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP'), null],
    ['403 authority not active', fail(403, 'CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE'), null],
    ['the refusal code without a status', fail(undefined, 'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP'), null],
    ['503 read unavailable', fail(503, 'CANONICAL_DEALER_WORKSPACE_READ_UNAVAILABLE'), 'unavailable'],
    ['500 unexpected', fail(500, 'An unexpected internal server error occurred'), 'unavailable'],
    ['429', fail(429, 'Too many requests, please try again later.'), 'throttled'],
    ['no connection', new TypeError('Failed to fetch'), 'offline'],
    ['401', fail(401, 'Unauthorized. Session is invalid or expired.'), 'session'],
    ['409 several dealerships', fail(409, 'MULTIPLE_DEALERS_REQUIRE_EXPLICIT_TENANT_SELECTION'), 'multiple'],
    ['403 another refusal', fail(403, 'Forbidden'), 'denied'],
  ])('%s', (_name, err, expected) => {
    expect(classifyDealerStatusFailure(err)).toBe(expected)
  })
})

describe('unified dealer workspace (N2)', () => {
  it.each([
    ['unavailable', fail(503, 'CANONICAL_DEALER_WORKSPACE_READ_UNAVAILABLE'), /could not check your dealership’s operating status just now/],
    ['throttled', fail(429, 'Too many requests, please try again later.'), /too many requests/i],
    ['offline', new TypeError('Failed to fetch'), /could not be reached from this device/],
    ['session', fail(401, 'Unauthorized. Session is invalid or expired.'), /Sign in again to open your dealer workspace/],
    ['multiple', fail(409, 'MULTIPLE_DEALERS_REQUIRE_EXPLICIT_TENANT_SELECTION'), /cannot choose which dealership to open/],
    ['denied', fail(403, 'Forbidden'), /refused this account access to the dealer workspace/],
  ])('%s: says what happened, shows no dealer data, never "not approved"', async (kind, err, words) => {
    answer(() => { throw err })
    await mountUnifiedShell()
    const view = await endState()
    expect(view).toHaveAttribute('data-testid', 'dealer-workspace-check-failed')
    expect(view).toHaveAttribute('data-failure', kind)
    expect(view).toHaveTextContent(words)
    expect(view.textContent).not.toMatch(NOT_APPROVED_WORDS)
    expect(screen.queryByText('dealer dashboard body')).toBeNull()
    expect(screen.queryByTestId('dealer-workspace-unavailable')).toBeNull()
  })

  it.each([
    ['404 no approved dealership', () => { throw fail(404, 'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP') }],
    ['403 authority not active', () => { throw fail(403, 'CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE') }],
    ['an ineligible workspace', () => ({ workspace: { ...ELIGIBLE, operational: false } })],
  ])('%s keeps the existing "operating access unavailable" page', async (_name, fn) => {
    answer(fn)
    await mountUnifiedShell()
    const view = await endState()
    expect(view).toHaveAttribute('data-testid', 'dealer-workspace-unavailable')
    expect(view).toHaveTextContent(NOT_APPROVED_WORDS)
    expect(screen.queryByTestId('dealer-workspace-check-failed')).toBeNull()
  })

  it('a retry asks the server again and opens the workspace when it answers', async () => {
    answer(() => { throw fail(503, 'CANONICAL_DEALER_WORKSPACE_READ_UNAVAILABLE') })
    answer(() => ({ workspace: ELIGIBLE }))
    await mountUnifiedShell()
    const first = await endState()
    expect(first).toHaveAttribute('data-testid', 'dealer-workspace-check-failed')
    fireEvent.click(screen.getByTestId('dealer-workspace-check-retry'))
    await waitFor(() => expect(fx.workspaceCalls).toBe(2), { timeout: 2500 })
    expect(await endState()).toHaveTextContent('dealer dashboard body')
  })
})

describe('flags OFF: the legacy presentation is unchanged', () => {
  it('the legacy canonical layout still shows its own "unavailable" page for a failed check', async () => {
    mockModules(); vi.resetModules()
    answer(() => { throw fail(503, 'CANONICAL_DEALER_WORKSPACE_READ_UNAVAILABLE') })
    const { default: Layout } = await import('./DealerCanonicalWorkspaceLayout')
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes><Route element={<Layout />}><Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} /></Route></Routes>
      </MemoryRouter>,
    )
    expect(await endState()).toHaveTextContent('Dealership operating access unavailable')
    expect(screen.queryByTestId('dealer-workspace-check-failed')).toBeNull()
  })
})

describe('legacy dealer URLs (/dealer/…)', () => {
  async function mountGate(unified: boolean) {
    if (unified) window.sessionStorage.setItem('carup-unified-ui', '1')
    mockModules(); vi.resetModules()
    const { default: Gate } = await import('./LegacyDealerRouteGate')
    render(
      <MemoryRouter initialEntries={['/dealer']}>
        <Routes><Route element={<Gate />}><Route path="/dealer" element={<Outlet />} /></Route></Routes>
      </MemoryRouter>,
    )
  }
  it('unified: a failed check says so instead of treating an approved owner as a non-dealer', async () => {
    answer(() => { throw fail(429, 'Too many requests, please try again later.') })
    await mountGate(true)
    const view = await endState()
    expect(view).toHaveAttribute('data-testid', 'dealer-workspace-check-failed')
    expect(view).toHaveAttribute('data-failure', 'throttled')
  })
  it('flags OFF: a failed check keeps the legacy layout exactly as before', async () => {
    answer(() => { throw fail(429, 'Too many requests, please try again later.') })
    await mountGate(false)
    expect(await endState()).toHaveTextContent('legacy dealer layout')
    expect(screen.queryByTestId('dealer-workspace-check-failed')).toBeNull()
  })
  it('a genuine "no approved dealership" answer keeps the legacy layout in both presentations', async () => {
    answer(() => { throw fail(404, 'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP') })
    await mountGate(true)
    expect(await endState()).toHaveTextContent('legacy dealer layout')
  })
})
