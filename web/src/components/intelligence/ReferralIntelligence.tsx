/**
 * CarUp Intelligence 1.0 — I14 referral and marketing.
 *
 * Two things this surface must not let a reader conclude: that the referral
 * numbers describe the whole event table (they do not — it is shared with four
 * other domains), and that accrued reward value is money a referrer has received
 * (it is not — nothing has been paid).
 *
 * There is no ROI anywhere on this page, and its absence is stated rather than
 * left as a gap somebody later fills with an estimate.
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

interface ReferralEnvelope extends IntelligenceEnvelope {
  inventory?: Record<string, MetricEnvelope>
  activity?: Record<string, MetricEnvelope> & {
    by_type?: Record<string, number>
    excluded_from_this_count?: { other_domain_events: number; note: string }
  }
  channels?: {
    by_channel: Record<string, number>
    by_source: Record<string, number>
    source_coverage: { recorded: number; total: number; note: string | null }
  }
  rewards?: Record<string, MetricEnvelope> & {
    by_status?: Record<string, number>
    accrued_amounts?: CurrencyGroup
    paid_amounts?: CurrencyGroup
    note?: string | null
  }
  attributed_outcomes?: Record<string, MetricEnvelope> & { note?: string }
  not_measurable?: Array<{ key: string; label: string; reason: string; detail: string }>
  domain_boundary?: string
}

const INVENTORY_METRICS = [
  { key: 'active_codes', label: 'Active codes' },
  { key: 'active_campaigns', label: 'Active campaigns' },
  { key: 'draft_campaigns', label: 'Draft campaigns' },
]

const ACTIVITY_METRICS = [
  { key: 'referral_events', label: 'Referral events' },
  { key: 'validations', label: 'Validations' },
  { key: 'failed_validations', label: 'Failed validations' },
  { key: 'coupons_redeemed', label: 'Coupons redeemed' },
]

const REWARD_METRICS = [
  { key: 'transactions_recorded', label: 'Benefits recorded' },
  { key: 'paid_out', label: 'Paid out' },
  { key: 'awaiting_settlement', label: 'Awaiting settlement' },
]

const OUTCOME_METRICS = [
  { key: 'inquiries_with_a_referral_code', label: 'Inquiries with a referral code' },
  { key: 'inquiries_with_a_campaign_code', label: 'With a campaign code' },
  { key: 'inquiries_total', label: 'Inquiries in total' },
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

function CurrencyLines({ group, testid, emptyLabel }: { group?: CurrencyGroup; testid: string; emptyLabel: string }) {
  if (!group) return null
  const entries = Object.entries(group.by_currency)
  if (entries.length === 0) {
    return <p className="text-sm italic text-gray-500" data-testid={`${testid}-none`}>{emptyLabel}</p>
  }
  return (
    <div data-testid={testid}>
      {entries.map(([currency, { total, count }]) => (
        <p key={currency} className="text-sm text-gray-800" data-testid={`${testid}-${currency}`}>
          <span className="font-semibold">{total.toLocaleString()} {currency}</span>
          <span className="text-gray-500"> across {count} record{count === 1 ? '' : 's'}</span>
        </p>
      ))}
      {group.currencies > 1 && (
        <p className="mt-1 text-[11px] text-gray-500" data-testid={`${testid}-fx-note`}>{group.note}</p>
      )}
    </div>
  )
}

export default function ReferralIntelligence({ windowDays = 30 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchReferralIntelligence } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<ReferralEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchReferralIntelligence !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<ReferralEnvelope>
    try {
      pending = Promise.resolve(fetchReferralIntelligence(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: ReferralEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchReferralIntelligence, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="referral-intelligence-loading">
        <h3 className="text-sm font-semibold text-gray-700">Referral performance</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'activity')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="referral-intelligence-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Referral performance</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="referral-intelligence-message">
            {state === 'failed'
              ? 'Referral performance could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  const channels = payload?.channels

  return (
    <section className="space-y-4" data-testid="referral-intelligence">
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Referral activity</h3>
          <span className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</span>
        </div>
        <MetricGrid metrics={ACTIVITY_METRICS} payload={payload?.activity} prefix="referral-activity" />
        {/* Without this line a reader has no way to know the table held far more. */}
        {payload?.activity?.excluded_from_this_count && (
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-500" data-testid="referral-exclusion-note">
            {payload.activity.excluded_from_this_count.note}{' '}
            {payload.activity.excluded_from_this_count.other_domain_events} event
            {payload.activity.excluded_from_this_count.other_domain_events === 1 ? '' : 's'} from other domains
            {' '}were excluded.
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Programme</h3>
        <MetricGrid metrics={INVENTORY_METRICS} payload={payload?.inventory} prefix="referral-inventory" />
      </div>

      {channels && (
        <div className="rounded-xl border bg-white p-5" data-testid="referral-channels">
          <h3 className="text-sm font-semibold text-gray-700">Channels</h3>
          <ul className="mt-3 space-y-1">
            {Object.entries(channels.by_channel).map(([channel, count]) => (
              <li key={channel} className="flex justify-between text-sm" data-testid={`referral-channel-${channel}`}>
                <span className="text-gray-800">{channel}</span>
                <span className="font-semibold text-gray-900">{count}</span>
              </li>
            ))}
          </ul>
          {channels.source_coverage.note && (
            <p className="mt-3 text-[11px] text-gray-500" data-testid="referral-source-coverage">
              {channels.source_coverage.note} Source is recorded on {channels.source_coverage.recorded} of{' '}
              {channels.source_coverage.total} events.
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-white p-5" data-testid="referral-rewards">
        <h3 className="text-sm font-semibold text-gray-700">Referral benefits</h3>
        <MetricGrid metrics={REWARD_METRICS} payload={payload?.rewards} prefix="referral-rewards" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-600">Accrued</p>
            <CurrencyLines group={payload?.rewards?.accrued_amounts} testid="referral-accrued" emptyLabel="None accrued" />
          </div>
          <div>
            <p className="text-xs text-gray-600">Paid</p>
            <CurrencyLines group={payload?.rewards?.paid_amounts} testid="referral-paid" emptyLabel="Nothing has been paid" />
          </div>
        </div>
        {payload?.rewards?.note && (
          <p className="mt-3 text-[11px] text-gray-500" data-testid="referral-reward-note">{payload.rewards.note}</p>
        )}
      </div>

      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700">Attributed outcomes</h3>
        <MetricGrid metrics={OUTCOME_METRICS} payload={payload?.attributed_outcomes} prefix="referral-outcomes" />
        {payload?.attributed_outcomes?.note && (
          <p className="mt-3 border-t pt-3 text-[11px] text-gray-500" data-testid="referral-outcome-note">
            {payload.attributed_outcomes.note}
          </p>
        )}
      </div>

      {payload?.not_measurable && payload.not_measurable.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="referral-not-measurable">
          <h3 className="text-sm font-semibold text-gray-700">Not measurable</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp does not hold the records these would need. They are not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.not_measurable.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`referral-missing-${entry.key}`}>
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
        <p className="text-[11px] text-gray-400" data-testid="referral-domain-boundary">{payload.domain_boundary}</p>
      )}
    </section>
  )
}
