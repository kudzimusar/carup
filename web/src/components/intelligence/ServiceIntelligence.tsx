/**
 * CarUp Intelligence 1.0 — I9 mechanic and garage intelligence.
 *
 * One component, two scopes, and the scope is always named on screen. The frozen
 * model keeps mechanic (a person) and garage (an organization) distinct, so the
 * surface must never let a practitioner read their own figures as the workshop's
 * or the other way round — the heading says which is which, in words.
 *
 * Everything CarUp cannot measure — bookings, capacity, staffing, branches,
 * turnaround, cancellations, service categories — is listed with its reason
 * rather than left out. Leaving it out invites someone to fill it back in.
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
} from '@/lib/intelligenceDisplay'

type Scope = 'mechanic' | 'garage'

interface ServiceEnvelope extends IntelligenceEnvelope {
  scope?: Scope
  demand_by_vehicle?: { top: Array<{ label: string; count: number }>; unidentified: number }
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
}

const MECHANIC_METRICS = [
  { key: 'work_orders', label: 'Work orders' },
  { key: 'completed_work_orders', label: 'Completed' },
  { key: 'open_work_orders', label: 'Open' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'service_records_logged', label: 'Service records' },
  { key: 'repeat_customers', label: 'Repeat customers' },
]

const GARAGE_METRICS = [
  { key: 'work_orders', label: 'Work orders' },
  { key: 'completed_work_orders', label: 'Completed' },
  { key: 'open_work_orders', label: 'Open' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'repeat_customers', label: 'Repeat customers' },
  { key: 'practitioners_contributing', label: 'Practitioners' },
]

const HEADINGS: Record<Scope, { title: string; note: string }> = {
  mechanic: { title: 'My workshop activity', note: 'Your own work only — not the whole garage.' },
  garage: { title: 'Garage activity', note: 'The whole organization — everyone working here.' },
}

export default function ServiceIntelligence({
  scope,
  windowDays = 30,
}: { scope: Scope; windowDays?: 7 | 30 | 90 }) {
  const { fetchMechanicIntelligence, fetchGarageIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<ServiceEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    const fetcher = scope === 'garage' ? fetchGarageIntelligence : fetchMechanicIntelligence
    if (typeof fetcher !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<ServiceEnvelope>
    try {
      pending = Promise.resolve(fetcher(windowDays))
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: ServiceEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchMechanicIntelligence, fetchGarageIntelligence, scope, windowDays])

  const heading = HEADINGS[scope]

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="service-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">{heading.title}</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload)) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="service-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">{heading.title}</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="service-intelligence-message">
            {state === 'failed'
              ? 'Service intelligence could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const metrics = scope === 'garage' ? GARAGE_METRICS : MECHANIC_METRICS
  const demand = payload?.demand_by_vehicle
  const completion = payload?.conversion?.completion_rate

  return (
    <section className="space-y-4" data-testid={`service-intelligence-${scope}`}>
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{heading.title}</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        {/* The scope is stated, not implied: one practitioner's figures must never
            be read as the workshop's, or the reverse. */}
        <p className="mt-1 text-xs text-gray-500" data-testid="service-scope-note">{heading.note}</p>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="service-metrics">
          {metrics.map(({ key, label }) => {
            const value = payload?.metrics?.[key]
            return (
              <div key={key} data-testid={`service-${key}`}>
                <dd
                  className={hasValue(value) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
                  data-testid={`service-${key}-value`}
                >
                  {displayMetric(value)}
                </dd>
                <dt className="mt-0.5 text-xs text-gray-600">{label}</dt>
              </div>
            )
          })}
        </dl>

        <div className="mt-4 border-t pt-3" data-testid="service-completion">
          <p className="text-xs text-gray-600">Completion rate</p>
          <p
            className={hasValue(completion) ? 'text-base font-medium text-gray-900' : 'text-xs italic text-gray-500'}
            data-testid="service-completion-value"
          >
            {displayMetric(completion)}
          </p>
        </div>

        {payload?.calculation_version && (
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
            Calculation {payload.calculation_version}
          </p>
        )}
      </div>

      {demand && demand.top.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="service-demand">
          <h3 className="text-sm font-semibold text-gray-700">Vehicles you work on most</h3>
          <ul className="mt-2 space-y-1">
            {demand.top.map((entry) => (
              <li key={entry.label} className="flex justify-between text-sm text-gray-800">
                <span>{entry.label}</span>
                <span className="font-medium">{entry.count}</span>
              </li>
            ))}
          </ul>
          {demand.unidentified > 0 && (
            <p className="mt-2 text-[11px] text-gray-400" data-testid="service-demand-unidentified">
              {demand.unidentified} {demand.unidentified === 1 ? 'job' : 'jobs'} could not be matched to a known vehicle.
            </p>
          )}
        </div>
      )}

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="service-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not yet measurable</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`not-measurable-${entry.key}`}>
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
    </section>
  )
}
