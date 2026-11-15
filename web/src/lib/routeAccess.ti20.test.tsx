// @vitest-environment jsdom
/**
 * TI-20 — the login redirect preserves the complete return journey
 * (dispatch RX02-RS-R3, Workstream C).
 *
 * Covers three layers (R5 adds the fragment, `#hash`, everywhere):
 *   1. The pure evaluator: `returnPath` (pathname + query + fragment) rides the auth
 *      redirect through `safeReturnTo`, so a guest's Marketplace search
 *      filters survive the login bounce; registry matching still uses the
 *      bare `route`; external/unsafe returnPath values are rejected.
 *   2. The component boundary: RequireAuthenticatedUser / RequireFrontendRole at a
 *      query- and fragment-bearing URL send the browser to /login?returnTo=<full path>.
 *   3. The full login round trip through the REAL Login page: guard -> /login -> submit ->
 *      the user lands on the same pathname, query AND fragment; hostile, absolute and
 *      protocol-relative returnTo values still fall back to the role dashboard.
 *   Plus a source inventory: every guard that builds a returnTo from `location` uses
 *   pathname + search + hash, so dropping the fragment at any call site fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useSearchParams } from 'react-router-dom'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'
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

type MockUser = { role: string; name?: string }
type MockAuth = { user: MockUser | null; loading: boolean; login: (u: MockUser) => void }
const h = vi.hoisted(() => {
  const auth: MockAuth = {
    user: null,
    loading: false,
    // The real Login page calls login(user, token) on success; the mock records the session.
    login: (u: MockUser) => {
      auth.user = u
    },
  }
  return { auth }
})
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }))

import { RequireAuthenticatedUser, RequireFrontendRole } from '@/components/routing/RegistryRouteBoundary'
import Login from '@/pages/auth/Login'
import { resolvePostLoginRoute } from '@/lib/returnTo'

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
  beforeEach(() => { h.auth.user = null; h.auth.loading = false })
  afterEach(() => cleanup())

  it('guest filtered Marketplace search → protected saved list → login returnTo carries pathname + query', () => {
    renderAt('/dashboard/saved?make=Toyota&priceMax=15000&sort=newest')
    expect(screen.getByTestId('returnTo').textContent).toBe('/dashboard/saved?make=Toyota&priceMax=15000&sort=newest')
    expect(screen.queryByText('SAVED LIST')).toBeNull()
  })

  it('authenticated user with the same URL renders the page untouched', () => {
    h.auth.user = { role: 'owner' }
    renderAt('/dashboard/saved?make=Toyota')
    expect(screen.getByText('SAVED LIST')).toBeTruthy()
  })
})

/* ── R5 (review 5908161887, finding 2): the fragment (`#hash`) is part of the journey ── */

// A real-world return journey: a filtered list, scrolled to one result.
const JOURNEY = {
  pathname: '/dashboard/saved',
  search: '?make=Toyota&priceMax=15000&sort=newest',
  hash: '#listing-7',
}
const JOURNEY_PATH = JOURNEY.pathname + JOURNEY.search + JOURNEY.hash
// A fragment that itself looks like a query, plus percent-encoded content, must survive byte for byte.
const TRICKY_PATH = '/dashboard/saved?q=a%20b&tags=suv,4x4#reviews?sort=new&page=2'

// Hostile, absolute and protocol-relative values, each carrying a fragment so a pass cannot come
// from the fragment being stripped first.
const HOSTILE = [
  'https://evil.example/steal#/dashboard/saved',
  '//evil.example/steal#listing-7',
  '/\\evil.example#listing-7',
  'javascript:alert(1)#/dashboard',
  '/dashboard/saved\n#listing-7',
  'evil.example/dashboard#x',
  // An absolute URL smuggled behind a leading slash: isSafeReturnTo's documented "no '://'" rule.
  '/https://evil.example/steal#listing-7',
]

describe('TI-20 R5 — fragment survives the helpers', () => {
  it('loginWithReturnTo keeps pathname + query + fragment, encoded INSIDE returnTo', () => {
    for (const path of [JOURNEY_PATH, TRICKY_PATH]) {
      const to = loginWithReturnTo(path)
      const url = new URL(to, 'http://localhost')
      expect(url.pathname).toBe('/login')
      // The fragment must not become the /login URL's own fragment (that would drop it).
      expect(url.hash).toBe('')
      expect(to).toContain('%23')
      expect(decodeReturnTo(to)).toBe(path)
    }
  })

  it('evaluateRouteAccess carries the fragment in the auth redirect; matching still uses the pathname', () => {
    const d = evaluateRouteAccess({ ...base, route: JOURNEY.pathname, returnPath: JOURNEY_PATH })
    expect(d.kind).toBe('redirect')
    if (d.kind !== 'redirect') return
    expect(d.reason).toBe('auth')
    expect(decodeReturnTo(d.to)).toBe(JOURNEY_PATH)
  })

  it('resolvePostLoginRoute (the Login page’s last step) returns pathname + query + fragment unchanged', () => {
    expect(resolvePostLoginRoute(JOURNEY_PATH, 'owner')).toBe(JOURNEY_PATH)
    expect(resolvePostLoginRoute(TRICKY_PATH, 'owner')).toBe(TRICKY_PATH)
  })

  it('hostile / absolute / protocol-relative values carrying a fragment are still rejected', () => {
    for (const evil of HOSTILE) {
      expect(loginWithReturnTo(evil)).toBe('/login')
      const d = evaluateRouteAccess({ ...base, route: '/dashboard', returnPath: evil })
      expect(d.kind === 'redirect' && d.to).toBe('/login')
      expect(resolvePostLoginRoute(evil, 'owner')).toBe('/dashboard')
    }
  })
})

function WhereAmI() {
  const l = useLocation()
  return <output data-testid="landed">{JSON.stringify({ pathname: l.pathname, search: l.search, hash: l.hash })}</output>
}

describe('TI-20 R5 — component guards keep the fragment', () => {
  beforeEach(() => { h.auth.user = null; h.auth.loading = false })
  afterEach(() => cleanup())

  it('RequireAuthenticatedUser: returnTo carries pathname + query + fragment', () => {
    renderAt(JOURNEY_PATH)
    expect(screen.getByTestId('returnTo').textContent).toBe(JOURNEY_PATH)
  })

  it('RequireFrontendRole: returnTo carries pathname + query + fragment', () => {
    render(
      <MemoryRouter initialEntries={[JOURNEY_PATH]}>
        <Routes>
          <Route path="/dashboard/saved" element={<RequireFrontendRole roles={['owner']}><div>SAVED LIST</div></RequireFrontendRole>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('returnTo').textContent).toBe(JOURNEY_PATH)
    expect(screen.queryByText('SAVED LIST')).toBeNull()
  })
})

describe('TI-20 R5 — full login round trip through the real Login page', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    h.auth.user = null
    h.auth.loading = false
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/security/csrf-token')) {
        return { ok: true, status: 200, json: async () => ({ csrfToken: 'csrf-test' }) }
      }
      if (String(url).includes('/auth/login')) {
        return { ok: true, status: 200, json: async () => ({ user: { id: 'u-test', name: 'Test Owner', role: 'owner' }, token: 'tok-test' }) }
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function renderJourney(start: string) {
    return render(
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="/dashboard/saved" element={<RequireAuthenticatedUser><WhereAmI /></RequireAuthenticatedUser>} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  async function signIn() {
    fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'owner@example.test' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'not-a-real-password' } })
    fireEvent.click(screen.getByTestId('login-button'))
    return JSON.parse((await screen.findByTestId('landed')).textContent ?? '{}')
  }

  it('guest at a filtered, scrolled protected URL signs in and lands on the same pathname, query AND fragment', async () => {
    renderJourney(JOURNEY_PATH)
    // The guard bounced the guest to the real login form…
    expect(screen.getByTestId('login-button')).toBeTruthy()
    // …and signing in returns them to exactly where they were.
    expect(await signIn()).toEqual(JOURNEY)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/login'))).toBe(true)
  })

  it('a fragment that looks like a query, and percent-encoded content, survive the round trip', async () => {
    renderJourney(TRICKY_PATH)
    expect(await signIn()).toEqual({
      pathname: '/dashboard/saved',
      search: '?q=a%20b&tags=suv,4x4',
      hash: '#reviews?sort=new&page=2',
    })
  })

  it('a hostile, absolute or protocol-relative returnTo (with a fragment) lands on the role dashboard instead', async () => {
    for (const evil of HOSTILE) {
      h.auth.user = null
      const view = renderJourney(`/login?returnTo=${encodeURIComponent(evil)}`)
      expect(await signIn()).toEqual({ pathname: '/dashboard', search: '', hash: '' })
      view.unmount()
    }
  })
})

/* ── Source inventory: no guard may drop the fragment ── */

const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function clientSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') clientSources(abs, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(abs)
  }
  return out
}

describe('TI-20 R5 — every location-built login return keeps pathname + search + hash', () => {
  // A call site is any loginWithReturnTo(...) / buildLoginRedirect(...) / returnPath: ... whose
  // argument is built from the router `location`.
  const SITE = /(loginWithReturnTo\(|buildLoginRedirect\(|returnPath:)([^\n]*location\.[^\n]*)/g
  const sites = clientSources(WEB_SRC).flatMap(file => {
    const text = readFileSync(file, 'utf8')
    return [...text.matchAll(SITE)].map(m => ({
      at: `${relative(WEB_SRC, file).split(sep).join('/')}:${text.slice(0, m.index).split('\n').length}`,
      expr: m[2],
    }))
  })

  it('finds the guard call sites (guards against a vacuous scan)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10)
  })

  it('no call site drops the query or the fragment', () => {
    const dropping = sites.filter(s => !/location\.pathname/.test(s.expr) || !/location\.search/.test(s.expr) || !/location\.hash/.test(s.expr))
    expect(dropping).toEqual([])
  })
})
