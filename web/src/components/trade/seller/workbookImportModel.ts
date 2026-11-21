/**
 * RX-06 Trade — the workbook import desk's model and read-outs (no components here).
 *
 * The confirmation rules live in pages/diaspora/confirmedImportHelpers.ts and are reused, never
 * restated. The only rule this desk adds is STRICTER, never looser: a confirmation binds to the
 * workbook checksum on screen, so with no checksum on screen there is nothing to bind and Confirm
 * stays disabled with the reason said plainly (the server would refuse it anyway).
 */
import type { WorkbookImportConfirmation, WorkbookImportExecutionResult, WorkbookImportReceipt, WorkbookInterruptedBatch } from '@/types'
import type { ConfirmBlockReason, DryRunSummary, ReceiptTotals } from '@/pages/diaspora/confirmedImportHelpers'
import type { ReadFailure } from './deskFormat'

export interface WorkbookImportModel {
  flagEnabled: boolean
  isAuthenticated: boolean
  authLoading: boolean
  role: string
  /** The signed-in account's active organisation, or null (the interrupted-import check is scoped to it). */
  tenantId: string | null
  batchIdInput: string
  setBatchIdInput: (v: string) => void
  onLoadBatch: () => void
  loadFailure: ReadFailure | null
  dryRun: DryRunSummary | null
  /** The batch summary as returned, for the breakdowns the narrowed preview does not keep. */
  dryRunRaw: Record<string, unknown> | null
  /** Whether the summary read itself carried these values (otherwise the page fell back to a default). */
  reported: { revision: boolean; quota: boolean } | null
  rowMessages: { row: number; sheet: string | null; message: string }[]
  blockReason: ConfirmBlockReason
  blockMessage: string | null
  confirmation: WorkbookImportConfirmation | null
  onConfirm: () => void
  onExecute: () => void
  result: WorkbookImportExecutionResult | null
  receipts: WorkbookImportReceipt[]
  receiptsUnreadable: boolean
  onRetryReceipts: () => void
  totals: ReceiptTotals
  onDownloadCsv: () => void
  interrupted: WorkbookInterruptedBatch[]
  interruptedUnreadable: boolean
  /** Why the interrupted-import check failed (null while fine). */
  interruptedFailure: ReadFailure | null
  onRetryInterrupted: () => void
  busy: string | null
  error: string | null
  notice: string | null
}

/** Roles that can open the workbook dry-run console (DiasporaWorkbookDryRun / OperatorConsole). */
export const DRY_RUN_OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])

export type ImportStep = 'load' | 'review' | 'confirm' | 'import' | 'outcome'
export type StepState = 'done' | 'current' | 'upcoming'

export const IMPORT_STEPS: ReadonlyArray<{ id: ImportStep; label: string }> = [
  { id: 'load', label: 'Load the dry run' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'import', label: 'Import' },
  { id: 'outcome', label: 'Outcome' },
]

/** Where the flow stands, from the page's own state only. */
export function stepStates(m: Pick<WorkbookImportModel, 'dryRun' | 'confirmation' | 'result'>): Record<ImportStep, StepState> {
  if (m.result) return { load: 'done', review: 'done', confirm: 'done', import: 'done', outcome: 'current' }
  if (m.confirmation && m.confirmation.state === 'pending') return { load: 'done', review: 'done', confirm: 'done', import: 'current', outcome: 'upcoming' }
  // Reviewing IS the step before confirming: the confirmation is how the review gets recorded.
  if (m.dryRun) return { load: 'done', review: 'current', confirm: 'upcoming', import: 'upcoming', outcome: 'upcoming' }
  return { load: 'current', review: 'upcoming', confirm: 'upcoming', import: 'upcoming', outcome: 'upcoming' }
}

/** A `{ key: count }` breakdown from the summary, or null when the read did not carry one. */
export function breakdown(value: unknown): Array<[string, number]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rows = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [k, Number(v)] as [string, number])
    .filter(([, n]) => Number.isFinite(n))
  return rows.length ? rows : null
}

export const CHECKSUM_MISSING_REASON =
  'This dry-run read did not include the workbook checksum the confirmation binds to, so CarUp’s server cannot accept a confirmation for it. Nothing about your workbook changed — the read simply did not carry the checksum.'
