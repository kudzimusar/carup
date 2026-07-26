import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  ClipboardList,
  Download,
  FileText,
  History,
  Loader2,
  Lock,
  PauseCircle,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  StickyNote,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type {
  DiasporaWorkbookOperatorBatchSummary,
  DiasporaWorkbookOperatorDashboard,
  DiasporaWorkbookOperatorDashboardFilters,
  DiasporaWorkbookOperatorDashboardItem,
} from '@/types'

const allowedOperatorRoles = new Set([
  'admin',
  'platform_admin',
  'super_admin',
  'government',
  'government_reviewer',
  'reviewer',
])

const forbiddenExecutionActions = new Set([
  'EXECUTE_LIVE_IMPORT',
  'EXECUTE_AI',
  'RELEASE_PAYMENT',
  'OVERWRITE_STOCK',
  'ROLLBACK_DRAFTS',
  'RETRY_DRAFT_IMPORT',
])

const filterBooleanOptions = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

const explicitGuardrails = [
  { id: 'diaspora-workbook-live-import-blocked', label: 'Live import is not available.', action: 'EXECUTE_LIVE_IMPORT' },
  { id: 'diaspora-workbook-retry-execution-blocked', label: 'Retry execution is not available.', action: 'RETRY_DRAFT_IMPORT' },
  { id: 'diaspora-workbook-rollback-blocked', label: 'Rollback execution is not available.', action: 'ROLLBACK_DRAFTS' },
  { id: 'diaspora-workbook-ai-execution-blocked', label: 'AI execution is not available.', action: 'EXECUTE_AI' },
  { id: 'diaspora-workbook-drive-blocked', label: 'Drive/OAuth is not available.', action: 'DRIVE_OAUTH' },
]

function labelize(value?: string | null) {
  if (!value) return 'Not set'
  return value
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not recorded'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function safeTotals(value: unknown): Record<string, number> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {}
}

function planTotals(summary: DiasporaWorkbookOperatorBatchSummary | null) {
  const totals = summary?.plan?.totals
  return totals && typeof totals === 'object' ? totals as Record<string, unknown> : {}
}

function compactValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (Array.isArray(value)) return String(value.length)
  return JSON.stringify(value)
}

function SummaryMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-h-20 rounded-md border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-950">{compactValue(value)}</p>
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const statusUpper = (status || '').toUpperCase()
  const tone = statusUpper.includes('FAILED') || statusUpper === 'BLOCKED'
    ? 'bg-red-100 text-red-800 hover:bg-red-100'
    : statusUpper.includes('READY') || statusUpper.includes('IMPORTED')
      ? 'bg-green-100 text-green-800 hover:bg-green-100'
      : 'bg-amber-100 text-amber-800 hover:bg-amber-100'

  return (
    <Badge className={tone} data-testid="diaspora-workbook-status-badge">
      {labelize(status || 'unknown')}
    </Badge>
  )
}

function RiskBadge({ riskLevel }: { riskLevel?: string }) {
  const highRisk = (riskLevel || '').toUpperCase() === 'HIGH'
  return (
    <Badge
      className={highRisk ? 'bg-red-100 text-red-800 hover:bg-red-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-100'}
      data-testid="diaspora-workbook-risk-level"
    >
      {labelize(riskLevel || 'low')} risk
    </Badge>
  )
}

function BooleanFilter({
  id,
  label,
  value,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs font-medium text-gray-600">
      {label}
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
        data-testid={testId}
      >
        {filterBooleanOptions.map(option => (
          <option key={option.value || 'any'} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function buildFilters(filters: Record<string, string>): DiasporaWorkbookOperatorDashboardFilters {
  return {
    status: filters.status || undefined,
    needsReview: filters.needsReview || undefined,
    hasFailures: filters.hasFailures || undefined,
    hasRetryableRows: filters.hasRetryableRows || undefined,
    held: filters.held || undefined,
    limit: 50,
  }
}

function DashboardTable({
  items,
  selectedBatchId,
  onSelect,
}: {
  items: DiasporaWorkbookOperatorDashboardItem[];
  selectedBatchId: string;
  onSelect: (batchId: string) => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white" data-testid="diaspora-workbook-dashboard-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rows</TableHead>
            <TableHead>Review</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Next</TableHead>
            <TableHead className="w-24">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-gray-500">
                No workbook batches found.
              </TableCell>
            </TableRow>
          ) : items.map((item, index) => {
            const batchId = item.batchId || `missing-batch-${index + 1}`
            return (
              <TableRow
                key={batchId}
                data-testid="diaspora-workbook-dashboard-row"
                className={selectedBatchId === batchId ? 'bg-orange-50/70' : ''}
              >
                <TableCell>
                  <div className="min-w-48">
                    <p className="font-medium text-gray-950">{item.batchId || 'Batch ID missing'}</p>
                    <p className="text-xs text-gray-500">{labelize(item.templateType)} · {formatDateTime(item.createdAt)}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.importStatus} />
                    {item.held && (
                      <Badge className="bg-slate-900 text-white hover:bg-slate-900" data-testid="diaspora-workbook-held-badge">
                        Held
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-gray-700">
                    <p>{numberValue(item.totalRows)} total</p>
                    <p className="text-xs text-gray-500">
                      {numberValue(item.acceptedRows)} accepted · {numberValue(item.rejectedRows)} rejected
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {item.needsReview && <Badge variant="outline">Needs review</Badge>}
                    {item.hasFailures && <Badge variant="outline">Failures</Badge>}
                    {item.hasRetryableRows && <Badge variant="outline">Retryable</Badge>}
                  </div>
                </TableCell>
                <TableCell><RiskBadge riskLevel={item.riskLevel} /></TableCell>
                <TableCell>
                  <span className="text-sm font-medium text-gray-800" data-testid="diaspora-workbook-next-action">
                    {labelize(item.nextRecommendedAction)}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant={selectedBatchId === batchId ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onSelect(batchId)}
                    disabled={!item.batchId}
                    data-testid="diaspora-workbook-batch-select"
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function BatchSummaryPanel({ summary }: { summary: DiasporaWorkbookOperatorBatchSummary | null }) {
  if (!summary?.batch) {
    return (
      <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-batch-summary">
        <p className="text-sm text-gray-500">Select a batch to inspect workbook review state.</p>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-batch-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-600" />
            <h2 className="text-lg font-semibold text-gray-950">Batch summary</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">{summary.batch.id} · {labelize(summary.batch.templateType)}</p>
        </div>
        <StatusBadge status={summary.batch.importStatus} />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryMetric label="Total rows" value={summary.batch.totalRows} />
        <SummaryMetric label="Accepted" value={summary.batch.acceptedRows} />
        <SummaryMetric label="Rejected" value={summary.batch.rejectedRows} />
        <SummaryMetric label="Warnings" value={summary.batch.warningCount} />
        <SummaryMetric label="Errors" value={summary.batch.errorCount} />
      </div>
    </section>
  )
}

function PlanSummaryPanel({ summary }: { summary: DiasporaWorkbookOperatorBatchSummary | null }) {
  const totals = planTotals(summary)
  const blockedReason = summary?.plan?.blockedReason
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-plan-summary">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-semibold text-gray-950">Plan summary</h2>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label="Planned actions" value={totals.plannedActions} />
        <SummaryMetric label="Blocked actions" value={totals.blockedActions} />
        <SummaryMetric label="Requires review" value={totals.requiresReview} />
        <SummaryMetric label="Requires approval" value={totals.requiresApproval} />
      </div>
      {Boolean(blockedReason) && (
        <p className="mt-4 text-sm text-gray-600">{labelize(String(blockedReason))}</p>
      )}
    </section>
  )
}

function AuditSummaryPanel({ summary }: { summary: DiasporaWorkbookOperatorBatchSummary | null }) {
  const totals = summary?.audit?.totals || {}
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-audit-summary">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-semibold text-gray-950">Execution audit</h2>
      </div>
      {summary?.audit ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric label="Created drafts" value={totals.createdRows} />
          <SummaryMetric label="Failed rows" value={totals.failedRows} />
          <SummaryMetric label="Blocked rows" value={totals.blockedRows} />
          <SummaryMetric label="Retryable rows" value={totals.retryableRows} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">No draft execution audit is attached to this batch.</p>
      )}
    </section>
  )
}

function RetryPlanPanel({ summary }: { summary: DiasporaWorkbookOperatorBatchSummary | null }) {
  const retryPlan = summary?.retryPlan
  const totals = retryPlan?.totals || {}
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-retry-plan">
      <div className="flex items-center gap-2">
        <Lock className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-gray-950">Retry plan</h2>
      </div>
      {retryPlan ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric label="Can retry" value={retryPlan.canRetry} />
            <SummaryMetric label="Retryable" value={totals.retryableRows} />
            <SummaryMetric label="Blocked" value={totals.blockedRows} />
            <SummaryMetric label="Failures" value={totals.failedRows} />
          </div>
          {retryPlan.reason && <p className="text-sm text-gray-600">{labelize(retryPlan.reason)}</p>}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">No retry plan is available for this batch.</p>
      )}
    </section>
  )
}

function ActionsPanel({ summary }: { summary: DiasporaWorkbookOperatorBatchSummary | null }) {
  const nextActions = safeArray(summary?.operator?.nextActions)
  const forbiddenActions = safeArray(summary?.operator?.forbiddenActions)
  const warnings = safeArray(summary?.operator?.warnings)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-next-actions">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-green-700" />
          <h2 className="text-lg font-semibold text-gray-950">Next actions</h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {nextActions.length === 0 ? (
            <span className="text-sm text-gray-500">No next actions available.</span>
          ) : nextActions.map(action => (
            <Badge key={action} variant="outline" data-testid="diaspora-workbook-next-action">
              {labelize(action)}
            </Badge>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {warnings.map(warning => (
              <Alert key={warning} className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-900">{warning}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-forbidden-actions">
        <div className="flex items-center gap-2">
          <Ban className="h-5 w-5 text-red-700" />
          <h2 className="text-lg font-semibold text-gray-950">Blocked actions</h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {explicitGuardrails.map(guardrail => (
            <span
              key={guardrail.id}
              className="inline-flex min-h-8 items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800"
              data-testid={guardrail.id}
            >
              {guardrail.label}
            </span>
          ))}
          {forbiddenActions
            .filter(action => !explicitGuardrails.some(guardrail => guardrail.action === action))
            .map(action => (
              <span
                key={action}
                className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                  forbiddenExecutionActions.has(action) ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {labelize(action)}
              </span>
            ))}
        </div>
      </section>
    </div>
  )
}

function NotesPanel({
  summary,
  noteText,
  noteError,
  submitting,
  onNoteChange,
  onSubmit,
}: {
  summary: DiasporaWorkbookOperatorBatchSummary | null;
  noteText: string;
  noteError: string;
  submitting: boolean;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const notes = safeArray(summary?.operator?.notes)
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-notes-panel">
      <div className="flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-semibold text-gray-950">Operator notes</h2>
      </div>
      <div className="mt-4 space-y-3">
        <Textarea
          value={noteText}
          onChange={event => onNoteChange(event.target.value)}
          placeholder="Add an internal operator note"
          maxLength={2000}
          data-testid="diaspora-workbook-note-input"
        />
        {noteError && (
          <p className="text-sm font-medium text-red-700" data-testid="diaspora-workbook-note-error">{noteError}</p>
        )}
        {submitting && (
          <p className="flex items-center gap-2 text-sm font-medium text-orange-700" data-testid="diaspora-workbook-note-loading">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving operator note...
          </p>
        )}
        <Button type="button" onClick={onSubmit} disabled={submitting || !summary?.batch?.id} data-testid="diaspora-workbook-note-submit">
          {submitting ? 'Saving...' : 'Add note'}
        </Button>
      </div>
      <div className="mt-5 divide-y divide-gray-100">
        {notes.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">No operator notes recorded.</p>
        ) : notes.map(note => (
          <div key={note.id || note.createdAt || note.note} className="py-3" data-testid="diaspora-workbook-note-row">
            <p className="text-sm text-gray-900">{note.note}</p>
            <p className="mt-1 text-xs text-gray-500">{labelize(note.role)} · {formatDateTime(note.createdAt)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function HoldPanel({
  summary,
  holdReason,
  holdError,
  submitting,
  onHoldReasonChange,
  onPlaceHold,
  onClearHold,
}: {
  summary: DiasporaWorkbookOperatorBatchSummary | null;
  holdReason: string;
  holdError: string;
  submitting: boolean;
  onHoldReasonChange: (value: string) => void;
  onPlaceHold: () => void;
  onClearHold: () => void;
}) {
  const held = summary?.operator?.held
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-hold-panel">
      <div className="flex items-center gap-2">
        <PauseCircle className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-gray-950">Operator hold</h2>
      </div>

      {held && (
        <Alert className="mt-4 border-slate-300 bg-slate-50" data-testid="diaspora-workbook-active-hold-warning">
          <PauseCircle className="h-4 w-4 text-slate-700" />
          <AlertTitle>Batch is held</AlertTitle>
          <AlertDescription>{summary?.operator?.holdReason || 'No hold reason recorded.'}</AlertDescription>
        </Alert>
      )}

      <div className="mt-4 space-y-3">
        <Input
          value={holdReason}
          onChange={event => onHoldReasonChange(event.target.value)}
          placeholder="Reason for hold"
          data-testid="diaspora-workbook-hold-reason"
        />
        {holdError && <p className="text-sm font-medium text-red-700" data-testid="diaspora-workbook-hold-error">{holdError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPlaceHold}
            disabled={submitting || !summary?.batch?.id}
            data-testid="diaspora-workbook-place-hold"
          >
            Place hold
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClearHold}
            disabled={submitting || !summary?.batch?.id || !held}
            data-testid="diaspora-workbook-clear-hold"
          >
            Clear hold
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function DiasporaWorkbookOperatorConsole() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const {
    fetchDiasporaWorkbookOperatorDashboard,
    fetchDiasporaWorkbookOperatorBatchSummary,
    addDiasporaWorkbookOperatorNote,
    setDiasporaWorkbookOperatorHold,
    clearDiasporaWorkbookOperatorHold,
    downloadDiasporaWorkbookDbExport,
  } = useCarUpApi()

  const [exportType, setExportType] = useState('enterprise')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const [filters, setFilters] = useState({
    status: '',
    needsReview: '',
    hasFailures: '',
    hasRetryableRows: '',
    held: '',
  })
  const [dashboard, setDashboard] = useState<DiasporaWorkbookOperatorDashboard>({ items: [] })
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [summary, setSummary] = useState<DiasporaWorkbookOperatorBatchSummary | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteError, setNoteError] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [holdError, setHoldError] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)
  const [submittingHold, setSubmittingHold] = useState(false)
  const submittingNoteRef = useRef(false)
  const submittingHoldRef = useRef(false)

  const canView = useMemo(() => (
    isAuthenticated && allowedOperatorRoles.has((user?.role || '').toLowerCase())
  ), [isAuthenticated, user?.role])

  const dashboardItems = safeArray(dashboard.items)
  const dashboardTotals = safeTotals(dashboard.totals)

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({
      status: '',
      needsReview: '',
      hasFailures: '',
      hasRetryableRows: '',
      held: '',
    })
  }

  const loadDashboard = useCallback(async () => {
    if (!canView) return
    setDashboardLoading(true)
    setDashboardError('')
    try {
      const result = await fetchDiasporaWorkbookOperatorDashboard(buildFilters(filters))
      const safeResult = result && typeof result === 'object' ? result : { items: [] }
      const items = safeArray(safeResult.items)
      setDashboard({
        ...safeResult,
        items,
        totals: safeTotals(safeResult.totals),
      })
      setSelectedBatchId(current => {
        if (current && items.some(item => item.batchId === current)) return current
        return items[0]?.batchId || ''
      })
    } catch (err) {
      setDashboard({ items: [] })
      setSelectedBatchId('')
      setSummary(null)
      setDashboardError(err instanceof Error ? err.message : 'Unable to load operator dashboard.')
    } finally {
      setDashboardLoading(false)
    }
  }, [canView, fetchDiasporaWorkbookOperatorDashboard, filters])

  const loadSummary = useCallback(async (batchId: string) => {
    if (!canView || !batchId) {
      setSummary(null)
      return
    }
    setSummaryLoading(true)
    setSummaryError('')
    try {
      const result = await fetchDiasporaWorkbookOperatorBatchSummary(batchId)
      setSummary(result && typeof result === 'object' ? result : null)
    } catch (err) {
      setSummary(null)
      setSummaryError(err instanceof Error ? err.message : 'Unable to load batch summary.')
    } finally {
      setSummaryLoading(false)
    }
  }, [canView, fetchDiasporaWorkbookOperatorBatchSummary])

  useEffect(() => {
    if (authLoading || !canView) return
    const timeoutId = window.setTimeout(() => {
      void loadDashboard()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [authLoading, canView, loadDashboard])

  useEffect(() => {
    if (authLoading || !canView || !selectedBatchId) return
    const timeoutId = window.setTimeout(() => {
      void loadSummary(selectedBatchId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [authLoading, canView, selectedBatchId, loadSummary])

  const submitNote = async () => {
    if (submittingNoteRef.current) return
    const trimmed = noteText.trim()
    if (!trimmed) {
      setNoteError('Operator note text is required.')
      return
    }
    if (trimmed.length > 2000) {
      setNoteError('Operator note must not exceed 2000 characters.')
      return
    }
    if (!summary?.batch?.id) return
    submittingNoteRef.current = true
    setSubmittingNote(true)
    setNoteError('')
    try {
      await addDiasporaWorkbookOperatorNote(summary.batch.id, trimmed)
      setNoteText('')
      await Promise.all([loadSummary(summary.batch.id), loadDashboard()])
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Unable to save operator note.')
    } finally {
      submittingNoteRef.current = false
      setSubmittingNote(false)
    }
  }

  const placeHold = async () => {
    if (submittingHoldRef.current) return
    const reason = holdReason.trim()
    if (!reason) {
      setHoldError('Hold reason is required.')
      return
    }
    if (!summary?.batch?.id) return
    submittingHoldRef.current = true
    setSubmittingHold(true)
    setHoldError('')
    try {
      await setDiasporaWorkbookOperatorHold(summary.batch.id, reason)
      setHoldReason('')
      await Promise.all([loadSummary(summary.batch.id), loadDashboard()])
    } catch (err) {
      setHoldError(err instanceof Error ? err.message : 'Unable to place operator hold.')
    } finally {
      submittingHoldRef.current = false
      setSubmittingHold(false)
    }
  }

  const clearHold = async () => {
    if (submittingHoldRef.current) return
    if (!summary?.batch?.id) return
    submittingHoldRef.current = true
    setSubmittingHold(true)
    setHoldError('')
    try {
      await clearDiasporaWorkbookOperatorHold(summary.batch.id)
      await Promise.all([loadSummary(summary.batch.id), loadDashboard()])
    } catch (err) {
      setHoldError(err instanceof Error ? err.message : 'Unable to clear operator hold.')
    } finally {
      submittingHoldRef.current = false
      setSubmittingHold(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-orange-600" data-testid="diaspora-workbook-console-loading">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8" data-testid="diaspora-workbook-console-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>Workbook operator console access requires an authorized reviewer role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-workbook-console-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 text-2xl font-semibold text-gray-950">Workbook operator console</h1>
          <p className="mt-1 text-sm text-gray-500">Dry-run batches, draft planning state, operator holds, and audit visibility.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default" data-testid="diaspora-workbook-new-dry-run-link">
            <Link to="/admin/diaspora/workbooks/new">
              <PlusCircle className="h-4 w-4" />
              New Dry Run
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={loadDashboard} disabled={dashboardLoading} data-testid="diaspora-workbook-dashboard-refresh">
            <RefreshCw className={`mr-2 h-4 w-4 ${dashboardLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-2" data-testid="diaspora-workbook-db-export">
            <select
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={exportType}
              onChange={event => setExportType(event.target.value)}
              aria-label="Export template type"
              data-testid="diaspora-workbook-db-export-type"
            >
              <option value="enterprise">Enterprise</option>
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={exporting}
              data-testid="diaspora-workbook-db-export-button"
              onClick={async () => {
                if (exporting) return
                setExporting(true)
                setExportError('')
                try {
                  await downloadDiasporaWorkbookDbExport(exportType)
                } catch (err) {
                  setExportError(err instanceof Error ? err.message : 'Export failed')
                } finally {
                  setExporting(false)
                }
              }}
            >
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export data (.xlsx)
            </Button>
          </div>
        </div>
      </div>
      {exportError && (
        <Alert className="mt-3 border-red-200" data-testid="diaspora-workbook-db-export-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-3 rounded-md border border-gray-200 bg-white p-4 md:grid-cols-3 xl:grid-cols-6">
        <label htmlFor="diaspora-workbook-status-filter" className="flex flex-col gap-1 text-xs font-medium text-gray-600 md:col-span-1 xl:col-span-2">
          Status
          <Input
            id="diaspora-workbook-status-filter"
            value={filters.status}
            onChange={event => updateFilter('status', event.target.value)}
            placeholder="READY_FOR_REVIEW"
            data-testid="diaspora-workbook-dashboard-filter-status"
          />
        </label>
        <BooleanFilter id="diaspora-workbook-needs-review-filter" label="Needs review" value={filters.needsReview} onChange={value => updateFilter('needsReview', value)} testId="diaspora-workbook-dashboard-filter-needs-review" />
        <BooleanFilter id="diaspora-workbook-failures-filter" label="Has failures" value={filters.hasFailures} onChange={value => updateFilter('hasFailures', value)} testId="diaspora-workbook-dashboard-filter-has-failures" />
        <BooleanFilter id="diaspora-workbook-retryable-filter" label="Has retryable" value={filters.hasRetryableRows} onChange={value => updateFilter('hasRetryableRows', value)} testId="diaspora-workbook-dashboard-filter-has-retryable" />
        <BooleanFilter id="diaspora-workbook-held-filter" label="Held" value={filters.held} onChange={value => updateFilter('held', value)} testId="diaspora-workbook-dashboard-filter-held" />
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={resetFilters}
            data-testid="diaspora-workbook-dashboard-reset-filters"
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          {dashboardError && (
            <Alert className="border-red-200 bg-red-50" data-testid="diaspora-workbook-dashboard-error">
              <AlertTriangle className="h-4 w-4 text-red-700" />
              <AlertTitle>Unable to load workbook batches</AlertTitle>
              <AlertDescription>{dashboardError}</AlertDescription>
            </Alert>
          )}

          {dashboardLoading ? (
            <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-orange-600" data-testid="diaspora-workbook-dashboard-loading">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mt-3 text-sm">Loading workbook batches...</p>
            </div>
          ) : !dashboardError && dashboardItems.length === 0 ? (
            <div className="rounded-md border border-gray-200 bg-white p-8 text-center" data-testid="diaspora-workbook-dashboard-empty">
              <ClipboardList className="mx-auto h-6 w-6 text-gray-400" />
              <p className="mt-3 text-sm font-medium text-gray-900">No workbook batches found.</p>
              <p className="mt-1 text-sm text-gray-500">Try clearing filters or refresh when new dry-run batches are available.</p>
            </div>
          ) : (
            <DashboardTable items={dashboardItems} selectedBatchId={selectedBatchId} onSelect={setSelectedBatchId} />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric label="Total batches" value={dashboardTotals.totalBatches} />
            <SummaryMetric label="Ready review" value={dashboardTotals.readyForReview} />
            <SummaryMetric label="Failed drafts" value={dashboardTotals.failedDraftImports} />
            <SummaryMetric label="Held" value={dashboardTotals.held} />
          </div>
        </div>

        <div className="space-y-4">
          {summaryError && (
            <Alert className="border-red-200 bg-red-50" data-testid="diaspora-workbook-batch-summary-error">
              <AlertTriangle className="h-4 w-4 text-red-700" />
              <AlertTitle>Unable to load selected batch</AlertTitle>
              <AlertDescription>{summaryError}</AlertDescription>
            </Alert>
          )}

          {summaryLoading ? (
            <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-orange-600" data-testid="diaspora-workbook-batch-summary-loading">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mt-3 text-sm">Loading batch summary...</p>
            </div>
          ) : (
            <>
              <BatchSummaryPanel summary={summary} />
              <PlanSummaryPanel summary={summary} />
              <AuditSummaryPanel summary={summary} />
              <RetryPlanPanel summary={summary} />
              <ActionsPanel summary={summary} />
              <NotesPanel
                summary={summary}
                noteText={noteText}
                noteError={noteError}
                submitting={submittingNote}
                onNoteChange={setNoteText}
                onSubmit={submitNote}
              />
              <HoldPanel
                summary={summary}
                holdReason={holdReason}
                holdError={holdError}
                submitting={submittingHold}
                onHoldReasonChange={setHoldReason}
                onPlaceHold={placeHold}
                onClearHold={clearHold}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
