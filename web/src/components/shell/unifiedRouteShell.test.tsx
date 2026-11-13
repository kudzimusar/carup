/**
 * RX-02A S1-4B — Default-OFF and authorization-preservation tests for the
 * unified route shell switch. Security-critical invariants:
 *
 *   1. DEFAULT-OFF: with no opt-in, the wrapper returns the EXACT legacy
 *      element (identity), so production presentation is unchanged.
 *   2. Opted-in dealer workspace STILL enforces the canonical server guard:
 *      an unauthenticated user is redirected to /login?returnTo=... and the
 *      protected dealer page never renders (tenant/compliance authorization
 *      preserved; the shell never gates or bypasses the guard).
 *   3. Opted-in public shell renders real page content with unified chrome
 *      (header, footer at all widths, bottom nav, skip link).
 *   4. Opted-in focused shell renders the page's own form beneath the chrome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'

const KEY = 'carup-unified-ui'

async function loadSwitch() {
  vi.resetModules()
  const mod = await import('./UnifiedRouteShell')
  return mod.UnifiedRouteShell
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

describe('UnifiedRouteShell — DEFAULT-OFF', () => {
  it('returns the exact legacy element (reference identity) when not opted in', async () => {
    const UnifiedRouteShell = await loadSwitch()
    const legacy = <div data-testid="legacy-layout">legacy</div>
    const out = UnifiedRouteShell({ family: 'public', legacy })
    // Must be the very same element object, not a re-created wrapper.
    expect(out).toBe(legacy)
  })
})

describe('UnifiedRouteShell — dealer workspace authorization preserved', () => {
  it('unauthenticated user is redirected to /login?returnTo=...; protected page never renders', async () => {
    window.sessionStorage.setItem(KEY, '1')
    // Mock an unauthenticated, non-loading session BEFORE importing the switch.
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: false, login: () => {}, logout: () => {}, switchRole: async () => {} }),
    }))
    const UnifiedRouteShell = await loadSwitch()
    render(
      <MemoryRouter initialEntries={['/dealer/dashboard']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route element={<UnifiedRouteShell family="workspace-dealer" legacy={<div>legacy</div>} />}>
            <Route path="/dealer/dashboard" element={<div>dealer dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    // The canonical guard redirected to login; the protected body must NOT render.
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('dealer dashboard body')).toBeNull()
  })

  it('returnTo is preserved in the login redirect (safe internal path)', async () => {
    window.sessionStorage.setItem(KEY, '1')
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: false, login: () => {}, logout: () => {}, switchRole: async () => {} }),
    }))
    const UnifiedRouteShell = await loadSwitch()
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
    // returnTo carries the protected path so post-login can return (continuity).
    expect(screen.getByTestId('returnto')).toHaveTextContent('/dealer/dashboard')
  })
})

// Reads the returnTo query the canonical guard redirected with.
function LoginProbe() {
  const [params] = useSearchParams()
  return <div data-testid="returnto">{params.get('returnTo') ?? ''}</div>
}

describe('UnifiedRouteShell — public shell (opted in)', () => {
  it('renders real page content with unified chrome: header, footer, bottom nav, skip link', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const UnifiedRouteShell = await loadSwitch()
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
})

describe('UnifiedRouteShell — focused shell (opted in)', () => {
  it('renders the page own form beneath the focused chrome', async () => {
    window.sessionStorage.setItem(KEY, '1')
    const UnifiedRouteShell = await loadSwitch()
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<UnifiedRouteShell family="focused" legacy={<div>legacy</div>} focusedTitle="Sign in to CarUp" />}>
            <Route path="/login" element={<form data-testid="real-login-form"><input aria-label="Email" /></form>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('real-login-form')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="shell-focused-exit"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in to CarUp' })).toBeInTheDocument()
  })
})
