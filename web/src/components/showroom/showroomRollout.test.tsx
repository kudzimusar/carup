import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

/**
 * RX03-R3 P0 — the redesigned pages cannot become visible in a production-mode build by accident.
 *
 * The switch sits INSIDE the guarded route (RegistryRouteBoundary owns lifecycle/role decisions), so
 * these tests render it exactly there. Production mode is simulated with `vi.stubEnv('PROD', true)`,
 * which is what every `vite build` output (production, staging, previews) reports at runtime.
 */
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock('@/lib/navigationAnalytics', () => ({ trackNav: vi.fn() }))

const { ShowroomRoute } = await import('./ShowroomRoute')
const { RegistryRouteBoundary } = await import('@/components/routing/RegistryRouteBoundary')
const { FeatureGovernanceContext } = await import('@/context/featureGovernanceStore')
const { getFeatureByRoute } = await import('@/config/featureRegistry')
const { readPresentation, PRESENTATIONS } = await import('@/lib/presentationFlags')

const Showroom = () => <div data-testid="showroom-page">showroom composition</div>

function renderRoute(routePath: string, states: Record<string, unknown> = {}) {
  const loader = vi.fn(async () => ({ default: Showroom }))
  const LazyShowroom = lazy(loader)
  render(
    <FeatureGovernanceContext.Provider value={states as never}>
      <MemoryRouter initialEntries={[routePath]}>
        <Routes>
          <Route element={<RegistryRouteBoundary enforceAuth={false}><Outlet /></RegistryRouteBoundary>}>
            <Route path="/marketplace" element={<ShowroomRoute accepted={<div data-testid="accepted-page">accepted</div>} showroom={LazyShowroom} />} />
            <Route path="/marketplace/:id" element={<ShowroomRoute accepted={<div data-testid="accepted-page">accepted</div>} showroom={LazyShowroom} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </FeatureGovernanceContext.Provider>,
  )
  return loader
}

function optInEverythingAVisitorControls() {
  ;(globalThis as Record<string, unknown>).__CARUP_SHOWROOM_PAGES__ = true
  window.sessionStorage.setItem('carup-showroom-pages', '1')
  window.history.replaceState(null, '', '/?carup-showroom=pages')
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__CARUP_SHOWROOM_PAGES__
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('readPresentation — the fail-closed decision', () => {
  const base = { prod: false, envValue: undefined, storageValue: null, globalValue: undefined, search: '' }

  it('is OFF by default in every build', () => {
    expect(readPresentation('pages', base)).toBe(false)
    expect(readPresentation('pages', { ...base, prod: true })).toBe(false)
  })

  it('ignores every visitor-controlled source in a production-mode build', () => {
    expect(readPresentation('pages', { ...base, prod: true, storageValue: '1', globalValue: true, search: '?carup-showroom=pages' })).toBe(false)
  })

  it('turns on in production only with the exact build-time value "on"', () => {
    expect(readPresentation('pages', { ...base, prod: true, envValue: 'on' })).toBe(true)
    for (const value of ['true', '1', 'ON', 'yes', ' on', 'off', '']) {
      expect(readPresentation('pages', { ...base, prod: true, envValue: value }), value).toBe(false)
    }
  })

  it('honours the isolated review opt-ins only outside production', () => {
    expect(readPresentation('pages', { ...base, storageValue: '1' })).toBe(true)
    expect(readPresentation('pages', { ...base, globalValue: true })).toBe(true)
    expect(readPresentation('pages', { ...base, search: '?carup-showroom=pages' })).toBe(true)
    expect(readPresentation('pages', { ...base, search: '?carup-showroom=chrome' })).toBe(false)
    expect(readPresentation('pages', { ...base, storageValue: 'true', globalValue: 'true' })).toBe(false)
  })

  it('uses a build variable separate from the unified-shell flag', () => {
    expect(PRESENTATIONS.pages.envName).toBe('VITE_CARUP_SHOWROOM_PAGES')
    expect(PRESENTATIONS.pages.envName).not.toBe('VITE_CARUP_UNIFIED_UI')
  })
})

describe('ShowroomRoute inside the guarded route', () => {
  it('renders the accepted composition by default and never requests the showroom chunk', () => {
    const loader = renderRoute('/marketplace')
    expect(screen.getByTestId('accepted-page')).toBeInTheDocument()
    expect(screen.queryByTestId('showroom-page')).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('renders the showroom composition for an isolated review opt-in (non-production)', async () => {
    window.sessionStorage.setItem('carup-showroom-pages', '1')
    const loader = renderRoute('/marketplace/JTDKARFP0H3000731')
    expect(await screen.findByTestId('showroom-page')).toBeInTheDocument()
    expect(screen.queryByTestId('accepted-page')).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('in a production-mode build, visitor opt-ins cannot reveal it and its code is not downloaded', () => {
    vi.stubEnv('PROD', true)
    optInEverythingAVisitorControls()
    const loader = renderRoute('/marketplace')
    expect(screen.getByTestId('accepted-page')).toBeInTheDocument()
    expect(screen.queryByTestId('showroom-page')).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('in a production-mode build, only the release setting turns it on', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_CARUP_SHOWROOM_PAGES', 'on')
    renderRoute('/marketplace')
    expect(await screen.findByTestId('showroom-page')).toBeInTheDocument()
  })

  it('cannot bypass the feature lifecycle guard: a disabled Marketplace stays disabled in both compositions', () => {
    const marketplaceId = getFeatureByRoute('/marketplace')?.id
    expect(marketplaceId).toBeTruthy()
    const states = { [marketplaceId as string]: { enabled: false }, 'product.marketplace': { enabled: false } }
    window.sessionStorage.setItem('carup-showroom-pages', '1')
    const loader = renderRoute('/marketplace', states)
    expect(screen.queryByTestId('showroom-page')).toBeNull()
    expect(screen.queryByTestId('accepted-page')).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('rolls back by removing the setting: the accepted page returns with no state of its own to undo', async () => {
    window.sessionStorage.setItem('carup-showroom-pages', '1')
    renderRoute('/marketplace')
    expect(await screen.findByTestId('showroom-page')).toBeInTheDocument()
    cleanup()
    window.sessionStorage.removeItem('carup-showroom-pages')
    renderRoute('/marketplace')
    expect(screen.getByTestId('accepted-page')).toBeInTheDocument()
    // The switch writes nothing but its own opt-in key; there is no other client state to migrate.
    expect(Object.keys(window.sessionStorage)).toEqual([])
  })
})

describe('App wiring', () => {
  const app = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../App.tsx'), 'utf8')

  it('routes all four journey paths through the switch with the accepted page as the default', () => {
    expect(app).toContain('<Route path="/" element={<ShowroomRoute accepted={<Landing />} showroom={ShowroomLanding} />} />')
    expect(app).toContain('<Route path="/marketplace" element={<ShowroomRoute accepted={<Marketplace />} showroom={ShowroomMarketplace} />} />')
    expect(app).toContain('<Route path="/marketplace/listing/:id" element={<ShowroomRoute accepted={<VehicleDetail />} showroom={ShowroomVehicleDetail} />} />')
    expect(app).toContain('<Route path="/marketplace/:id" element={<ShowroomRoute accepted={<VehicleDetail />} showroom={ShowroomVehicleDetail} />} />')
  })

  it('loads the showroom pages only through dynamic imports (separate chunks)', () => {
    expect(app).not.toMatch(/^import .* from '\.\/pages\/showroom\//m)
    expect(app).toContain("lazy(importShowroomLanding)")
  })

  it('leaves the unified-shell production fail-closed flag untouched', () => {
    const flag = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shell/unifiedFlag.ts'), 'utf8')
    expect(flag).toContain('if (s.prod) return false')
  })
})

describe('RX03 Addendum 05 — launch-capability previews are fail-closed', () => {
  const base = { prod: true, envValue: undefined, storageValue: '1', globalValue: true, search: '?carup-showroom=pages,chrome,preview' }
  it('a production build ignores every visitor opt-in for previews', () => {
    expect(readPresentation('preview', base)).toBe(false)
  })
  it('only the build-time setting turns previews on in production', () => {
    expect(readPresentation('preview', { ...base, envValue: 'on' })).toBe(true)
  })
  it('review opt-ins work outside production', () => {
    expect(readPresentation('preview', { ...base, prod: false, storageValue: null, globalValue: undefined })).toBe(true)
  })
})
