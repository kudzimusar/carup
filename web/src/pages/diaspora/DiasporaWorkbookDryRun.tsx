import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  DiasporaWorkbookDryRunFinding,
  DiasporaWorkbookDryRunResult,
  DiasporaWorkbookDryRunSheetSummary,
  DiasporaWorkbookTemplateDefinition,
  DiasporaWorkbookTemplateDownloadStatus,
  DiasporaWorkbookTemplateSchema,
} from '@/types'

const allowedOperatorRoles = new Set([
  'admin',
  'platform_admin',
  'super_admin',
  'government',
  'government_reviewer',
  'reviewer',
])

const fallbackTemplates: DiasporaWorkbookTemplateDefinition[] = [
  { templateType: 'buyer', sheets: [] },
  { templateType: 'seller', sheets: [] },
  { templateType: 'enterprise', sheets: [] },
]

interface WorkbookSource {
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

interface ParsedWorkbook {
  sheets: Record<string, Array<Record<string, unknown>>>;
  source: WorkbookSource;
}

function labelize(value?: string | null) {
  if (!value) return 'Not set'
  return value
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function compactValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  return JSON.stringify(value)
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeJsonWorkbook(text: string, source: WorkbookSource): { parsed?: ParsedWorkbook; error?: string } {
  if (!text.trim()) return { error: 'JSON workbook input is empty.' }

  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { error: 'Invalid JSON workbook payload.' }
  }

  if (Array.isArray(root)) return { error: 'Workbook JSON must be an object, not an array.' }
  if (!isObjectRecord(root)) return { error: 'Workbook JSON must be an object.' }

  const workbookCandidate = root.sheets ?? root.workbook
  if (!isObjectRecord(workbookCandidate)) {
    return { error: 'Workbook JSON must include a sheets object or workbook object.' }
  }

  const sheets: Record<string, Array<Record<string, unknown>>> = {}
  for (const [sheetName, rows] of Object.entries(workbookCandidate)) {
    if (!Array.isArray(rows)) {
      return { error: `${sheetName} must be an array of row objects.` }
    }
    sheets[sheetName] = rows.map(row => isObjectRecord(row) ? row : { value: row })
  }

  return { parsed: { sheets, source } }
}

function requiredSheetNames(schema: DiasporaWorkbookTemplateSchema | null) {
  return Array.isArray(schema?.sheets) ? schema.sheets.map(sheet => sheet.sheetName).filter(Boolean) : []
}

function totalRows(sheets: Record<string, Array<Record<string, unknown>>> | null) {
  if (!sheets) return 0
  return Object.values(sheets).reduce((sum, rows) => sum + rows.length, 0)
}

function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function Metric({ label, value, testId }: { label: string; value: unknown; testId?: string }) {
  return (
    <div className="min-h-20 rounded-md border border-gray-200 bg-white px-4 py-3" data-testid={testId}>
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-950">{compactValue(value)}</p>
    </div>
  )
}

function TemplateSchemaPanel({
  schema,
  supportedTemplates,
}: {
  schema: DiasporaWorkbookTemplateSchema | null;
  supportedTemplates: DiasporaWorkbookTemplateDefinition[];
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-template-schema">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-semibold text-gray-950">Template schema</h2>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {supportedTemplates.map(template => (
          <Badge key={template.templateType} variant="outline">
            {labelize(template.templateType)}
          </Badge>
        ))}
      </div>

      {schema ? (
        <div className="mt-5 space-y-4">
          {schema.sheets.map(sheet => (
            <div key={sheet.sheetName} className="rounded-md border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-950">{sheet.sheetName}</h3>
                  {sheet.description && <p className="mt-1 text-sm text-gray-500">{sheet.description}</p>}
                </div>
                {sheet.apiTable && <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{sheet.apiTable}</Badge>}
              </div>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <p className="font-medium text-gray-700">Primary key</p>
                  <p className="mt-1 text-gray-600">{sheet.primaryKey || 'Not set'}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Required columns</p>
                  <p className="mt-1 text-gray-600">{(sheet.requiredColumns || []).join(', ') || 'None'}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Target table</p>
                  <p className="mt-1 text-gray-600">{sheet.apiTable || 'Review-only'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">Select a template to load its schema.</p>
      )}
    </section>
  )
}

function PreviewPanel({
  parsedWorkbook,
  schema,
}: {
  parsedWorkbook: ParsedWorkbook | null;
  schema: DiasporaWorkbookTemplateSchema | null;
}) {
  const requiredSheets = requiredSheetNames(schema)
  const sheetNames = parsedWorkbook ? Object.keys(parsedWorkbook.sheets) : []
  const missingSheets = requiredSheets.filter(sheetName => !sheetNames.includes(sheetName))
  const unexpectedSheets = sheetNames.filter(sheetName => !requiredSheets.includes(sheetName))

  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-preview">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-orange-600" />
        <h2 className="text-lg font-semibold text-gray-950">Preview</h2>
      </div>
      {parsedWorkbook ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Source filename" value={parsedWorkbook.source.filename || 'Pasted JSON'} />
            <Metric label="File size" value={parsedWorkbook.source.sizeBytes === null ? 'Not recorded' : `${parsedWorkbook.source.sizeBytes} bytes`} />
            <Metric label="Sheet count" value={sheetNames.length} />
            <Metric label="Total rows" value={totalRows(parsedWorkbook.sheets)} testId="diaspora-workbook-preview-total-rows" />
          </div>
          <div className="rounded-md border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sheet</TableHead>
                  <TableHead>Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheetNames.map(sheetName => (
                  <TableRow key={sheetName} data-testid="diaspora-workbook-preview-sheet">
                    <TableCell className="font-medium">{sheetName}</TableCell>
                    <TableCell>{parsedWorkbook.sheets[sheetName]?.length || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Alert className={missingSheets.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'} data-testid="diaspora-workbook-preview-missing-sheets">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertTitle>Missing required sheets</AlertTitle>
              <AlertDescription>{missingSheets.length > 0 ? missingSheets.join(', ') : 'No required sheets are missing.'}</AlertDescription>
            </Alert>
            <Alert className={unexpectedSheets.length > 0 ? 'border-slate-200 bg-slate-50' : 'border-green-200 bg-green-50'}>
              <ShieldCheck className="h-4 w-4 text-slate-700" />
              <AlertTitle>Unexpected sheets</AlertTitle>
              <AlertDescription>{unexpectedSheets.length > 0 ? unexpectedSheets.join(', ') : 'No unexpected sheets found.'}</AlertDescription>
            </Alert>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">Paste JSON or choose a JSON file to preview workbook sheets before dry-run.</p>
      )}
    </section>
  )
}

function FindingsTable({
  title,
  findings,
  testId,
}: {
  title: string;
  findings: DiasporaWorkbookDryRunFinding[];
  testId: string;
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5" data-testid={testId}>
      <h3 className="text-base font-semibold text-gray-950">{title}</h3>
      <div className="mt-4 rounded-md border border-gray-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sheet</TableHead>
              <TableHead>Row</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {findings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-gray-500">No {title.toLowerCase()} returned.</TableCell>
              </TableRow>
            ) : findings.map((finding, index) => (
              <TableRow key={`${finding.sheetName || 'sheet'}-${finding.rowIndex || index}-${finding.code || index}`}>
                <TableCell>{finding.sheetName || 'Unknown sheet'}</TableCell>
                <TableCell>{finding.rowIndex ?? 'N/A'}</TableCell>
                <TableCell>{finding.code || 'N/A'}</TableCell>
                <TableCell>{finding.message || JSON.stringify(finding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function ResultsPanel({ result }: { result: DiasporaWorkbookDryRunResult }) {
  const persistence = result.persistence || {}
  const totals = result.totals || {}
  const summaries = Array.isArray(result.summaries) ? result.summaries : []
  const errors = Array.isArray(result.errors) ? result.errors : []
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  const batchId = persistence.batchId || ''

  return (
    <section className="space-y-4" data-testid="diaspora-workbook-dry-run-result">
      <div className="rounded-md border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-700" />
              <h2 className="text-lg font-semibold text-gray-950">Dry-run result</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">Validated for review and persisted for operator review. Live trade-table writes remain disabled.</p>
          </div>
          <Badge className={result.canImport ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-red-100 text-red-800 hover:bg-red-100'} data-testid="diaspora-workbook-dry-run-status">
            {result.canImport ? 'Validated for review' : 'Blocked by validation errors'}
          </Badge>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="diaspora-workbook-dry-run-totals">
          <Metric label="Dry-run ID" value={result.dryRunId || 'Not returned'} />
          <Metric label="Batch ID" value={batchId || 'Not persisted'} testId="diaspora-workbook-dry-run-batch-id" />
          <Metric label="Template" value={labelize(result.templateType)} />
          <Metric label="Can import" value={Boolean(result.canImport)} />
          <Metric label="Total rows" value={numberValue(totals.totalRows)} />
          <Metric label="Accepted rows" value={numberValue(totals.acceptedRows)} />
          <Metric label="Warning rows" value={numberValue(persistence.warningRows)} />
          <Metric label="Rejected rows" value={numberValue(persistence.rejectedRows)} />
          <Metric label="Total errors" value={numberValue(totals.errorCount)} />
          <Metric label="Total warnings" value={numberValue(totals.warningCount)} />
          <Metric label="Persistence" value={persistence.persisted ? 'Persisted' : 'Not persisted'} testId="diaspora-workbook-dry-run-persisted" />
          <Metric label="Import status" value={labelize(persistence.importStatus)} />
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-950">Sheet summaries</h3>
        <div className="mt-4 rounded-md border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sheet</TableHead>
                <TableHead>Target table</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Warnings</TableHead>
                <TableHead>Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((summary: DiasporaWorkbookDryRunSheetSummary) => (
                <TableRow key={summary.sheetName} data-testid="diaspora-workbook-dry-run-sheet-summary">
                  <TableCell className="font-medium">{summary.sheetName}</TableCell>
                  <TableCell>{summary.apiTable || 'Review-only'}</TableCell>
                  <TableCell>{numberValue(summary.totalRows)}</TableCell>
                  <TableCell>{numberValue(summary.acceptedRows)}</TableCell>
                  <TableCell>{numberValue(summary.warningRows)}</TableCell>
                  <TableCell>{numberValue(summary.rejectedRows)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <FindingsTable title="Errors" findings={errors} testId="diaspora-workbook-dry-run-errors" />
      <FindingsTable title="Warnings" findings={warnings} testId="diaspora-workbook-dry-run-warnings" />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" data-testid="diaspora-workbook-view-console">
          <Link to={batchId ? `/admin/diaspora/workbooks?batchId=${encodeURIComponent(batchId)}` : '/admin/diaspora/workbooks'}>View Workbook Console</Link>
        </Button>
        <Button asChild variant="secondary" data-testid="diaspora-workbook-start-another">
          <Link to="/admin/diaspora/workbooks/new">Start Another Dry Run</Link>
        </Button>
      </div>
    </section>
  )
}

export default function DiasporaWorkbookDryRun() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const {
    fetchDiasporaWorkbookTemplateSchema,
    fetchDiasporaWorkbookTemplateDownloadStatus,
    runDiasporaWorkbookDryRun,
  } = useCarUpApi()

  const [templateType, setTemplateType] = useState('enterprise')
  const [schema, setSchema] = useState<DiasporaWorkbookTemplateSchema | null>(null)
  const [supportedTemplates, setSupportedTemplates] = useState<DiasporaWorkbookTemplateDefinition[]>(fallbackTemplates)
  const [downloadStatus, setDownloadStatus] = useState<DiasporaWorkbookTemplateDownloadStatus | null>(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(null)
  const [jsonError, setJsonError] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState('')
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunError, setDryRunError] = useState('')
  const [dryRunResult, setDryRunResult] = useState<DiasporaWorkbookDryRunResult | null>(null)
  const submittingRef = useRef(false)

  const canView = useMemo(() => (
    isAuthenticated && allowedOperatorRoles.has((user?.role || '').toLowerCase())
  ), [isAuthenticated, user?.role])

  const loadTemplate = useCallback(async () => {
    if (!canView || !templateType) return
    setTemplateLoading(true)
    setTemplateError('')
    try {
      const [schemaResponse, downloadResponse] = await Promise.all([
        fetchDiasporaWorkbookTemplateSchema(templateType),
        fetchDiasporaWorkbookTemplateDownloadStatus(templateType),
      ])
      setSchema(schemaResponse.data)
      setSupportedTemplates(schemaResponse.supportedTemplates?.length ? schemaResponse.supportedTemplates : fallbackTemplates)
      setDownloadStatus(downloadResponse)
    } catch (err) {
      setSchema(null)
      setDownloadStatus(null)
      setTemplateError(err instanceof Error ? err.message : 'Unable to load workbook template schema.')
    } finally {
      setTemplateLoading(false)
    }
  }, [canView, fetchDiasporaWorkbookTemplateDownloadStatus, fetchDiasporaWorkbookTemplateSchema, templateType])

  useEffect(() => {
    if (authLoading || !canView) return
    void loadTemplate()
  }, [authLoading, canView, loadTemplate])

  const applyParsedWorkbook = (text: string, source: WorkbookSource, fromFile = false) => {
    const result = normalizeJsonWorkbook(text, source)
    if (result.error) {
      setParsedWorkbook(null)
      if (fromFile) setFileError(result.error)
      else setJsonError(result.error)
      return
    }
    setParsedWorkbook(result.parsed || null)
    setJsonError('')
    setFileError('')
    setDryRunResult(null)
  }

  const handleFileChange = async (file: File | undefined) => {
    setFileError('')
    setDryRunResult(null)
    if (!file) return
    const extensionOk = file.name.toLowerCase().endsWith('.json')
    const mimeOk = !file.type || file.type === 'application/json'
    if (!extensionOk || !mimeOk) {
      setFileName(file.name)
      setParsedWorkbook(null)
      setFileError('Only JSON workbook files are supported.')
      return
    }
    setFileName(file.name)
    const text = await file.text()
    setJsonText(text)
    applyParsedWorkbook(text, {
      filename: file.name,
      mimeType: file.type || 'application/json',
      sizeBytes: file.size,
    }, true)
  }

  const parsePastedJson = () => {
    setFileName('')
    setDryRunResult(null)
    applyParsedWorkbook(jsonText, {
      filename: null,
      mimeType: 'application/json',
      sizeBytes: new Blob([jsonText]).size,
    })
  }

  const clearJson = () => {
    setFileName('')
    setFileError('')
    setJsonError('')
    setJsonText('')
    setParsedWorkbook(null)
    setDryRunResult(null)
  }

  const canSubmit = Boolean(templateType && parsedWorkbook && !jsonError && !fileError && !dryRunLoading)

  const submitDryRun = async () => {
    if (submittingRef.current || !canSubmit || !parsedWorkbook) return
    submittingRef.current = true
    setDryRunLoading(true)
    setDryRunError('')
    setDryRunResult(null)
    try {
      const result = await runDiasporaWorkbookDryRun({
        templateType,
        idempotencyKey: generateIdempotencyKey(),
        source: parsedWorkbook.source,
        sheets: parsedWorkbook.sheets,
      })
      setDryRunResult(result)
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : 'Unable to run workbook dry-run.')
    } finally {
      submittingRef.current = false
      setDryRunLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-orange-600">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8" data-testid="diaspora-workbook-dry-run-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>Workbook dry-run access requires an authorized reviewer role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-workbook-dry-run-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 text-2xl font-semibold text-gray-950">Workbook dry-run intake</h1>
          <p className="mt-1 text-sm text-gray-500">JSON workbook intake, schema preview, validation diagnostics, and persisted review batches.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/diaspora/workbooks">View Workbook Console</Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <section className="rounded-md border border-gray-200 bg-white p-5">
            <label htmlFor="diaspora-workbook-template-select" className="text-sm font-medium text-gray-700">
              Template type
            </label>
            <select
              id="diaspora-workbook-template-select"
              value={templateType}
              onChange={event => setTemplateType(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              data-testid="diaspora-workbook-template-select"
            >
              {supportedTemplates.map(template => (
                <option key={template.templateType} value={template.templateType}>{labelize(template.templateType)}</option>
              ))}
            </select>
            <Button type="button" variant="outline" className="mt-3" onClick={loadTemplate} disabled={templateLoading}>
              <RefreshCw className={`h-4 w-4 ${templateLoading ? 'animate-spin' : ''}`} />
              Refresh schema
            </Button>
            {templateLoading && (
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-orange-700" data-testid="diaspora-workbook-template-loading">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading template schema...
              </p>
            )}
            {templateError && (
              <Alert className="mt-3 border-red-200 bg-red-50" data-testid="diaspora-workbook-template-error">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertTitle>Unable to load template</AlertTitle>
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            )}
          </section>

          <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-workbook-template-download-status">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-gray-950">Template download</h2>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              Binary XLSX template download is not yet available. Use the schema preview to prepare JSON workbook payloads.
            </p>
            {downloadStatus?.message && <p className="mt-2 text-xs text-gray-500">{downloadStatus.message}</p>}
            <Button type="button" variant="secondary" className="mt-4" disabled data-testid="diaspora-workbook-template-download-disabled">
              XLSX template unavailable
            </Button>
          </section>

          <section className="rounded-md border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-600" />
              <h2 className="text-lg font-semibold text-gray-950">JSON file intake</h2>
            </div>
            <input
              type="file"
              accept=".json,application/json"
              className="mt-4 block w-full text-sm text-gray-700 file:mr-4 file:rounded-md file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-orange-800 hover:file:bg-orange-100"
              onChange={event => void handleFileChange(event.target.files?.[0])}
              data-testid="diaspora-workbook-json-file-input"
            />
            {fileName && <p className="mt-2 text-sm text-gray-600" data-testid="diaspora-workbook-json-file-name">{fileName}</p>}
            {fileError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-workbook-json-file-error">{fileError}</p>}
            <Button type="button" variant="outline" className="mt-3" onClick={clearJson} data-testid="diaspora-workbook-json-clear">
              Clear
            </Button>
          </section>

          <section className="rounded-md border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-orange-600" />
              <h2 className="text-lg font-semibold text-gray-950">JSON paste/edit intake</h2>
            </div>
            <Textarea
              value={jsonText}
              onChange={event => {
                setJsonText(event.target.value)
                setJsonError('')
                setDryRunResult(null)
              }}
              className="mt-4 min-h-56 font-mono text-xs"
              placeholder='{"sheets":{"TRADE_PROFILES":[],"DIASPORA_IMPORT_ORDERS":[]}}'
              data-testid="diaspora-workbook-json-input"
            />
            {jsonError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-workbook-json-error">{jsonError}</p>}
            <Button type="button" className="mt-3" onClick={parsePastedJson} data-testid="diaspora-workbook-json-parse">
              Parse JSON
            </Button>
          </section>
        </div>

        <div className="space-y-4">
          <TemplateSchemaPanel schema={schema} supportedTemplates={supportedTemplates} />
          <PreviewPanel parsedWorkbook={parsedWorkbook} schema={schema} />

          <section className="rounded-md border border-gray-200 bg-white p-5">
            <Alert className="border-orange-200 bg-orange-50" data-testid="diaspora-workbook-dry-run-safety-note">
              <ShieldCheck className="h-4 w-4 text-orange-700" />
              <AlertTitle>Dry-run safety boundary</AlertTitle>
              <AlertDescription>
                The dry-run persists a workbook batch and row diagnostics for review. It does not write to live trade records. This distinction matters because the backend persists the dry-run batch and diagnostics, while live trade-table import remains disabled. The persistence service creates import-batch and row-diagnostic records only.
              </AlertDescription>
            </Alert>
            <p className="mt-3 text-sm text-gray-600">
              Live trade-table import, draft execution, retry, rollback, AI, Drive/OAuth, payments, compliance decisions, document verification, and shipment completion remain unavailable here.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={submitDryRun}
                disabled={!canSubmit}
                data-testid="diaspora-workbook-dry-run-submit"
              >
                {dryRunLoading ? 'Running...' : 'Run Dry-Run'}
              </Button>
              {dryRunLoading && (
                <span className="flex items-center gap-2 text-sm font-medium text-orange-700" data-testid="diaspora-workbook-dry-run-loading">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting JSON workbook...
                </span>
              )}
            </div>
            {dryRunError && (
              <Alert className="mt-4 border-red-200 bg-red-50" data-testid="diaspora-workbook-dry-run-error">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertTitle>Dry-run failed</AlertTitle>
                <AlertDescription>{dryRunError}</AlertDescription>
              </Alert>
            )}
          </section>

          {dryRunResult && <ResultsPanel result={dryRunResult} />}
        </div>
      </div>
    </div>
  )
}
