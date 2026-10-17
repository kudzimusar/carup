/**
 * CarUp Intelligence 1.0 — I16 command centre.
 *
 * Every section shows what it was read from. A section that could not be read
 * says so; a section that has no source at all says that too, and is rendered as
 * prominently as the sections that do — because on an admin surface an absent
 * section reads as an oversight, while a declared one is a fact about the
 * platform that somebody may need to act on.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Info, Link2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  displayMetric,
  hasValue,
  envelopeIsReadable,
  envelopeMessage,
  type IntelligenceEnvelope,
  type MetricEnvelope,
} from '@/lib/intelligenceDisplay'

/** PC01-K2B — what a section read, and what it set aside, by provenance. Counts only. */
interface SetAside {
  records_read: number
  operational: number
  excluded_non_operational?: number
  unknown_requires_review?: number
  excluded?: number
}

interface Section {
  available: boolean
  provenance?: SetAside | Record<string, SetAside>
  unreadable?: boolean
  source?: string
  reason?: string
  note?: string | null
  metrics?: Record<string, MetricEnvelope>
  trust_authority?: string
  authority?: string
  boundary?: string
}

interface CommandCentreEnvelope extends IntelligenceEnvelope {
  sections?: Record<string, Section>
  verticals?: Array<{ key: string; label: string; endpoint: string; phase: string }>
  sections_without_a_source?: Array<{ key: string; label: string; reason: string; detail: string }>
  composition_note?: string
}

/** Section order and the human label for each. */
const SECTION_ORDER: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'supply', label: 'Supply' },
  { key: 'demand', label: 'Demand' },
  { key: 'trust_evidence', label: 'Trust and evidence' },
  { key: 'communications', label: 'Communications' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'risk', label: 'Risk' },
]

const METRIC_LABELS: Record<string, string> = {
  users_total: 'Users',
  users_joined_in_window: 'Joined this period',
  organizations_total: 'Organizations',
  vehicles_total: 'Vehicles',
  vehicles_published: 'Published',
  vehicles_unpublished: 'Not published',
  listed_in_window: 'Listed this period',
  inquiries: 'Inquiries',
  saved_vehicles: 'Saved',
  behavioural_events: 'Behavioural events',
  evidence_reviewed: 'Evidence reviewed',
  evidence_awaiting_review: 'Awaiting review',
  threads: 'Threads',
  messages: 'Messages',
  sessions_opened: 'Sessions opened',
  live_settlements: 'Live settlements',
  sandbox_settlements: 'Sandbox settlements',
  claims_recorded: 'Claims recorded',
}

const PROVENANCE_PART_LABELS: Record<string, string> = {
  inquiries: 'Inquiries',
  saved_vehicles: 'Saved',
  behavioural_events: 'Behavioural events',
}

function isSetAside(value: unknown): value is SetAside {
  return Boolean(value) && typeof (value as SetAside).records_read === 'number'
}

function setAsideText(part: SetAside): string {
  const excluded = part.excluded_non_operational ?? part.excluded ?? 0
  const review = part.unknown_requires_review ?? 0
  return `${part.operational} of ${part.records_read} records counted · Test / certification data excluded: ${excluded}`
    + (review > 0 ? ` · Needs review (not counted): ${review}` : '')
}

/** Operational truth only: say what was read and what was set aside, never silently. */
function ProvenanceLine({ sectionKey, provenance }: { sectionKey: string; provenance?: Section['provenance'] }) {
  if (!provenance) return null
  const parts: Array<[string | null, SetAside]> = isSetAside(provenance)
    ? [[null, provenance]]
    : Object.entries(provenance).filter((entry): entry is [string, SetAside] => isSetAside(entry[1]))
  if (parts.length === 0) return null
  return (
    <div className="mt-3 space-y-0.5 text-[11px] text-gray-500" data-testid={`command-${sectionKey}-provenance`}>
      {parts.map(([name, part]) => (
        <p key={name ?? 'all'}>
          {name ? `${PROVENANCE_PART_LABELS[name] || name}: ` : ''}{setAsideText(part)}
        </p>
      ))}
    </div>
  )
}

/** A figure that cannot be separated from test data is named as such, not as "Not available". */
function metricText(value: MetricEnvelope): string {
  if (!hasValue(value) && String(value?.reason ?? '').endsWith('_not_separable')) return 'Not separable from test data'
  return displayMetric(value)
}

function SectionCard({ sectionKey, label, section }: { sectionKey: string; label: string; section?: Section }) {
  if (!section) return null

  if (section.unreadable || !section.available) {
    return (
      <div className="rounded-xl border bg-white p-5" data-testid={`command-section-${sectionKey}`}>
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600" data-testid={`command-section-${sectionKey}-unreadable`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>{section.note || 'This section could not be read. Its figures are NOT zero.'}</span>
        </p>
        {section.source && (
          <p className="mt-2 text-[11px] text-gray-400">Source: {section.source}</p>
        )}
      </div>
    )
  }

  const entries = Object.entries(section.metrics || {})
  return (
    <div className="rounded-xl border bg-white p-5" data-testid={`command-section-${sectionKey}`}>
      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {entries.map(([key, value]) => (
          <div key={key} data-testid={`command-${sectionKey}-${key}`}>
            <dd
              className={hasValue(value) ? 'text-xl font-semibold text-gray-900' : 'text-sm italic text-gray-500'}
              data-testid={`command-${sectionKey}-${key}-value`}
            >
              {metricText(value)}
            </dd>
            <dt className="mt-0.5 text-xs text-gray-600">{METRIC_LABELS[key] || key}</dt>
          </div>
        ))}
      </dl>
      {section.note && (
        <p className="mt-3 text-[11px] text-gray-500" data-testid={`command-${sectionKey}-note`}>{section.note}</p>
      )}
      <ProvenanceLine sectionKey={sectionKey} provenance={section.provenance} />
      {(section.trust_authority || section.authority || section.boundary) && (
        <p className="mt-2 text-[11px] text-gray-500" data-testid={`command-${sectionKey}-authority`}>
          {section.trust_authority || section.authority || section.boundary}
        </p>
      )}
      {section.source && (
        <p className="mt-3 border-t pt-3 text-[11px] text-gray-400" data-testid={`command-${sectionKey}-source`}>
          Source: {section.source}
        </p>
      )}
    </div>
  )
}

export default function CommandCentre({ windowDays = 30 }: { windowDays?: 7 | 30 | 90 }) {
  const { fetchCommandCentre } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<CommandCentreEnvelope | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchCommandCentre !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<CommandCentreEnvelope>
    try {
      pending = Promise.resolve(fetchCommandCentre(windowDays)) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: CommandCentreEnvelope) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchCommandCentre, windowDays])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="command-centre-loading">
        <h3 className="text-sm font-semibold text-gray-700">Platform position</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || !envelopeIsReadable(payload, 'sections')) {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="command-centre-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Platform position</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="command-centre-message">
            {state === 'failed'
              ? 'The platform position could not be loaded. These figures are NOT zero.'
              : envelopeMessage(payload)}
          </span>
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4" data-testid="command-centre">
      <p className="text-xs text-gray-500">Last {payload?.window_days ?? windowDays} days</p>

      {SECTION_ORDER.map(({ key, label }) => (
        <SectionCard key={key} sectionKey={key} label={label} section={payload?.sections?.[key]} />
      ))}

      {payload?.verticals && payload.verticals.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="command-verticals">
          <h3 className="text-sm font-semibold text-gray-700">Stakeholder verticals</h3>
          {/* Linked, not restated: two surfaces quoting the same domain from
              different code eventually disagree. */}
          <p className="mt-1 text-xs text-gray-500">{payload.composition_note}</p>
          <ul className="mt-3 space-y-1">
            {payload.verticals.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2 text-sm" data-testid={`command-vertical-${entry.key}`}>
                <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="text-gray-800">{entry.label}</span>
                <span className="text-[11px] text-gray-400">{entry.endpoint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload?.sections_without_a_source && payload.sections_without_a_source.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="command-no-source">
          <h3 className="text-sm font-semibold text-gray-700">Sections with no source</h3>
          <p className="mt-1 text-xs text-gray-500">
            CarUp holds no records for these. They are absent, not zero.
          </p>
          <ul className="mt-2 space-y-2">
            {payload.sections_without_a_source.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 text-sm" data-testid={`command-missing-${entry.key}`}>
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
