/**
 * CarUp Intelligence 1.0 — I15 institutional provenance.
 *
 * One distinction governs this whole surface: what CarUp ASSESSED itself, versus
 * what an authoritative registry CONFIRMED. The first exists. The second does not
 * — no provider is registered and every check on record ran against a sandbox.
 *
 * So the assessed figures are labelled as CarUp's own throughout, the registry
 * block leads with the absence rather than burying it, and a sandbox simulation
 * is never shown next to a confirmation as though they were comparable.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Info, ShieldOff } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  displayMetric,
  hasValue,
  envelopeIsReadable,
  envelopeMessage,
  type IntelligenceEnvelope,
  type MetricEnvelope,
} from '@/lib/intelligenceDisplay'

interface GovernmentEnvelope extends IntelligenceEnvelope {
  commercial_behaviour_access?: boolean
  institutional_contract?: {
    registered_providers: MetricEnvelope
    live_providers: MetricEnvelope
    contract_established: boolean
    jurisdictions: string[]
    note: string | null
  }
  carup_assessment?: Record<string, MetricEnvelope> & {
    decisions_by_type?: Record<string, number>
    basis?: string
  }
  registry_checks?: {
    live_confirmations: MetricEnvelope
    sandbox_simulations: MetricEnvelope
    sandbox_by_provider: Record<string, number>
    any_live_confirmation: boolean
    note: string | null
  }
  audit_posture?: Record<string, MetricEnvelope> & { basis?: string }
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
  domain_boundary?: string
}

const ASSESSMENT_METRICS = [
  { key: 'carup_assessed_evidence', label: 'Evidence CarUp reviewed' },
  { key: 'carup_assessed_complete', label: 'Review complete' },
  { key: 'carup_awaiting_review', label: 'Awaiting review' },
  { key: 'carup_review_decisions', label: 'Review decisions' },
]

const AUDIT_METRICS = [
  { key: 'trust_audit_entries', label: 'Trust audit entries' },
  { key: 'organization_audit_entries', label: 'Organization audit entries' },
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

export default function GovernmentIntelligence({ windowDays = 30 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchGovernmentProvenance } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<GovernmentEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchGovernmentProvenance !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<GovernmentEnvelope>
    try {
      pending = Promise.resolve(fetchGovernmentProvenance(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: GovernmentEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchGovernmentProvenance, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="government-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Institutional position</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'carup_assessment')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="government-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Institutional position</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="government-intelligence-message">
            {state === 'failed'
              ? 'The institutional position could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const contract = payload?.institutional_contract
  const registry = payload?.registry_checks

  return (
    <section className="space-y-4" data-testid="government-intelligence">
      {/* The absence leads. A reader must meet it before any number. */}
      {contract && !contract.contract_established && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5" data-testid="government-no-contract">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <ShieldOff className="h-4 w-4" aria-hidden="true" />
            No authoritative source is connected
          </h3>
          <p className="mt-2 text-sm text-amber-800" data-testid="government-no-contract-note">{contract.note}</p>
        </div>
      )}

      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">What CarUp has assessed</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <MetricGrid metrics={ASSESSMENT_METRICS} payload={payload?.carup_assessment} prefix="government-assessment" />
        {payload?.carup_assessment?.basis && (
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-500" data-testid="government-assessment-basis">
            {payload.carup_assessment.basis}
          </p>
        )}
      </div>

      {registry && (
        <div className="rounded-xl border bg-white p-5" data-testid="government-registry">
          <h3 className="text-sm font-semibold text-gray-700">Registry checks</h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div data-testid="government-registry-live">
              <p className="text-xl font-semibold text-gray-900" data-testid="government-registry-live-value">
                {displayMetric(registry.live_confirmations)}
              </p>
              <p className="text-xs text-gray-600">Confirmed by a registry</p>
            </div>
            <div data-testid="government-registry-sandbox">
              <p className="text-xl font-semibold text-gray-900" data-testid="government-registry-sandbox-value">
                {displayMetric(registry.sandbox_simulations)}
              </p>
              <p className="text-xs text-gray-600">Sandbox simulations</p>
            </div>
          </div>
          {registry.note && (
            <p className="mt-3 text-[11px] text-gray-500" data-testid="government-registry-note">{registry.note}</p>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Audit trail</h3>
        <MetricGrid metrics={AUDIT_METRICS} payload={payload?.audit_posture} prefix="government-audit" />
        {payload?.audit_posture?.basis && (
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-500" data-testid="government-audit-basis">
            {payload.audit_posture.basis}
          </p>
        )}
      </div>

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="government-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not available</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`government-missing-${entry.key}`}>
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
        <p className="text-[11px] text-gray-400" data-testid="government-domain-boundary">{payload.domain_boundary}</p>
      )}
    </section>
  )
}
