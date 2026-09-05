/**
 * Confirmed workbook import (Deliverable B, Issue #127).
 *
 * Turns a dry-run preview into real writes across several domains. Two properties shape every
 * decision on this page:
 *
 *  1. **The user must be confirming the thing they are looking at.** The confirmation is bound to the
 *     checksum and dry-run revision displayed on screen. If either moves, the confirmation is refused
 *     — by the server, and visibly here, so the refusal is explained rather than merely enforced.
 *
 *  2. **A partial import is never dressed as a success.** `imported` is the server's all-or-nothing
 *     verdict. Anything else renders the truthful outcome, including the one state where a retry
 *     would double-apply (NEEDS_OPERATOR), where no retry is offered at all.
 *
 * Everything here is advisory. The backend re-checks the confirmation against current state, consumes
 * it single-use, reserves quota through the entitlement guard, receipts every row, and compensates on
 * failure. Nothing on this page is what actually prevents a bad import.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { UnavailableNote } from '@/components/diaspora/DataStateNotes'
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Lock, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { workbookImportUiEnabled } from '@/config/confirmedImportFlag'
import {
  confirmBlockReason, explainConfirmBlock, isSuccessfulImport, needsOperator, isSafeToRetry,
  summarizeReceipts, confirmationIdempotencyKey, RECEIPT_OUTCOME_LABELS,
  type DryRunSummary,
} from './confirmedImportHelpers'
import type {
  WorkbookImportConfirmation, WorkbookImportReceipt, WorkbookImportExecutionResult, WorkbookInterruptedBatch,
} from '@/types'

export default function DiasporaConfirmedImport() {
  const flagEnabled = workbookImportUiEnabled()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null)
  const [rowMessages, setRowMessages] = useState<{ row: number; sheet: string | null; message: string }[]>([])
  const [confirmation, setConfirmation] = useState<WorkbookImportConfirmation | null>(null)
  const [result, setResult] = useState<WorkbookImportExecutionResult | null>(null)
  const [receipts, setReceipts] = useState<WorkbookImportReceipt[]>([])
  const [interrupted, setInterrupted] = useState<WorkbookInterruptedBatch[]>([])
  // An unreadable check is not a clean result — see loadInterrupted/loadReceipts.
  const [interruptedUnreadable, setInterruptedUnreadable] = useState(false)
  const [receiptsUnreadable, setReceiptsUnreadable] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tenantId = user?.active_tenant_id ?? null
  const userId = user?.id ?? null
  const canView = flagEnabled && isAuthenticated

  // The live checksum, re-read whenever the batch is refreshed. Compared against the one the preview
  // was rendered from; a difference is what "the workbook changed" actually means.
  const [currentChecksum, setCurrentChecksum] = useState<string | null>(null)

  const blockReason = useMemo(() => confirmBlockReason({
    dryRun,
    displayedChecksum: dryRun?.checksum ?? null,
    currentChecksum,
    confirmationExpiresAt: confirmation?.expires_at ?? null,
    contextTenantId: tenantId,
    contextUserId: userId,
    boundTenantId: confirmation?.tenant_id ?? null,
    boundUserId: confirmation?.confirmed_by ?? null,
  }), [dryRun, currentChecksum, confirmation, tenantId, userId])

  const blockMessage = explainConfirmBlock(blockReason)
  const totals = useMemo(() => summarizeReceipts(receipts), [receipts])

  const loadInterrupted = useCallback(async () => {
    if (!canView) return
    try {
      setInterrupted(await api.getWorkbookInterruptedImports())
      setInterruptedUnreadable(false)
    } catch {
      // The whole section is gated on this list being non-empty, so swallowing
      // the failure hid the "do not retry" warning from an operator whose import
      // may be partly applied. An unreadable check is reported, never hidden.
      setInterrupted([])
      setInterruptedUnreadable(true)
    }
  }, [api, canView])

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void loadInterrupted() }, [authLoading, canView])

  const loadReceipts = useCallback(async (batchId: string) => {
    try {
      setReceipts(await api.getWorkbookImportReceipts(batchId))
      setReceiptsUnreadable(false)
    } catch {
      setReceipts([])
      setReceiptsUnreadable(true)
    }
  }, [api])

  const onConfirm = useCallback(async () => {
    if (!dryRun || blockReason) return
    setBusy('confirm'); setError(null); setNotice(null)
    try {
      const key = confirmationIdempotencyKey(dryRun.batchId, dryRun.checksum || '', dryRun.dryRunRevision)
      const res = await api.confirmWorkbookImport(dryRun.batchId, dryRun.checksum || '', key)
      setConfirmation(res.data)
      setNotice(res.idempotentReplay
        // Surfaced rather than hidden: a duplicate submit produced the SAME confirmation, which is
        // exactly why it cannot import twice.
        ? 'This workbook was already confirmed. Re-using that confirmation — it can only be imported once.'
        : 'Confirmed. Review the summary, then import.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The confirmation could not be recorded.')
    } finally { setBusy(null) }
  }, [api, dryRun, blockReason])

  const onExecute = useCallback(async () => {
    if (!dryRun || !confirmation) return
    setBusy('execute'); setError(null); setNotice(null)
    try {
      const res = await api.executeWorkbookImport(dryRun.batchId, confirmation.id)
      setResult(res)
      await loadReceipts(dryRun.batchId)
      await loadInterrupted()
      // The confirmation is spent either way — showing it as still available would invite a retry
      // the server would refuse.
      setConfirmation((c) => (c ? { ...c, state: 'consumed' } : c))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import could not be run.')
      if (dryRun) await loadReceipts(dryRun.batchId)
    } finally { setBusy(null) }
  }, [api, dryRun, confirmation, loadReceipts, loadInterrupted])

  const onDownloadCsv = useCallback(async () => {
    if (!dryRun) return
    setBusy('csv')
    try {
      const rows = await api.getWorkbookImportReceipts(dryRun.batchId)
      const header = ['row_order', 'sheet', 'outcome', 'entity_type', 'entity_ref', 'error_code', 'error_message']
      const cell = (v: unknown) => {
        const s = v == null ? '' : String(v)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const csv = [header.join(','), ...rows.map((r) => [
        cell(r.row_number), cell(r.sheet_name), cell(r.outcome), cell(r.entity_type),
        cell(r.entity_ref), cell(r.error_code), cell(r.error_message),
      ].join(','))].join('\n')
      const blob = new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `import-result-${dryRun.batchId}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('The result file could not be prepared.')
    } finally { setBusy(null) }
  }, [api, dryRun])

  // ── Test seam: the dry-run producer lives on the page in this build ────────
  // Wired so an operator can paste a batch id from the dry-run console. Real upload lands in the
  // existing dry-run surface; this page is the confirm→execute half.
  const [batchIdInput, setBatchIdInput] = useState('')
  const onLoadBatch = useCallback(async () => {
    const id = batchIdInput.trim()
    if (!id) return
    setBusy('load'); setError(null); setResult(null); setConfirmation(null); setReceipts([])
    try {
      const summary = await api.getDiasporaWorkbookImportBatchSummary(id)
      const s = summary as unknown as Record<string, unknown>
      const next: DryRunSummary = {
        batchId: id,
        checksum: (s.checksum_sha256 as string) ?? (s.checksum as string) ?? null,
        dryRunRevision: Number(s.dry_run_revision ?? s.dryRunRevision ?? 1),
        totalRows: Number(s.total_rows ?? s.totalRows ?? 0),
        validRows: Number(s.accepted_rows ?? s.acceptedRows ?? 0),
        invalidRows: Number(s.rejected_rows ?? s.rejectedRows ?? 0) + Number(s.error_count ?? s.errorCount ?? 0),
        quotaAllowed: (s.quotaAllowed as boolean) ?? true,
        quotaMessage: (s.quotaMessage as string) ?? null,
      }
      setDryRun(next)
      setCurrentChecksum(next.checksum)
      setRowMessages(Array.isArray(s.rowMessages) ? (s.rowMessages as typeof rowMessages) : [])
      await loadReceipts(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That workbook batch could not be loaded.')
      setDryRun(null)
    } finally { setBusy(null) }
  }, [api, batchIdInput, loadReceipts])

  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="confirmed-import-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>Workbook import is not available</AlertTitle>
          <AlertDescription>
            Confirmed workbook import is not available in this environment. It can be enabled by an administrator.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="confirmed-import-signin">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>Sign in to import a workbook.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const success = isSuccessfulImport(result)
  const stuck = needsOperator(result)
  const retryable = isSafeToRetry(result)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="confirmed-import-page">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <FileSpreadsheet className="h-6 w-6 text-slate-700" aria-hidden="true" />
          Import workbook
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Review the dry run, confirm exactly what you reviewed, then import.
        </p>
      </header>

      <div role="status" aria-live="polite" className="sr-only" data-testid="confirmed-import-announcer">
        {busy ? `Working: ${busy}` : (result?.userMessage ?? (confirmation ? 'Confirmed, ready to import' : 'Awaiting a dry run'))}
      </div>

      {error && (
        <Alert className="mb-6 border-red-200 bg-red-50" data-testid="confirmed-import-error">
          <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden="true" />
          <AlertTitle>Could not continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mb-6 border-slate-200 bg-slate-50" data-testid="confirmed-import-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {/* ── 1. Select the previewed batch ─────────────────────────────────── */}
      <section aria-labelledby="select-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="select-heading" className="mb-3 text-sm font-semibold text-slate-900">Workbook</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="batch-id">Workbook batch id</label>
          <input
            id="batch-id"
            data-testid="batch-id-input"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Dry-run batch id"
            value={batchIdInput}
            onChange={(e) => setBatchIdInput(e.target.value)}
          />
          <Button onClick={() => void onLoadBatch()} disabled={busy === 'load'} data-testid="load-batch">
            {busy === 'load' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
            Load dry run
          </Button>
        </div>
      </section>

      {/* ── 2. What will be imported ──────────────────────────────────────── */}
      {dryRun && (
        <section aria-labelledby="preview-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="dry-run-preview">
          <h2 id="preview-heading" className="mb-3 text-sm font-semibold text-slate-900">What will be imported</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-600">Rows</dt><dd className="font-medium tabular-nums" data-testid="preview-total">{dryRun.totalRows}</dd></div>
            <div><dt className="text-slate-600">Valid</dt><dd className="font-medium tabular-nums" data-testid="preview-valid">{dryRun.validRows}</dd></div>
            <div><dt className="text-slate-600">Invalid</dt><dd className="font-medium tabular-nums" data-testid="preview-invalid">{dryRun.invalidRows}</dd></div>
            <div><dt className="text-slate-600">Dry-run revision</dt><dd className="font-medium tabular-nums" data-testid="preview-revision">{dryRun.dryRunRevision}</dd></div>
            <div className="col-span-2">
              <dt className="text-slate-600">Workbook checksum</dt>
              {/* Shown in full: it is the thing the confirmation binds to, and a truncated value
                  cannot be compared by a user who suspects the file changed. */}
              <dd className="break-all font-mono text-xs" data-testid="preview-checksum">{dryRun.checksum ?? 'none recorded'}</dd>
            </div>
          </dl>

          <p className="mt-3 text-sm" data-testid="preview-quota">
            {dryRun.quotaAllowed
              ? 'Your plan has capacity for this import.'
              : (dryRun.quotaMessage || 'Your plan does not have enough remaining import capacity for this workbook.')}
          </p>

          {rowMessages.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Row messages</h3>
              <ul className="space-y-1" data-testid="row-messages">
                {rowMessages.map((m, i) => (
                  <li key={`${m.row}-${i}`} className="text-sm text-slate-700">
                    <span className="font-mono text-xs">{m.sheet ? `${m.sheet} ` : ''}row {m.row}</span> — {m.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── 3. Confirm ────────────────────────────────────────────────────── */}
      {dryRun && !result && (
        <section aria-labelledby="confirm-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 id="confirm-heading" className="mb-3 text-sm font-semibold text-slate-900">Confirm</h2>

          {blockMessage && (
            <Alert className="mb-3 border-amber-200 bg-amber-50" data-testid="confirm-blocked">
              <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <AlertTitle>Not ready to import</AlertTitle>
              <AlertDescription data-testid="confirm-blocked-reason">{blockMessage}</AlertDescription>
            </Alert>
          )}

          {confirmation && confirmation.state === 'pending' && (
            <div className="mb-3 rounded border border-slate-200 p-3 text-sm" data-testid="confirmation-summary">
              <p className="text-slate-700">
                Confirmed by you for revision {confirmation.dry_run_revision}, expiring{' '}
                <span data-testid="confirmation-expiry">{new Date(confirmation.expires_at).toLocaleString()}</span>.
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-600" data-testid="confirmation-checksum">
                {confirmation.workbook_checksum}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void onConfirm()}
              disabled={Boolean(blockReason) || busy === 'confirm' || confirmation?.state === 'pending'}
              data-testid="confirm-import"
            >
              {busy === 'confirm' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />}
              Confirm this workbook
            </Button>
            <Button
              variant="outline"
              onClick={() => void onExecute()}
              disabled={!confirmation || confirmation.state !== 'pending' || busy === 'execute'}
              data-testid="execute-import"
            >
              {busy === 'execute' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Import now
            </Button>
          </div>
        </section>
      )}

      {/* ── 4. Outcome ────────────────────────────────────────────────────── */}
      {result && (
        <section aria-labelledby="result-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="import-result">
          <h2 id="result-heading" className="mb-3 text-sm font-semibold text-slate-900">Result</h2>

          {success ? (
            <Alert className="border-emerald-200 bg-emerald-50" data-testid="result-success">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              <AlertTitle>Imported</AlertTitle>
              <AlertDescription>{result.userMessage}</AlertDescription>
            </Alert>
          ) : stuck ? (
            // The one state where retrying could double-apply. No retry control is rendered at all.
            <Alert className="border-red-200 bg-red-50" data-testid="result-needs-operator">
              <ShieldAlert className="h-4 w-4 text-red-700" aria-hidden="true" />
              <AlertTitle>This import needs our team</AlertTitle>
              <AlertDescription>
                {result.userMessage}
                <strong className="mt-1 block" data-testid="do-not-retry">Do not retry this import.</strong>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-amber-200 bg-amber-50" data-testid="result-failed">
              <XCircle className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <AlertTitle>Not imported</AlertTitle>
              <AlertDescription>{result.userMessage}</AlertDescription>
            </Alert>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4" data-testid="result-totals">
            <div><dt className="text-slate-600">Status</dt><dd className="font-medium" data-testid="result-status">{result.status}</dd></div>
            <div><dt className="text-slate-600">Applied</dt><dd className="font-medium tabular-nums" data-testid="result-applied">{result.appliedRows ?? 'Not reported'}</dd></div>
            <div><dt className="text-slate-600">Rejected</dt><dd className="font-medium tabular-nums" data-testid="result-rejected">{totals.rejected}</dd></div>
            <div><dt className="text-slate-600">Reversed</dt><dd className="font-medium tabular-nums" data-testid="result-compensated">{result.compensatedRows ?? totals.compensated}</dd></div>
          </dl>

          {retryable && (
            <p className="mt-3 text-sm text-slate-700" data-testid="safe-to-retry">
              Nothing remains applied. Fix the workbook, run the dry run again, and confirm.
            </p>
          )}
        </section>
      )}

      {/* ── 5. Receipts ───────────────────────────────────────────────────── */}
      {receiptsUnreadable && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <UnavailableNote testId="import-receipts-unavailable">
            The per-row import results could not be loaded. This is not a report of zero rows.
          </UnavailableNote>
        </section>
      )}

      {receipts.length > 0 && (
        <section aria-labelledby="receipts-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="receipts-heading" className="text-sm font-semibold text-slate-900">Per-row result</h2>
            <Button variant="outline" size="sm" onClick={() => void onDownloadCsv()} disabled={busy === 'csv'} data-testid="download-csv">
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />Download CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="receipts-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  {/* "Row (order)" not "Row": this is an ordinal in plan order, not the workbook's own
                      row number, and calling it "Row" would send users to the wrong line of their file. */}
                  <th scope="col" className="py-1 pr-4">Row (order)</th>
                  <th scope="col" className="py-1 pr-4">Sheet</th>
                  <th scope="col" className="py-1 pr-4">Outcome</th>
                  <th scope="col" className="py-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100" data-testid={`receipt-${r.row_number}`}>
                    <td className="py-1 pr-4 tabular-nums">{r.row_number}</td>
                    <td className="py-1 pr-4">{r.sheet_name || '—'}</td>
                    <td className="py-1 pr-4">
                      <Badge variant="outline">{RECEIPT_OUTCOME_LABELS[r.outcome] || r.outcome}</Badge>
                    </td>
                    <td className="py-1 text-slate-700">{r.error_message || r.error_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 6. Interrupted imports ────────────────────────────────────────── */}
      {interruptedUnreadable && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <UnavailableNote testId="interrupted-imports-unavailable">
            CarUp could not check for interrupted imports. This is not confirmation that there are
            none — if an import was interrupted, do not retry it until this check succeeds.
          </UnavailableNote>
        </section>
      )}

      {interrupted.length > 0 && (
        <section aria-labelledby="interrupted-heading" className="rounded-lg border border-slate-200 bg-white p-4" data-testid="interrupted-imports">
          <h2 id="interrupted-heading" className="mb-3 text-sm font-semibold text-slate-900">Interrupted imports</h2>
          <ul className="space-y-2">
            {interrupted.map((b) => (
              <li key={b.id} className="rounded border border-slate-200 p-3 text-sm" data-testid={`interrupted-${b.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{b.status}</Badge>
                  <span className="text-xs text-slate-500">{b.totalRows ?? 0} rows</span>
                </div>
                {b.needsHuman ? (
                  <p className="mt-1 text-red-800" data-testid={`interrupted-needs-human-${b.id}`}>
                    Partly applied and could not be fully reversed. Our team is resolving it — do not retry.
                  </p>
                ) : (
                  <p className="mt-1 text-slate-700">
                    This import stopped partway. Its per-row result shows exactly how far it got.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
