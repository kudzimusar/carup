/**
 * CarUp Intelligence 1.0 — I7 Marketplace Pulse (seller/owner).
 *
 * Answers the plan's Level 1 question: what happened since I last came here?
 *
 * The component's whole discipline is that it renders what the backend says and
 * nothing more. Every figure goes through `displayMetric`, so a metric the
 * backend marked unavailable shows words, never 0 — an owner must be able to tell
 * "nobody came" from "we could not measure".
 */
import { useEffect, useState } from 'react'
import { TrendingUp, AlertCircle } from 'lucide-react'
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

/** The four figures the plan puts on a seller's pulse, in its order. */
const PULSE_METRICS: Array<{ key: string; label: string }> = [
  { key: 'views', label: 'Views' },
  { key: 'saves', label: 'Saves' },
  { key: 'shares_confirmed', label: 'Shares' },
  { key: 'inquiries', label: 'Enquiries' },
]

export default function MarketplacePulse({ windowDays = 7 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchSellerIntelligence } = useCarUpApi()
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
    // Analytics must never block, or break, the surface it sits on. If the API
    // surface is unavailable to this render (a partially-stubbed hook in a test,
    // an older bundle, a failed import), report it as unreadable rather than
    // throwing and taking the whole dashboard down with it.
    if (typeof fetchSellerIntelligence !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    // The call itself is guarded, not just the promise: a fetcher that throws
    // SYNCHRONOUSLY would otherwise escape the .catch below and break the effect,
    // taking the host surface down with it.
    let pending: Promise<IntelligenceEnvelope>
    try {
      pending = Promise.resolve(fetchSellerIntelligence(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending
      .then((data: IntelligenceEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      })
      .catch(() => {
        // A failed read is NOT an empty market. It gets its own state so the
        // surface can say so rather than rendering a wall of zeros.
        if (!cancelled) setState('failed')
      })
    return () => { cancelled = true }
  }, [fetchSellerIntelligence, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="marketplace-pulse-loading">
        <h3 className="text-sm font-semibold text-gray-700">Marketplace Pulse</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload)) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="marketplace-pulse-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Marketplace Pulse</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="marketplace-pulse-message">
            {state === 'failed'
              ? 'Intelligence could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const asOf = formatAsOf(payload?.as_of)
  const coverage = coverageNote(payload)
  const measured = PULSE_METRICS
    .map(item => ({ ...item, metric: payload?.metrics?.[item.key] }))
    .filter(item => hasValue(item.metric))
  const maxMeasured = measured.reduce((max, item) => Math.max(max, Number(item.metric?.value || 0)), 0)

  return (
    <section className="border-y border-slate-200 bg-white py-6" data-testid="marketplace-pulse">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-black tracking-[-0.03em] text-slate-950">
            <TrendingUp className="h-5 w-5 text-orange-500" aria-hidden="true" />
            Marketplace Pulse
          </h3>
          <p className="mt-1 text-xs text-slate-500">Measured buyer activity · last {payload?.window_days ?? windowDays} days</p>
        </div>
        {asOf && <span className="text-[11px] font-semibold text-slate-400" data-testid="pulse-as-of">As of {asOf}</span>}
      </div>

      <dl className="mt-6 grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {PULSE_METRICS.map(({ key, label }) => {
          const metric = payload?.metrics?.[key]
          const qualifier = metricQualifier(metric)
          return (
            <div key={key} className="bg-white p-4" data-testid={`pulse-${key}`}>
              <dt className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</dt>
              <dd
                className={hasValue(metric) ? 'mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950' : 'mt-2 text-sm font-semibold text-slate-500'}
                data-testid={`pulse-${key}-value`}
              >
                {displayMetric(metric)}
              </dd>
              {qualifier && <p className="mt-1 text-[11px] text-slate-400">{qualifier}</p>}
            </div>
          )
        })}
      </dl>

      <div className="mt-7" data-testid="marketplace-pulse-visual">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Activity comparison</p>
            <p className="mt-1 text-xs text-slate-500">Bar lengths compare only measured counts in this period. They are not conversion rates.</p>
          </div>
        </div>
        {measured.length > 0 && maxMeasured > 0 ? (
          <div className="mt-4 space-y-3">
            {measured.map(({ key, label, metric }) => (
              <div key={key} className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-xs font-bold text-slate-600">{label}</span>
                <div className="h-3 overflow-hidden bg-slate-100" aria-hidden="true">
                  <div
                    className="h-full bg-slate-950"
                    style={{ width: `${Math.max(3, (Number(metric?.value || 0) / maxMeasured) * 100)}%` }}
                  />
                </div>
                <span className="min-w-10 text-right text-xs font-black tabular-nums text-slate-950">{displayMetric(metric)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 border-l-2 border-slate-300 pl-4 text-sm text-slate-500">
            No measured counts are available for a comparative visual in this period.
          </div>
        )}
      </div>

      <div className="mt-5 space-y-1 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
        {coverage && <p data-testid="pulse-coverage">{coverage}</p>}
        {payload?.calculation_version && <p data-testid="pulse-calc-version">Calculation {payload.calculation_version}</p>}
      </div>
    </section>
  )
}
