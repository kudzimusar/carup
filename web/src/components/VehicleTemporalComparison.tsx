import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  ArrowRight,
  CalendarClock,
  AlertTriangle,
  ShieldAlert,
  Wrench,
  RefreshCw,
  PackageX,
  Paintbrush,
  TrendingDown,
  TrendingUp,
  Minus,
  HelpCircle,
  CheckCircle,
  Clock,
  XCircle,
  Info,
  GitCompareArrows,
  type LucideIcon,
} from 'lucide-react'
import type {
  TemporalFinding,
  TemporalFindingType,
  IntelligenceSeverity,
  IntelligenceReviewerState,
} from '@/types'

interface VehicleTemporalComparisonProps {
  findings: TemporalFinding[]
}

interface FindingMeta {
  label: string
  icon: LucideIcon
  // Each finding type has a distinct icon AND label so meaning never relies on colour alone.
  accent: string
  ring: string
}

// Human-readable, neutral labels for each finding type. Wording stays cautious and
// descriptive — never accusatory — matching the backend's intentional tone.
const FINDING_META: Record<TemporalFindingType, FindingMeta> = {
  newly_damaged: { label: 'Newly damaged', icon: AlertTriangle, accent: 'bg-red-50 text-red-700', ring: 'border-red-200' },
  repaired: { label: 'Repaired', icon: Wrench, accent: 'bg-amber-50 text-amber-700', ring: 'border-amber-200' },
  replaced: { label: 'Replaced', icon: RefreshCw, accent: 'bg-indigo-50 text-indigo-700', ring: 'border-indigo-200' },
  removed_missing: { label: 'Removed or missing', icon: PackageX, accent: 'bg-red-50 text-red-700', ring: 'border-red-200' },
  repainted_colour_mismatch: { label: 'Repainted — colour mismatch', icon: Paintbrush, accent: 'bg-violet-50 text-violet-700', ring: 'border-violet-200' },
  worsened: { label: 'Condition worsened', icon: TrendingDown, accent: 'bg-orange-50 text-orange-700', ring: 'border-orange-200' },
  improved: { label: 'Condition improved', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700', ring: 'border-emerald-200' },
  unchanged: { label: 'Unchanged', icon: Minus, accent: 'bg-gray-50 text-gray-600', ring: 'border-gray-200' },
  unable_to_compare: { label: 'Unable to compare', icon: HelpCircle, accent: 'bg-slate-50 text-slate-600', ring: 'border-slate-200' },
}

const FALLBACK_FINDING_META: FindingMeta = {
  label: 'Change observed',
  icon: GitCompareArrows,
  accent: 'bg-gray-50 text-gray-600',
  ring: 'border-gray-200',
}

interface SeverityMeta {
  label: string
  icon: LucideIcon
  className: string
}

// Severity uses BOTH an icon and a text label so it is never communicated by colour alone.
const SEVERITY_META: Record<IntelligenceSeverity, SeverityMeta> = {
  info: { label: 'Informational', icon: Info, className: 'bg-gray-100 text-gray-700 border-gray-200' },
  low: { label: 'Low', icon: Info, className: 'bg-blue-100 text-blue-800 border-blue-200' },
  medium: { label: 'Medium', icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  high: { label: 'High', icon: ShieldAlert, className: 'bg-red-100 text-red-800 border-red-200' },
  critical: { label: 'Critical', icon: ShieldAlert, className: 'bg-red-100 text-red-800 border-red-200' },
}

const FALLBACK_SEVERITY_META: SeverityMeta = SEVERITY_META.info

interface ReviewerStateMeta {
  label: string
  icon: LucideIcon
  className: string
}

const REVIEWER_STATE_META: Record<IntelligenceReviewerState, ReviewerStateMeta> = {
  confirmed: { label: 'Reviewer confirmed', icon: CheckCircle, className: 'bg-green-100 text-green-800 border-green-200' },
  pending_review: { label: 'Pending reviewer confirmation', icon: Clock, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  dismissed: { label: 'Reviewer dismissed', icon: XCircle, className: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const FALLBACK_REVIEWER_STATE_META: ReviewerStateMeta = REVIEWER_STATE_META.pending_review

function findingMetaFor(type: string): FindingMeta {
  return (FINDING_META as Record<string, FindingMeta>)[type] ?? FALLBACK_FINDING_META
}
function severityMetaFor(severity: string): SeverityMeta {
  return (SEVERITY_META as Record<string, SeverityMeta>)[severity] ?? FALLBACK_SEVERITY_META
}
function reviewerStateMetaFor(state: string): ReviewerStateMeta {
  return (REVIEWER_STATE_META as Record<string, ReviewerStateMeta>)[state] ?? FALLBACK_REVIEWER_STATE_META
}

function formatComponent(component: string | null): string {
  if (!component) return 'Component'
  return component
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function formatDate(value: string | null): string {
  if (!value) return 'Date unknown'
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return 'Date unknown'
  return t.toLocaleDateString()
}

export default function VehicleTemporalComparison({ findings }: VehicleTemporalComparisonProps) {
  // Findings the model could not resolve are surfaced as an explicit, neutral
  // "insufficient evidence" edge state rather than mixed in with confident findings.
  const { comparable, inconclusive } = useMemo(() => {
    const comparableList: TemporalFinding[] = []
    const inconclusiveList: TemporalFinding[] = []
    for (const finding of findings) {
      if (finding.finding_type === 'unable_to_compare') inconclusiveList.push(finding)
      else comparableList.push(finding)
    }
    return { comparable: comparableList, inconclusive: inconclusiveList }
  }, [findings])

  // Overall empty state: no findings at all. This is the common, expected case for
  // most buyer-facing vehicles and must NOT imply anything is wrong.
  if (findings.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400" data-testid="temporal-comparison-empty">
        <GitCompareArrows className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
        <p className="font-medium">No confirmed component changes</p>
        <p className="text-xs mt-1">
          No reviewer-confirmed before/after comparisons are available for this vehicle.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="temporal-comparison">
      {comparable.length > 0 && (
        <ol className="space-y-4" data-testid="temporal-comparison-list">
          {comparable.map((finding, idx) => {
            const meta = findingMetaFor(finding.finding_type)
            const severity = severityMetaFor(finding.severity)
            const reviewer = reviewerStateMetaFor(finding.reviewer_state)
            const FindingIcon = meta.icon
            const SeverityIcon = severity.icon
            const ReviewerIcon = reviewer.icon
            const componentLabel = formatComponent(finding.component)

            return (
              <li
                key={`${finding.finding_type}-${finding.component ?? 'component'}-${idx}`}
                className={`rounded-xl border bg-white p-4 shadow-sm ${meta.ring}`}
                data-testid="temporal-finding"
                data-finding-type={finding.finding_type}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.accent}`}
                    aria-hidden="true"
                  >
                    <FindingIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{componentLabel}</h3>
                      <Badge variant="secondary" className="bg-gray-100 text-gray-700 font-normal">
                        {meta.label}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`inline-flex items-center gap-1 border ${severity.className}`}
                      >
                        <SeverityIcon className="h-3 w-3" aria-hidden="true" />
                        {severity.label} severity
                      </Badge>
                    </div>

                    {/* Before / after dates — the temporal axis of the comparison. */}
                    <div
                      className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600"
                      data-testid="temporal-finding-dates"
                    >
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                        <CalendarClock className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                        <span className="text-gray-500">Earlier:</span>
                        <span className="font-medium text-gray-700">{formatDate(finding.earlier_date)}</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                        <CalendarClock className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                        <span className="text-gray-500">Later:</span>
                        <span className="font-medium text-gray-700">{formatDate(finding.later_date)}</span>
                      </span>
                    </div>

                    {finding.public_summary && (
                      <p className="mt-2 text-sm text-gray-700">{finding.public_summary}</p>
                    )}

                    <Badge
                      variant="outline"
                      className={`mt-3 inline-flex items-center gap-1 border ${reviewer.className}`}
                    >
                      <ReviewerIcon className="h-3 w-3" aria-hidden="true" />
                      {reviewer.label}
                    </Badge>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* Explicit "insufficient evidence / unable to compare" edge state. */}
      {inconclusive.length > 0 && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          data-testid="temporal-comparison-inconclusive"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500"
              aria-hidden="true"
            >
              <HelpCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-700">
                Insufficient evidence to compare
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {inconclusive.length === 1
                  ? 'One component could not be compared across time due to limited evidence.'
                  : `${inconclusive.length} components could not be compared across time due to limited evidence.`}
              </p>
              <ul className="mt-2 space-y-1">
                {inconclusive.map((finding, idx) => (
                  <li
                    key={`unable-${finding.component ?? 'component'}-${idx}`}
                    className="text-xs text-slate-600"
                    data-testid="temporal-finding-inconclusive"
                  >
                    <span className="font-medium text-slate-700">{formatComponent(finding.component)}</span>
                    {finding.public_summary ? <span className="text-slate-500"> — {finding.public_summary}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
