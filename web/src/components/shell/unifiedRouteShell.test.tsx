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
import { MemoryRouter, Routes, Route, Outlet, useSearchParams } from 'react-router-dom'
import type { EffectiveFeatureState } from '@/config/featureRegistry'
import { safeReturnTarget } from './safeReturn'

const KEY = 'carup-unified-ui'

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
    // Object context is projected from the canonical registry, not invented.
    expect(screen.getByTestId('shell-ws-object-title')).toBeInTheDocument()
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
    expect(screen.getAllByText('Fixture Motors').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('shell-ws-tenant')).toHaveTextContent('Fixture Motors')
    expect(screen.getByText('Operating')).toBeInTheDocument()
    expect(screen.getByText('tenant tenant-fx1')).toBeInTheDocument()
    // Exactly ONE chrome: the legacy canonical header must not also render.
    expect(screen.queryByText('CarUp Dealer Workspace')).toBeNull()
    expect(container.querySelectorAll('[data-testid="shell-ws-rail"]')).toHaveLength(1)
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

  it('focused off-slice path (/kyc) renders legacy even when opted in', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const { UnifiedRouteShell } = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/kyc']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="focused" legacy={legacyMain} />}>
            <Route path="/kyc" element={<div>kyc body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('legacy-layout')).toBeInTheDocument()
    expect(screen.getByText('kyc body')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-focused-exit"]')).toBeNull()
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
