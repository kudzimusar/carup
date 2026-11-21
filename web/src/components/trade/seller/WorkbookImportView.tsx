/**
 * RX-06 Trade — the workbook import desk (unified presentation of /diaspora/workbook/import).
 *
 *   1 load the dry run → 2 review its results → 3 confirm exactly what was reviewed → 4 import →
 *   5 the truthful outcome, its per-row receipts, and interrupted-import recovery.
 *
 * Fed by DiasporaConfirmedImport's own state and handlers (dry-run read, confirm, execute, receipts,
 * CSV, interrupted imports). Nothing executes without the existing explicit confirmation; a partial
 * import is never dressed as a success; the one state where a retry could double-apply offers none.
 * Phones get the same order — review first — and no sticky import button.
 */
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCircle2, Download, FileSpreadsheet, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { RECEIPT_OUTCOME_LABELS, isSafeToRetry, isSuccessfulImport, needsOperator, type DryRunSummary } from '@/pages/diaspora/confirmedImportHelpers'
import type { WorkbookImportExecutionResult, WorkbookImportReceipt } from '@/types'
import { DeskHeader, DeskNotice, DeskPanel, DeskPulse, DeskState, Provenance, ReadFailureState } from './DeskPrimitives'
import { DESK_EYEBROW, DESK_FIELD, DESK_LABEL, DESK_PRIMARY, DESK_SECONDARY, DESK_TEXT_ACTION } from './deskStyles'
import { humanize, plural, shortRef, when } from './deskFormat'
import {
  CHECKSUM_MISSING_REASON, DRY_RUN_OPERATOR_ROLES, IMPORT_STEPS, breakdown, stepStates, type WorkbookImportModel,
} from './workbookImportModel'

const PAGE = 'mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8'

export function WorkbookImportView({ model }: { model: WorkbookImportModel }) {
  if (model.authLoading) {
    return <div className={PAGE}><DeskState kind="loading" title="Opening workbook import…" testId="wi-loading" /></div>
  }
  if (!model.flagEnabled) {
    return (
      <div className={PAGE}>
        <DeskState kind="unavailable" title="Workbook import is not available in this environment" testId="wi-unavailable">
          Confirmed workbook import is switched off here, so nothing was fetched. It can be enabled by an administrator.
        </DeskState>
      </div>
    )
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" title="Sign in to import a workbook" testId="wi-signin" action={<Link to="/login" className={DESK_PRIMARY}>Sign in</Link>}>
          An import writes into your organisation’s trade records, so it is always tied to a signed-in account.
        </DeskState>
      </div>
    )
  }

  const { dryRun, result, confirmation } = model
  const steps = stepStates(model)
  // The page-level error slot is shared by load / confirm / execute / CSV. A failed load is shown as
  // its own classified state in step 1, so it is not repeated here.
  const pageError = model.error && !(model.loadFailure && model.error === model.loadFailure.message) ? model.error : null

  return (
    <div className={PAGE} data-testid="wi-desk">
      <div role="status" aria-live="polite" className="sr-only" data-testid="wi-announcer">
        {model.busy ? `Working: ${model.busy}` : (result?.userMessage ?? (confirmation?.state === 'pending' ? 'Confirmed, ready to import' : 'Awaiting a dry run'))}
      </div>

      <DeskHeader testId="wi-header" eyebrow="Trade · Workbook import" title="Import a workbook"
        description="Review the dry run, confirm exactly what you reviewed, then import. Nothing is written until you confirm and press Import."
        pulse={dryRun ? (
          <DeskPulse testId="wi-pulse" scope={`Dry run ${shortRef(dryRun.batchId, 10)}`} items={[
            { label: dryRun.totalRows === 1 ? 'row' : 'rows', value: dryRun.totalRows },
            { label: 'valid', value: dryRun.validRows },
            { label: 'invalid', value: dryRun.invalidRows },
          ]} />
        ) : undefined}
      />

      {/* Scrolls sideways on phones: keyboard users can focus it and scroll with the arrow keys (axe scrollable-region-focusable). */}
      <ol aria-label="Import steps" tabIndex={0} data-testid="wi-stepper" className="relative mt-5 flex gap-2 overflow-x-auto rounded-control pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
        {IMPORT_STEPS.map((s, i) => {
          const state = steps[s.id]
          return (
            <li key={s.id} data-testid={`wi-step-${s.id}`} data-state={state} aria-current={state === 'current' ? 'step' : undefined}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm ${state === 'current' ? 'bg-carup-bg-raised font-semibold text-carup-text ring-1 ring-carup-line-strong' : state === 'done' ? 'text-carup-text' : 'text-carup-text-3'}`}>
              <span aria-hidden="true" className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${state === 'done' ? 'bg-carup-raw-ink text-white' : state === 'current' ? 'bg-carup-raw-orange-signal text-carup-raw-ink' : 'border border-carup-line-strong'}`}>
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
              <span className="sr-only">{state === 'done' ? '(done)' : state === 'current' ? '(current step)' : '(not started)'}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-5 space-y-5">
        {pageError && <DeskNotice tone="danger" testId="wi-error">Could not continue. {pageError}</DeskNotice>}
        {model.notice && <DeskNotice testId="wi-notice">{model.notice}</DeskNotice>}

        <LoadStep model={model} />
        {dryRun && <ReviewStep model={model} dryRun={dryRun} />}
        {dryRun && !result && <ConfirmStep model={model} dryRun={dryRun} />}
        {dryRun && !result && <ImportStep model={model} />}
        {result && <OutcomeStep model={model} result={result} />}
        <ReceiptsPanel model={model} />
        <InterruptedPanel model={model} />
      </div>
    </div>
  )
}

/* ───────────────────────── 1 · load ───────────────────────── */

function LoadStep({ model }: { model: WorkbookImportModel }) {
  const id = useId()
  const operator = DRY_RUN_OPERATOR_ROLES.has(model.role.toLowerCase())
  return (
    <DeskPanel testId="wi-load" eyebrow="Step 1" title="Load the dry run"
      description="A dry run validates a workbook without writing anything. Its batch id brings it here for review.">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-batch`} className={DESK_LABEL}>Dry-run batch id</label>
          <input id={`${id}-batch`} className={`${DESK_FIELD} font-mono`} value={model.batchIdInput} onChange={(e) => model.setBatchIdInput(e.target.value)}
            autoComplete="off" spellCheck={false} data-testid="wi-batch-input" />
        </div>
        <button type="button" className={DESK_PRIMARY} onClick={model.onLoadBatch} disabled={model.busy === 'load'} data-testid="wi-load-submit">
          {model.busy === 'load' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />} Load dry run
        </button>
      </div>
      {model.loadFailure && (
        <div className="mt-3">
          <ReadFailureState failure={model.loadFailure} what="That dry-run batch" onRetry={model.onLoadBatch} compact testId="wi-load-failed"
            deniedHint="This account may not read that dry-run batch."
            unavailableHint="No dry-run batch with this id is visible to this account — check the id, or ask whoever ran the dry run." />
        </div>
      )}
      <div className="mt-4 rounded-control bg-carup-bg-surface p-3 text-xs leading-5 text-carup-text-2" data-testid="wi-dryrun-help">
        {operator ? (
          <>
            <p>You can produce a dry run yourself in the workbook console.</p>
            <div className="mt-1 flex flex-wrap gap-x-4">
              <Link to="/admin/diaspora/workbooks/new" className={DESK_TEXT_ACTION}>Start a dry run</Link>
              <Link to="/admin/diaspora/workbooks" className={DESK_TEXT_ACTION}>Workbook console</Link>
            </div>
          </>
        ) : (
          <p>Dry runs are produced in CarUp’s workbook dry-run console, which CarUp operators run. Ask the operator who ran yours for its batch id.</p>
        )}
      </div>
    </DeskPanel>
  )
}

/* ───────────────────────── 2 · review ───────────────────────── */

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-carup-text [overflow-wrap:anywhere]" data-testid={testId}>{children}</dd>
    </div>
  )
}

const BREAKDOWNS: ReadonlyArray<[string, string]> = [
  ['rowsBySheet', 'By sheet'], ['rowsByTargetTable', 'By destination'], ['rowsByActionType', 'By action'], ['rowsByValidationStatus', 'By validation result'],
]

function ReviewStep({ model, dryRun: d }: { model: WorkbookImportModel; dryRun: DryRunSummary }) {
  const raw = model.dryRunRaw ?? {}
  const warnings = Number(raw.warningRows ?? raw.warningCount)
  const lists = BREAKDOWNS.flatMap(([key, label]) => {
    const rows = breakdown(raw[key])
    return rows ? [{ label, rows }] : []
  })
  return (
    <DeskPanel testId="wi-review" eyebrow="Step 2" title="Review the dry-run results"
      provenance={<Provenance kind="server" label="Validated by CarUp’s dry run · nothing written yet" />}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Fact label="Rows" testId="wi-total">{d.totalRows}</Fact>
        <Fact label="Valid" testId="wi-valid">{d.validRows}</Fact>
        <Fact label="Invalid" testId="wi-invalid">{d.invalidRows}</Fact>
        {Number.isFinite(warnings) && <Fact label="Rows with warnings">{warnings}</Fact>}
        {typeof raw.importStatus === 'string' && <Fact label="Batch status">{humanize(raw.importStatus)}</Fact>}
        {typeof raw.templateType === 'string' && <Fact label="Template">{humanize(raw.templateType)}</Fact>}
        <Fact label="Dry-run revision" testId="wi-revision">
          {model.reported?.revision ? d.dryRunRevision : <span className="font-normal text-carup-text-2">Not provided by this read (shown as 1 by default)</span>}
        </Fact>
      </dl>
      <div className="mt-4 rounded-control bg-carup-bg-surface p-3">
        <p className="text-xs font-medium text-carup-text-3">Workbook checksum — what a confirmation binds to</p>
        <p className={d.checksum ? 'mt-1 break-all font-mono text-[12.5px] text-carup-text' : 'mt-1 text-sm text-carup-text-2'} data-testid="wi-checksum">
          {d.checksum ?? 'Not included in this read'}
        </p>
      </div>
      <p className="mt-3 text-sm text-carup-text" data-testid="wi-quota">
        {!model.reported?.quota
          ? 'Plan capacity was not reported by this read. The server checks it when you confirm and import.'
          : d.quotaAllowed ? 'Your plan has capacity for this import.' : (d.quotaMessage || 'Your plan does not have enough remaining import capacity for this workbook.')}
      </p>
      {lists.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2" data-testid="wi-breakdowns">
          {lists.map(({ label, rows }) => (
            <div key={label} className="min-w-0">
              <p className={DESK_EYEBROW}>{label}</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {rows.map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-3"><span className="min-w-0 text-carup-text-2 [overflow-wrap:anywhere]">{k === 'null' || k === 'undefined' ? 'Not recorded' : humanize(k)}</span><span className="font-mono tabular-nums text-carup-text">{n}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {model.rowMessages.length > 0 && (
        <div className="mt-4">
          <p className={DESK_EYEBROW}>Row messages</p>
          <ul className="mt-1.5 space-y-1" data-testid="wi-row-messages">
            {model.rowMessages.map((m, i) => (
              <li key={`${m.row}-${i}`} className="text-sm text-carup-text-2">
                <span className="font-mono text-xs text-carup-text">{m.sheet ? `${m.sheet} ` : ''}row {m.row}</span> — {m.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DeskPanel>
  )
}

/* ───────────────────────── 3 · confirm  ·  4 · import ───────────────────────── */

function ConfirmStep({ model, dryRun: d }: { model: WorkbookImportModel; dryRun: DryRunSummary }) {
  const c = model.confirmation
  const pending = c?.state === 'pending'
  const noChecksum = !d.checksum
  return (
    <DeskPanel testId="wi-confirm" eyebrow="Step 3" title="Confirm exactly what you reviewed"
      description="A confirmation records that you reviewed this preview. It is bound to the checksum and dry-run revision above, expires after a short window, and can be used once.">
      <div className="space-y-3">
        {model.blockMessage && (
          <DeskNotice tone="warning" testId="wi-confirm-blocked"><strong className="font-semibold">Not ready to import.</strong> {model.blockMessage}</DeskNotice>
        )}
        {noChecksum && <DeskNotice tone="warning" testId="wi-checksum-missing">{CHECKSUM_MISSING_REASON}</DeskNotice>}
        {pending && c && (
          <div className="rounded-control bg-carup-bg-surface p-3 text-sm" data-testid="wi-confirmation">
            <p className="text-carup-text">
              Confirmed by you for revision {c.dry_run_revision}, expiring <span data-testid="wi-confirmation-expiry">{when(c.expires_at) ?? 'at a time not returned'}</span>.
            </p>
            <p className="mt-1 break-all font-mono text-xs text-carup-text-2">{c.workbook_checksum}</p>
          </div>
        )}
        <button type="button" className={DESK_PRIMARY} onClick={model.onConfirm} data-testid="wi-confirm-submit"
          disabled={Boolean(model.blockReason) || noChecksum || model.busy === 'confirm' || pending}>
          {model.busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          {pending ? 'Confirmed' : 'Confirm this workbook'}
        </button>
      </div>
    </DeskPanel>
  )
}

function ImportStep({ model }: { model: WorkbookImportModel }) {
  const c = model.confirmation
  const ready = Boolean(c) && c?.state === 'pending'
  return (
    <DeskPanel testId="wi-import" eyebrow="Step 4" title="Import"
      description="Importing writes every valid row into your trade records as one all-or-nothing import. If a row fails, CarUp reverses what was applied and receipts every row; if that reversal cannot complete, CarUp’s team takes over. The confirmation is spent either way.">
      <button type="button" className={ready ? DESK_PRIMARY : DESK_SECONDARY} onClick={model.onExecute}
        disabled={!c || c.state !== 'pending' || model.busy === 'execute'} data-testid="wi-execute">
        {model.busy === 'execute' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />} Import now
      </button>
      {!ready && <p className="mt-2 text-xs text-carup-text-2" data-testid="wi-import-locked">Import stays locked until a confirmation is pending.</p>}
    </DeskPanel>
  )
}

/* ───────────────────────── 5 · outcome ───────────────────────── */

function OutcomeStep({ model, result: r }: { model: WorkbookImportModel; result: WorkbookImportExecutionResult }) {
  const success = isSuccessfulImport(r)
  const stuck = needsOperator(r)
  const retryable = isSafeToRetry(r)
  return (
    <DeskPanel testId="wi-outcome" eyebrow="Step 5" title="Outcome">
      {success ? (
        <div className="flex items-start gap-3 rounded-control border border-status-success bg-status-success-soft p-3" data-testid="wi-outcome-success">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success" aria-hidden="true" />
          <div><p className="font-semibold text-carup-text">Imported</p><p className="text-sm text-carup-text">{r.userMessage}</p></div>
        </div>
      ) : stuck ? (
        <div role="alert" className="flex items-start gap-3 rounded-control border border-status-danger bg-status-danger-soft p-3" data-testid="wi-outcome-needs-operator">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-danger" aria-hidden="true" />
          <div>
            <p className="font-semibold text-carup-text">This import needs our team</p>
            <p className="text-sm text-carup-text">{r.userMessage}</p>
            <p className="mt-1 text-sm font-bold text-status-danger" data-testid="wi-do-not-retry">Do not retry this import.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-control border border-status-warning bg-status-warning-soft p-3" data-testid="wi-outcome-failed">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" aria-hidden="true" />
          <div><p className="font-semibold text-carup-text">Not imported</p><p className="text-sm text-carup-text">{r.userMessage}</p></div>
        </div>
      )}
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Status" testId="wi-result-status"><span className="font-mono text-[12.5px]">{r.status}</span></Fact>
        <Fact label="Applied rows" testId="wi-result-applied">{r.appliedRows ?? 'Not reported'}</Fact>
        <Fact label="Rejected rows" testId="wi-result-rejected">{model.receiptsUnreadable ? 'Not known — receipts could not be read' : model.totals.rejected}</Fact>
        <Fact label="Reversed rows" testId="wi-result-reversed">{r.compensatedRows ?? (model.receiptsUnreadable ? 'Not known' : model.totals.compensated)}</Fact>
        {r.failedAtRow != null && <Fact label="Stopped at row (order)">{r.failedAtRow}</Fact>}
        {r.errorCode && <Fact label="Error code"><span className="font-mono text-[12.5px]">{r.errorCode}</span></Fact>}
        {r.receipts != null && <Fact label="Receipts written">{r.receipts}</Fact>}
      </dl>
      {retryable && <p className="mt-3 text-sm text-carup-text" data-testid="wi-safe-to-retry">Nothing remains applied. Fix the workbook, run the dry run again, and confirm.</p>}
    </DeskPanel>
  )
}

/* ───────────────────────── receipts + recovery ───────────────────────── */

function ReceiptsPanel({ model }: { model: WorkbookImportModel }) {
  const { receipts, totals } = model
  if (!model.dryRun && receipts.length === 0 && !model.receiptsUnreadable) return null
  return (
    <DeskPanel testId="wi-receipts" eyebrow="Receipts" title="Per-row result" provenance={<Provenance kind="recorded" />}
      actions={receipts.length > 0 ? (
        <button type="button" className={DESK_SECONDARY} onClick={model.onDownloadCsv} disabled={model.busy === 'csv'} data-testid="wi-download-csv">
          <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
        </button>
      ) : undefined}
      description="“Row (order)” is the row’s position in the import plan, not its line number in your spreadsheet.">
      {model.receiptsUnreadable ? (
        <DeskState kind="failed" compact title="The per-row import results could not be loaded" onRetry={model.onRetryReceipts} testId="wi-receipts-unreadable">
          This is not a report of zero rows.
        </DeskState>
      ) : receipts.length === 0 ? (
        <p className="text-sm text-carup-text-2" data-testid="wi-receipts-none">No per-row results are recorded for this batch yet. They appear once an import runs.</p>
      ) : (
        <>
          <DeskPulse tone="light" scope="Receipts" items={[
            { label: 'imported', value: totals.accepted }, { label: 'rejected', value: totals.rejected },
            { label: 'skipped', value: totals.skipped }, { label: 'reversed', value: totals.compensated }, { label: 'in total', value: totals.total },
          ]} />
          <div className="relative mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="wi-receipts-table">
              <thead>
                <tr className="border-b border-carup-line text-[11px] uppercase tracking-[0.12em] text-carup-text-3">
                  <th scope="col" className="py-2 pr-3 font-semibold">Row (order)</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Sheet</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Outcome</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Record</th>
                  <th scope="col" className="py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-carup-line">
                {receipts.map((r) => (
                  <tr key={r.id} data-testid={`wi-receipt-${r.row_number}`} className="align-top">
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.row_number}</td>
                    <td className="py-2 pr-3 text-carup-text-2">{r.sheet_name || '—'}</td>
                    <td className="py-2 pr-3"><StatusChip tone={outcomeTone(r.outcome)}>{RECEIPT_OUTCOME_LABELS[r.outcome] || r.outcome}</StatusChip></td>
                    <td className="py-2 pr-3 text-carup-text-2">{recordText(r)}</td>
                    <td className="py-2 text-carup-text-2 [overflow-wrap:anywhere]">{r.error_message || r.error_code || '—'}{r.compensated_at ? <span className="block text-xs text-carup-text-3">Reversed {when(r.compensated_at) ?? ''}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="mt-3 space-y-2 md:hidden" data-testid="wi-receipts-cards">
            {receipts.map((r) => (
              <li key={r.id} className="rounded-control bg-carup-bg-surface p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-carup-text">Row (order) {r.row_number}{r.sheet_name ? ` · ${r.sheet_name}` : ''}</span>
                  <StatusChip tone={outcomeTone(r.outcome)}>{RECEIPT_OUTCOME_LABELS[r.outcome] || r.outcome}</StatusChip>
                </div>
                <p className="mt-1 text-xs text-carup-text-2">{recordText(r)}</p>
                {(r.error_message || r.error_code) && <p className="mt-1 text-xs text-carup-text-2 [overflow-wrap:anywhere]">{r.error_message || r.error_code}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </DeskPanel>
  )
}

function outcomeTone(outcome: string) {
  if (outcome === 'accepted') return 'info' as const
  if (outcome === 'rejected') return 'warning' as const
  if (outcome === 'compensated') return 'warning' as const
  return 'neutral' as const
}

function recordText(r: WorkbookImportReceipt): ReactNode {
  if (!r.entity_type && !r.entity_ref) return <span className="text-carup-text-3">No record</span>
  return <>{humanize(r.entity_type, 'Record')}{r.entity_ref ? <span className="ml-1 font-mono text-[12px] text-carup-text">{shortRef(r.entity_ref, 10)}</span> : null}</>
}

function InterruptedPanel({ model }: { model: WorkbookImportModel }) {
  return (
    <DeskPanel testId="wi-interrupted" eyebrow="Recovery" title={<span className="inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-carup-text-3" aria-hidden="true" />Interrupted imports</span>}
      description="An import that stopped partway is listed here with what to do — or not do — next.">
      {model.interruptedUnreadable ? (
        <div className="space-y-2" data-testid="wi-interrupted-unreadable">
          {model.interruptedFailure
            ? <ReadFailureState failure={model.interruptedFailure} what="The interrupted-import check" onRetry={model.onRetryInterrupted} compact />
            : <DeskState kind="failed" compact title="The interrupted-import check could not be loaded" onRetry={model.onRetryInterrupted} />}
          <p className="px-1 text-sm font-semibold leading-6 text-carup-text">
            This is not confirmation that there are none — if an import was interrupted, do not retry it until this check succeeds.
          </p>
        </div>
      ) : model.interrupted.length > 0 ? (
        <ul className="space-y-2" data-testid="wi-interrupted-list">
          {model.interrupted.map((b) => (
            <li key={b.id} className="rounded-control border border-carup-line p-3 text-sm" data-testid={`wi-interrupted-${b.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={b.needsHuman ? 'danger' : 'warning'}>{humanize(b.status)}</StatusChip>
                <span className="font-mono text-xs text-carup-text-2">{shortRef(b.id, 10)}</span>
                <span className="text-xs text-carup-text-3">{b.totalRows != null ? plural(b.totalRows, 'row') : 'Row count not recorded'}{when(b.updatedAt) ? ` · updated ${when(b.updatedAt)}` : ''}</span>
              </div>
              {b.needsHuman ? (
                <p className="mt-1 font-semibold text-status-danger" data-testid={`wi-interrupted-needs-human-${b.id}`}>Partly applied and could not be fully reversed. Our team is resolving it — do not retry.</p>
              ) : (
                <p className="mt-1 text-carup-text-2">This import stopped partway. Its per-row result shows exactly how far it got.</p>
              )}
            </li>
          ))}
        </ul>
      ) : !model.tenantId ? (
        <DeskState kind="unavailable" compact title="No organisation to check" testId="wi-interrupted-no-tenant">
          The interrupted-import check is scoped to an organisation, and this account is not acting for one, so the check returned nothing. That is not confirmation that no import was interrupted.
        </DeskState>
      ) : (
        <p className="text-sm text-carup-text-2" data-testid="wi-interrupted-none">No interrupted imports for your organisation.</p>
      )}
    </DeskPanel>
  )
}
