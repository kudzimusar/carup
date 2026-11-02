/**
 * CA-K3-01 — provenance / freshness presentation (CA-UX-01 §3.7, §7.7; CA-METRIC-01 §dashboard contract).
 *
 * It DISPLAYS governed facts a source adapter supplies — authority, metric/version, as-of, freshness,
 * provenance state and the excluded / needs-review counts the provenance authority (K2B) already
 * computed. It never receives rows and never classifies, sums or derives anything: a count that was
 * not supplied is not shown, and "operational" is never computed as raw − excluded.
 */
import { Clock, Database, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FreshnessState = 'current' | 'stale' | 'degraded' | 'unavailable' | 'not_connected'
export type ProvenanceState = 'certified_k2b' | 'pending_k2b_consumption' | 'not_applicable' | 'unknown'

export interface ProvenanceFreshnessProps {
  sourceAuthority?: string
  metricId?: string
  metricVersion?: string
  /** ISO timestamp supplied by the source; shown verbatim with its zone. */
  asOf?: string
  freshness?: FreshnessState
  provenance?: ProvenanceState
  /** Counts as computed by the provenance authority. Optional, never derived here. */
  excludedNonOperational?: number
  needsReview?: number
  /** Short note on a degraded or unavailable source. */
  sourceNote?: string
  compact?: boolean
  className?: string
}

const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  current: 'Current',
  stale: 'Stale',
  degraded: 'Source degraded',
  unavailable: 'Source unavailable',
  not_connected: 'No governed source connected',
}

const PROVENANCE_LABEL: Record<ProvenanceState, string> = {
  certified_k2b: 'Operational provenance certified (K2B)',
  pending_k2b_consumption: 'Operational provenance integration not certified for this source',
  not_applicable: 'Provenance not applicable',
  unknown: 'Provenance unknown — not counted as operational',
}

export function ProvenanceFreshness(props: ProvenanceFreshnessProps) {
  const { sourceAuthority, metricId, metricVersion, asOf, freshness, provenance, excludedNonOperational, needsReview, sourceNote, compact, className } = props
  const hasCounts = typeof excludedNonOperational === 'number' || typeof needsReview === 'number'
  const expand = (excludedNonOperational ?? 0) > 0 || (needsReview ?? 0) > 0
  const rows: Array<[string, string]> = []
  if (sourceAuthority) rows.push(['Source authority', sourceAuthority])
  if (metricId) rows.push(['Metric', metricVersion ? `${metricId} @ ${metricVersion}` : metricId])
  if (asOf) rows.push(['As of', asOf])
  if (typeof excludedNonOperational === 'number') rows.push(['Excluded (non-operational)', String(excludedNonOperational)])
  if (typeof needsReview === 'number') rows.push(['Needs review (not counted)', String(needsReview)])
  if (sourceNote) rows.push(['Source note', sourceNote])

  return (
    <div
      className={cn('rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600', className)}
      data-testid="provenance-freshness"
      data-freshness={freshness ?? 'unspecified'}
      data-provenance={provenance ?? 'unspecified'}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {freshness && (
          <span className="inline-flex items-center gap-1.5" data-testid="freshness-state">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-medium text-slate-700">Freshness:</span> {FRESHNESS_LABEL[freshness]}
          </span>
        )}
        {provenance && (
          <span className="inline-flex items-center gap-1.5" data-testid="provenance-state">
            {provenance === 'unknown' ? <ShieldQuestion className="h-3.5 w-3.5" aria-hidden="true" /> : <Database className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="font-medium text-slate-700">Provenance:</span> {PROVENANCE_LABEL[provenance]}
          </span>
        )}
      </div>
      {rows.length > 0 && (compact && !expand ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[11px] text-slate-500 underline-offset-2 hover:underline">Source details</summary>
          <MetaRows rows={rows} />
        </details>
      ) : (
        <MetaRows rows={rows} highlight={hasCounts && expand} />
      ))}
    </div>
  )
}

function MetaRows({ rows, highlight }: { rows: Array<[string, string]>; highlight?: boolean }) {
  return (
    <dl className={cn('mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2', highlight && 'text-slate-700')} data-testid="provenance-rows">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-slate-500">{k}:</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
