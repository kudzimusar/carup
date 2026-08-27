import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import VehicleTemporalComparison from '@/components/VehicleTemporalComparison'
import VehicleDisclosurePanel from '@/components/VehicleDisclosurePanel'
import {
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  Clock,
  Car,
  Gauge,
  Tag,
  ClipboardList,
  ArrowLeftRight,
  Camera,
  Ship,
  Gavel,
  Wrench,
  CarFront,
  FileSearch,
  ListChecks,
  CircleSlash,
  type LucideIcon,
} from 'lucide-react'
import type {
  VehicleHistoryReportData,
  ReportKeyAlert,
  ReportTimelineItem,
  ReportMileageObservation,
  ReportListingSnapshot,
  IntelligenceSeverity,
} from '@/types'

interface VehicleHistoryReportProps {
  report: VehicleHistoryReportData
  /** Optional freshness metadata (present when rendering a shared/snapshotted version). */
  generatedAt?: string | null
  correctionNotice?: string | null
}

/* ── Shared severity meta — icon + text so status is never colour-only ─────── */
interface SeverityMeta {
  label: string
  icon: LucideIcon
  className: string
}

const SEVERITY_META: Record<IntelligenceSeverity, SeverityMeta> = {
  info: { label: 'Informational', icon: Info, className: 'bg-gray-100 text-gray-700 border-gray-200' },
  low: { label: 'Low', icon: Info, className: 'bg-blue-100 text-blue-800 border-blue-200' },
  medium: { label: 'Medium', icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  high: { label: 'High', icon: ShieldAlert, className: 'bg-red-100 text-red-800 border-red-200' },
  critical: { label: 'Critical', icon: ShieldAlert, className: 'bg-red-100 text-red-800 border-red-200' },
}
const FALLBACK_SEVERITY_META: SeverityMeta = SEVERITY_META.info
function severityMetaFor(value: string): SeverityMeta {
  return (SEVERITY_META as Record<string, SeverityMeta>)[value] ?? FALLBACK_SEVERITY_META
}

/* ── Formatting helpers ───────────────────────────────────────────────────── */
function titleCase(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback
  return String(value)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Date unknown'
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return 'Date unknown'
  return t.toLocaleDateString()
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return 'Unknown'
  return t.toLocaleString()
}

function formatMileage(value: number, unit: string): string {
  return `${value.toLocaleString()} ${unit || 'km'}`
}

function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(price)
  } catch {
    return `${currency || ''} ${price.toLocaleString()}`.trim()
  }
}

/* Verification status meta for the evidence index table (icon + text). */
const VERIFICATION_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  verified: { label: 'Verified', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-200' },
  pending: { label: 'Pending', icon: Clock, className: 'bg-amber-100 text-amber-800 border-amber-200' },
  rejected: { label: 'Rejected', icon: CircleSlash, className: 'bg-red-100 text-red-800 border-red-200' },
  disputed: { label: 'Disputed', icon: AlertTriangle, className: 'bg-orange-100 text-orange-800 border-orange-200' },
  superseded: { label: 'Superseded', icon: Clock, className: 'bg-gray-100 text-gray-700 border-gray-200' },
  recorded: { label: 'Recorded', icon: ClipboardList, className: 'bg-slate-100 text-slate-700 border-slate-200' },
  active: { label: 'Active', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-200' },
  seller_stated: { label: 'Seller stated', icon: Info, className: 'bg-blue-50 text-blue-800 border-blue-200' },
}
function verificationMetaFor(value: string | null) {
  return VERIFICATION_META[String(value ?? 'pending')] ?? VERIFICATION_META.pending
}

/* Section heading used consistently across the report. */
function SectionHeading({ icon: Icon, title, subtitle, id }: { icon: LucideIcon; title: string; subtitle?: string; id?: string }) {
  return (
    <div className="mb-3">
      <h3 id={id} className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <Icon className="h-5 w-5 text-gray-500" aria-hidden="true" />
        {title}
      </h3>
      {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
    </div>
  )
}

/* A reassuring, neutral empty state — absence of data must never read as "clean". */
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="text-center py-6 text-gray-400">
      <Icon className="w-9 h-9 mx-auto mb-2 opacity-30" aria-hidden="true" />
      <p className="font-medium text-sm">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  )
}

export default function VehicleHistoryReport({ report, generatedAt, correctionNotice }: VehicleHistoryReportProps) {
  const { identity, completeness, limitations, key_alerts, sections, mileage_history, listing_history, timeline, evidence_index, lifecycle_projection } = report

  const identityTitle = useMemo(() => {
    const parts = [identity?.year, identity?.make, identity?.model].filter(Boolean)
    return parts.length ? parts.join(' ') : 'Vehicle'
  }, [identity])

  const mileageCoverageState = completeness.mileage_coverage_state ?? mileage_history.coverage_state ?? 'complete'
  const inspectionCoverageIncomplete = completeness.classes_unavailable?.includes('inspection') ?? false
  const currentConditionUnavailable = completeness.current_condition_coverage === null

  const coverageItems: { label: string; value: string; ok: boolean }[] = [
    { label: 'Identity confirmed', value: completeness.identity_coverage ? 'Yes' : 'No', ok: !!completeness.identity_coverage },
    { label: 'Timeline coverage', value: `${Math.round((completeness.timeline_coverage || 0) * 100)}%`, ok: completeness.timeline_coverage >= 0.5 },
    {
      label: 'Mileage readings',
      value: mileageCoverageState === 'complete'
        ? (completeness.mileage_coverage ? 'Available' : 'None recorded')
        : mileageCoverageState === 'partial' ? 'Partial coverage' : 'Source unavailable',
      ok: mileageCoverageState === 'complete' && !!completeness.mileage_coverage,
    },
    {
      label: 'Lifecycle source coverage',
      value: completeness.lifecycle_source_coverage === undefined
        ? 'Not reported'
        : `${Math.round(completeness.lifecycle_source_coverage * 100)}%`,
      ok: completeness.lifecycle_source_coverage === 1,
    },
    { label: 'Source diversity', value: `${completeness.source_diversity} source${completeness.source_diversity === 1 ? '' : 's'}`, ok: completeness.source_diversity > 1 },
    {
      label: 'Latest inspection',
      value: completeness.inspection_recency
        ? formatDate(completeness.inspection_recency)
        : inspectionCoverageIncomplete ? 'Source incomplete' : 'None on record',
      ok: !!completeness.inspection_recency && !inspectionCoverageIncomplete,
    },
    {
      label: 'Current condition',
      value: currentConditionUnavailable
        ? 'Source incomplete'
        : completeness.current_condition_coverage ? 'Documented' : 'Not documented',
      ok: completeness.current_condition_coverage === 1,
    },
  ]

  const countDisplay = (category: string, fallback: number | null | undefined) => {
    const envelope = lifecycle_projection?.count_states?.[category]
    if (!envelope) return fallback === null || fallback === undefined ? 'Unavailable' : String(fallback)
    if (envelope.state === 'complete') return String(envelope.value)
    if (envelope.state === 'partial') return envelope.value > 0 ? `≥${envelope.value}` : 'Partial'
    return 'Unavailable'
  }

  const sectionCounts: { label: string; value: string; icon: LucideIcon }[] = [
    { label: 'Auction records', value: countDisplay('auction', sections.auction_import.auction), icon: Gavel },
    { label: 'Import records', value: countDisplay('import', sections.auction_import.import), icon: Ship },
    { label: 'Accident records', value: countDisplay('accident', sections.accident_repair.accident), icon: CarFront },
    { label: 'Repair records', value: countDisplay('repair', sections.accident_repair.repair), icon: Wrench },
    { label: 'Service records', value: countDisplay('service', sections.service), icon: Wrench },
    { label: 'Inspections', value: countDisplay('inspection', sections.inspection), icon: ClipboardList },
    { label: 'Ownership transfers', value: countDisplay('ownership_transfer', sections.ownership_transfer), icon: ArrowLeftRight },
    { label: 'Insurance records', value: countDisplay('insurance', sections.insurance), icon: ShieldAlert },
    { label: 'Registration records', value: countDisplay('registration', sections.registration), icon: FileSearch },
    { label: 'Clearance records', value: countDisplay('clearance', sections.clearance), icon: CheckCircle2 },
    { label: 'Current condition', value: countDisplay('current_condition', sections.current_condition), icon: Camera },
  ]

  return (
    <article className="space-y-8" aria-label={`Vehicle history report for ${identityTitle}`} data-testid="vehicle-history-report">
      {/* ── Identity summary + freshness note ── */}
      <header className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Vehicle History Report</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-gray-900">
              <Car className="h-5 w-5 text-gray-500" aria-hidden="true" />
              {identityTitle}
            </h2>
            <p className="mt-1 font-mono text-xs text-gray-500" data-testid="report-vin">
              VIN: {identity?.vin || report.vin || '—'}
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            {generatedAt ? (
              <p data-testid="report-generated-at">Generated {formatDateTime(generatedAt)}</p>
            ) : (
              <p>{report.generated_at_note || 'Reflects evidence held at the time of viewing.'}</p>
            )}
          </div>
        </div>

        {correctionNotice && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            data-testid="report-correction-notice"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Correction notice</p>
              <p className="mt-0.5">{correctionNotice}</p>
            </div>
          </div>
        )}
      </header>

      {/* ── Completeness + Limitations (prominent: missing data is never a clean bill) ── */}
      <section aria-labelledby="report-completeness-heading">
        <SectionHeading
          id="report-completeness-heading"
          icon={ListChecks}
          title="Report completeness"
          subtitle="What this report does and does not cover. Absence of records is not proof of a clean history."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-gray-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700">Coverage indicators</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2" data-testid="report-coverage">
                {coverageItems.map((item) => {
                  const StatusIcon = item.ok ? CheckCircle2 : AlertTriangle
                  return (
                    <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-gray-600">
                        <StatusIcon
                          className={`h-4 w-4 shrink-0 ${item.ok ? 'text-green-600' : 'text-amber-500'}`}
                          aria-hidden="true"
                        />
                        {item.label}
                      </span>
                      <span className="font-medium text-gray-800">{item.value}</span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Limitations rendered prominently with a warning treatment. */}
          <Card className="border-amber-300 bg-amber-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Limitations &amp; data not available
              </CardTitle>
            </CardHeader>
            <CardContent>
              {limitations.length === 0 ? (
                <p className="text-sm text-amber-800">No reporting limitations were recorded for this vehicle.</p>
              ) : (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-amber-900" data-testid="report-limitations">
                  {limitations.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Key alerts ── */}
      <section aria-labelledby="report-alerts-heading">
        <SectionHeading
          id="report-alerts-heading"
          icon={ShieldAlert}
          title="Key alerts"
          subtitle="Itemized, evidence-linked findings. Each alert is descriptive, not a verdict."
        />
        {key_alerts.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No key alerts"
            hint="No reviewer-confirmed alerts were raised from the evidence on record."
          />
        ) : (
          <ul className="space-y-3" data-testid="report-key-alerts">
            {key_alerts.map((alert: ReportKeyAlert, idx) => {
              const severity = severityMetaFor(alert.severity)
              const SeverityIcon = severity.icon
              const reviewed = alert.reviewed
              const ReviewIcon = reviewed ? CheckCircle2 : Clock
              const headline = titleCase(alert.type, titleCase(alert.category, 'Alert'))
              return (
                <li
                  key={`${alert.category}-${alert.type ?? 'alert'}-${idx}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  data-testid="report-key-alert"
                  data-alert-category={alert.category}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${severity.className}`}
                      aria-hidden="true"
                    >
                      <SeverityIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">{headline}</h4>
                        {alert.component && (
                          <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-700">
                            {titleCase(alert.component)}
                          </Badge>
                        )}
                        <Badge variant="outline" className={`inline-flex items-center gap-1 border ${severity.className}`}>
                          <SeverityIcon className="h-3 w-3" aria-hidden="true" />
                          {severity.label} severity
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`inline-flex items-center gap-1 border ${reviewed ? 'bg-green-100 text-green-800 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}
                        >
                          <ReviewIcon className="h-3 w-3" aria-hidden="true" />
                          {reviewed ? 'Reviewer confirmed' : 'Not yet reviewed'}
                        </Badge>
                      </div>

                      {/* Render summaries verbatim — do not paraphrase the backend's careful wording. */}
                      {alert.summary && <p className="mt-2 text-sm text-gray-700">{alert.summary}</p>}

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                          {alert.evidence_count} supporting item{alert.evidence_count === 1 ? '' : 's'}
                        </span>
                      </div>

                      {alert.recommended_action && (
                        <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">Recommended action: </span>
                          {alert.recommended_action}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Life-stage record counts ── */}
      <section aria-labelledby="report-sections-heading">
        <SectionHeading
          id="report-sections-heading"
          icon={ClipboardList}
          title="Records by life stage"
          subtitle="Count of canonical lifecycle records CarUp can currently support across evidence, ownership, maintenance, inspection, insurance and listing observations."
        />
        <div className="grid grid-cols-2 border-l border-t border-slate-200 sm:grid-cols-3 lg:grid-cols-4" data-testid="report-section-counts">
          {sectionCounts.map(({ label, value, icon: Icon }) => (
            <div key={label} className="border-b border-r border-slate-200 bg-white p-4 text-left">
              <Icon className="h-5 w-5 text-orange-500" aria-hidden="true" />
              <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Mileage history ── */}
      <section aria-labelledby="report-mileage-heading">
        <SectionHeading
          id="report-mileage-heading"
          icon={Gauge}
          title="Mileage history"
          subtitle="Odometer observations from evidence, maintenance, inspections, listing snapshots and the current seller-stated listing. Source labels distinguish observation from verification."
        />
        {mileage_history.anomaly && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            data-testid="report-mileage-anomaly"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Possible mileage inconsistency</p>
              <p className="mt-0.5">
                One or more later readings are lower than an earlier reading. Verify the odometer against
                service and inspection records before purchase.
              </p>
            </div>
          </div>
        )}
        {mileage_history.observations.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No mileage readings available"
            hint="Odometer history cannot be verified for this vehicle."
          />
        ) : (
          <ul className="space-y-2" data-testid="report-mileage-list">
            {mileage_history.observations.map((obs: ReportMileageObservation, idx) => (
              <li
                key={`${obs.source}-${obs.evidence_id ?? obs.listing_id ?? idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-800">{formatMileage(obs.value, obs.unit)}</span>
                <span className="text-xs text-gray-500">{formatDate(obs.date)}</span>
                <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-600">
                  {titleCase(obs.source, 'Source')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Listing history ── */}
      <section aria-labelledby="report-listings-heading">
        <SectionHeading
          id="report-listings-heading"
          icon={Tag}
          title="Listing history"
          subtitle="How this vehicle has been advertised over time — price, mileage and condition claims."
        />
        {listing_history.length === 0 ? (
          <EmptyState icon={Tag} title="No listing snapshots captured" hint="No advertised history is on record for this vehicle." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <Table data-testid="report-listing-history">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Captured</TableHead>
                  <TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">Price</TableHead>
                  <TableHead scope="col">Advertised mileage</TableHead>
                  <TableHead scope="col">Claimed condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listing_history.map((l: ReportListingSnapshot, idx) => (
                  <TableRow key={`${l.version ?? idx}-${l.captured_at ?? idx}`}>
                    <TableCell className="whitespace-nowrap text-xs text-gray-500">{formatDate(l.captured_at)}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{l.title || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{formatPrice(l.price, l.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.advertised_mileage != null ? formatMileage(l.advertised_mileage, 'km') : '—'}
                    </TableCell>
                    <TableCell>{titleCase(l.claimed_condition, '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Visual comparisons (reuse M3 component) ── */}
      <section aria-labelledby="report-visual-heading">
        <SectionHeading
          id="report-visual-heading"
          icon={Camera}
          title="Component changes over time"
          subtitle="Reviewer-confirmed before/after comparisons of vehicle components."
        />
        <VehicleTemporalComparison findings={report.visual_comparisons} />
      </section>

      {/* ── Disclosure review (reuse M3 component) ── */}
      <section aria-labelledby="report-disclosure-heading">
        <SectionHeading
          id="report-disclosure-heading"
          icon={FileSearch}
          title="Disclosure review"
          subtitle="How the seller's disclosures compare against available evidence, as confirmed by a reviewer."
        />
        <VehicleDisclosurePanel conflicts={report.disclosure} />
      </section>

      {/* ── Life timeline (chronological evidence rows) ── */}
      <section aria-labelledby="report-timeline-heading">
        <SectionHeading
          id="report-timeline-heading"
          icon={Clock}
          title="Life timeline"
          subtitle="Chronological lifecycle events from the same canonical projection used by the report counts and mileage history."
        />
        {timeline.length === 0 ? (
          <EmptyState icon={Clock} title="No dated evidence yet" hint="As dated evidence is added, it appears here in order." />
        ) : (
          <ol className="space-y-2" data-testid="report-timeline">
            {timeline.map((item: ReportTimelineItem, idx) => {
              const statusMeta = verificationMetaFor(item.verification_status)
              const StatusIcon = statusMeta.icon
              return (
                <li
                  key={`${item.evidence_id}-${idx}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-gray-700">{formatDate(item.date)}</span>
                  <span className="text-gray-600">{titleCase(item.evidence_class, 'Record')}</span>
                  {item.evidence_subtype && <span className="text-xs text-gray-500">{titleCase(item.evidence_subtype)}</span>}
                  {typeof item.mileage === 'number' && (
                    <span className="text-xs font-semibold text-slate-600">{formatMileage(item.mileage, item.mileage_unit || 'km')}</span>
                  )}
                  {item.source_kind && (
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">{titleCase(item.source_kind)}</span>
                  )}
                  <Badge variant="outline" className={`ml-auto inline-flex items-center gap-1 border ${statusMeta.className}`}>
                    <StatusIcon className="h-3 w-3" aria-hidden="true" />
                    {statusMeta.label}
                  </Badge>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* ── Evidence / source index ── */}
      <section aria-labelledby="report-evidence-heading">
        <SectionHeading
          id="report-evidence-heading"
          icon={FileSearch}
          title="Evidence &amp; source index"
          subtitle="Every record this report is built from, with its source and verification status."
        />
        {evidence_index.length === 0 ? (
          <EmptyState icon={FileSearch} title="No evidence on record" hint="This report is built from no evidence items yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <Table data-testid="report-evidence-index">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Stage</TableHead>
                  <TableHead scope="col">Subtype</TableHead>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col">Source</TableHead>
                  <TableHead scope="col">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidence_index.map((item: ReportTimelineItem, idx) => {
                  const statusMeta = verificationMetaFor(item.verification_status)
                  const StatusIcon = statusMeta.icon
                  return (
                    <TableRow key={`${item.evidence_id}-${idx}`}>
                      <TableCell>{titleCase(item.evidence_class, '—')}</TableCell>
                      <TableCell>{titleCase(item.evidence_subtype, '—')}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-gray-500">{formatDate(item.date)}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{item.source_id || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`inline-flex items-center gap-1 border ${statusMeta.className}`}>
                          <StatusIcon className="h-3 w-3" aria-hidden="true" />
                          {statusMeta.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </article>
  )
}
