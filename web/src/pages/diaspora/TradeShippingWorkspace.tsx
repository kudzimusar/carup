import { useState, type ReactNode } from 'react'
import { Box, Container, Truck } from 'lucide-react'
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
  const isProvider = context?.business_type === 'logistics_provider'

  // The trade context is fetched by the shell after this component mounts, so `isProvider` starts
  // false for everyone. Deriving the tab during render (rather than seeding useState once and
  // correcting it in an effect) is what actually lets a logistics provider land on their own
  // queue when the context resolves, and it drops a provider back to My shipping if that
  // eligibility is ever lost. `chosenTab` stays null until the person picks a tab themselves.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null)
  const defaultTab: Tab = isProvider ? 'provider' : 'mine'
  const tab: Tab = chosenTab && (chosenTab !== 'provider' || isProvider) ? chosenTab : defaultTab

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
                onClick={() => setChosenTab(id)}
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
