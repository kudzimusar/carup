// @vitest-environment jsdom
/**
 * TI-20 — the login redirect preserves the complete return journey
 * (dispatch RX02-RS-R3, Workstream C).
 *
 * Covers two layers:
 *   1. The pure evaluator: `returnPath` (pathname + query) rides the auth
 *      redirect through `safeReturnTo`, so a guest's Marketplace search
 *      filters survive the login bounce; registry matching still uses the
 *      bare `route`; external/unsafe returnPath values are rejected.
 *   2. The component boundary: RequireAuthenticatedUser at a query-bearing
 *      URL sends the browser to /login?returnTo=<full path>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import { evaluateRouteAccess, loginWithReturnTo, type RouteAccessInput } from './routeAccess'

const base: RouteAccessInput = {
  route: '/insurance',
  isBootstrapping: false,
  isAuthenticated: false,
  role: null,
}

function decodeReturnTo(redirectTo: string): string {
  const raw = new URL(redirectTo, 'http://localhost').searchParams.get('returnTo')
  return raw ?? ''
}

describe('TI-20 — evaluateRouteAccess returnPath', () => {
  it('auth redirect preserves query/filter state when returnPath is supplied', () => {
    const d = evaluateRouteAccess({
      ...base,
      route: '/dashboard',
      returnPath: '/dashboard?tab=sales&period=30d',
    })
    expect(d.kind).toBe('redirect')
    if (d.kind !== 'redirect') return
    expect(d.reason).toBe('auth')
    expect(decodeReturnTo(d.to)).toBe('/dashboard?tab=sales&period=30d')
  })

  it('guest Marketplace search: full path with filters is preserved through the login bounce', () => {
    // /marketplace itself is public and never redirects. The TI-20 journey is a
    // guest filtering the Marketplace and then hitting a PROTECTED surface (e.g.
    // their saved list from a filtered search) — the bounce must land back on the
    // SAME result/filter state.
    const d = evaluateRouteAccess({
      ...base,
      route: '/dashboard/saved',
      returnPath: '/dashboard/saved?make=Toyota&priceMax=15000&sort=newest',
    })
    expect(d.kind).toBe('redirect')
    if (d.kind !== 'redirect') return
    expect(decodeReturnTo(d.to)).toBe('/dashboard/saved?make=Toyota&priceMax=15000&sort=newest')
  })

  it('the public Marketplace itself still renders for a guest (no bounce invented)', () => {
    // Guard against over-correction: making /marketplace protected would BE the defect.
    expect(evaluateRouteAccess({ ...base, route: '/marketplace' }).kind).toBe('render')
  })

  it('without returnPath the redirect preserves the pathname exactly as before (no regression)', () => {
    const d = evaluateRouteAccess({ ...base, route: '/dashboard' })
    expect(d.kind).toBe('redirect')
    if (d.kind !== 'redirect') return
    expect(decodeReturnTo(d.to)).toBe('/dashboard')
  })

  it('an external/unsafe returnPath is rejected — redirect carries no returnTo (open-redirect closed)', () => {
    for (const evil of [
      'https://evil.example/steal',
      '//evil.example/steal',
      '/\\evil.example',
      '/dashboard\nLocation: https://evil.example',
    ]) {
      const d = evaluateRouteAccess({ ...base, route: '/dashboard', returnPath: evil })
      expect(d.kind).toBe('redirect')
      if (d.kind !== 'redirect') return
      expect(d.to).toBe('/login')
    }
  })

  it('registry matching uses `route`, not returnPath: a query-string never changes the feature decision', () => {
    // /insurance is a PUBLIC active route: renders regardless of auth. The
    // returnPath must not influence the lifecycle/auth decision in any way.
    const d = evaluateRouteAccess({
      ...base,
      route: '/insurance',
      returnPath: '/insurance?foo=bar',
    })
    expect(d.kind).toBe('render')
  })

  it('role redirect is unchanged: wrong role goes to the role dashboard, not to login', () => {
    const d = evaluateRouteAccess({
      ...base,
      isAuthenticated: true,
      role: 'mechanic',
      route: '/dashboard',
      returnPath: '/dashboard?tab=sales',
    })
    expect(d.kind).toBe('redirect')
    if (d.kind !== 'redirect') return
    expect(d.reason).toBe('role')
    expect(d.to).not.toContain('returnTo')
  })
})

describe('TI-20 — loginWithReturnTo with a full path', () => {
  it('encodes a path+query so it round-trips through the login form', () => {
    const to = loginWithReturnTo('/marketplace?make=Toyota&priceMax=15000')
    expect(decodeReturnTo(to)).toBe('/marketplace?make=Toyota&priceMax=15000')
  })

  it('rejects an external destination (defence in depth at the helper level)', () => {
    expect(loginWithReturnTo('https://evil.example/x')).toBe('/login')
  })
})

/* ── Component boundary: the real guard component over a query-bearing URL ── */

const h = vi.hoisted(() => ({ auth: { user: null as null | { role: string }, loading: false } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }))

import { RequireAuthenticatedUser } from '@/components/routing/RegistryRouteBoundary'

function LoginProbe() {
  // Reads the returnTo the canonical guard redirected with (MemoryRouter history,
  // not window.location).
  const [params] = useSearchParams()
  return <output data-testid="returnTo">{params.get('returnTo') ?? ''}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/saved" element={<RequireAuthenticatedUser><div>SAVED LIST</div></RequireAuthenticatedUser>} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TI-20 — RequireAuthenticatedUser preserves the guest journey', () => {
  beforeEach(() => { h.auth = { user: null, loading: false } })
  afterEach(() => cleanup())

  it('guest filtered Marketplace search → protected saved list → login returnTo carries pathname + query', () => {
    renderAt('/dashboard/saved?make=Toyota&priceMax=15000&sort=newest')
    expect(screen.getByTestId('returnTo').textContent).toBe('/dashboard/saved?make=Toyota&priceMax=15000&sort=newest')
    expect(screen.queryByText('SAVED LIST')).toBeNull()
  })

  it('authenticated user with the same URL renders the page untouched', () => {
    h.auth = { user: { role: 'owner' }, loading: false }
    renderAt('/dashboard/saved?make=Toyota')
    expect(screen.getByText('SAVED LIST')).toBeTruthy()
  })
})
