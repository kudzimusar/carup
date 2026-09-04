import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Car, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import type { DiasporaTradeContext } from '@/types'

/**
 * Trade OS operational workspace shell (owner UAT #1/#3/#7).
 *
 * The Diaspora trade-operations routes previously rendered inside the PUBLIC MainLayout — marketing
 * mega-navigation, marketing footer and the mobile bottom bar — which both broke narrow-desktop
 * composition and mis-labelled the experience. This shell is the authenticated operating chrome:
 * compact CarUp-branded top bar, local Trade OS navigation (only surfaces that genuinely work), and
 * the user's REAL commercial identity from the trade-context projection — organisation, business
 * type, corridor, membership — never the platform security role. No public footer, no mega-menu.
 */

const NAV_ITEMS: Array<[string, string]> = [
  ['/diaspora/containers', 'Containers'],
  ['/diaspora/imports', 'Import orders'],
  ['/dashboard/communications', 'Communications'],
]

function corridorOf(context: DiasporaTradeContext | null): string | null {
  const from = context?.country_of_residence
  // CarUp's market is Zimbabwe; the corridor's destination side is the platform's market itself.
  if (!from) return null
  return from.toLowerCase() === 'zimbabwe' ? 'Zimbabwe trade operations' : `${from} → Zimbabwe trade operations`
}

function TradeIdentity({ context, unreadable }: { context: DiasporaTradeContext | null; unreadable: boolean }) {
  if (unreadable) {
    return (
      <div className="min-w-0 text-right" data-testid="tradeos-identity">
        <p className="truncate text-sm font-semibold text-white">Trade OS</p>
        <p className="truncate text-[11px] text-slate-400">Business context could not be loaded</p>
      </div>
    )
  }
  if (!context) {
    return (
      <div className="min-w-0 text-right" data-testid="tradeos-identity">
        <p className="truncate text-[11px] text-slate-400">Loading business context…</p>
      </div>
    )
  }
  const corridor = corridorOf(context)
  if (context.organisation) {
    return (
      <div className="min-w-0 text-right" data-testid="tradeos-identity">
        <p className="truncate text-sm font-semibold text-white" data-testid="tradeos-identity-org">{context.organisation.name || 'Organisation'}</p>
        <p className="truncate text-[11px] uppercase tracking-wide text-orange-400">
          {context.business_type === 'logistics_provider' ? 'Logistics provider' : (context.business_type ? context.business_type.replace(/_/g, ' ') : 'Business')}
          {corridor ? <span className="normal-case tracking-normal text-slate-400"> · {corridor}</span> : null}
        </p>
        <p className="hidden truncate text-[11px] text-slate-400 sm:block">
          Signed in as {context.user.name || 'member'}{context.is_organisation_admin ? ' · Organisation administrator' : ''}
        </p>
      </div>
    )
  }
  return (
    <div className="min-w-0 text-right" data-testid="tradeos-identity">
      <p className="truncate text-sm font-semibold text-white" data-testid="tradeos-identity-participant">{context.user.name || 'Trade participant'}</p>
      <p className="truncate text-[11px] uppercase tracking-wide text-orange-400">
        Trade participant
        {corridor ? <span className="normal-case tracking-normal text-slate-400"> · {corridor}</span> : null}
      </p>
    </div>
  )
}

export default function TradeOSWorkspaceLayout() {
  const { isAuthenticated, loading } = useAuth()
  const { fetchDiasporaTradeContext } = useCarUpApi()
  const location = useLocation()
  const [context, setContext] = useState<DiasporaTradeContext | null>(null)
  const [contextUnreadable, setContextUnreadable] = useState(false)

  useEffect(() => {
    if (loading || !isAuthenticated) return
    let live = true
    fetchDiasporaTradeContext()
      .then((ctx) => { if (live) { setContext(ctx && ctx.user ? ctx : null); setContextUnreadable(!ctx || !ctx.user) } })
      .catch(() => { if (live) { setContext(null); setContextUnreadable(true) } })
    return () => { live = false }
  }, [loading, isAuthenticated, fetchDiasporaTradeContext])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-white text-orange-600"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="flex min-h-screen flex-col bg-white" data-testid="tradeos-workspace">
      <header className="bg-slate-950">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="CarUp home">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500">
                  <Car className="h-4 w-4 text-white" aria-hidden="true" />
                </span>
                <span className="hidden text-lg font-bold text-white sm:inline">Car<span className="text-orange-500">Up</span></span>
              </Link>
              <span className="shrink-0 border-l border-slate-700 pl-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400">Trade OS</span>
            </div>
            <TradeIdentity context={context} unreadable={contextUnreadable} />
          </div>
          <nav className="-mx-1 flex gap-1 overflow-x-auto pb-2" aria-label="Trade OS">
            {NAV_ITEMS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-t px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-white font-semibold text-slate-950' : 'text-slate-300 hover:text-orange-400'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="min-w-0 flex-1">
        <RegistryRouteBoundary enforceAuth={false}>
          <Outlet />
        </RegistryRouteBoundary>
      </main>
    </div>
  )
}
