/**
 * CarUp Intelligence 1.0 — I8 Dealer Intelligence.
 *
 * The governed replacement for the dealer's fabricated analytics. Everything here
 * comes from the tenant-scoped projection (`/api/dealer/analytics`), whose tenant
 * is resolved from verified session membership — there is deliberately no tenant
 * parameter to pass, so a dealer cannot be shown, or ask for, another tenant.
 *
 * What this component will NOT do, because the I0 audit found each of them live on
 * the surfaces it replaces:
 *
 *   - show platform-wide inventory as if it were this dealer's;
 *   - print a revenue, units-sold or average-sale figure, because CarUp holds no
 *     authoritative dealer sales state — the tenant rollup has none, and inferring
 *     it from disappearing public listings is exactly what the plan forbids;
 *   - show a customer rating, because no rating system exists anywhere in CarUp;
 *   - show a trend delta, because no baseline has been computed;
 *   - render a failed read as zero.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  displayMetric,
  hasValue,
  metricQualifier,
  envelopeIsReadable,
  envelopeMessage,
  formatAsOf,
  coverageNote,
  type IntelligenceEnvelope,
} from '@/lib/intelligenceDisplay'

/**
 * The dealer funnel, from the tenant grain.
 *
 * `active_listings` is deliberately absent: in the rollup it counts listings that
 * had ACTIVITY that day, not listings the dealer has active. Showing it under that
 * name would be a quiet lie, so real inventory is read from the tenant-scoped
 * inventory endpoint instead and labelled for what it is.
 */
const DEALER_FUNNEL = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'views', label: 'Views' },
  { key: 'unique_viewers', label: 'Unique shoppers' },
  { key: 'saves', label: 'Saves' },
  { key: 'shares_confirmed', label: 'Shares' },
  { key: 'inquiries', label: 'Leads' },
  { key: 'inspections', label: 'Inspections' },
]

export default function DealerIntelligence({ windowDays = 7 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchDealerIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<IntelligenceEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchDealerIntelligence !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    // The call itself is guarded, not just the promise: a fetcher that throws
    // SYNCHRONOUSLY would otherwise escape the .catch below and break the effect,
    // taking the host surface down with it.
    let pending: Promise<IntelligenceEnvelope>
    try {
      pending = Promise.resolve(fetchDealerIntelligence(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    // Two-argument then(): the rejection handler is attached in the SAME tick as
    // the fulfilment one, so a promise that is already rejected can never be seen
    // as unhandled before this binds.
    pending.then(
      (data: IntelligenceEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchDealerIntelligence, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="dealer-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Marketplace performance</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload)) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="dealer-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Marketplace performance</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="dealer-intelligence-message">
            {state === 'failed'
              ? 'Dealer intelligence could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const conversion = payload?.conversion?.view_to_inquiry

  return (
    <section className="space-y-4" data-testid="dealer-intelligence">
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Marketplace performance</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <p className="mt-1 text-xs text-gray-500" data-testid="dealer-scope-note">
          Your dealership only.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="dealer-funnel">
          {DEALER_FUNNEL.map(({ key, label }) => {
            const metric = payload?.metrics?.[key]
            const qualifier = metricQualifier(metric)
            return (
              <div key={key} data-testid={`dealer-${key}`}>
                <dd
                  className={hasValue(metric) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                  data-testid={`dealer-${key}-value`}
                >
                  {displayMetric(metric)}
                </dd>
                <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
                {qualifier && <p className="mt-0.5 text-[11px] text-gray-400">{qualifier}</p>}
              </div>
            )
          })}
        </dl>

        <div className="mt-4 border-t pt-3" data-testid="dealer-conversion">
          <p className="text-xs text-gray-600">View → lead</p>
          <p
            className={hasValue(conversion) ? 'text-base font-medium text-gray-900' : 'text-xs italic text-gray-500'}
            data-testid="dealer-view-to-lead"
          >
            {displayMetric(conversion)}
          </p>
          {metricQualifier(conversion) && (
            <p className="mt-0.5 text-[11px] text-gray-400">{metricQualifier(conversion)}</p>
          )}
        </div>

        <div className="mt-4 space-y-1 border-t pt-3 text-[11px] text-gray-400">
          {formatAsOf(payload?.as_of) && <p data-testid="dealer-as-of">As of {formatAsOf(payload?.as_of)}</p>}
          {coverageNote(payload) && <p data-testid="dealer-coverage">{coverageNote(payload)}</p>}
          {payload?.calculation_version && <p>Calculation {payload.calculation_version}</p>}
        </div>
      </div>

      {/*
        Sales and revenue are stated as unavailable rather than omitted.
        Omission invites someone to fill the gap back in with an estimate; naming
        the absence, and why, is what stops the fabricated $2.09M coming back.
      */}
      <div className="rounded-xl border bg-white p-5" data-testid="dealer-sales-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Sales and revenue</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span>
            Not available. CarUp holds no authoritative record of your completed sales, so no revenue,
            units-sold or average-sale figure can be shown. These are not zero.
          </span>
        </p>
      </div>
    </section>
  )
}
