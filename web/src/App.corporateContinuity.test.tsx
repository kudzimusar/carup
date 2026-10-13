/**
 * CA-K3-AUTH-01-R1 (D-5) — Corporate in-shell navigation continuity, through the REAL App: the real
 * route table, the real app-wide LazyRouteBoundary and Suspense, the real AuthProvider and the real
 * Corporate layout. Only `fetch` is faked — a backend keyed on the session token, exactly as the
 * shipped GET /api/corporate/access is.
 *
 * Why this file exists: the shell-only test "asked once per session, not per navigation click" used an
 * isolated router without App's pathname-keyed boundary, so it passed while the shipped app remounted
 * the whole Corporate shell — and re-asked the server — on every click (CA-K3-CERT-01-R2, D-5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import App from './App'
import { SERVER_DENIAL, SERVER_GRANT } from '@/test/corporateAccessFixture'

// One Corporate page whose chunk fails to load, to prove Corporate error recovery stays inside the shell.
vi.mock('./pages/corporate/CorporateGrowth', () => { throw new Error('Failed to fetch dynamically imported module: CorporateGrowth') })

type Account = { id: string; name: string; email: string; role: string }
const account = (role: string): Account => ({ id: `u-${role}`, name: `Cert ${role}`, email: `${role}@carup.test`, role })
const COMPAT = new Set(['tok-admin', 'tok-platform_admin', 'tok-super_admin'])

let accessLatencyMs = 0
let decide: (token: string | null) => { status: number; body: unknown } = (t) => (t && COMPAT.has(t) ? { status: 200, body: SERVER_GRANT } : { status: 403, body: SERVER_DENIAL })
const accessCalls: Array<string | null> = []
const accountsByToken = new Map<string, Account>()

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  accessLatencyMs = 0
  accessCalls.length = 0
  decide = (t) => (t && COMPAT.has(t) ? { status: 200, body: SERVER_GRANT } : { status: 403, body: SERVER_DENIAL })
  for (const r of ['admin', 'owner', 'platform_admin']) accountsByToken.set(`tok-${r}`, account(r))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const token = headers['x-session-token'] ?? null
    if (url.endsWith('/auth/me')) {
      const who = token ? accountsByToken.get(token) : undefined
      return who ? json(200, { user: who }) : json(401, { error: 'Unauthorized. Session is invalid or expired.' })
    }
    if (url.endsWith('/auth/logout')) return json(200, { success: true })
    if (url.endsWith('/corporate/access')) {
      accessCalls.push(token)
      if (accessLatencyMs) await new Promise((r) => setTimeout(r, accessLatencyMs))
      const a = decide(token)
      return json(a.status, a.body)
    }
    return json(200, {})
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

function signIn(role: string) {
  localStorage.setItem('carup_user', JSON.stringify(account(role)))
  localStorage.setItem('carup_token', `tok-${role}`)
}

const handles: { navigate?: NavigateFunction; auth?: ReturnType<typeof useAuth> } = {}
function Handles() {
  const navigate = useNavigate()
  const auth = useAuth()
  useEffect(() => { handles.navigate = navigate; handles.auth = auth }, [navigate, auth])
  return null
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Handles />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

/**
 * Watches the Corporate shell from the moment it first appears: records every moment it left the
 * document, was hidden (Suspense hides with display:none), or was REPLACED by a different element, and
 * any loading indicator shown outside the shell.
 */
function watchShell() {
  const log = { first: null as Element | null, removed: 0, hidden: 0, replaced: 0, loadingOutsideShell: 0 }
  const check = () => {
    const shell = document.querySelector('[data-testid="corporate-shell"]')
    if (!log.first) { if (shell) log.first = shell; return }
    if (!shell) log.removed += 1
    else if (shell !== log.first) log.replaced += 1
    else if (shell.closest('[style*="display: none"]')) log.hidden += 1
    const loaders = [...document.querySelectorAll('[data-testid="auth-bootstrap-loading"]')]
    if (loaders.some((l) => !l.closest('[data-testid="corporate-shell"]'))) log.loadingOutsideShell += 1
  }
  const obs = new MutationObserver(check)
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  return { log, check, stop: () => obs.disconnect() }
}

const rail = () => within(screen.getByTestId('corporate-rail'))
const clickRail = (id: string) => fireEvent.click(rail().getByTestId(`corporate-nav-${id}`))
const where = () => document.querySelector('[data-testid="corporate-main"] h1')?.textContent ?? null

describe('CA-K3-AUTH-01-R1 · D-5 — the REAL App keeps the Corporate shell and its server decision across in-shell navigation', () => {
  it('enter /corporate → one decision; rail navigation to Finance, Business Units and Platform keeps the SAME shell, never hides it, and asks again zero times (400 ms access latency)', async () => {
    signIn('admin')
    accessLatencyMs = 400
    const watch = watchShell()
    renderApp('/corporate')
    const shell = await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    watch.check()
    expect(accessCalls).toEqual(['tok-admin'])

    for (const [id, heading] of [['finance', 'Finance'], ['business-units', 'Business Units'], ['platform', 'Platform'], ['overview', 'Corporate Overview']] as const) {
      clickRail(id)
      await waitFor(() => expect(where()).toBe(heading), { timeout: 5000 })
      expect(screen.getByTestId('corporate-shell'), `${id}: the very same shell element`).toBe(shell)
    }
    // Long enough for a re-ask at 400 ms latency to have shown itself.
    await new Promise((r) => setTimeout(r, 500))
    watch.check(); watch.stop()
    expect(accessCalls, 'no authority request caused by navigation').toEqual(['tok-admin'])
    expect(watch.log).toMatchObject({ removed: 0, hidden: 0, replaced: 0, loadingOutsideShell: 0 })
  }, 20000)

  it('control — a NON-Corporate pathname change still remounts its routed subtree (app-wide key unchanged)', async () => {
    renderApp('/about')
    await waitFor(() => expect(document.querySelector('main')).not.toBeNull(), { timeout: 5000 })
    const before = document.querySelector('main')
    act(() => { handles.navigate!('/pricing') })
    // MainLayout's own <main> survives /about → /pricing unless the app-wide boundary remounts the tree.
    await waitFor(() => {
      const now = document.querySelector('main')
      expect(now).not.toBeNull()
      expect(now).not.toBe(before)
    }, { timeout: 5000 })
  }, 20000)

  it('leaving Corporate and re-entering mounts a fresh shell and asks the server again', async () => {
    signIn('admin')
    renderApp('/corporate/finance')
    const first = await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    expect(accessCalls).toHaveLength(1)
    act(() => { handles.navigate!('/about') })
    await waitFor(() => expect(screen.queryByTestId('corporate-shell')).toBeNull(), { timeout: 5000 })
    act(() => { handles.navigate!('/corporate/reports') })
    const second = await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    expect(second).not.toBe(first)
    expect(accessCalls).toEqual(['tok-admin', 'tok-admin'])
  }, 20000)

  it('a Corporate page whose chunk fails is caught INSIDE the shell, and the next Corporate navigation recovers — no remount, no re-ask', async () => {
    signIn('admin')
    renderApp('/corporate')
    const shell = await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    clickRail('growth')
    const error = await screen.findByTestId('lazy-route-error', {}, { timeout: 5000 })
    expect(within(screen.getByTestId('corporate-main')).getByTestId('lazy-route-error')).toBe(error)
    expect(screen.getByTestId('corporate-shell')).toBe(shell)
    clickRail('finance')
    await waitFor(() => expect(where()).toBe('Finance'), { timeout: 5000 })
    expect(screen.queryByTestId('lazy-route-error')).toBeNull()
    expect(screen.getByTestId('corporate-shell')).toBe(shell)
    expect(accessCalls).toEqual(['tok-admin'])
  }, 20000)
})

describe('CA-K3-AUTH-01-R1 · security regression through the REAL App', () => {
  it('server denial on first entry — and a local admin with a server denial — never render Corporate content', async () => {
    for (const [role, deny] of [['owner', false], ['admin', true]] as const) {
      if (deny) decide = () => ({ status: 403, body: SERVER_DENIAL })
      signIn(role)
      const watch = watchShell()
      const { unmount } = renderApp('/corporate/finance')
      await screen.findByTestId('corporate-denied', {}, { timeout: 5000 })
      watch.check(); watch.stop()
      expect(watch.log.first, `${role}: shell must never have appeared`).toBeNull()
      expect(screen.queryByTestId('corporate-main')).toBeNull()
      unmount(); localStorage.clear()
    }
  }, 20000)

  it('session change admin → owner: the old grant stops counting in the same render and the server is asked with the new token', async () => {
    signIn('admin')
    renderApp('/corporate/finance')
    await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    act(() => { handles.auth!.login(account('owner') as never, 'tok-owner') })
    expect(screen.queryByTestId('corporate-shell')).toBeNull()
    await screen.findByTestId('corporate-denied', {}, { timeout: 5000 })
    expect(accessCalls).toEqual(['tok-admin', 'tok-owner'])
  }, 20000)

  it('token change for the same account: the old grant stops counting at once and a new decision is required', async () => {
    signIn('admin')
    accountsByToken.set('tok-admin-2', account('admin'))
    decide = (t) => (t === 'tok-admin' ? { status: 200, body: SERVER_GRANT } : { status: 403, body: SERVER_DENIAL })
    renderApp('/corporate')
    await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    act(() => { handles.auth!.login(account('admin') as never, 'tok-admin-2') })
    expect(screen.queryByTestId('corporate-shell')).toBeNull()
    await screen.findByTestId('corporate-denied', {}, { timeout: 5000 })
    expect(accessCalls).toEqual(['tok-admin', 'tok-admin-2'])
  }, 20000)

  it('sign-out removes the shell, and Back cannot restore it without valid authority', async () => {
    signIn('admin')
    renderApp('/corporate')
    await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    clickRail('finance')
    await waitFor(() => expect(where()).toBe('Finance'), { timeout: 5000 })
    fireEvent.click(screen.getByTestId('topbar-account'))
    fireEvent.click(screen.getByTestId('corporate-sign-out'))
    await waitFor(() => expect(screen.queryByTestId('corporate-shell')).toBeNull(), { timeout: 5000 })
    act(() => { handles.navigate!(-1) })
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('corporate-shell')).toBeNull()
    expect(screen.queryByTestId('corporate-main')).toBeNull()
    expect(localStorage.getItem('carup_token')).toBeNull()
  }, 20000)

  it('a fresh mount (hard reload / new tab / direct load) asks the server again', async () => {
    signIn('admin')
    const first = renderApp('/corporate/platform')
    await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    first.unmount()
    renderApp('/corporate/platform')
    await screen.findByTestId('corporate-shell', {}, { timeout: 5000 })
    expect(accessCalls).toEqual(['tok-admin', 'tok-admin'])
  }, 20000)
})
