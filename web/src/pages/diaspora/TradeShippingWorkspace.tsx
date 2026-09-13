import { type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Container, Truck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { canRoleAccessRoute, normalizeFrontendRole } from '@/config/featureRegistry'
import type { DiasporaTradeContext } from '@/types'
import TradeShippingRequests from './TradeShippingRequests'
import TradeLogisticsProviderPanel from './TradeLogisticsProviderPanel'

type Tab = 'mine' | 'provider' | 'containers'

export default function TradeShippingWorkspace({
  context,
  children,
}: {
  context: DiasporaTradeContext | null
  children: ReactNode
}) {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Authorization boundary for the T3 surfaces. Wrapping /diaspora/containers in this workspace
  // must not become a way around the gate the container product already enforced: before this
  // wrapper existed, an unauthorized role reaching the route got the hardened page's own
  // access-denied state. The wrapper is therefore offered only to a role the canonical Feature
  // Registry admits to /diaspora/containers — the SAME rule the Trade OS shell filters its nav
  // with — and anyone else falls straight through to the container product, which remains the
  // authority on its own access. No role gains a surface here that it did not already have, and
  // the server stays authoritative regardless of what the SPA renders.
  const role = normalizeFrontendRole(user?.role)
  const mayUseShippingWorkspace = !!role && canRoleAccessRoute(role, '/diaspora/containers')

  const isProvider = context?.business_type === 'logistics_provider'

  // The tab lives in the URL rather than in component state, for two reasons.
  //
  // First, it makes the three modes linkable: "Ship something" can send someone straight to the
  // request journey and "Find container space" straight to the sailings, instead of dropping
  // everyone on the same landing tab and asking them to find the rest.
  //
  // Second, the shell fetches the trade context AFTER this component mounts, so `isProvider`
  // starts false for everyone. A useState seed would capture that first false and never
  // reconsider it — which is exactly why a logistics provider could never land on their own
  // queue. Deriving the tab on every render fixes that, and equally drops a provider back to
  // My shipping if the eligibility is ever lost.
  const requestedView = searchParams.get('view')
  const requestedTab: Tab | null =
    requestedView === 'mine' || requestedView === 'provider' || requestedView === 'containers'
      ? requestedView
      : null
  const defaultTab: Tab = isProvider ? 'provider' : 'mine'
  const tab: Tab = requestedTab && (requestedTab !== 'provider' || isProvider) ? requestedTab : defaultTab

  const selectTab = (id: Tab) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', id)
    setSearchParams(next, { replace: true })
  }

  // Placed after every hook so the early return cannot make hook order conditional.
  if (!mayUseShippingWorkspace) return <>{children}</>

  const tabs: Array<{ id: Tab; label: string; note: string; icon: typeof Box }> = [
    { id: 'mine', label: 'My shipping', note: 'Ask providers to move cargo you already own', icon: Box },
    ...(isProvider ? [{ id: 'provider' as Tab, label: 'Provider requests', note: 'Quote customers who need logistics', icon: Truck }] : []),
    { id: 'containers', label: 'Container space', note: 'Browse or operate shared-container sailings', icon: Container },
  ]

  return (
    <div className="min-w-0" data-testid="trade-shipping-workspace">
      <div className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10">
          <div className="py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Shipping</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Move cargo from request to approved space</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              Request transport quotes when you need providers to propose a service, or browse open
              shared-container space directly. A quote, a space request and an approved booking are
              separate states — CarUp keeps them separate so the journey stays truthful.
            </p>
          </div>
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Shipping workspace">
            {tabs.map(({ id, label, note, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => selectTab(id)}
                className={`min-w-[190px] border-b-2 px-3 py-3 text-left transition-colors ${
                  tab === id ? 'border-orange-500 bg-white text-slate-950' : 'border-transparent text-slate-600 hover:text-slate-950'
                }`}
                data-testid={`shipping-tab-${id}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" /> {label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{note}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'mine' && <TradeShippingRequests />}
      {tab === 'provider' && isProvider && <TradeLogisticsProviderPanel context={context} />}
      {tab === 'containers' && children}
    </div>
  )
}
