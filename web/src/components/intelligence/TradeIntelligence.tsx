/**
 * CarUp Intelligence 1.0 — I13 diaspora / trade demand.
 *
 * Every figure on this surface is demand or intent. None of it is money that
 * moved: no payment milestone has been confirmed and no escrow session has used a
 * live provider. The surface says so rather than leaving a reader to assume.
 *
 * Amounts are rendered per currency and never combined, because CarUp applies no
 * exchange rate.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  displayMetric,
  hasValue,
  envelopeIsReadable,
  envelopeMessage,
  type IntelligenceEnvelope,
  type MetricEnvelope,
} from '@/lib/intelligenceDisplay'

interface CurrencyGroup {
  by_currency: Record<string, { total: number; count: number }>
  currencies: number
  unpriced_records: number
  note: string
}

interface TradeEnvelope extends IntelligenceEnvelope {
  corridor_demand?: {
    corridors: Array<{ corridor: string; orders: number }>
    distinct_corridors: number
    unspecified_corridor: number
    note: string | null
  }
  order_funnel?: Record<string, MetricEnvelope> & {
    by_status?: Record<string, number>
    by_order_type?: Record<string, number>
  }
  quote_activity?: Record<string, MetricEnvelope> & { quoted_amounts?: CurrencyGroup }
  requested_budgets?: CurrencyGroup
  payment_milestones?: Record<string, MetricEnvelope> & {
    scheduled_amounts?: CurrencyGroup
    note?: string | null
  }
  escrow?: {
    sessions_opened: MetricEnvelope
    live: { sessions: MetricEnvelope; settled: MetricEnvelope }
    sandbox: { sessions: MetricEnvelope; settled: MetricEnvelope; note: string }
    no_payment_started: MetricEnvelope
    live_market: boolean
    note: string | null
  }
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
  domain_boundary?: string
}

const ORDER_METRICS = [
  { key: 'orders_created', label: 'Import requests' },
  { key: 'cancelled', label: 'Cancelled' },
]

const QUOTE_METRICS = [
  { key: 'quotes_issued', label: 'Quotes issued' },
  { key: 'quotes_accepted', label: 'Quotes accepted' },
  { key: 'orders_awaiting_a_quote', label: 'Awaiting a quote' },
]

const MILESTONE_METRICS = [
  { key: 'milestones_scheduled', label: 'Milestones scheduled' },
  { key: 'milestones_confirmed', label: 'Confirmed' },
  { key: 'awaiting_confirmation', label: 'Awaiting confirmation' },
]

function MetricGrid({ metrics, payload, prefix }: {
  metrics: Array<{ key: string; label: string }>
  payload?: Record<string, MetricEnvelope>
  prefix: string
}) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid={`${prefix}-grid`}>
      {metrics.map(({ key, label }) => {
        const value = payload?.[key]
        return (
          <div key={key} data-testid={`${prefix}-${key}`}>
            <dd
              className={hasValue(value) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
              data-testid={`${prefix}-${key}-value`}
            >
              {displayMetric(value)}
            </dd>
            <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
          </div>
        )
      })}
    </dl>
  )
}

/** Each currency on its own line. There is deliberately no combined total. */
function CurrencyLines({ group, testid }: { group?: CurrencyGroup; testid: string }) {
  if (!group) return null
  const entries = Object.entries(group.by_currency)
  if (entries.length === 0) {
    return <p className="mt-2 text-sm italic text-gray-500" data-testid={`${testid}-none`}>No amount recorded</p>
  }
  return (
    <div className="mt-2" data-testid={testid}>
      {entries.map(([currency, { total, count }]) => (
        <p key={currency} className="text-sm text-gray-800" data-testid={`${testid}-${currency}`}>
          <span className="font-semibold">{total.toLocaleString()} {currency}</span>
          <span className="text-gray-500"> across {count} record{count === 1 ? '' : 's'}</span>
        </p>
      ))}
      {group.currencies > 1 && (
        <p className="mt-1 text-[11px] text-gray-500" data-testid={`${testid}-fx-note`}>{group.note}</p>
      )}
      {group.unpriced_records > 0 && (
        <p className="mt-1 text-[11px] text-gray-500" data-testid={`${testid}-unpriced`}>
          {group.unpriced_records} record{group.unpriced_records === 1 ? '' : 's'} with no recorded amount are excluded.
        </p>
      )}
    </div>
  )
}

export default function TradeIntelligence({ windowDays = 30 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchTradeIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<TradeEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    if (typeof fetchTradeIntelligence !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<TradeEnvelope>
    try {
      pending = Promise.resolve(fetchTradeIntelligence(windowDays))
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: TradeEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchTradeIntelligence, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="trade-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Trade demand</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'order_funnel')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="trade-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Trade demand</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="trade-intelligence-message">
            {state === 'failed'
              ? 'Trade demand could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const corridor = payload?.corridor_demand
  const escrow = payload?.escrow

  return (
    <section className="space-y-4" data-testid="trade-intelligence">
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Import requests</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <MetricGrid metrics={ORDER_METRICS} payload={payload?.order_funnel} prefix="trade-orders" />
        <p className="mt-3 text-xs text-gray-600">Requested budget</p>
        <CurrencyLines group={payload?.requested_budgets} testid="trade-budgets" />
        <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
          A requested budget is what a buyer hoped to spend, not an agreed price.
        </p>
      </div>

      {corridor && (
        <div className="rounded-xl border bg-white p-5" data-testid="trade-corridors">
          <h3 className="text-sm font-semibold text-gray-700">Corridors</h3>
          <ul className="mt-3 space-y-1">
            {corridor.corridors.map((entry) => (
              <li key={entry.corridor} className="flex justify-between text-sm" data-testid={`trade-corridor-${entry.corridor}`}>
                <span className="text-gray-800">{entry.corridor}</span>
                <span className="font-semibold text-gray-900">{entry.orders}</span>
              </li>
            ))}
          </ul>
          {/* A one-corridor market must not read as the leader of a ranking. */}
          {corridor.note && (
            <p className="mt-2 text-[11px] text-gray-500" data-testid="trade-corridor-note">{corridor.note}</p>
          )}
          {corridor.unspecified_corridor > 0 && (
            <p className="mt-1 text-[11px] text-gray-500" data-testid="trade-corridor-unspecified">
              {corridor.unspecified_corridor} request{corridor.unspecified_corridor === 1 ? '' : 's'} name no corridor.
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Quotes</h3>
        <MetricGrid metrics={QUOTE_METRICS} payload={payload?.quote_activity} prefix="trade-quotes" />
        <p className="mt-3 text-xs text-gray-600">Quoted amounts</p>
        <CurrencyLines group={payload?.quote_activity?.quoted_amounts} testid="trade-quoted" />
      </div>

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Payment milestones</h3>
        <MetricGrid metrics={MILESTONE_METRICS} payload={payload?.payment_milestones} prefix="trade-milestones" />
        <p className="mt-3 text-xs text-gray-600">Scheduled amounts</p>
        <CurrencyLines group={payload?.payment_milestones?.scheduled_amounts} testid="trade-scheduled" />
        {payload?.payment_milestones?.note && (
          <p className="mt-2 text-[11px] text-gray-500" data-testid="trade-milestone-note">
            {payload.payment_milestones.note}
          </p>
        )}
      </div>

      {escrow && (
        <div className="rounded-xl border bg-white p-5" data-testid="trade-escrow">
          <h3 className="text-sm font-semibold text-gray-700">Escrow</h3>
          {/* Live and sandbox are separate blocks. There is no combined total. */}
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div data-testid="trade-escrow-live">
              <p className="text-xs font-medium text-gray-700">Live</p>
              <p className="text-xl font-semibold text-gray-900" data-testid="trade-escrow-live-settled">
                {displayMetric(escrow.live.settled)}
              </p>
              <p className="text-xs text-gray-600">Settled</p>
            </div>
            <div data-testid="trade-escrow-sandbox">
              <p className="text-xs font-medium text-gray-700">Sandbox</p>
              <p className="text-xl font-semibold text-gray-900" data-testid="trade-escrow-sandbox-settled">
                {displayMetric(escrow.sandbox.settled)}
              </p>
              <p className="text-xs text-gray-600">Settled (simulated)</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">{escrow.sandbox.note}</p>
          {escrow.note && (
            <p className="mt-1 text-[11px] text-gray-500" data-testid="trade-escrow-note">{escrow.note}</p>
          )}
        </div>
      )}

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="trade-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not measurable</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`trade-missing-${entry.key}`}>
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  <span className="font-medium text-gray-800">{entry.label}</span>
                  <span className="block text-xs text-gray-600">{entry.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload?.domain_boundary && (
        <p className="text-[11px] text-gray-400" data-testid="trade-domain-boundary">{payload.domain_boundary}</p>
      )}
    </section>
  )
}
