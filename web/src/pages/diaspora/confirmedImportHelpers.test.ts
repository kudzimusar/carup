/**
 * Confirmed-import gating rules — unit tests (Deliverable B, Issue #127).
 *
 * These are the rules that decide whether a user may press the button that writes across several
 * domains, and the rules that decide whether the outcome may be described as a success. Both are
 * pure, so they are tested directly rather than through the DOM — the component renders whatever
 * these return, so a rule proven here is a rule the page cannot contradict.
 */
import { describe, it, expect } from 'vitest'
import {
  confirmBlockReason, explainConfirmBlock, CONFIRM_BLOCK_MESSAGES,
  isSuccessfulImport, needsOperator, isSafeToRetry,
  summarizeReceipts, confirmationIdempotencyKey,
  type DryRunSummary,
} from './confirmedImportHelpers'
import type { WorkbookImportExecutionResult, WorkbookImportReceipt } from '@/types'

const cleanDryRun: DryRunSummary = {
  batchId: 'batch-1',
  checksum: 'abc123',
  dryRunRevision: 1,
  totalRows: 10,
  validRows: 10,
  invalidRows: 0,
  quotaAllowed: true,
  quotaMessage: null,
}

describe('confirmation gating', () => {
  it('allows confirmation for a clean dry run', () => {
    expect(confirmBlockReason({ dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'abc123' })).toBeNull()
  })

  it('blocks with no dry run at all', () => {
    expect(confirmBlockReason({ dryRun: null, displayedChecksum: null, currentChecksum: null })).toBe('NO_DRY_RUN')
  })

  it('blocks while any row is invalid, and offers no partial import', () => {
    const reason = confirmBlockReason({
      dryRun: { ...cleanDryRun, invalidRows: 3, validRows: 7 },
      displayedChecksum: 'abc123', currentChecksum: 'abc123',
    })
    expect(reason).toBe('INVALID_ROWS')
    expect(explainConfirmBlock(reason)).toMatch(/partial import is not offered/)
  })

  it('blocks when the workbook changed under the preview', () => {
    const reason = confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'DIFFERENT',
    })
    expect(reason).toBe('CHECKSUM_CHANGED')
    expect(explainConfirmBlock(reason)).toMatch(/Nothing was imported/)
  })

  it('blocks an expired confirmation', () => {
    const reason = confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'abc123',
      confirmationExpiresAt: '2026-07-28T09:00:00.000Z',
      now: new Date('2026-07-28T10:00:00.000Z'),
    })
    expect(reason).toBe('CONFIRMATION_EXPIRED')
  })

  it('allows a confirmation that has not yet expired', () => {
    expect(confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'abc123',
      confirmationExpiresAt: '2026-07-28T11:00:00.000Z',
      now: new Date('2026-07-28T10:00:00.000Z'),
    })).toBeNull()
  })

  it('blocks when the tenant changed after confirming', () => {
    expect(confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'abc123',
      boundTenantId: 'tenant-A', contextTenantId: 'tenant-B',
    })).toBe('CONTEXT_CHANGED')
  })

  it('blocks when the signed-in user changed after confirming', () => {
    expect(confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'abc123',
      boundUserId: 'user-1', contextUserId: 'user-2',
    })).toBe('CONTEXT_CHANGED')
  })

  it('blocks when quota is denied', () => {
    expect(confirmBlockReason({
      dryRun: { ...cleanDryRun, quotaAllowed: false },
      displayedChecksum: 'abc123', currentChecksum: 'abc123',
    })).toBe('QUOTA_DENIED')
  })

  it('reports invalid rows BEFORE quota — the user must fix the workbook first', () => {
    // Telling someone their quota is exhausted when eight rows failed validation sends them to the
    // wrong place entirely.
    expect(confirmBlockReason({
      dryRun: { ...cleanDryRun, invalidRows: 8, quotaAllowed: false },
      displayedChecksum: 'abc123', currentChecksum: 'abc123',
    })).toBe('INVALID_ROWS')
  })

  it('reports a changed workbook before an expired confirmation', () => {
    // Both are true, but re-confirming an expired token for a workbook that moved would just fail again.
    expect(confirmBlockReason({
      dryRun: cleanDryRun, displayedChecksum: 'abc123', currentChecksum: 'CHANGED',
      confirmationExpiresAt: '2026-07-28T09:00:00.000Z', now: new Date('2026-07-28T10:00:00.000Z'),
    })).toBe('CHECKSUM_CHANGED')
  })

  it('every block reason has an actionable message', () => {
    for (const [reason, message] of Object.entries(CONFIRM_BLOCK_MESSAGES)) {
      expect(message.length, `${reason} needs a real message`).toBeGreaterThan(15)
      expect(message).not.toMatch(/undefined|null|\[object/)
    }
    expect(explainConfirmBlock(null)).toBeNull()
  })
})

describe('outcome truthfulness', () => {
  const base: WorkbookImportExecutionResult = {
    imported: false, batchId: 'b', confirmationId: 'c', status: 'COMPENSATED', userMessage: 'x',
  }

  it('success requires BOTH the imported flag and the IMPORTED status', () => {
    expect(isSuccessfulImport({ ...base, imported: true, status: 'IMPORTED' })).toBe(true)
    // A future status value cannot accidentally read as success.
    expect(isSuccessfulImport({ ...base, imported: true, status: 'PARTIALLY_IMPORTED' })).toBe(false)
    expect(isSuccessfulImport({ ...base, imported: false, status: 'IMPORTED' })).toBe(false)
    expect(isSuccessfulImport(null)).toBe(false)
  })

  it('NEEDS_OPERATOR is recognised as needing a human', () => {
    expect(needsOperator({ ...base, status: 'NEEDS_OPERATOR' })).toBe(true)
  })

  it('any un-reversed row means a human is needed, whatever the status says', () => {
    // Defence in depth: if compensation partly failed, that is the fact that matters.
    expect(needsOperator({ ...base, status: 'COMPENSATED', compensationFailures: 2 })).toBe(true)
  })

  it('a fully-reversed failure is safe to retry', () => {
    expect(isSafeToRetry({ ...base, status: 'COMPENSATED' })).toBe(true)
    expect(isSafeToRetry({ ...base, status: 'FAILED_IMPORT' })).toBe(true)
  })

  it('a partly-applied failure is NOT safe to retry', () => {
    // The one case where retrying could double-apply.
    expect(isSafeToRetry({ ...base, status: 'NEEDS_OPERATOR' })).toBe(false)
    expect(isSafeToRetry({ ...base, status: 'COMPENSATED', compensationFailures: 1 })).toBe(false)
  })

  it('a success is never offered as retryable', () => {
    expect(isSafeToRetry({ ...base, imported: true, status: 'IMPORTED' })).toBe(false)
  })
})

describe('receipt totals', () => {
  const r = (outcome: string, n: number): WorkbookImportReceipt => ({
    id: `r${n}`, batch_id: 'b', row_number: n, sheet_name: 'Stock', outcome,
    entity_type: null, entity_ref: null, error_code: null, error_message: null,
    compensated_at: null, attempt: 1, created_at: 'x',
  })

  it('counts each outcome separately', () => {
    const totals = summarizeReceipts([r('accepted', 1), r('accepted', 2), r('rejected', 3), r('skipped', 4), r('compensated', 5)])
    expect(totals).toEqual({ accepted: 2, rejected: 1, skipped: 1, compensated: 1, total: 5 })
  })

  it('handles an empty set', () => {
    expect(summarizeReceipts([])).toEqual({ accepted: 0, rejected: 0, skipped: 0, compensated: 0, total: 0 })
  })
})

describe('idempotency key', () => {
  it('is stable for the same batch, checksum and revision', () => {
    // A double-click must produce the SAME key, so the server returns the same confirmation.
    expect(confirmationIdempotencyKey('b1', 'abc', 1)).toBe(confirmationIdempotencyKey('b1', 'abc', 1))
  })

  it('changes when the workbook changes', () => {
    expect(confirmationIdempotencyKey('b1', 'abc', 1)).not.toBe(confirmationIdempotencyKey('b1', 'CHANGED', 1))
  })

  it('changes when the dry run is re-run', () => {
    expect(confirmationIdempotencyKey('b1', 'abc', 1)).not.toBe(confirmationIdempotencyKey('b1', 'abc', 2))
  })
})
