/**
 * Pure helpers for the confirmed workbook import page (Deliverable B, Issue #127).
 *
 * Separated from the component so the confirmation-gating rules — the part that decides whether a
 * user is allowed to press the button that writes to several domains — can be unit-tested directly,
 * without rendering. They are also exported for the component, which keeps the rendered state and the
 * tested rule the same object rather than two implementations that can drift.
 */
import type { WorkbookImportReceipt, WorkbookImportExecutionResult } from '@/types'

export interface DryRunSummary {
  batchId: string
  checksum: string | null
  dryRunRevision: number
  totalRows: number
  validRows: number
  invalidRows: number
  /** Server-reported entitlement/quota verdict for the confirmed-import feature. */
  quotaAllowed: boolean
  quotaMessage: string | null
}

export type ConfirmBlockReason =
  | 'NO_DRY_RUN'
  | 'INVALID_ROWS'
  | 'CHECKSUM_CHANGED'
  | 'CONFIRMATION_EXPIRED'
  | 'CONTEXT_CHANGED'
  | 'QUOTA_DENIED'
  | null

/**
 * Why confirmation is refused, or null when it may proceed.
 *
 * Order matters: the reason returned is the one the user should act on FIRST. Telling someone their
 * quota is exhausted when the real problem is that eight rows failed validation sends them to the
 * wrong place entirely.
 *
 * This mirrors the server's own refusals rather than replacing them — the backend re-checks every one
 * of these against current state and is the only thing that actually prevents an import.
 */
export function confirmBlockReason(input: {
  dryRun: DryRunSummary | null
  displayedChecksum: string | null
  currentChecksum: string | null
  confirmationExpiresAt?: string | null
  now?: Date
  contextTenantId?: string | null
  contextUserId?: string | null
  boundTenantId?: string | null
  boundUserId?: string | null
}): ConfirmBlockReason {
  const { dryRun } = input
  if (!dryRun) return 'NO_DRY_RUN'

  // Blocking rows come before everything: nothing else is worth reporting while the workbook itself
  // is not importable.
  if (dryRun.invalidRows > 0) return 'INVALID_ROWS'

  // The workbook moved under the preview the user is looking at.
  if (input.displayedChecksum && input.currentChecksum
      && input.displayedChecksum !== input.currentChecksum) return 'CHECKSUM_CHANGED'

  // Identity changed since the confirmation was minted (tenant switch, re-login as someone else).
  if (input.boundTenantId && input.contextTenantId && input.boundTenantId !== input.contextTenantId) return 'CONTEXT_CHANGED'
  if (input.boundUserId && input.contextUserId && input.boundUserId !== input.contextUserId) return 'CONTEXT_CHANGED'

  if (input.confirmationExpiresAt) {
    const now = input.now ?? new Date()
    if (new Date(input.confirmationExpiresAt) <= now) return 'CONFIRMATION_EXPIRED'
  }

  if (!dryRun.quotaAllowed) return 'QUOTA_DENIED'
  return null
}

export const CONFIRM_BLOCK_MESSAGES: Record<Exclude<ConfirmBlockReason, null>, string> = {
  NO_DRY_RUN: 'Run a dry run first so you can review what would be imported.',
  INVALID_ROWS: 'Some rows failed validation. Fix them in the workbook and run the dry run again — a partial import is not offered.',
  CHECKSUM_CHANGED: 'The workbook has changed since this preview was generated. Nothing was imported. Run the dry run again and review it.',
  CONFIRMATION_EXPIRED: 'This confirmation has expired. Review the preview again and confirm.',
  CONTEXT_CHANGED: 'Your organisation or sign-in changed after you confirmed. Confirm again so the import is attributed correctly.',
  QUOTA_DENIED: 'Your plan does not have enough remaining import capacity for this workbook.',
}

export function explainConfirmBlock(reason: ConfirmBlockReason): string | null {
  return reason ? CONFIRM_BLOCK_MESSAGES[reason] : null
}

/**
 * Whether the RESULT of an execution may be presented as a success.
 *
 * Deliberately not `result.status === 'IMPORTED'` alone: `imported` is the server's own all-or-nothing
 * verdict, and requiring both means a future status value cannot accidentally read as success.
 */
export function isSuccessfulImport(result: WorkbookImportExecutionResult | null): boolean {
  return Boolean(result?.imported) && result?.status === 'IMPORTED'
}

/**
 * A partly-applied import that could not be fully reversed. The only state where a retry could
 * genuinely double-apply, so the UI must say so rather than offering a retry button.
 */
export function needsOperator(result: WorkbookImportExecutionResult | null): boolean {
  return result?.status === 'NEEDS_OPERATOR' || Number(result?.compensationFailures ?? 0) > 0
}

/**
 * A failure where nothing remains applied — every row was reversed, or none ever landed. Safe to fix
 * the workbook and try again, and the only failure shape where a retry is offered.
 */
export function isSafeToRetry(result: WorkbookImportExecutionResult | null): boolean {
  if (!result || result.imported) return false
  if (needsOperator(result)) return false
  return result.status === 'COMPENSATED' || result.status === 'FAILED_IMPORT'
}

export interface ReceiptTotals {
  accepted: number
  rejected: number
  skipped: number
  compensated: number
  total: number
}

export function summarizeReceipts(receipts: WorkbookImportReceipt[] = []): ReceiptTotals {
  const totals: ReceiptTotals = { accepted: 0, rejected: 0, skipped: 0, compensated: 0, total: receipts.length }
  for (const r of receipts) {
    if (r.outcome === 'accepted') totals.accepted += 1
    else if (r.outcome === 'rejected') totals.rejected += 1
    else if (r.outcome === 'skipped') totals.skipped += 1
    else if (r.outcome === 'compensated') totals.compensated += 1
  }
  return totals
}

/** Generates the idempotency key for a confirmation attempt. */
export function confirmationIdempotencyKey(batchId: string, checksum: string, revision: number): string {
  return `confirm:${batchId}:${checksum}:${revision}`
}

export const RECEIPT_OUTCOME_LABELS: Record<string, string> = {
  accepted: 'Imported',
  rejected: 'Rejected',
  skipped: 'Skipped',
  compensated: 'Reversed',
  pending: 'Pending',
}
