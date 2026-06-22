import { Badge } from '@/components/ui/badge'
import {
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  AlertTriangle,
  Clock,
  History,
  CheckCircle2,
  MessageSquareQuote,
  Info,
  FileSearch,
  type LucideIcon,
} from 'lucide-react'
import type {
  DisclosureConflict,
  DisclosureClassification,
  IntelligenceSeverity,
  IntelligenceReviewerState,
} from '@/types'

interface VehicleDisclosurePanelProps {
  conflicts: DisclosureConflict[]
}

interface ClassificationMeta {
  label: string
  icon: LucideIcon
  // Distinct icon + label per classification so meaning never depends on colour alone.
  className: string
  ring: string
}

// Neutral, non-accusatory labels mirroring the backend classification vocabulary.
const CLASSIFICATION_META: Record<DisclosureClassification, ClassificationMeta> = {
  supported: { label: 'Supported by evidence', icon: ShieldCheck, className: 'bg-green-100 text-green-800 border-green-200', ring: 'border-green-200' },
  not_verifiable: { label: 'Not verifiable', icon: ShieldQuestion, className: 'bg-gray-100 text-gray-700 border-gray-200', ring: 'border-gray-200' },
  possible_conflict: { label: 'Possible conflict', icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 border-amber-200', ring: 'border-amber-200' },
  strong_conflict: { label: 'Strong conflict', icon: ShieldAlert, className: 'bg-red-100 text-red-800 border-red-200', ring: 'border-red-200' },
  outdated_claim: { label: 'Outdated claim', icon: History, className: 'bg-slate-100 text-slate-700 border-slate-200', ring: 'border-slate-200' },
  resolved_corrected: { label: 'Resolved / corrected', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-800 border-emerald-200', ring: 'border-emerald-200' },
}

const FALLBACK_CLASSIFICATION_META: ClassificationMeta = {
  label: 'Reviewed claim',
  icon: FileSearch,
  className: 'bg-gray-100 text-gray-700 border-gray-200',
  ring: 'border-gray-200',
}

interface SeverityMeta {
  label: string
  icon: LucideIcon
  className: string
}

// Severity carries both an icon and a label so it is never colour-only.
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
  confirmed: { label: 'Reviewer confirmed', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-200' },
  pending_review: { label: 'Pending reviewer confirmation', icon: Clock, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  dismissed: { label: 'Reviewer dismissed', icon: ShieldQuestion, className: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const FALLBACK_REVIEWER_STATE_META: ReviewerStateMeta = REVIEWER_STATE_META.pending_review

function classificationMetaFor(value: string): ClassificationMeta {
  return (CLASSIFICATION_META as Record<string, ClassificationMeta>)[value] ?? FALLBACK_CLASSIFICATION_META
}
function severityMetaFor(value: string): SeverityMeta {
  return (SEVERITY_META as Record<string, SeverityMeta>)[value] ?? FALLBACK_SEVERITY_META
}
function reviewerStateMetaFor(value: string): ReviewerStateMeta {
  return (REVIEWER_STATE_META as Record<string, ReviewerStateMeta>)[value] ?? FALLBACK_REVIEWER_STATE_META
}

function formatConflictType(value: string | null): string {
  if (!value) return 'Disclosure claim'
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

export default function VehicleDisclosurePanel({ conflicts }: VehicleDisclosurePanelProps) {
  // Empty state: the common, expected case for most buyer-facing vehicles. It must
  // read as reassuring/neutral and must NOT imply anything is wrong.
  if (conflicts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400" data-testid="disclosure-panel-empty">
        <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
        <p className="font-medium">No confirmed disclosure conflicts</p>
        <p className="text-xs mt-1">
          No reviewer-confirmed conflicts between the seller's disclosures and available evidence.
        </p>
      </div>
    )
  }

  return (
    <ol className="space-y-4" data-testid="disclosure-panel">
      {conflicts.map((conflict, idx) => {
        const classification = classificationMetaFor(conflict.classification)
        const severity = severityMetaFor(conflict.severity)
        const reviewer = reviewerStateMetaFor(conflict.reviewer_state)
        const ClassificationIcon = classification.icon
        const SeverityIcon = severity.icon
        const ReviewerIcon = reviewer.icon

        return (
          <li
            key={`${conflict.conflict_type ?? 'claim'}-${conflict.classification}-${idx}`}
            className={`rounded-xl border bg-white p-4 shadow-sm ${classification.ring}`}
            data-testid="disclosure-conflict"
            data-classification={conflict.classification}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${classification.className}`}
                aria-hidden="true"
              >
                <ClassificationIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {formatConflictType(conflict.conflict_type)}
                  </h3>
                  <Badge
                    variant="outline"
                    className={`inline-flex items-center gap-1 border ${classification.className}`}
                  >
                    <ClassificationIcon className="h-3 w-3" aria-hidden="true" />
                    {classification.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`inline-flex items-center gap-1 border ${severity.className}`}
                  >
                    <SeverityIcon className="h-3 w-3" aria-hidden="true" />
                    {severity.label} severity
                  </Badge>
                </div>

                {conflict.public_summary && (
                  <p className="mt-2 text-sm text-gray-700">{conflict.public_summary}</p>
                )}

                {conflict.seller_response && (
                  <div
                    className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                    data-testid="disclosure-seller-response"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                      <MessageSquareQuote className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                      Seller response
                    </div>
                    <p className="mt-1 text-sm text-gray-700">{conflict.seller_response}</p>
                  </div>
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
  )
}
