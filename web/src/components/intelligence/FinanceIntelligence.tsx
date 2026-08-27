/**
 * CarUp Intelligence 1.0 — I11 finance COMMERCIAL demand.
 *
 * Commercial demand only. Credit risk, underwriting and collateral are a separate
 * governed domain with their own surfaces, and the payload's own boundary note
 * says so — a demand figure must never be reusable as a credit signal.
 *
 * Live and sandbox activity are shown in separate blocks and never summed: a
 * simulated prequalification is a real record of a simulation, not of demand.
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

interface FinanceEnvelope extends IntelligenceEnvelope {
  provider_state?: { active_lenders: MetricEnvelope; live_market: boolean; note: string | null }
  attribution?: { basis: string; unattributed_applications: MetricEnvelope | null; note: string }
  application_demand?: Record<string, MetricEnvelope>
  live_eligibility?: Record<string, MetricEnvelope>
  sandbox_activity?: Record<string, MetricEnvelope> & { note?: string }
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
  domain_boundary?: string
}

const APPLICATION_METRICS = [
  { key: 'applications_received', label: 'Applications received' },
  { key: 'decisions_recorded', label: 'Decisions recorded' },
  { key: 'awaiting_decision', label: 'Awaiting decision' },
]

const ELIGIBILITY_METRICS = [
  { key: 'requests', label: 'Prequalification requests' },
  { key: 'eligible', label: 'Eligible' },
  { key: 'not_eligible', label: 'Not eligible' },
]

export default function FinanceIntelligence({ windowDays = 30 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchFinanceIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<FinanceEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchFinanceIntelligence !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<FinanceEnvelope>
    try {
      pending = Promise.resolve(fetchFinanceIntelligence(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: FinanceEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchFinanceIntelligence, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="finance-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Lending demand</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'application_demand')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="finance-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Lending demand</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="finance-intelligence-message">
            {state === 'failed'
              ? 'Lending demand could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const provider = payload?.provider_state

  return (
    <section className="space-y-4" data-testid="finance-intelligence">
      {/* Market state first: an empty market is described, not rendered as poor
          performance. */}
      {provider && !provider.live_market && (
        <div className="rounded-xl border bg-white p-5" data-testid="finance-no-live-market">
          <h3 className="text-sm font-semibold text-gray-700">No live lending market</h3>
          <p className="mt-2 text-sm text-gray-600">{provider.note}</p>
        </div>
      )}

      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Applications</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="finance-applications">
          {APPLICATION_METRICS.map(({ key, label }) => {
            const value = payload?.application_demand?.[key]
            return (
              <div key={key} data-testid={`finance-${key}`}>
                <dd
                  className={hasValue(value) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                  data-testid={`finance-${key}-value`}
                >
                  {displayMetric(value)}
                </dd>
                <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
              </div>
            )
          })}
        </dl>
        <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
          A decision is counted only where a lender decision was actually recorded.
        </p>
        {/* What this view cannot see, said out loud — otherwise a small count
            reads as the whole market. */}
        {payload?.attribution?.note && (
          <p className="mt-1 text-[11px] text-gray-400" data-testid="finance-attribution-note">
            {payload.attribution.note}
            {hasValue(payload.attribution.unattributed_applications) && (
              <> ({displayMetric(payload.attribution.unattributed_applications)} in this period.)</>
            )}
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Live prequalification</h3>
        <dl className="mt-4 grid grid-cols-3 gap-4" data-testid="finance-eligibility">
          {ELIGIBILITY_METRICS.map(({ key, label }) => {
            const value = payload?.live_eligibility?.[key]
            return (
              <div key={key} data-testid={`finance-live-${key}`}>
                <dd
                  className={hasValue(value) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                  data-testid={`finance-live-${key}-value`}
                >
                  {displayMetric(value)}
                </dd>
                <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
              </div>
            )
          })}
        </dl>
      </div>

      {payload?.sandbox_activity && (
        <div className="rounded-xl border bg-white p-5" data-testid="finance-sandbox">
          <h3 className="text-sm font-semibold text-gray-700">Sandbox activity</h3>
          <p className="mt-1 text-xs text-gray-500">{payload.sandbox_activity.note}</p>
          <p className="mt-2 text-xl font-semibold text-gray-900" data-testid="finance-sandbox-requests">
            {displayMetric(payload.sandbox_activity.requests)}
          </p>
          <p className="text-xs text-gray-600">Simulated requests</p>
        </div>
      )}

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="finance-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not measurable</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`finance-missing-${entry.key}`}>
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
        <p className="text-[11px] text-gray-400" data-testid="finance-domain-boundary">
          {payload.domain_boundary}
        </p>
      )}
    </section>
  )
}
