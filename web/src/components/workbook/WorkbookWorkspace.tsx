/**
 * O2-X5A — the common Workbook tools shell: Template | Export | Import | Recent
 * Imports, with the CarUp AI Workbook Assistant as a VISIBLE component of the
 * import flow (never invisible plumbing).
 *
 * Rendering laws: proposals are visually attributed (deterministic vs AI
 * PROPOSAL vs unmapped) and AI output is advisory until the human confirms;
 * the dry run is disabled until every data sheet's mapping is confirmed for
 * these exact bytes; the import executes only after an explicit confirmation;
 * corrections happen IN THE FILE (the assistant suggests, the user edits and
 * re-uploads — the page never silently rewrites their data).
 */
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Bot, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'

const fieldClass = 'rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100'

interface Proposal { source: string; proposed_target: string | null; confidence: number | null; provider: string }
interface SheetInspection { sheet_name: string; row_count: number; headers: string[]; proposals: Proposal[]; canonical_columns: string[] }
interface Inspection { checksum: string; schema_version: string | null; sheets: SheetInspection[] }
interface AttentionRow { sheet_name: string; row: number; field: string | null; severity: string; code: string; message: string; explanation: string }
interface DryRun {
  batchId: string; canImport: boolean
  totals: { vehicleCount: number; acceptedVehicles: number; blockedVehicles: number; warningCount: number; errorCount: number }
  summary?: { headline: string; lines: string[] }
  attention?: { needs_attention: AttentionRow[]; count: number }
}
interface RecentImport {
  batch_id: string; template_key: string; source_filename: string | null; uploaded_at: string
  total_rows: number; accepted_rows: number; rejected_rows: number; import_status: string; can_execute: boolean
}

function providerBadge(provider: string) {
  if (provider === 'deterministic') return <Badge data-testid="provider-deterministic" className="bg-gray-700 text-gray-200">matched</Badge>
  if (provider === 'ai') return <Badge data-testid="provider-ai" className="bg-violet-700 text-violet-100">AI PROPOSAL</Badge>
  return <Badge data-testid="provider-unmapped" className="bg-amber-700 text-amber-100">unmapped</Badge>
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function WorkbookWorkspace({ templateKey, title }: { templateKey: string; title?: string }) {
  const {
    downloadWorkbookFile, inspectWorkbook, confirmWorkbookMappings, runWorkbookDryRun,
    executeVehicleWorkbookBatch, fetchRecentWorkbookImports, explainWorkbookField,
  } = useCarUpApi()

  const [tab, setTab] = useState<'template' | 'export' | 'import' | 'recent'>('import')
  const [file, setFile] = useState<{ name: string; dataUri: string } | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [mappingConfirmed, setMappingConfirmed] = useState(false)
  const [dryRun, setDryRun] = useState<DryRun | null>(null)
  const [running, setRunning] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executed, setExecuted] = useState<{ created: number; failed: number; importStatus: string } | null>(null)
  const [recent, setRecent] = useState<RecentImport[]>([])
  const [explain, setExplain] = useState<{ header: string; explanation: string; allowed?: Array<{ label: string }> } | null>(null)

  const loadRecent = useCallback(async () => {
    try {
      const data = await fetchRecentWorkbookImports() as unknown as { imports: RecentImport[] }
      setRecent((data.imports || []).filter((entry) => entry.template_key === templateKey))
    } catch { /* recent imports are a convenience view */ }
  }, [fetchRecentWorkbookImports, templateKey])

  // The shared request() helper flips its loading flag synchronously, so defer by a
  // microtask — the effect itself must not set state in its own pass (the X2/X5 idiom).
  useEffect(() => {
    if (tab !== 'recent') return
    queueMicrotask(() => { void loadRecent() })
  }, [tab, loadRecent])

  const download = async (kind: 'templates' | 'export') => {
    try {
      const blob = await downloadWorkbookFile(kind, templateKey)
      saveBlob(blob, `carup-${templateKey}-${kind === 'templates' ? 'template' : 'export'}.xlsx`)
      toast.success(kind === 'templates' ? 'Template downloaded.' : 'Export downloaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed.')
    }
  }

  const pickFile = async (picked: File | undefined) => {
    if (!picked) return
    const dataUri = await readFileAsDataUri(picked)
    setFile({ name: picked.name, dataUri })
    setInspection(null); setTargets({}); setMappingConfirmed(false); setDryRun(null); setExecuted(null)
  }

  const inspect = async () => {
    if (!file) return
    setInspecting(true)
    try {
      const result = await inspectWorkbook({ fileBase64: file.dataUri, filename: file.name, template_key: templateKey }) as unknown as Inspection
      setInspection(result)
      const initial: Record<string, string> = {}
      for (const sheet of result.sheets) {
        for (const proposal of sheet.proposals) {
          initial[`${sheet.sheet_name}::${proposal.source}`] = proposal.proposed_target || 'ignore'
        }
      }
      setTargets(initial)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The workbook could not be inspected.')
    } finally {
      setInspecting(false)
    }
  }

  const confirmMapping = async () => {
    if (!inspection) return
    try {
      const sheets = inspection.sheets
        .filter((sheet) => sheet.row_count > 0)
        .map((sheet) => ({
          sheet_name: sheet.sheet_name,
          mappings: sheet.proposals.map((proposal) => ({
            source: proposal.source,
            target: targets[`${sheet.sheet_name}::${proposal.source}`] || 'ignore',
          })),
        }))
      await confirmWorkbookMappings({ template_key: templateKey, workbook_checksum: inspection.checksum, sheets })
      setMappingConfirmed(true)
      toast.success('Mapping confirmed for this exact file.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The mapping could not be confirmed.')
    }
  }

  const dryRunNow = async () => {
    if (!file) return
    setRunning(true)
    try {
      const result = await runWorkbookDryRun({ fileBase64: file.dataUri, filename: file.name, template_key: templateKey }) as unknown as DryRun
      setDryRun(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The dry run failed.')
    } finally {
      setRunning(false)
    }
  }

  const execute = async () => {
    if (!dryRun) return
    setExecuting(true)
    try {
      const result = await executeVehicleWorkbookBatch(dryRun.batchId) as unknown as { created: number; failed: number; importStatus: string }
      setExecuted(result)
      toast.success(`Import complete — ${result.created} vehicle${result.created === 1 ? '' : 's'} created as drafts.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import could not be executed.')
    } finally {
      setExecuting(false)
    }
  }

  const explainHeader = async (sheetName: string, header: string) => {
    try {
      const result = await explainWorkbookField({ template_key: templateKey, sheet_name: sheetName, field: header }) as unknown as { header: string; explanation: string; allowed_values: Array<{ label: string }> | null }
      setExplain({ header: result.header, explanation: result.explanation, allowed: result.allowed_values || undefined })
    } catch {
      setExplain({ header, explanation: 'This column is not part of the template — map it to a known field or ignore it.' })
    }
  }

  return (
    <Card className="bg-gray-900 border-gray-800" data-testid="workbook-workspace">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" aria-hidden />{title || 'Workbook tools'}</h2>
          <div className="flex gap-1">
            {(['template', 'export', 'import', 'recent'] as const).map((name) => (
              <Button key={name} size="sm" variant={tab === name ? 'default' : 'outline'} data-testid={`tab-${name}`} onClick={() => setTab(name)}>
                {name === 'template' ? 'Template' : name === 'export' ? 'Export' : name === 'import' ? 'Import' : 'Recent Imports'}
              </Button>
            ))}
          </div>
        </div>

        {tab === 'template' && (
          <div className="space-y-2 text-sm text-gray-400">
            <p>Download the canonical workbook for this task — headers, help row, dropdowns and instructions included. It also opens in Google Sheets.</p>
            <Button size="sm" onClick={() => void download('templates')} data-testid="download-template"><Download className="mr-1 h-4 w-4" aria-hidden />Download template</Button>
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-2 text-sm text-gray-400">
            <p>Export your current CarUp data into this workbook for offline review or bulk editing. Sensitive identifiers are redacted by default.</p>
            <Button size="sm" onClick={() => void download('export')} data-testid="download-export"><Download className="mr-1 h-4 w-4" aria-hidden />Export my data</Button>
          </div>
        )}

        {tab === 'import' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept=".xlsx" data-testid="wb-file" className="text-xs text-gray-400"
                onChange={(event) => void pickFile(event.target.files?.[0])} />
              <Button size="sm" disabled={!file || inspecting} onClick={() => void inspect()} data-testid="wb-inspect">
                <Upload className="mr-1 h-4 w-4" aria-hidden />{inspecting ? 'Inspecting…' : 'Inspect workbook'}
              </Button>
            </div>

            {/* CarUp AI Workbook Assistant — an explicit, named product surface. */}
            <div className="rounded-md border border-violet-900 bg-violet-950/30 p-3" data-testid="assistant-panel">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-200">
                <Bot className="h-4 w-4" aria-hidden />CarUp AI Workbook Assistant
              </div>
              <p className="mt-1 text-xs text-violet-300/80">
                Maps your columns (exact matches first, AI only for the leftovers), explains fields and errors,
                checks the workbook, and summarizes the import. It proposes — you decide. It never invents a
                value and never imports an authority decision.
              </p>
              {explain && (
                <div className="mt-2 rounded bg-gray-900/60 p-2 text-xs text-gray-300" data-testid="assistant-explanation">
                  <span className="font-medium">{explain.header}:</span> {explain.explanation}
                  {explain.allowed && <span className="block mt-1 text-gray-400">Allowed: {explain.allowed.map((entry) => entry.label).join(' · ')}</span>}
                </div>
              )}
            </div>

            {inspection && inspection.sheets.filter((sheet) => sheet.row_count > 0).map((sheet) => (
              <div key={sheet.sheet_name} className="space-y-1" data-testid={`mapping-sheet-${sheet.sheet_name}`}>
                <div className="text-xs font-medium text-gray-300">{sheet.sheet_name} — {sheet.row_count} row{sheet.row_count === 1 ? '' : 's'}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500"><th className="text-left">Your column</th><th className="text-left">Maps to</th><th className="text-left">Source</th><th /></tr></thead>
                    <tbody>
                      {sheet.proposals.map((proposal) => (
                        <tr key={proposal.source}>
                          <td className="pr-2 text-gray-300">{proposal.source}</td>
                          <td className="pr-2">
                            <select className={fieldClass} data-testid={`target-${sheet.sheet_name}-${proposal.source}`}
                              value={targets[`${sheet.sheet_name}::${proposal.source}`] || 'ignore'}
                              onChange={(event) => setTargets((current) => ({ ...current, [`${sheet.sheet_name}::${proposal.source}`]: event.target.value }))}>
                              <option value="ignore">— ignore —</option>
                              {sheet.canonical_columns.map((column) => <option key={column} value={column}>{column}</option>)}
                            </select>
                          </td>
                          <td className="pr-2">{providerBadge(proposal.provider)}</td>
                          <td><button type="button" className="text-violet-300 underline" data-testid={`explain-${sheet.sheet_name}-${proposal.source}`}
                            onClick={() => void explainHeader(sheet.sheet_name, proposal.source)}>explain</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {inspection && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void confirmMapping()} data-testid="wb-confirm-mapping">Confirm mapping</Button>
                <Button size="sm" disabled={!mappingConfirmed || running} onClick={() => void dryRunNow()} data-testid="wb-dry-run">
                  {running ? 'Checking…' : 'Run dry run'}
                </Button>
              </div>
            )}

            {dryRun && (
              <div className="space-y-2">
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-sm text-gray-200" data-testid="wb-summary">
                  <div className="font-medium">{dryRun.summary?.headline}</div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-gray-400">
                    {(dryRun.summary?.lines || []).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                {dryRun.attention && dryRun.attention.count > 0 && (
                  <div className="overflow-x-auto" data-testid="wb-attention">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500"><th className="text-left">Sheet</th><th className="text-left">Row</th><th className="text-left">Field</th><th className="text-left">Issue</th><th className="text-left">What to do</th></tr></thead>
                      <tbody>
                        {dryRun.attention.needs_attention.map((row, index) => (
                          <tr key={index} className={row.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>
                            <td className="pr-2">{row.sheet_name}</td><td className="pr-2">{row.row}</td>
                            <td className="pr-2">{row.field || '—'}</td><td className="pr-2">{row.message}</td>
                            <td className="text-gray-400">{row.explanation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-xs text-gray-500">Fix these in your file and upload it again — CarUp never edits your workbook for you.</p>
                  </div>
                )}
                <Button size="sm" disabled={!dryRun.canImport || executing || Boolean(executed)} onClick={() => void execute()} data-testid="wb-execute">
                  {executing ? 'Importing…' : `Confirm import (${dryRun.totals.acceptedVehicles} vehicle${dryRun.totals.acceptedVehicles === 1 ? '' : 's'})`}
                </Button>
                {executed && (
                  <div className="text-xs text-gray-300" data-testid="wb-executed">
                    {executed.created} created as private drafts · {executed.failed} failed · status {executed.importStatus}. Open My Vehicles to review — nothing is published by an import.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'recent' && (
          <div className="overflow-x-auto" data-testid="wb-recent">
            {recent.length === 0 && <p className="text-sm text-gray-500">No imports yet for this workbook.</p>}
            {recent.length > 0 && (
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500"><th className="text-left">File</th><th className="text-left">Uploaded</th><th className="text-left">Rows</th><th className="text-left">Status</th></tr></thead>
                <tbody>
                  {recent.map((entry) => (
                    <tr key={entry.batch_id} className="text-gray-300">
                      <td className="pr-2">{entry.source_filename || '—'}</td>
                      <td className="pr-2">{entry.uploaded_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="pr-2">{entry.accepted_rows}/{entry.total_rows} accepted</td>
                      <td>{entry.import_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
