import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Car, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import type { DiasporaTradeContext } from '@/types'
import TradeShippingWorkspace from '@/pages/diaspora/TradeShippingWorkspace'

/**
 * Trade OS operational workspace shell.
 *
 * Operational routes do not render inside the public marketing shell. The local navigation uses
 * human intentions (Request quotes, Shipping, Messages) while the server remains authoritative on
 * the domain records and permissions underneath.
 */
const NAV_ITEMS: Array<[string, string]> = [
  ['/diaspora/request-quotes', 'Request quotes'],
  ['/diaspora/requests', 'My requests'],
  ['/diaspora/buyer-requests', 'Buyer requests'],
  ['/diaspora/containers', 'Shipping'],
  ['/diaspora/imports', 'Orders'],
  ['/diaspora/messages', 'Messages'],
  ['/diaspora/rate-research', 'Rate research'],
]

function corridorOf(context: DiasporaTradeContext | null): string | null {
  const from = context?.country_of_residence
  if (!from) return null
  return from.toLowerCase() === 'zimbabwe' ? 'Zimbabwe trade operations' : `${from} → Zimbabwe trade operations`
}

function TradeIdentity({ context, unreadable }: { context: DiasporaTradeContext | null; unreadable: boolean }) {
  if (unreadable) {
    return (
      <div className="min-w-0 text-left sm:text-right" data-testid="tradeos-identity">
        <p className="truncate text-sm font-semibold text-white">Trade OS</p>
        <p className="truncate text-[11px] text-slate-400">Business context could not be loaded</p>
      </div>
    )
  }
  if (!context) {
    return (
      <div className="min-w-0 text-left sm:text-right" data-testid="tradeos-identity">
        <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-400" data-testid="tradeos-identity-loading"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading business context…</p>
      </div>
    )
  }
  const corridor = corridorOf(context)
  if (context.organisation) {
    return (
      <div className="min-w-0 text-left sm:text-right" data-testid="tradeos-identity">
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
    <div className="min-w-0 text-left sm:text-right" data-testid="tradeos-identity">
      <p className="truncate text-sm font-semibold text-white" data-testid="tradeos-identity-participant">{context.user.name || 'Trade participant'}</p>
      <p className="truncate text-[11px] uppercase tracking-wide text-orange-400">
        Trade participant
        {corridor ? <span className="normal-case tracking-normal text-slate-400"> · {corridor}</span> : null}
      </p>
    </div>
  )
}

export default function TradeOSWorkspaceLayout() {
  const { isAuthenticated, loading, user } = useAuth()
  const { fetchDiasporaTradeContext } = useCarUpApi()
  const location = useLocation()
  const [context, setContext] = useState<DiasporaTradeContext | null>(null)
  const [contextUnreadable, setContextUnreadable] = useState(false)

  useEffect(() => {
    if (loading || !isAuthenticated) return
    let live = true
    // The read is genuinely slow on a cold backend (measured 1.5-2.5s on staging), and the first
    // Trade OS screen a customer sees was sitting on a bare "Loading…" for that whole time. The
    // request is not the problem; the absence of a TERMINAL guarantee is. A read that never
    // settles must resolve into the honest unreadable state rather than claiming to still be
    // loading forever — the shell already renders "Business context could not be loaded", which is
    // true and recoverable, whereas a permanent spinner is neither.
    const settle = window.setTimeout(() => {
      if (live) { setContext(null); setContextUnreadable(true) }
    }, 15_000)
    fetchDiasporaTradeContext()
      .then((ctx) => { if (live) { window.clearTimeout(settle); setContext(ctx && ctx.user ? ctx : null); setContextUnreadable(!ctx || !ctx.user) } })
      .catch(() => { if (live) { window.clearTimeout(settle); setContext(null); setContextUnreadable(true) } })
    return () => { live = false; window.clearTimeout(settle) }
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
          {/*
            * At narrow widths the brand lockup and the commercial identity must NOT share a
            * physical row: both are meaningful, neither may be dropped, and squeezing them
            * together collided "TRADE OS" with the organisation name at 393px. Below `sm` the
            * header composes vertically — lockup, then identity — and returns to the single
            * justified row from `sm` upward, where there is genuinely space for both.
            */}
          <div className="flex min-w-0 flex-col items-stretch gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
          {/* F7 — the nav already scrolled horizontally, but with no affordance the trailing items
              read as accidentally chopped rather than as "there is more this way". A fade at the
              trailing edge says so without hiding anything or shrinking the labels. `pr-6` keeps
              the last item from sitting under the fade. */}
          <div className="relative">
            <nav className="-mx-1 flex gap-1 overflow-x-auto pb-2 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Trade OS" data-testid="tradeos-nav">
              {NAV_ITEMS.filter(([to]) => canRoleAccessRoute((user?.role as UserRole) ?? 'owner', to)).map(([to, label]) => (
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
            <div aria-hidden="true"
                 className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-slate-950 to-transparent" />
          </div>
        </div>
      </header>
      <main className="min-w-0 flex-1">
        {/*
          * enforceAuth is ON. It was previously false, which meant the registry's ROLE decision was
          * skipped for every protected Trade OS route: the shell filtered its navigation through
          * canRoleAccessRoute, but typing the URL bypassed that filter entirely, so a link a role
          * could not see was still a page it could open. Nav visibility and typed-URL eligibility
          * are now the same rule, which is what dc812007's nav filter already assumed was true.
          *
          * This is a defence-in-depth agreement, not the authorization itself — the API decides
          * every read and write regardless of what the SPA chooses to render.
          *
          * Auth (rather than role) is still settled above: this component returns its own spinner
          * while the session restores and redirects to /login when there is no user, so the
          * boundary never has to make a premature auth decision here.
          */}
        <RegistryRouteBoundary>
          {location.pathname === '/diaspora/containers'
            ? <TradeShippingWorkspace context={context}><Outlet /></TradeShippingWorkspace>
            : <Outlet />}
        </RegistryRouteBoundary>
      </main>
    </div>
  )
}
