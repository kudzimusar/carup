import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Ship,
  Gavel,
  CarFront,
  Wrench,
  ClipboardCheck,
  ArrowLeftRight,
  Tag,
  Camera,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import type {
  EvidenceClass,
  EvidenceTaxonomyResponse,
  EvidenceSource,
  VehicleEvidence,
  EvidenceVerificationStatus,
} from '@/types'

interface VehicleLifeStageTimelineProps {
  evidence: VehicleEvidence[]
  /** Optional taxonomy payload — used to derive a class for legacy records via legacy_type_to_class. */
  taxonomy?: EvidenceTaxonomyResponse | null
  /** Optional source registry — used to resolve a human-readable source label from source_id. */
  sources?: EvidenceSource[]
}

// Stable, canonical ordering of the eight life-stage classes (chronological life arc).
const LIFE_STAGE_ORDER: EvidenceClass[] = [
  'import',
  'auction',
  'accident',
  'repair',
  'inspection',
  'ownership_transfer',
  'dealer_listing',
  'current_condition',
]

interface StageMeta {
  label: string
  icon: LucideIcon
  // Distinct accent per stage so all eight are visually separable (not color-only — each has a unique icon too).
  accent: string
  ring: string
}

const STAGE_META: Record<EvidenceClass, StageMeta> = {
  import: { label: 'Import', icon: Ship, accent: 'bg-sky-50 text-sky-700', ring: 'border-sky-200' },
  auction: { label: 'Auction', icon: Gavel, accent: 'bg-violet-50 text-violet-700', ring: 'border-violet-200' },
  accident: { label: 'Accident', icon: CarFront, accent: 'bg-red-50 text-red-700', ring: 'border-red-200' },
  repair: { label: 'Repair', icon: Wrench, accent: 'bg-amber-50 text-amber-700', ring: 'border-amber-200' },
  inspection: { label: 'Inspection', icon: ClipboardCheck, accent: 'bg-emerald-50 text-emerald-700', ring: 'border-emerald-200' },
  ownership_transfer: { label: 'Ownership Transfer', icon: ArrowLeftRight, accent: 'bg-indigo-50 text-indigo-700', ring: 'border-indigo-200' },
  dealer_listing: { label: 'Dealer Listing', icon: Tag, accent: 'bg-orange-50 text-orange-700', ring: 'border-orange-200' },
  current_condition: { label: 'Current Condition', icon: Camera, accent: 'bg-teal-50 text-teal-700', ring: 'border-teal-200' },
}

const VERIFICATION_META: Record<EvidenceVerificationStatus, { label: string; icon: LucideIcon; className: string }> = {
  verified: { label: 'Verified', icon: CheckCircle, className: 'bg-green-100 text-green-800 border-green-200' },
  pending: { label: 'Pending review', icon: Clock, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  rejected: { label: 'Rejected', icon: XCircle, className: 'bg-red-100 text-red-800 border-red-200' },
  disputed: { label: 'Disputed', icon: AlertTriangle, className: 'bg-orange-100 text-orange-800 border-orange-200' },
  superseded: { label: 'Superseded', icon: Layers, className: 'bg-gray-100 text-gray-700 border-gray-200' },
}

function isEvidenceClass(value: string | null | undefined): value is EvidenceClass {
  return !!value && (LIFE_STAGE_ORDER as string[]).includes(value)
}

/**
 * Resolve a life-stage class for an evidence record:
 *   1. explicit evidence_class (M1 records), else
 *   2. taxonomy.legacy_type_to_class[evidence_type] (legacy records), else null.
 */
function classForEvidence(
  item: VehicleEvidence,
  legacyMap: Record<string, string>,
): EvidenceClass | null {
  if (isEvidenceClass(item.evidence_class)) return item.evidence_class
  const mapped = item.evidence_type ? legacyMap[item.evidence_type] : undefined
  return isEvidenceClass(mapped) ? mapped : null
}

/** Best available date for an evidence record (event_date wins, then captured_at, then uploaded_at). */
function bestDate(item: VehicleEvidence): string | null {
  return item.event_date || item.captured_at || item.uploaded_at || null
}

/** Parse a date to a sortable epoch; unknown/partial dates sort last but deterministically. */
function dateSortKey(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

function formatDate(value: string | null): string {
  if (!value) return 'Date unknown'
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return 'Date unknown'
  return t.toLocaleDateString()
}

interface StageGroup {
  evidenceClass: EvidenceClass
  meta: StageMeta
  items: VehicleEvidence[]
  earliest: string | null
  latest: string | null
}

export default function VehicleLifeStageTimeline({
  evidence,
  taxonomy,
  sources,
}: VehicleLifeStageTimelineProps) {
  // Memoised so the `{}` fallback is stable across renders and does not force the
  // downstream useMemo to recompute every render (react-hooks/exhaustive-deps).
  const legacyMap = useMemo(() => taxonomy?.legacy_type_to_class ?? {}, [taxonomy])

  const sourceLabelById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const source of sources ?? []) {
      map[source.id] = source.display_name || source.code
    }
    return map
  }, [sources])

  const groups = useMemo<StageGroup[]>(() => {
    const buckets = new Map<EvidenceClass, VehicleEvidence[]>()
    for (const item of evidence) {
      const evidenceClass = classForEvidence(item, legacyMap)
      if (!evidenceClass) continue
      const existing = buckets.get(evidenceClass)
      if (existing) existing.push(item)
      else buckets.set(evidenceClass, [item])
    }

    return LIFE_STAGE_ORDER.filter((cls) => buckets.has(cls)).map((evidenceClass) => {
      // Deterministic ordering: by best date asc, with a stable tiebreak on id so
      // records sharing a (possibly unknown) date never reorder between renders.
      const items = [...(buckets.get(evidenceClass) as VehicleEvidence[])].sort((a, b) => {
        const ka = dateSortKey(bestDate(a))
        const kb = dateSortKey(bestDate(b))
        if (ka !== kb) return ka - kb
        return String(a.id).localeCompare(String(b.id))
      })
      const datedKeys = items
        .map((i) => bestDate(i))
        .filter((d): d is string => !!d && !Number.isNaN(new Date(d).getTime()))
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

      return {
        evidenceClass,
        meta: STAGE_META[evidenceClass],
        items,
        earliest: datedKeys[0] ?? null,
        latest: datedKeys[datedKeys.length - 1] ?? null,
      }
    })
  }, [evidence, legacyMap])

  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400" data-testid="life-stage-timeline-empty">
        <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No life-stage evidence yet</p>
        <p className="text-xs mt-1">As evidence is added across the vehicle's life, it will appear here grouped by stage.</p>
      </div>
    )
  }

  return (
    <ol className="space-y-4" data-testid="life-stage-timeline">
      {groups.map((group) => {
        const StageIcon = group.meta.icon
        const dateLabel =
          group.earliest && group.latest && group.earliest !== group.latest
            ? `${formatDate(group.earliest)} – ${formatDate(group.latest)}`
            : formatDate(group.earliest ?? group.latest)

        return (
          <li
            key={group.evidenceClass}
            className={`rounded-xl border bg-white p-4 shadow-sm ${group.meta.ring}`}
            data-testid={`life-stage-${group.evidenceClass}`}
            data-stage={group.evidenceClass}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${group.meta.accent}`}
                aria-hidden="true"
              >
                <StageIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{group.meta.label}</h3>
                  <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-normal">
                    {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{dateLabel}</p>

                <ul className="mt-3 space-y-2">
                  {group.items.map((item) => {
                    const statusMeta =
                      VERIFICATION_META[item.verification_status as EvidenceVerificationStatus] ??
                      VERIFICATION_META.pending
                    const StatusIcon = statusMeta.icon
                    const sourceLabel = item.source_id ? sourceLabelById[item.source_id] : undefined

                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs"
                        data-testid="life-stage-evidence-item"
                      >
                        <span className="font-medium text-gray-700">{formatDate(bestDate(item))}</span>
                        {item.evidence_subtype && (
                          <span className="text-gray-500">
                            {String(item.evidence_subtype)
                              .split('_')
                              .filter(Boolean)
                              .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                              .join(' ')}
                          </span>
                        )}
                        {sourceLabel && (
                          <span className="text-gray-500">
                            Source: <span className="text-gray-700">{sourceLabel}</span>
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={`ml-auto inline-flex items-center gap-1 border ${statusMeta.className}`}
                        >
                          <StatusIcon className="h-3 w-3" aria-hidden="true" />
                          {statusMeta.label}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
