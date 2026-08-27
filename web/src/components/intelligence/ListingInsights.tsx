/**
 * CarUp Intelligence 1.0 — I7 listing-level insights.
 *
 * The plan's Level 3 surface for one listing: how it was discovered, how buyers
 * responded, what information is missing, what that has demonstrably cost, and
 * what to do next.
 *
 * Two disciplines carried from the backend, visible in the markup:
 *
 *  1. Completeness is NOT Trust. They render in separate blocks with different
 *     headings, and the trust block never shows a number the backend withheld.
 *  2. Nothing is invented. Every figure goes through the display contract, so an
 *     unmeasured metric shows words; the score publishes what it could NOT assess;
 *     and lost opportunity is phrased as a matching statement, never a lost sale.
 *
 * Rendered standalone (no layout assumptions) so it can be embedded wherever a
 * seller manages a listing without that surface needing to know about analytics.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  displayMetric,
  hasValue,
  metricQualifier,
  envelopeIsReadable,
  envelopeMessage,
  formatAsOf,
  coverageNote,
  displayTrust,
  type IntelligenceEnvelope,
} from '@/lib/intelligenceDisplay'

/** The discovery funnel, in the order the plan states it. */
const FUNNEL = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'views', label: 'Views' },
  { key: 'unique_viewers', label: 'Unique viewers' },
  { key: 'engaged_views', label: 'Engaged views' },
  { key: 'saves', label: 'Saves' },
  { key: 'inquiries', label: 'Enquiries' },
]

const CONVERSIONS = [
  { key: 'impression_to_view', label: 'Impression → view' },
  { key: 'view_to_save', label: 'View → save' },
  { key: 'view_to_inquiry', label: 'View → enquiry' },
]

export default function ListingInsights({
  vin,
  windowDays = 7,
}: { vin: string; windowDays?: 7 | 30 | 90 }) {
  const { fetchListingIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<IntelligenceEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    // Analytics must never break the surface it sits on: an unavailable API
    // surface is an unreadable read, not a thrown error.
    if (typeof fetchListingIntelligence !== 'function' || !vin) {
      setState('failed')
      return () => { cancelled = true }
    }
    Promise.resolve(fetchListingIntelligence(vin, windowDays))
      .then((data: IntelligenceEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('failed') })
    return () => { cancelled = true }
  }, [fetchListingIntelligence, vin, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="listing-insights-loading">
        <h3 className="text-sm font-semibold text-gray-700">Listing insights</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  // Performance may be unreadable while GUIDANCE is still perfectly readable —
  // completeness needs no rollup — so the two are judged separately rather than
  // one failure hiding the other.
  const performanceReadable = state === 'ready' && envelopeIsReadable(payload)
  const completeness = payload?.completeness
  const lostOpportunity = payload?.lost_opportunity
  const actions = payload?.next_best_actions ?? []

  if (state === 'failed' && !completeness) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="listing-insights-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Listing insights</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="listing-insights-message">
            Insights could not be loaded. These figures are NOT zero.
          </span>
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4" data-testid="listing-insights">
      {/* ── Performance ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">How buyers found this listing</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>

        {!performanceReadable ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-gray-600" data-testid="listing-performance-unavailable">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{envelopeMessage(payload)}</span>
          </p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="listing-funnel">
              {FUNNEL.map(({ key, label }) => {
                const metric = payload?.metrics?.[key]
                const qualifier = metricQualifier(metric)
                return (
                  <div key={key} data-testid={`funnel-${key}`}>
                    <dd
                      className={hasValue(metric) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                      data-testid={`funnel-${key}-value`}
                    >
                      {displayMetric(metric)}
                    </dd>
                    <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
                    {qualifier && <p className="mt-0.5 text-[11px] text-gray-400">{qualifier}</p>}
                  </div>
                )
              })}
            </dl>

            <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-3" data-testid="listing-conversion">
              {CONVERSIONS.map(({ key, label }) => {
                const metric = payload?.conversion?.[key]
                const qualifier = metricQualifier(metric)
                return (
                  <div key={key} data-testid={`conversion-${key}`}>
                    <p className="text-xs text-gray-600">{label}</p>
                    <p
                      className={hasValue(metric) ? 'text-base font-medium text-gray-900' : 'text-xs italic text-gray-500'}
                      data-testid={`conversion-${key}-value`}
                    >
                      {displayMetric(metric)}
                    </p>
                    {qualifier && <p className="mt-0.5 text-[11px] text-gray-400">{qualifier}</p>}
                  </div>
                )
              })}
            </div>

            <div className="mt-4 space-y-1 border-t pt-3 text-[11px] text-gray-400">
              {formatAsOf(payload?.as_of) && <p data-testid="insights-as-of">As of {formatAsOf(payload?.as_of)}</p>}
              {coverageNote(payload) && <p data-testid="insights-coverage">{coverageNote(payload)}</p>}
              {payload?.calculation_version && <p>Calculation {payload.calculation_version}</p>}
            </div>
          </>
        )}
      </div>

      {/* ── Listing completeness — explicitly NOT a Trust score ─────────── */}
      {completeness && (
        <div className="rounded-xl border bg-white p-5" data-testid="listing-completeness">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Listing completeness</h3>
            <span className="text-lg font-semibold text-gray-900" data-testid="completeness-percent">
              {completeness.percent}%
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500" data-testid="completeness-not-trust">
            How much useful information you have supplied. This is not a Trust score.
          </p>

          <ul className="mt-3 space-y-2" data-testid="completeness-groups">
            {completeness.groups.map((group) => (
              <li key={group.key} className="flex items-start gap-2 text-sm" data-testid={`completeness-group-${group.key}`}>
                {group.complete ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                )}
                <span className={group.complete ? 'text-gray-600' : 'text-gray-800'}>
                  <span className="font-medium">{group.label}</span>
                  {!group.complete && group.guidance && <span className="block text-xs text-gray-600">{group.guidance}</span>}
                </span>
              </li>
            ))}
          </ul>

          {/* The denominator is published: 100% never means "everything". */}
          {completeness.not_measurable?.length > 0 && (
            <div className="mt-3 border-t pt-3" data-testid="completeness-not-measurable">
              <p className="text-[11px] font-medium text-gray-500">Not assessed</p>
              <ul className="mt-1 space-y-0.5">
                {completeness.not_measurable.map((group) => (
                  <li key={group.key} className="text-[11px] text-gray-400">{group.detail}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Trust travels OUTSIDE the score, in its own block. */}
          <div className="mt-3 flex flex-wrap gap-4 border-t pt-3" data-testid="listing-trust-separate">
            <div>
              <p className="text-[11px] text-gray-500">Trust evaluation</p>
              <p className="text-sm text-gray-800" data-testid="listing-trust-state">
                {displayTrust(completeness.displayed_separately?.trust)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-500">Publication</p>
              <p className="text-sm text-gray-800" data-testid="listing-publication-status">
                {completeness.displayed_separately?.transaction_readiness?.publication_status ?? 'Not recorded'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Lost opportunity ────────────────────────────────────────────── */}
      {lostOpportunity && lostOpportunity.dimensions.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="listing-lost-opportunity">
          <h3 className="text-sm font-semibold text-gray-700">Searches you could not be matched to</h3>
          <ul className="mt-2 space-y-2">
            {lostOpportunity.dimensions.map((dimension) => (
              <li key={dimension.filter} className="text-sm text-gray-800" data-testid={`lost-${dimension.filter}`}>
                {dimension.message}
                <span className="ml-1 text-xs text-gray-500">
                  ({dimension.missed_searches} {dimension.missed_searches === 1 ? 'search' : 'searches'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Next best action ────────────────────────────────────────────── */}
      {actions.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="listing-next-best-actions">
          <h3 className="text-sm font-semibold text-gray-700">What to do next</h3>
          <ol className="mt-2 space-y-2">
            {actions.slice(0, 4).map((action) => (
              <li key={action.action} className="text-sm text-gray-800" data-testid={`action-${action.action}`}>
                {action.message}
                {action.basis === 'observed_missed_searches' && (
                  <span className="ml-1 text-xs font-medium text-amber-700">Based on searches we observed</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
