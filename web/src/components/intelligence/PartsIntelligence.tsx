/**
 * CarUp Intelligence 1.0 — I12 parts intelligence surface.
 *
 * Two scopes, kept apart exactly as I9 kept mechanic apart from garage: a
 * practitioner sees their own PartSentry records and their organization's stock;
 * the platform sees RFQ demand, which exists at no other scope because no part
 * quote request names a supplier.
 *
 * The list of what CarUp cannot measure is rendered as prominently as what it
 * can. On this surface the absences are the finding — there is no parts
 * catalogue, no fitment data and no supplier principal — and hiding them would
 * make a thin page look like a complete one.
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

interface PartsEnvelope extends IntelligenceEnvelope {
  provenance?: Record<string, MetricEnvelope>
  rfq_demand?: Record<string, MetricEnvelope> & { by_status?: Record<string, number> }
  inventory?: (Record<string, MetricEnvelope> & {
    unavailable?: boolean
    note?: string
    valuation_coverage?: { priced_parts: number; total_parts: number; note: string | null }
  })
  scope_note?: string
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
  domain_boundary?: string
}

const PROVENANCE_METRICS = [
  { key: 'logs_recorded', label: 'Records logged' },
  { key: 'parts_verified', label: 'Parts verified' },
  { key: 'awaiting_verification', label: 'Awaiting verification' },
  { key: 'publicly_shareable', label: 'Shareable publicly' },
]

const RFQ_METRICS = [
  { key: 'requests_received', label: 'Quote requests' },
  { key: 'responded', label: 'Responded to' },
  { key: 'awaiting_response', label: 'Awaiting response' },
]

const INVENTORY_METRICS = [
  { key: 'part_types_tracked', label: 'Part types tracked' },
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'below_reorder_threshold', label: 'Below reorder level' },
]

function MetricGrid({ metrics, payload, prefix }: {
  metrics: Array<{ key: string; label: string }>
  payload?: Record<string, MetricEnvelope>
  prefix: string
}) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid={`${prefix}-grid`}>
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

export default function PartsIntelligence({
  scope = 'mechanic',
  windowDays = 30,
}: { scope?: 'mechanic' | 'platform'; windowDays?: 7 | 30 | 90 }) {
  const api = useCarUpApi()
  const fetcher = scope === 'platform' ? api.fetchPlatformPartsIntelligence : api.fetchPartsIntelligence
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<PartsEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    if (typeof fetcher !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<PartsEnvelope>
    try {
      pending = Promise.resolve(fetcher(windowDays))
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: PartsEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetcher, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="parts-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Parts intelligence</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'provenance')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="parts-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Parts intelligence</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="parts-intelligence-message">
            {state === 'failed'
              ? 'Parts intelligence could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const inventory = payload?.inventory

  return (
    <section className="space-y-4" data-testid="parts-intelligence">
      {payload?.scope_note && (
        <p className="text-xs text-gray-500" data-testid="parts-scope-note">{payload.scope_note}</p>
      )}

      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">PartSentry records</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <MetricGrid metrics={PROVENANCE_METRICS} payload={payload?.provenance} prefix="parts-provenance" />
        <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
          A record is shareable publicly only where the governed review says so. A flagged record is
          awaiting review, not a finding of fraud.
        </p>
      </div>

      {payload?.rfq_demand && (
        <div className="rounded-xl border bg-white p-5" data-testid="parts-rfq">
          <h3 className="text-sm font-semibold text-gray-700">Parts quote requests</h3>
          <MetricGrid metrics={RFQ_METRICS} payload={payload.rfq_demand} prefix="parts-rfq" />
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
            No quote request names a supplier or a part, so these are platform totals only. They
            cannot be broken down by either.
          </p>
        </div>
      )}

      {inventory && (
        <div className="rounded-xl border bg-white p-5" data-testid="parts-inventory">
          <h3 className="text-sm font-semibold text-gray-700">Organization stock</h3>
          {inventory.unavailable ? (
            <p className="mt-2 text-sm text-gray-600" data-testid="parts-inventory-unavailable">{inventory.note}</p>
          ) : (
            <>
              <MetricGrid metrics={INVENTORY_METRICS} payload={inventory} prefix="parts-inventory" />
              {inventory.valuation_coverage?.note && (
                <p className="mt-3 text-[11px] text-gray-500" data-testid="parts-inventory-coverage">
                  {inventory.valuation_coverage.note}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="parts-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not measurable</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`parts-missing-${entry.key}`}>
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
        <p className="text-[11px] text-gray-400" data-testid="parts-domain-boundary">{payload.domain_boundary}</p>
      )}
    </section>
  )
}
