/**
 * CA-K3-01 — the Corporate Admin shell.
 *
 * Gate first: the shell renders NOTHING of Corporate Admin until the compatibility bridge
 * (lib/corporate/access.ts) admits the person; every other outcome redirects or refuses (fail closed).
 * Then: identity bar (plane · scope · freshness · attention · account), a persistent left rail with
 * the ten canonical destinations in canonical order, each with its plane marker, and the page.
 *
 * Responsive: ≥1024px the rail is persistent and can be collapsed to an icon rail; below that it
 * becomes a drawer (Escape closes, focus moves in and returns). Truth-state and plane labels stay
 * visible at every width.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bell, Building2, Car, ChevronsLeft, ChevronsRight, Clock, Database, FileText, Landmark, LayoutDashboard, LogOut, Menu, Server, ShieldCheck, TrendingUp, UserCircle, Users, Workflow, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { activeTenantScopeOf } from '@/config/featureRegistry'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { loginWithReturnTo } from '@/lib/routeAccess'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { useShellSignOut } from '@/components/layout/useShellSignOut'
import { CORPORATE_PLANES, CORPORATE_ROOT, destinationForPath } from '@/config/corporate/navigation'
import { canSeeDestination, resolveCorporateAccess, visibleDestinations, type CorporateGrant } from '@/lib/corporate/access'
import { CorporateContextProvider } from './CorporateContext'
import { PlaneIndicator } from './CorporatePage'
import { TruthStateBadge } from './TruthState'

// Local to the Corporate shell: the shared feature-icon map is not widened for this slice.
const DESTINATION_ICONS: Record<string, LucideIcon> = { LayoutDashboard, Building2, Landmark, TrendingUp, Workflow, ShieldCheck, Database, Users, FileText, Server }

const COLLAPSE_KEY = 'carup.corporate.rail.collapsed'
const readCollapsed = () => { try { return window.localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
const writeCollapsed = (v: boolean) => { try { window.localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* per-viewer convenience only */ } }

export default function CorporateLayout() {
  const { user, loading } = useAuth()
  const effectiveStates = useFeatureEffectiveStates()
  const location = useLocation()
  const decision = resolveCorporateAccess({
    isBootstrapping: loading,
    isAuthenticated: !!user,
    role: user?.role ?? null,
    activeTenant: activeTenantScopeOf(user),
    effectiveStates,
  })
  if (decision.kind === 'loading') return <AuthBootstrapLoading />
  if (decision.kind === 'redirect') {
    const to = decision.reason === 'auth' ? loginWithReturnTo(`${location.pathname}${location.search}`) : decision.to
    return <Navigate to={to} replace />
  }
  if (decision.kind === 'unavailable') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6" data-testid="corporate-unavailable">
        <p className="max-w-md text-center text-sm text-slate-600">Corporate Admin is not available right now.</p>
      </main>
    )
  }
  return (
    <CorporateContextProvider>
      <CorporateShell grant={decision.grant} />
    </CorporateContextProvider>
  )
}

function CorporateShell({ grant }: { grant: CorporateGrant }) {
  const { user } = useAuth()
  const location = useLocation()
  const current = destinationForPath(location.pathname)
  const allowed = current ? canSeeDestination(grant, current) : false
  const nav = visibleDestinations(grant)

  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  const toggleCollapsed = () => setCollapsed((c) => { writeCollapsed(!c); return !c })

  const [drawerOpen, setDrawerOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openDrawer = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDrawerOpen(true)
  }, [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  useEffect(() => {
    if (!drawerOpen) { openerRef.current?.focus?.(); openerRef.current = null; return }
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const [panel, setPanel] = useState<null | 'freshness' | 'attention' | 'account'>(null)
  const signOut = useShellSignOut(closeDrawer)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" data-testid="corporate-shell">
      <a href="#corporate-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to content
      </a>

      {/* Identity / context bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950 text-white" data-testid="corporate-topbar">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400 lg:hidden"
            onClick={openDrawer}
            aria-label="Open Corporate Admin navigation"
            aria-expanded={drawerOpen}
            aria-controls="corporate-drawer"
            data-testid="corporate-drawer-open"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link to={CORPORATE_ROOT} className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400" data-testid="corporate-identity">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-orange-500"><Car className="h-4 w-4 text-white" aria-hidden="true" /></span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">CarUp</span>
              <span className="block text-[11px] uppercase tracking-[0.14em] text-slate-400">Corporate Admin</span>
            </span>
          </Link>
          {current && allowed && (
            <span className="ml-2 hidden md:inline-flex" data-testid="topbar-plane">
              <span className="sr-only">Current plane: </span>
              <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                <span className="mr-1 font-mono text-orange-400" aria-hidden="true">{CORPORATE_PLANES[current.plane].marker}</span>
                {CORPORATE_PLANES[current.plane].label}
              </span>
            </span>
          )}
          <span className="hidden text-xs text-slate-400 xl:inline" data-testid="topbar-scope">Scope: CarUp Corporate</span>
          <div className="ml-auto flex items-center gap-1">
            <TopbarButton label="Data freshness" active={panel === 'freshness'} onClick={() => setPanel(panel === 'freshness' ? null : 'freshness')} testId="topbar-freshness">
              <Clock className="h-4 w-4" aria-hidden="true" /><span className="hidden text-xs sm:inline">No source connected</span>
            </TopbarButton>
            <TopbarButton label="Attention" active={panel === 'attention'} onClick={() => setPanel(panel === 'attention' ? null : 'attention')} testId="topbar-attention">
              <Bell className="h-4 w-4" aria-hidden="true" />
            </TopbarButton>
            <TopbarButton label="Account" active={panel === 'account'} onClick={() => setPanel(panel === 'account' ? null : 'account')} testId="topbar-account">
              <UserCircle className="h-5 w-5" aria-hidden="true" />
            </TopbarButton>
          </div>
        </div>
        {panel && (
          <div className="border-t border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200" role="region" aria-label={panel === 'freshness' ? 'Data freshness' : panel === 'attention' ? 'Attention' : 'Account'} data-testid={`topbar-panel-${panel}`}>
            {panel === 'freshness' && (
              <div className="flex flex-wrap items-center gap-2">
                <TruthStateBadge state="UNAVAILABLE_NO_SOURCE" badge="Not connected" />
                <span>No governed metric source is connected to Corporate Admin yet, so there is nothing to be fresh or stale. Freshness is a source state, not a business figure.</span>
              </div>
            )}
            {panel === 'attention' && (
              <div className="flex flex-wrap items-center gap-2">
                <TruthStateBadge state="UNAVAILABLE_NO_SOURCE" badge="Not connected" />
                <span>No attention source is connected. Overdue queues, report approvals and access reviews will appear here once their governed sources exist; no severity is inferred.</span>
              </div>
            )}
            {panel === 'account' && (
              <div className="space-y-2" data-testid="account-panel">
                <p><span className="text-slate-400">Signed in as </span>{user?.name || 'Signed-in account'}</p>
                <p className="text-xs text-slate-300" data-testid="access-explanation">{grant.explanation}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link to="/admin" className="inline-flex min-h-[40px] items-center rounded border border-slate-600 px-3 text-xs hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400">
                    Open current operational Admin
                  </Link>
                  <button type="button" onClick={signOut} className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-slate-600 px-3 text-xs hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400" data-testid="corporate-sign-out">
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex">
        {/* Persistent rail ≥ lg */}
        <aside
          className={cn('sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-slate-200 bg-white lg:block', collapsed ? 'w-[68px]' : 'w-60 xl:w-64')}
          data-testid="corporate-rail"
          data-collapsed={collapsed ? 'true' : 'false'}
        >
          <div className="flex h-full flex-col">
            <RailNav destinations={nav} collapsed={collapsed} currentId={current?.id ?? null} />
            <div className="border-t border-slate-200 p-2">
              <button
                type="button"
                onClick={toggleCollapsed}
                className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                aria-pressed={collapsed}
                data-testid="corporate-rail-toggle"
              >
                {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <><ChevronsLeft className="h-4 w-4" aria-hidden="true" /> Collapse</>}
              </button>
            </div>
          </div>
        </aside>

        {/* Drawer < lg */}
        {drawerOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <div className="absolute inset-0 bg-slate-950/60" onClick={closeDrawer} data-testid="corporate-drawer-overlay" />
            <div id="corporate-drawer" role="dialog" aria-modal="true" aria-label="Corporate Admin navigation" className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-white shadow-xl" data-testid="corporate-drawer">
              <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3">
                <span className="text-sm font-semibold">Corporate Admin</span>
                <button ref={closeRef} type="button" onClick={closeDrawer} className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500" aria-label="Close navigation">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <RailNav destinations={nav} collapsed={false} currentId={current?.id ?? null} onNavigate={closeDrawer} />
            </div>
          </div>
        )}

        <main id="corporate-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" data-testid="corporate-main">
          {allowed ? (
            <Outlet />
          ) : (
            // Non-enumerating: names nothing about what the page would have shown.
            <div className="mx-auto max-w-xl rounded-md border border-slate-300 bg-white p-6 text-center" data-testid="corporate-forbidden" role="alert">
              <TruthStateBadge state="FORBIDDEN" />
              <p className="mt-3 text-sm text-slate-700">You do not have access to this page.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function TopbarButton({ label, active, onClick, children, testId }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      className={cn('inline-flex h-10 min-w-[40px] items-center justify-center gap-1.5 rounded px-2 text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400', active && 'bg-slate-800')}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

function RailNav({ destinations, collapsed, currentId, onNavigate }: { destinations: ReturnType<typeof visibleDestinations>; collapsed: boolean; currentId: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Corporate Admin" className="flex-1 overflow-y-auto py-3" data-testid="corporate-nav">
      <ol className="space-y-0.5 px-2">
        {destinations.map((d, i) => {
          const Icon = DESTINATION_ICONS[d.icon] ?? FileText
          const plane = CORPORATE_PLANES[d.plane]
          const isCurrent = d.id === currentId
          return (
            <li key={d.id}>
              <NavLink
                to={d.route}
                end={d.route === CORPORATE_ROOT}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={onNavigate}
                title={collapsed ? `${d.label} — ${plane.label}` : undefined}
                className={cn(
                  'group flex min-h-[44px] items-center gap-3 rounded-md px-2.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-500',
                  isCurrent ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                  collapsed && 'justify-center px-0',
                )}
                data-testid={`corporate-nav-${d.id}`}
                data-plane={d.plane}
                data-order={i + 1}
              >
                <span className={cn('relative flex h-7 w-7 shrink-0 items-center justify-center rounded', isCurrent ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-white')}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {collapsed ? (
                  <span className="sr-only">{d.label} ({plane.label})</span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    {/* CA-K3-01-R2 D-3: the canonical label wraps; it is never truncated. */}
                    <span className="min-w-0 py-1 leading-snug" data-testid="rail-label">{d.label}</span>
                    <span className={cn('shrink-0 font-mono text-[10px]', isCurrent ? 'text-orange-300' : 'text-slate-600')} aria-hidden="true" data-testid="rail-plane-marker">{plane.marker}</span>
                    <span className="sr-only">({plane.label})</span>
                  </span>
                )}
              </NavLink>
            </li>
          )
        })}
      </ol>
      {!collapsed && (
        <div className="mt-4 space-y-1 border-t border-slate-100 px-4 pt-3 text-[11px] text-slate-500" data-testid="plane-legend">
          {Object.values(CORPORATE_PLANES).map((p) => (
            <p key={p.id}><span className="mr-1.5 font-mono text-slate-600" data-testid="legend-plane-marker">{p.marker}</span>{p.label}</p>
          ))}
          {/* CA-K3-01-R2 D-2: a full-width 44px target (was ~138×17). */}
          <Link to="/admin" onClick={onNavigate} className="-mx-2 mt-2 flex min-h-[44px] items-center rounded px-2 text-slate-600 underline-offset-2 hover:bg-slate-50 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500" data-testid="rail-operational-admin-link">
            Current operational Admin
          </Link>
        </div>
      )}
    </nav>
  )
}

export { PlaneIndicator }
