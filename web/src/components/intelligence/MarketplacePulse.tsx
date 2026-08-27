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

  return (
    <section className="rounded-xl border bg-white p-5" data-testid="marketplace-pulse">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <TrendingUp className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Marketplace Pulse
        </h3>
        <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {PULSE_METRICS.map(({ key, label }) => {
          const metric = payload?.metrics?.[key]
          const qualifier = metricQualifier(metric)
          return (
            <div key={key} data-testid={`pulse-${key}`}>
              <dd
                className={hasValue(metric) ? 'text-2xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                data-testid={`pulse-${key}-value`}
              >
                {displayMetric(metric)}
              </dd>
              <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
              {qualifier && <p className="mt-0.5 text-[11px] text-gray-400">{qualifier}</p>}
            </div>
          )
        })}
      </dl>

      {/* Provenance, not decoration: an owner can see how fresh the figures are
          and how much of the window was actually measured. */}
      <div className="mt-4 space-y-1 border-t pt-3 text-[11px] text-gray-400">
        {asOf && <p data-testid="pulse-as-of">As of {asOf}</p>}
        {coverage && <p data-testid="pulse-coverage">{coverage}</p>}
        {payload?.calculation_version && (
          <p data-testid="pulse-calc-version">Calculation {payload.calculation_version}</p>
        )}
      </div>
    </section>
  )
}
