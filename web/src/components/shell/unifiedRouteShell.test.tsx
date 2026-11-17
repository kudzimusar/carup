/**
 * RX-02A S1-4B R2 — Guard-restoration, scope, and verified-context tests for
 * the unified route shell switch. Security-critical invariants that MUST hold:
 *
 *  P0-A  Public + focused unified flows enforce the SAME lifecycle boundary as
 *        legacy MainLayout (planned/disabled/deprecated/beta) — opt-in cannot
 *        bypass it.
 *  P0-B  The personal workspace enforces the SAME centralized guard as legacy
 *        DashboardLayout: guest → login?returnTo, wrong role → own dashboard,
 *        planned/disabled → canonical state pages, bootstrapping → loading.
 *  R2-1  The dealer workspace uses the SHARED server-enforced workspace hook,
 *        renders exactly ONE chrome (no nested legacy header), shows only
 *        server-verified tenant context, and renders explicit
 *        loading/unauthorized states.
 *  R2-2  No inert primary action exists in the personal workspace.
 *  R2-3  Off-slice routes (diaspora/Trade, KYC, …) keep the legacy composition
 *        even when opted in.
 *  R2-5  safeReturnTarget bounds exit destinations to safe internal paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, Outlet, useSearchParams } from 'react-router-dom'
import type { EffectiveFeatureState } from '@/config/featureRegistry'
import { getDashboardItems, getDashboardRoute, getRoleMetadata } from '@/config/featureRegistry'
import { safeReturnTarget } from './safeReturn'

const KEY = 'carup-unified-ui'

/** RX03-P2-R4 — the family navigation: a desktop rail (many destinations) or a grouped tab bar. */
const workspaceNav = () =>
  (document.getElementById('shell-ws-rail') ?? document.querySelector('[data-testid="shell-ws-tabs"]')) as HTMLElement

// NOTE: vi.resetModules() gives the component under test a FRESH module graph,
// so the governance context must come from the SAME graph or Provider
// overrides would be invisible to RegistryRouteBoundary.
async function loadSwitch() {
  vi.resetModules()
  const [shell, gov] = await Promise.all([
    import('./UnifiedRouteShell'),
    import('@/context/featureGovernanceStore'),
  ])
  return {
    UnifiedRouteShell: shell.UnifiedRouteShell,
    FeatureGovernanceContext: gov.FeatureGovernanceContext,
  }
}

const unauthenticatedAuth = {
  useAuth: () => ({
    user: null, token: null, isAuthenticated: false, loading: false,
    login: () => {}, logout: () => {}, switchRole: async () => {},
  }),
}
function authenticatedAuth(role: string, name = 'Tendai Moyo') {
  return {
    useAuth: () => ({
      user: { id: 'u1', name, email: 't@example.co.zw', role, phone: '' },
      token: 'tok', isAuthenticated: true, loading: false,
      login: () => {}, logout: () => {}, switchRole: async () => {},
    }),
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
})
afterEach(() => {
  window.sessionStorage.clear()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  vi.unstubAllGlobals()
})

/* ── P0 reference: flag OFF returns the exact legacy element ─────────────── */

describe('UnifiedRouteShell — DEFAULT-OFF', () => {
  it('returns the exact legacy element (reference identity) when not opted in', async () => {
    const { UnifiedRouteShell } = await loadSwitch()
    const legacy = <div data-testid="legacy-layout">legacy</div>
    expect(UnifiedRouteShell({ family: 'public', legacy })).toBe(legacy)
    expect(UnifiedRouteShell({ family: 'focused', legacy })).toBe(legacy)
    expect(UnifiedRouteShell({ family: 'workspace-personal', legacy })).toBe(legacy)
    expect(UnifiedRouteShell({ family: 'workspace-dealer', legacy })).toBe(legacy)
  })
})

/* ── P0-A: lifecycle boundary restored in unified public/focused flows ───── */

describe('P0-A — lifecycle boundary enforced when opted in', () => {
  it('public slice renders FeatureDisabledPage when governance disables the marketplace', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const disabled: EffectiveFeatureState = {
      featureId: 'product.marketplace', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'product.marketplace': disabled }}>
        <MemoryRouter initialEntries={['/marketplace']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="public" legacy={<div>legacy</div>} />}>
              <Route path="/marketplace" element={<div>marketplace body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(screen.getByTestId('feature-disabled-page')).toBeInTheDocument()
    expect(screen.queryByText('marketplace body')).toBeNull()
  })

  it('public slice renders FeaturePlannedPage when governance marks the marketplace planned (guest sees lifecycle, not the page)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    // `enabled` stays true: enabled:false is the runtime kill-switch and
    // short-circuits to the DISABLED decision before the planned gate.
    const planned: EffectiveFeatureState = {
      featureId: 'product.marketplace', state: 'planned',
      enabled: true, visible: false, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'product.marketplace': planned }}>
        <MemoryRouter initialEntries={['/marketplace']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="public" legacy={<div>legacy</div>} />}>
              <Route path="/marketplace" element={<div>marketplace body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(screen.getByTestId('feature-planned-page')).toBeInTheDocument()
    expect(screen.queryByText('marketplace body')).toBeNull()
  })

  it('focused flow honors the same boundary (disabled login feature blocks the login form)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const disabled: EffectiveFeatureState = {
      featureId: 'auth.login', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'auth.login': disabled }}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="focused" legacy={<div>legacy</div>} />}>
              <Route path="/login" element={<form data-testid="real-login-form" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(screen.getByTestId('feature-disabled-page')).toBeInTheDocument()
    expect(screen.queryByTestId('real-login-form')).toBeNull()
  })
})

/* ── P0-B: personal workspace centralized guard ──────────────────────────── */

describe('P0-B — personal workspace guard equals legacy DashboardLayout', () => {
  it('guest is redirected to /login?returnTo=…; workspace chrome never renders', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
            <Route path="/dashboard" element={<div>owner dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('returnto')).toHaveTextContent('/dashboard')
    expect(screen.queryByText('owner dashboard body')).toBeNull()
    expect(screen.queryByTestId('shell-ws-rail')).toBeNull()
  })

  it('wrong role is redirected away to their own dashboard; owner body never renders', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('mechanic', 'Simba Mechanic'))
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/mechanic" element={<div>mechanic dashboard</div>} />
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
            <Route path="/dashboard" element={<div>owner dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('mechanic dashboard')).toBeInTheDocument()
    expect(screen.queryByText('owner dashboard body')).toBeNull()
    expect(screen.queryByTestId('shell-ws-rail')).toBeNull()
  })

  it('disabled owner feature renders the canonical disabled page (not the shell)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const disabled: EffectiveFeatureState = {
      featureId: 'owner.overview', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'owner.overview': disabled }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
              <Route path="/dashboard" element={<div>owner dashboard body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(screen.getByTestId('feature-disabled-page')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-ws-rail')).toBeNull()
  })

  it('owner allowed: shell chrome renders with registry-derived context and NO inert primary action (R2-2)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
            <Route path="/dashboard" element={<div>real owner overview</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('real owner overview')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-ws-rail"]')).toBeInTheDocument()
    // RX03-P2-R4: the page owns its heading — the shell adds no second title row —
    // and phones get the owner's task bar with exactly one current destination.
    expect(screen.queryByTestId('shell-ws-object-title')).toBeNull()
    const tasks = screen.getByTestId('shell-ws-bottom-nav')
    expect(tasks.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(tasks.querySelector('[aria-current="page"]')).toHaveAttribute('href', '/dashboard')
    // One brand owner: the masthead logo only (no rail logo).
    expect(container.querySelectorAll('[data-brand-slot]')).toHaveLength(1)
    // One home: the rail never adds a second link to the page it already lists.
    const homeLinks = Array.from(workspaceNav().querySelectorAll('a[href="/dashboard"]'))
    expect(homeLinks).toHaveLength(1)
    // No inert primary button.
    expect(container.querySelector('[data-testid="shell-ws-primary-action"]')).toBeNull()
  })
})

/* ── R2-1: dealer workspace — verified context, single chrome ────────────── */

function mockApiClient(workspace: unknown) {
  vi.doMock('@/lib/apiClient', () => ({
    apiRequest: async () => ({ workspace }),
    resolveApiBaseUrl: () => '/api',
    setUnauthorizedHandler: () => {},
    SessionExpiredError: class extends Error {},
  }))
}

const eligibleWorkspace = {
  actor_id: 'u1', operational: true, owner_membership_confirmed: true,
  tenant_id: 'tenant-fx1', organization_id: 'org-fx1', dealer_profile_id: 'dp-fx1',
  profile: { legal_name: 'Fixture Motors Pvt Ltd', trading_name: 'Fixture Motors' },
}

describe('R2-1 — dealer workspace uses the shared server-enforced guard', () => {
  it('guest is redirected to /login?returnTo=… (same canonical behavior as legacy)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    mockApiClient(null)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('returnto')).toHaveTextContent('/dealer/dashboard')
    expect(screen.queryByText('dealer dashboard body')).toBeNull()
  })

  it('server-verified owner sees ONE workspace chrome with verified tenant context — no duplicate legacy header', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('member', 'Tendai Moyo'))
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    // Server verification is async: await the ready state.
    expect(await screen.findByText('dealer dashboard body')).toBeInTheDocument()
    // Verified tenant context from the server (never client-invented); it is
    // projected in both the rail tenant label and the object title.
    // RX03-P2-R4: the dealership is named ONCE in the chrome (context text with its operating
    // state); the page's own profile card is its single large identity. No raw UUIDs.
    expect(screen.getByTestId('shell-ws-tenant')).toHaveTextContent('Fixture Motors · Operating')
    expect(screen.queryByTestId('shell-ws-object-title')).toBeNull()
    expect(container.textContent).not.toContain('tenant-fx1')
    expect(container.textContent).not.toContain('org-fx1')
    // Exactly ONE chrome: the legacy canonical header must not also render, one brand mark,
    // and the dealer destinations are one grouped tab bar (no rail).
    expect(screen.queryByText('CarUp Dealer Workspace')).toBeNull()
    expect(container.querySelectorAll('[data-brand-slot]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="shell-ws-tabs"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="shell-ws-rail"]')).toHaveLength(0)
  })

  it('ineligible workspace renders the explicit unavailable state and implies no permission', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('member', 'Tendai Moyo'))
    mockApiClient({ ...eligibleWorkspace, operational: false })
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('dealer-workspace-unavailable')).toBeInTheDocument()
    expect(screen.queryByText('dealer dashboard body')).toBeNull()
    expect(screen.queryByText('Operating')).toBeNull()
    expect(screen.queryByTestId('shell-ws-rail')).toBeNull()
  })
})

/* ── R2-3: off-slice routes keep legacy composition even when opted in ───── */

describe('R2-3 — first-slice scope', () => {
  // The legacy stub mirrors real wiring (MainLayout renders an Outlet), so
  // off-slice pages keep their full legacy composition when opted in.
  const legacyMain = (
    <div data-testid="legacy-layout">
      legacy
      <Outlet />
    </div>
  )

  it('public off-slice path (diaspora) renders legacy even when opted in', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/diaspora']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora" element={<div>diaspora body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(screen.getByText('diaspora body')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-public-header"]')).toBeNull()
  })

  it('RX04-E: /kyc renders in the focused identity shell when opted in (title + explicit exit, no legacy chrome)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/kyc']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="focused" legacy={legacyMain} />}>
            <Route path="/kyc" element={<div>kyc body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('legacy-layout')).toBeNull()
    expect(screen.getByText('kyc body')).toBeInTheDocument()
    expect(screen.getByTestId('shell-focused-exit')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Identity check')
  })

  it('marketplace compare is NOT mistaken for a vehicle-detail slice route', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/marketplace/compare']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/marketplace/compare" element={<div>compare body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(screen.getByText('compare body')).toBeInTheDocument()
  })
})

/* ── R2-5: bounded exit destinations ─────────────────────────────────────── */

describe('R2-5 — safeReturnTarget bounds exit destinations', () => {
  const loc = (from: unknown) =>
    ({
      state: from === undefined ? undefined : { from },
      pathname: '/login', search: '', hash: '', key: 'x',
    }) as never
  it('honors safe internal paths', () => {
    expect(safeReturnTarget(loc('/marketplace'))).toBe('/marketplace')
    expect(safeReturnTarget(loc('/dealer/dashboard'))).toBe('/dealer/dashboard')
  })
  it('rejects external URLs and falls back to /', () => {
    expect(safeReturnTarget(loc('https://evil.example/phish'))).toBe('/')
    expect(safeReturnTarget(loc('//evil.example'))).toBe('/')
    expect(safeReturnTarget(loc('javascript:alert(1)'))).toBe('/')
  })
  it('falls back to / when no from state exists', () => {
    expect(safeReturnTarget(loc(undefined))).toBe('/')
  })
})

/* ── Chrome presence (opted in, allowed routes) ──────────────────────────── */

describe('Unified shell chrome — opted in, in-scope routes', () => {
  it('public slice renders real page content with unified chrome: header, footer, bottom nav, skip link', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={<div>legacy</div>} />}>
            <Route path="/marketplace" element={<div>real marketplace page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('real marketplace page')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-public-header"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-public-footer"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-public-bottom-nav"]')).toBeInTheDocument()
    expect(screen.getByText('Skip to main content')).toBeInTheDocument()
  })

  it('focused login renders the page own form beneath the path-appropriate focused chrome', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="focused" legacy={<div>legacy</div>} />}>
            <Route path="/login" element={<form data-testid="real-login-form"><input aria-label="Email" /></form>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('real-login-form')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-focused-exit"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in to CarUp' })).toBeInTheDocument()
  })

  it('focused register gets its own path-appropriate title (no static wrong title)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="focused" legacy={<div>legacy</div>} />}>
            <Route path="/register" element={<form data-testid="register-form" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Create your CarUp account' })).toBeInTheDocument()
  })
})

// Reads the returnTo query the canonical guard redirected with.
function LoginProbe() {
  const [params] = useSearchParams()
  return <div data-testid="returnto">{params.get('returnTo') ?? ''}</div>
}

/* ── R3 C4: role-aware projection (never assumes owner) ──────────────────── */

describe('R3-C4 — navigation truth from the real session role', () => {
  it('public shell offers an authenticated DEALER their own dashboard (not the owner dashboard)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('dealer', 'Croco Motors'))
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={<div>legacy</div>} />}>
            <Route path="/marketplace" element={<div>marketplace body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const entry = screen.getByTestId('shell-workspace-entry')
    expect(entry).toHaveAttribute('href', getDashboardRoute('dealer'))
    expect(entry).not.toHaveAttribute('href', getDashboardRoute('owner'))
  })

  it('personal workspace header shows the REAL role metadata title', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
            <Route path="/dashboard" element={<div>owner dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.setup().click(screen.getByTestId('shell-ws-account'))
    expect(screen.getByTestId('shell-ws-account-menu')).toHaveTextContent(getRoleMetadata('owner').title)
  })

  it('a feature marked PLANNED by governance is not an active rail action (registry visibility: omitted from the rail)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const target = getDashboardItems('owner').find(f => f.id !== 'owner.overview')
    expect(target).toBeDefined()
    const planned: EffectiveFeatureState = {
      featureId: target!.id, state: 'planned',
      // enabled stays true: enabled:false is the runtime kill-switch and
      // short-circuits to DISABLED before the planned gate.
      enabled: true, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ [target!.id]: planned }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
              <Route path="/dashboard" element={<div>owner dashboard body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    // The planned feature must not appear as an active navigable link. The
    // shared visibility resolver treats 'planned' as not visible, so the
    // registry projection omits it from the rail entirely (never an action).
    const rail = workspaceNav()
    const activeLink = Array.from(rail.querySelectorAll('a[href]'))
      .find(a => a.getAttribute('href') === target!.route)
    expect(activeLink).toBeUndefined()
  })

  it('a feature DISABLED by governance disappears from the workspace rail entirely', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const target = getDashboardItems('owner').find(f => f.id !== 'owner.overview')
    const disabled: EffectiveFeatureState = {
      featureId: target!.id, state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ [target!.id]: disabled }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
              <Route path="/dashboard" element={<div>owner dashboard body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    const rail = workspaceNav()
    expect(rail.textContent).not.toContain(target!.label)
  })
})

/* ── R3 C2: safe sign-out via the existing session mechanism ─────────────── */

describe('R3-C2 — sign-out uses the existing AuthContext logout', () => {
  it('personal workspace Sign Out invokes the session logout (no new backend, no storage nuking)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const logout = vi.fn()
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: () => ({
        user: { id: 'u1', name: 'Tendai Moyo', email: 't@example.co.zw', role: 'owner', phone: '' },
        token: 'tok', isAuthenticated: true, loading: false,
        login: () => {}, logout, switchRole: async () => {},
      }),
    }))
    const { UnifiedRouteShell } = await loadSwitch()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={<div>legacy</div>} />}>
            <Route path="/dashboard" element={<div>owner dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByTestId('shell-ws-account'))
    await user.click(screen.getByTestId('shell-ws-sign-out'))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('dealer workspace Sign Out invokes the same session logout', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const logout = vi.fn()
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: () => ({
        user: { id: 'u1', name: 'Tendai Moyo', email: 't@example.co.zw', role: 'member', phone: '' },
        token: 'tok', isAuthenticated: true, loading: false,
        login: () => {}, logout, switchRole: async () => {},
      }),
    }))
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell } = await loadSwitch()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('dealer dashboard body')).toBeInTheDocument()
    await user.click(screen.getByTestId('shell-ws-account'))
    await user.click(screen.getByTestId('shell-ws-sign-out'))
    expect(logout).toHaveBeenCalledTimes(1)
  })
})

/* ── R4-1: seller route ownership ─────────────────────────────────────────── */

describe('R4-1 / RX04-D — the seller claim flow never enters the unified personal shell', () => {
  // Mirrors the real wiring: legacy DashboardLayout renders its own chrome +
  // Outlet, so the seller flow keeps its FULL assigned composition.
  const legacyOwnerDashboard = (
    <div data-testid="legacy-owner-dashboard">
      legacy owner dashboard layout
      <Outlet />
    </div>
  )

  it('/dashboard/sell-vehicle renders its register-assigned FocusedShell (seller-claim) — NO WorkspaceShell chrome', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/sell-vehicle']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={legacyOwnerDashboard} />}>
            <Route path="/dashboard/sell-vehicle" element={<div data-testid="seller-flow-body">seller claim flow</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    // RX04-D: the real flow renders inside the Seller Studio focused chrome (R076)…
    expect(screen.getByTestId('seller-flow-body')).toBeInTheDocument()
    expect(screen.getByTestId('shell-focused-task')).toHaveTextContent('Seller Studio')
    expect(screen.getByTestId('shell-focused-exit')).toBeInTheDocument()
    // …and neither the unified workspace chrome nor the legacy dashboard chrome takes it over.
    expect(container.querySelector('[data-testid="shell-ws-rail"]')).toBeNull()
    expect(screen.queryByTestId('legacy-owner-dashboard')).toBeNull()
  })

  it('/dashboard/sell-vehicle keeps the centralized guard: a guest is sent to /login?returnTo=…', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dashboard/sell-vehicle']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={legacyOwnerDashboard} />}>
            <Route path="/dashboard/sell-vehicle" element={<div data-testid="seller-flow-body">seller claim flow</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('returnto')).toHaveTextContent('/dashboard/sell-vehicle')
    expect(screen.queryByTestId('seller-flow-body')).toBeNull()
  })

  it('guest /sell renders the same Seller Studio chrome with a lifecycle-only boundary (no sign-in needed to start)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/sell']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<UnifiedRouteShell family="public" legacy={<div data-testid="legacy-main">legacy main <Outlet /></div>} />}>
            <Route path="/sell" element={<div data-testid="guest-sell-body">guest sell</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('guest-sell-body')).toBeInTheDocument()
    expect(screen.getByTestId('shell-focused-task')).toHaveTextContent('Seller Studio')
    expect(screen.queryByTestId('legacy-main')).toBeNull()
    expect(screen.queryByTestId('returnto')).toBeNull()
  })

  it('approved personal-slice routes still render the unified workspace chrome when opted in', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner'))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/garage']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-personal" legacy={legacyOwnerDashboard} />}>
            <Route path="/dashboard/garage" element={<div>garage body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('garage body')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-ws-rail"]')).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-owner-dashboard')).toBeNull()
  })
})

/* ── R4-2: dealer navigation governance ───────────────────────────────────── */

describe('R4-2 — dealer rail is governed by the canonical resolver, not forced active', () => {
  it('route continuity: only unified-slice dealer destinations are live rail links; nothing outside the slice navigates; no out-of-slice primary action', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('dealer', 'Croco Motors'))
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('dealer dashboard body')).toBeInTheDocument()
    const rail = workspaceNav()
    // Continuity: no live link may point at a destination outside the unified
    // shell (those routes live in legacy MainLayout and would drop the chrome).
    // RX03-P2: the slice now holds the five canonical /dealers/* operations pages
    // (register R017–R021), rendered inside this same server-verified workspace.
    const { DEALER_UNIFIED_SLICE } = await import('./navProjection')
    const liveHrefs = Array.from(rail.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    for (const href of liveHrefs) {
      expect(href === null || DEALER_UNIFIED_SLICE.has(href) || !href.startsWith('/dealer')).toBe(true)
    }
    expect(liveHrefs).toEqual(expect.arrayContaining(['/dealer/dashboard', '/dealers/stock', '/dealers/inquiries']))
    // Any "Soon" entry stays honest: a non-navigating span, never a link.
    for (const entry of Array.from(rail.querySelectorAll('span[aria-disabled="true"]'))) {
      expect(entry.querySelector('a')).toBeNull()
    }
    // Governance: the forced "Review buyer inquiries" primary action is gone.
    expect(container.querySelector('[data-testid="shell-ws-primary-action"]')).toBeNull()
  })

  it('a registry-backed dealer destination DISABLED by governance is omitted from the rail', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('dealer', 'Croco Motors'))
    // Add a genuinely registry-backed operations destination so the resolver
    // path is exercised end to end (dealer.inventory → /dealer/inventory).
    vi.doMock('@/components/dealer/useDealerOperationalWorkspace', async importOriginal => {
      const actual =
        await importOriginal<typeof import('@/components/dealer/useDealerOperationalWorkspace')>()
      return {
        ...actual,
        DEALER_OPERATION_LINKS: [
          ...actual.DEALER_OPERATION_LINKS,
          { id: 'registry-inventory', label: 'Registry inventory', href: '/dealer/inventory' },
        ],
      }
    })
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const disabled: EffectiveFeatureState = {
      featureId: 'dealer.inventory', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'dealer.inventory': disabled }}>
        <MemoryRouter initialEntries={['/dealer/dashboard']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
              <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(await screen.findByText('dealer dashboard body')).toBeInTheDocument()
    const rail = workspaceNav()
    expect(rail.textContent).not.toContain('Registry inventory')
  })

  it('an out-of-slice registry-backed destination is never a live action (Soon, not a link)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('dealer', 'Croco Motors'))
    vi.doMock('@/components/dealer/useDealerOperationalWorkspace', async importOriginal => {
      const actual =
        await importOriginal<typeof import('@/components/dealer/useDealerOperationalWorkspace')>()
      return {
        ...actual,
        DEALER_OPERATION_LINKS: [
          ...actual.DEALER_OPERATION_LINKS,
          { id: 'registry-inventory', label: 'Registry inventory', href: '/dealer/inventory' },
        ],
      }
    })
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('dealer dashboard body')).toBeInTheDocument()
    const rail = workspaceNav()
    // Present (the feature is registry-active) but NOT a navigable link.
    expect(rail.textContent).toContain('Registry inventory')
    const link = Array.from(rail.querySelectorAll('a[href]'))
      .find(a => a.getAttribute('href') === '/dealer/inventory')
    expect(link).toBeUndefined()
  })
})

/* ── RX03-P2 — connected pilot slices (register R017–R021, R038–R043) ───── */

describe('RX03-P2 — connected pilot slices', () => {
  // The R4-2 block above leaves a doMock of the workspace hook bound to ITS module
  // graph (stale auth/api mocks). These tests must exercise the real hook.
  beforeEach(() => vi.doUnmock('@/components/dealer/useDealerOperationalWorkspace'))
  const legacyMain = (
    <div data-testid="legacy-layout">
      legacy
      <Outlet />
    </div>
  )
  const ORDER = '7f3c1a2b-0000-4000-8000-00000000abcd'

  it('with the accepted showroom chrome ON, public pages keep that chrome (RX-02 PublicShell does not replace it)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    window.sessionStorage.setItem('carup-showroom-chrome', '1')
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/marketplace" element={<div>real marketplace page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(screen.getByText('real marketplace page')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-public-header"]')).toBeNull()
  })

  it('/dealers/stock renders inside the SAME server-verified dealer workspace (one chrome, live inventory + enquiries)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('member', 'Fixture Owner'))
    mockApiClient(eligibleWorkspace)
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/dealers/stock']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/dealers/stock" element={<div>tenant inventory page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('tenant inventory page')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="legacy-layout"]')).toBeNull()
    const rail = workspaceNav()
    const hrefs = Array.from(rail.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['/dealers/stock', '/dealers/inquiries', '/dealer/dashboard']))
    expect(screen.getAllByText(/Fixture Motors/).length).toBeGreaterThan(0)
  })

  it('/dealers/inquiries without an operational workspace shows the explicit unavailable state, never the page', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('dealer', 'Legacy Dealer'))
    mockApiClient(null)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dealers/inquiries']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/dealers/inquiries" element={<div>tenant enquiries page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('dealer-workspace-unavailable')).toBeInTheDocument()
    expect(screen.queryByText('tenant enquiries page')).toBeNull()
  })

  it('guest on /dealers/stock is sent to login with returnTo (canonical dealer workspace behaviour)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    mockApiClient(null)
    const { UnifiedRouteShell } = await loadSwitch()
    function LoginProbe() {
      const [params] = useSearchParams()
      return <div>login returnTo={params.get('returnTo')}</div>
    }
    render(
      <MemoryRouter initialEntries={['/dealers/stock']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/dealers/stock" element={<div>tenant inventory page</div>} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('login returnTo=/dealers/stock')).toBeInTheDocument()
    expect(screen.queryByText('tenant inventory page')).toBeNull()
  })

  it('an import order renders in the Trade workspace with the SERVER-RETURNED order as the anchor and its real sections', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner', 'Rudo Chikore'))
    const reads: string[] = []
    vi.doMock('@/lib/apiClient', () => ({
      apiRequest: async ({ path }: { path: string }) => {
        reads.push(path)
        return { id: ORDER, order_type: 'vehicle', requested_make: 'Toyota', requested_model: 'Aqua', status: 'DOCUMENTS_PENDING', origin_country: 'Japan', destination_country: 'Zimbabwe' }
      },
      resolveApiBaseUrl: () => '/api',
      setUnauthorizedHandler: () => {},
      SessionExpiredError: class extends Error {},
    }))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={[`/diaspora/imports/${ORDER}`]}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora/imports/:id" element={<div>import order detail page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('import order detail page')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="legacy-layout"]')).toBeNull()
    // The order identity comes from the participant-checked server read, not from the URL.
    expect(await screen.findByText(`Order ${ORDER.slice(0, 8)}`)).toBeInTheDocument()
    expect(screen.getByTestId('shell-ws-object-title')).toHaveTextContent('Toyota Aqua')
    expect(reads).toContain(`/diaspora/import-orders/${encodeURIComponent(ORDER)}`)
    const family = Array.from(workspaceNav().querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    expect(family).toEqual(expect.arrayContaining(['/diaspora/imports']))
    const tabs = Array.from(screen.getByTestId('shell-ws-object-tabs').querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    expect(tabs).toEqual(expect.arrayContaining([
      `/diaspora/imports/${ORDER}`,
      `/diaspora/imports/${ORDER}/documents`,
      `/diaspora/imports/${ORDER}/shipment`,
    ]))
    // Exactly one current page: the order tab; the family destination is the current section.
    expect(container.querySelectorAll('[aria-current="page"]:not([data-testid="shell-ws-bottom-nav"] *)')).toHaveLength(1)
    // No primary action is invented by the chrome.
    expect(container.querySelector('[data-testid="shell-ws-primary-action"]')).toBeNull()
  })

  it('a REFUSED import order gets no order navigation: the URL id alone never produces actionable order links', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner', 'Someone Else'))
    vi.doMock('@/lib/apiClient', () => ({
      apiRequest: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }) },
      resolveApiBaseUrl: () => '/api',
      setUnauthorizedHandler: () => {},
      SessionExpiredError: class extends Error {},
    }))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={[`/diaspora/imports/${ORDER}/documents`]}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora/imports/:id/documents" element={<div>order documents page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Import order unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-ws-object-tabs')).toBeNull()
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map(a => a.getAttribute('href') ?? '')
    expect(hrefs.some(h => h.includes(ORDER))).toBe(false)
    expect(screen.queryByText(`Order ${ORDER.slice(0, 8)}`)).toBeNull()
  })

  it('a signed-out visitor on an import route keeps the exact legacy composition', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/diaspora/imports']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora/imports" element={<div>import list page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(container.querySelector('#shell-ws-rail')).toBeNull()
  })

  it('/diaspora/imports/new is a Focused flow (one goal, exit back to the order list), not a workspace', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner', 'Rudo Chikore'))
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/diaspora/imports/new']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora/imports/new" element={<div>new import form</div>} />
            <Route path="/diaspora/imports" element={<div>import list page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('new import form')).toBeInTheDocument()
    expect(screen.getByText('Start an import order')).toBeInTheDocument()
    expect(container.querySelector('#shell-ws-rail')).toBeNull()
    await userEvent.click(screen.getByTestId('shell-focused-exit'))
    expect(await screen.findByText('import list page')).toBeInTheDocument()
  })

  it('a signed-out visitor on /diaspora/imports/new keeps the exact legacy composition (no focused chrome)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => unauthenticatedAuth)
    const { UnifiedRouteShell } = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/diaspora/imports/new']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
            <Route path="/diaspora/imports/new" element={<div>new import form</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(screen.queryByText('Start an import order')).toBeNull()
    expect(screen.queryByTestId('shell-focused-exit')).toBeNull()
  })

  it('the lifecycle boundary still applies inside the Trade workspace (disabled feature blocks the page)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => authenticatedAuth('owner', 'Rudo Chikore'))
    const { UnifiedRouteShell, FeatureGovernanceContext } = await loadSwitch()
    const disabled: EffectiveFeatureState = {
      featureId: 'owner.import-orders', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    render(
      <FeatureGovernanceContext.Provider value={{ 'owner.import-orders': disabled }}>
        <MemoryRouter initialEntries={['/diaspora/imports']}>
          <Routes>
            <Route element={<UnifiedRouteShell family="public" legacy={legacyMain} />}>
              <Route path="/diaspora/imports" element={<div>import list page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FeatureGovernanceContext.Provider>,
    )
    expect(screen.queryByText('import list page')).toBeNull()
  })
})
