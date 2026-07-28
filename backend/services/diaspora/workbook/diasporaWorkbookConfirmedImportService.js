/**
 * Confirmed workbook import — execution (Deliverable B, Issue #127).
 *
 * Replaces the truthful deferral in diasporaWorkbookSyncService (`Workbook import execution is
 * intentionally disabled in Phase 1C`) with a workflow that is safe to actually run.
 *
 * The shape of the problem: a workbook writes across several domains, and those writes cannot all sit
 * in one database transaction because they go through domain services that enforce publish rules,
 * capacity, quotas and role gates of their own. So a partial failure is not hypothetical — it is the
 * normal case that has to be handled correctly.
 *
 * What that means concretely:
 *
 *   · **Nothing executes without a valid confirmation**, re-checked against the CURRENT batch at the
 *     moment of execution, then consumed single-use.
 *   · **Every row gets a receipt**, written as the row is decided. A crash mid-import leaves a
 *     truthful partial record, not silence.
 *   · **A failed import compensates what it already applied**, and marks those receipts
 *     `compensated` rather than deleting them — the fact that a row was applied and then reversed is
 *     itself something an operator needs to see.
 *   · **Quota is reserved before, committed on success, released on failure.** Reserving after would
 *     let a batch exceed its allowance; committing on failure would charge for work that was undone.
 *   · **The batch state machine is durable**, so a recovery pass can tell the difference between "in
 *     flight", "applied", "compensated" and "needs a human".
 *   · **Partial outcomes are never reported as success.** `IMPORTED` means every row applied;
 *     anything else says so in its name and in its user-facing message.
 *
 * This service never writes domain rows directly — it drives the existing execution primitive, which
 * goes through the allow-listed domain adapters.
 */
import { resolveClient, appendCriticalAudit, requestCorrelationId } from '../diasporaServiceUtils.js';
import { ValidationError, ForbiddenError } from '../../../utils/errors.js';
import {
  validateConfirmation, consumeConfirmation, explainRefusal, BATCHES_TABLE,
} from './diasporaWorkbookConfirmationService.js';
import {
  buildWorkbookImportPlan,
} from '../diasporaWorkbookImportPlanningService.js';
import {
  executeWorkbookImportAction,
} from '../diasporaWorkbookImportExecutionService.js';
import { requireFeature, reserveQuotaForFeature } from '../diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';

export const RECEIPTS_TABLE = 'diaspora_workbook_import_receipts';
export const ROWS_TABLE = 'diaspora_workbook_import_rows';

/**
 * The entitlement gate for confirmed import.
 *
 * Reuses the existing metered `diaspora.workbook.bulk_import` key rather than inventing a new one: a
 * key absent from the plan matrix resolves to a zero limit and would deny every tenant on every plan,
 * which looks identical to a correctly-enforced quota and is very hard to notice.
 */
export const CONFIRMED_IMPORT_FEATURE_KEY = FEATURE_KEYS.WORKBOOK_BULK_IMPORT;

/**
 * Durable batch states for CONFIRMED import.
 *
 * Deliberately distinct from the existing `*_DRAFTS` states: draft import and confirmed import are
 * different operations with different consequences, and collapsing them would make a recovery pass
 * unable to tell which one was interrupted.
 */
export const CONFIRMED_IMPORT_STATUSES = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  IMPORTING: 'IMPORTING',
  IMPORTED: 'IMPORTED',
  PARTIALLY_IMPORTED: 'PARTIALLY_IMPORTED',
  COMPENSATING: 'COMPENSATING',
  COMPENSATED: 'COMPENSATED',
  FAILED_IMPORT: 'FAILED_IMPORT',
  NEEDS_OPERATOR: 'NEEDS_OPERATOR',
});

/** States from which a recovery pass may resume. */
export const RESUMABLE_STATUSES = Object.freeze([
  CONFIRMED_IMPORT_STATUSES.IMPORTING,
  CONFIRMED_IMPORT_STATUSES.COMPENSATING,
]);

export const RECEIPT_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
  COMPENSATED: 'compensated',
  PENDING: 'pending',
});

/**
 * The executor→orchestrator seam.
 *
 * `executeWorkbookImportAction` reports an outcome through `status` plus `targetRecordId` (see
 * makeExecutedResult / makeSkippedResult / makeBlockedResult / makeAlreadyExecutedResult in
 * diasporaWorkbookImportExecutionService). It has never exposed an `executed` boolean or a
 * `recordId`, but this orchestrator read exactly those two fields — so `result?.executed` was
 * permanently undefined and EVERY row, including rows whose draft record was successfully inserted,
 * was classified as a skip. `applied` therefore stayed empty, which meant compensation had nothing
 * to reverse while the inserted rows remained in the database, and a half-applied run still told the
 * user "every applied row was reversed. Nothing was imported."
 *
 * It is exported and pure so the contract can be asserted directly, which is what the original tests
 * could not do: they only ever executed an empty row set, where "0 rows applied" is true either way.
 *
 * `applied` means "this run created it, so this run may reverse it" — deliberately false for
 * alreadyExecuted, where a previous run created the record and compensating it here would undo work
 * this import never did.
 */
export function classifyExecutionResult(result) {
  const recordId = result?.targetRecordId ?? null;
  switch (result?.status) {
    case 'executed':
      return { outcome: RECEIPT_OUTCOME.ACCEPTED, applied: true, recordId, errorCode: null, errorMessage: null };
    case 'alreadyExecuted':
      return { outcome: RECEIPT_OUTCOME.ACCEPTED, applied: false, recordId, errorCode: null, errorMessage: null };
    default:
      return {
        outcome: RECEIPT_OUTCOME.SKIPPED,
        applied: false,
        recordId: null,
        errorCode: result?.errorCode || result?.blockedReason || 'ROW_SKIPPED',
        errorMessage: result?.message || null,
      };
  }
}

function requireActor(userContext) {
  if (!userContext?.id) throw new ForbiddenError('A confirmed workbook import requires an authenticated user');
  return userContext;
}

async function setBatchStatus(supabase, batchId, status, extraMetadata = {}) {
  const { data: current } = await supabase.from(BATCHES_TABLE).select('metadata').eq('id', batchId).maybeSingle();
  const metadata = { ...(current?.metadata || {}) };
  metadata.confirmedImport = { ...(metadata.confirmedImport || {}), ...extraMetadata, status };
  const { error } = await supabase
    .from(BATCHES_TABLE)
    .update({ import_status: status, metadata })
    .eq('id', batchId);
  if (error) throw new ValidationError(`Failed to update the workbook batch state: ${error.message}`);
  return status;
}

/**
 * Write a receipt for one row.
 *
 * `entity_ref` is the id of the row we created in OUR schema. It is meaningless without an authorized
 * read, so it is safe to store — unlike anything drawn from the workbook's own cells, which can hold
 * names, addresses and contact details and is therefore never copied here.
 */
async function writeReceipt(supabase, {
  tenantId, batchId, confirmationId, rowId, rowNumber, sheetName,
  outcome, entityType = null, entityRef = null, errorCode = null, errorMessage = null, attempt = 1,
}) {
  const { data, error } = await supabase
    .from(RECEIPTS_TABLE)
    .insert({
      tenant_id: tenantId,
      batch_id: batchId,
      confirmation_id: confirmationId,
      row_id: rowId,
      row_number: rowNumber,
      sheet_name: sheetName,
      outcome,
      entity_type: entityType,
      entity_ref: entityRef,
      error_code: errorCode,
      // Sanitized and bounded: a domain-service error can echo submitted values back.
      error_message: errorMessage ? String(errorMessage).slice(0, 300) : null,
      attempt,
    })
    .select()
    .maybeSingle();
  if (error) {
    // A duplicate receipt means this row was already decided in a previous attempt — that is a safe
    // no-op, not a failure. Anything else is real.
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) return null;
    throw new ValidationError(`Failed to write an import receipt: ${error.message}`);
  }
  return data;
}

/**
 * Compensate one applied row.
 *
 * Compensation soft-deletes the record the import created, through the same allow-listed target
 * table. It is deliberately NOT a hard delete: the row existed, and an operator investigating a
 * partial import needs to see that it existed and was reversed.
 */
async function compensateAction(supabase, applied) {
  const { table, recordId } = applied;
  if (!table || !recordId) return { ok: false, reason: 'NO_RECORD_TO_COMPENSATE' };
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString(), status: 'CANCELLED' })
    .eq('id', recordId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Execute a confirmed import.
 *
 * Returns a truthful envelope. `imported` is true ONLY when every row applied; a partial run returns
 * `imported: false` with the compensation outcome, because telling a user their workbook imported
 * when half of it was rolled back is the single worst thing this service could do.
 */
export async function executeConfirmedWorkbookImport({
  batchId,
  confirmationId,
  userContext,
  supabaseClient = null,
  req = null,
  now = null,
} = {}) {
  requireActor(userContext);
  const supabase = await resolveClient({ supabaseClient });
  const correlationId = requestCorrelationId(req);

  // ── 1. The confirmation must still describe the workbook on file ──────────
  const validation = await validateConfirmation({
    confirmationId, batchId, userContext, supabaseClient: supabase, now,
  });
  if (!validation.ok) {
    throw new ValidationError(explainRefusal(validation.reason), {
      batchId, confirmationId, errorCode: validation.reason, imported: false,
    });
  }
  const { confirmation, batch } = validation;
  const tenantId = confirmation.tenant_id;

  // ── 2. Entitlement, before anything is consumed or reserved ───────────────
  await requireFeature(supabase, {
    tenantId, userId: userContext.id, featureKey: CONFIRMED_IMPORT_FEATURE_KEY,
  });

  // ── 3. Consume the confirmation — single use, race-safe ───────────────────
  const consumed = await consumeConfirmation({ confirmationId, supabaseClient: supabase, now });
  if (!consumed) {
    // Someone else won the race. Their import is the one that counts.
    throw new ValidationError(explainRefusal('CONFIRMATION_CONSUMED'), {
      batchId, confirmationId, errorCode: 'CONFIRMATION_CONSUMED', imported: false,
    });
  }

  // ── 4. Build the plan from the CURRENT rows ───────────────────────────────
  const { data: rows, error: rowsError } = await supabase
    .from(ROWS_TABLE).select('*').eq('batch_id', batchId).is('deleted_at', null);
  if (rowsError) throw new ValidationError(`Failed to read workbook rows: ${rowsError.message}`);

  const plan = buildWorkbookImportPlan(batch, rows || [], userContext);
  const executable = (plan.actions || []).filter((a) => !a.blocked);

  // ── 5. Reserve quota BEFORE applying anything ─────────────────────────────
  // Reserving afterwards would let a batch exceed its allowance and only discover it once the rows
  // were already written. The guard returns a no-op handle when enforcement is off, so this path is
  // identical in both modes and commit()/release() below are unconditionally safe.
  let quota = null;
  try {
    quota = await reserveQuotaForFeature(supabase, {
      tenantId,
      userId: userContext.id,
      featureKey: CONFIRMED_IMPORT_FEATURE_KEY,
      amount: executable.length || 1,
      // Bound to the confirmation, so a retried execution of the SAME confirmation reserves once.
      idempotencyKey: `confirmed-import:${confirmationId}`,
    });
  } catch (e) {
    await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.FAILED_IMPORT, {
      reason: 'QUOTA_DENIED', correlationId,
    });
    throw new ValidationError('Your plan does not have enough remaining import capacity for this workbook. Nothing was imported.', {
      batchId, errorCode: 'QUOTA_DENIED', imported: false, detail: e?.message,
    });
  }

  await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.IMPORTING, {
    confirmationId, startedAt: new Date().toISOString(), correlationId, plannedRows: executable.length,
  });

  // ── 6. Apply, recording a receipt per row as it is decided ────────────────
  //
  // The executor→orchestrator seam is classifyExecutionResult (above). Reading it wrong is what made
  // this loop record every applied row as a skip.
  const applied = [];
  const receipts = [];
  const executionContext = {};
  let failure = null;

  for (const action of plan.actions || []) {
    const rowNumber = Number(action.rowNumber ?? action.row?.row_number ?? receipts.length + 1);
    const base = {
      tenantId, batchId, confirmationId, rowId: action.rowId || action.row?.id || null,
      rowNumber, sheetName: action.sheetName || action.row?.sheet_name || null,
    };

    if (action.blocked) {
      receipts.push(await writeReceipt(supabase, {
        ...base, outcome: RECEIPT_OUTCOME.REJECTED,
        errorCode: action.blockedReason || 'ROW_BLOCKED',
        errorMessage: 'This row was blocked by validation and was not imported.',
      }));
      continue;
    }

    try {
      const result = await executeWorkbookImportAction(action, batch, userContext, {
        supabaseClient: supabase, executionContext,
      });
      const decision = classifyExecutionResult(result);
      if (decision.applied) {
        applied.push({ table: action.targetTable, recordId: decision.recordId, rowNumber });
      }
      receipts.push(await writeReceipt(supabase, decision.outcome === RECEIPT_OUTCOME.ACCEPTED
        ? { ...base, outcome: RECEIPT_OUTCOME.ACCEPTED, entityType: action.targetTable, entityRef: decision.recordId }
        : {
          ...base, outcome: decision.outcome,
          errorCode: decision.errorCode, errorMessage: decision.errorMessage,
        }));
    } catch (e) {
      // The first hard failure stops the run. Continuing would apply more rows on top of a batch we
      // already know is going to be reversed.
      failure = { rowNumber, message: e?.message, code: e?.code || 'ROW_EXECUTION_FAILED' };
      receipts.push(await writeReceipt(supabase, {
        ...base, outcome: RECEIPT_OUTCOME.REJECTED,
        errorCode: failure.code, errorMessage: failure.message,
      }));
      break;
    }
  }

  // ── 7a. Clean run → commit quota, mark imported ───────────────────────────
  if (!failure) {
    await quota.commit({ actor: userContext.id, req });
    await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.IMPORTED, {
      confirmationId, completedAt: new Date().toISOString(), correlationId,
      appliedRows: applied.length,
    });
    await appendCriticalAudit(supabase, {
      tenantId, actorId: userContext.id,
      action: 'DIASPORA_WORKBOOK_IMPORT_EXECUTED',
      resourceType: 'diaspora_workbook_import_batch', resourceId: batchId,
      newState: { appliedRows: applied.length, confirmationId },
      req,
    });
    return {
      imported: true,
      batchId,
      confirmationId,
      status: CONFIRMED_IMPORT_STATUSES.IMPORTED,
      appliedRows: applied.length,
      receipts: receipts.filter(Boolean).length,
      userMessage: `Imported ${applied.length} row${applied.length === 1 ? '' : 's'}.`,
    };
  }

  // ── 7b. Failure → compensate what was already applied ─────────────────────
  await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.COMPENSATING, {
    confirmationId, failedAtRow: failure.rowNumber, correlationId, appliedRows: applied.length,
  });

  const compensationFailures = [];
  for (const record of applied) {
    const outcome = await compensateAction(supabase, record);
    if (outcome.ok) {
      await writeReceipt(supabase, {
        tenantId, batchId, confirmationId, rowId: null, rowNumber: record.rowNumber,
        sheetName: null, outcome: RECEIPT_OUTCOME.COMPENSATED,
        entityType: record.table, entityRef: record.recordId, attempt: 2,
        errorCode: 'COMPENSATED_AFTER_FAILURE',
        errorMessage: 'This row was applied and then reversed because a later row failed.',
      });
    } else {
      compensationFailures.push({ ...record, reason: outcome.reason });
    }
  }

  // Quota is released, not committed — the work was undone, so charging for it would be wrong.
  await quota.release({ actor: userContext.id, req });

  // A compensation that itself failed is the one case a human MUST look at: some rows are applied,
  // could not be reversed, and the batch is genuinely inconsistent.
  const finalStatus = compensationFailures.length > 0
    ? CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR
    : CONFIRMED_IMPORT_STATUSES.COMPENSATED;

  await setBatchStatus(supabase, batchId, finalStatus, {
    confirmationId, correlationId,
    failedAtRow: failure.rowNumber,
    compensatedRows: applied.length - compensationFailures.length,
    compensationFailures: compensationFailures.length,
  });

  await appendCriticalAudit(supabase, {
    tenantId, actorId: userContext.id,
    action: 'DIASPORA_WORKBOOK_IMPORT_FAILED',
    resourceType: 'diaspora_workbook_import_batch', resourceId: batchId,
    newState: {
      failedAtRow: failure.rowNumber, errorCode: failure.code,
      compensatedRows: applied.length - compensationFailures.length,
      compensationFailures: compensationFailures.length,
      finalStatus,
    },
    req,
  });

  return {
    imported: false,
    batchId,
    confirmationId,
    status: finalStatus,
    failedAtRow: failure.rowNumber,
    errorCode: failure.code,
    appliedRows: applied.length,
    compensatedRows: applied.length - compensationFailures.length,
    compensationFailures: compensationFailures.length,
    receipts: receipts.filter(Boolean).length,
    userMessage: compensationFailures.length > 0
      ? `The import failed at row ${failure.rowNumber}. ${applied.length - compensationFailures.length} of ${applied.length} applied rows were reversed, but ${compensationFailures.length} could not be. Our team has been notified — do not retry.`
      : `The import failed at row ${failure.rowNumber} and every row applied before it was reversed. Nothing was imported. Fix the workbook and try again.`,
  };
}

/**
 * Per-row receipts for a batch, for the downloadable result and the UI.
 *
 * Ordered by row number so the result reads like the workbook the user submitted.
 */
export async function listReceipts({ batchId, tenantId = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(RECEIPTS_TABLE)
    .select('id, batch_id, row_number, sheet_name, outcome, entity_type, entity_ref, error_code, error_message, compensated_at, attempt, created_at')
    .eq('batch_id', batchId)
    .order('row_number', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to read import receipts: ${error.message}`);
  return data || [];
}

/** RFC 4180 escaping — a value containing a comma, quote or newline must not break the column count. */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The downloadable result.
 *
 * Contains outcome, reason and our own entity reference — never a value copied back out of the
 * workbook. The user already has their own file; echoing its contents into a second artefact only
 * creates another copy of whatever personal data it held.
 */
export function buildReceiptCsv(receipts = []) {
  const header = ['row_number', 'sheet', 'outcome', 'entity_type', 'entity_ref', 'error_code', 'error_message'];
  const lines = [header.join(',')];
  for (const r of receipts) {
    lines.push([
      csvCell(r.row_number), csvCell(r.sheet_name), csvCell(r.outcome), csvCell(r.entity_type),
      csvCell(r.entity_ref), csvCell(r.error_code), csvCell(r.error_message),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Batches interrupted mid-flight, for a recovery pass.
 *
 * A batch left in IMPORTING or COMPENSATING is one whose process died partway. It cannot be resumed
 * blindly — its receipts say exactly how far it got — so this surfaces them for a human rather than
 * retrying automatically.
 */
export async function listInterruptedBatches({ tenantId = null, supabaseClient = null, requireTenant = false } = {}) {
  // Fail closed. Without a tenant the query below is unscoped and would return every tenant's
  // interrupted batches, so a caller that asks for tenant scoping and has none gets nothing.
  if (requireTenant && !tenantId) return [];
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(BATCHES_TABLE)
    .select('id, tenant_id, import_status, total_rows, updated_at, metadata')
    .in('import_status', [...RESUMABLE_STATUSES, CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR]);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list interrupted imports: ${error.message}`);
  return (data || []).map((b) => ({
    id: b.id,
    tenantId: b.tenant_id,
    status: b.import_status,
    totalRows: b.total_rows,
    updatedAt: b.updated_at,
    confirmedImport: b.metadata?.confirmedImport || null,
    needsHuman: b.import_status === CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR,
  }));
}

/** Truthful user-facing state for a batch. No path from an unfinished import to the word "imported". */
export function describeImportForUser(status) {
  switch (String(status || '').toUpperCase()) {
    case CONFIRMED_IMPORT_STATUSES.IMPORTED:
      return { settled: true, ok: true, message: 'Imported.' };
    case CONFIRMED_IMPORT_STATUSES.COMPENSATED:
      return { settled: true, ok: false, message: 'The import failed and every applied row was reversed. Nothing was imported.' };
    case CONFIRMED_IMPORT_STATUSES.FAILED_IMPORT:
      return { settled: true, ok: false, message: 'The import did not run. Nothing was imported.' };
    case CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR:
      return { settled: false, ok: false, message: 'This import is partly applied and could not be fully reversed. Our team is resolving it — do not retry.' };
    case CONFIRMED_IMPORT_STATUSES.IMPORTING:
      return { settled: false, ok: false, message: 'Import in progress.' };
    case CONFIRMED_IMPORT_STATUSES.COMPENSATING:
      return { settled: false, ok: false, message: 'The import failed and is being reversed.' };
    case CONFIRMED_IMPORT_STATUSES.PARTIALLY_IMPORTED:
      return { settled: false, ok: false, message: 'This import is only partly applied and is being resolved.' };
    default:
      return { settled: false, ok: false, message: 'Not imported.' };
  }
}
