/**
 * Confirmed workbook import execution.
 *
 * Every row is receipted, quota is reserved before execution, and any partial failure compensates only
 * rows created by this run. Compensation is schema-safe: all Phase 1F targets share deleted_at and
 * updated_by, while several do not have a status column.
 */
import { resolveClient, appendCriticalAudit, requestCorrelationId } from '../diasporaServiceUtils.js';
import { ValidationError, ForbiddenError } from '../../../utils/errors.js';
import {
  validateConfirmation,
  consumeConfirmation,
  explainRefusal,
  BATCHES_TABLE,
} from './diasporaWorkbookConfirmationService.js';
import { buildWorkbookImportPlan } from '../diasporaWorkbookImportPlanningService.js';
import { executeWorkbookImportAction } from '../diasporaWorkbookImportExecutionService.js';
import { requireFeature, reserveQuotaForFeature } from '../diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';
import {
  WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES,
} from '../../../constants/diaspora/diasporaWorkbookImportMap.js';

export const RECEIPTS_TABLE = 'diaspora_workbook_import_receipts';
export const ROWS_TABLE = 'diaspora_workbook_import_rows';
export const CONFIRMED_IMPORT_FEATURE_KEY = FEATURE_KEYS.WORKBOOK_BULK_IMPORT;

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

export function classifyExecutionResult(result) {
  const recordId = result?.targetRecordId ?? null;
  switch (result?.status) {
    case 'executed':
      return {
        outcome: RECEIPT_OUTCOME.ACCEPTED,
        applied: true,
        recordId,
        errorCode: null,
        errorMessage: null,
      };
    case 'alreadyExecuted':
      return {
        outcome: RECEIPT_OUTCOME.ACCEPTED,
        applied: false,
        recordId,
        errorCode: null,
        errorMessage: null,
      };
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
  if (!userContext?.id) {
    throw new ForbiddenError('A confirmed workbook import requires an authenticated user');
  }
  return userContext;
}

async function setBatchStatus(supabase, batchId, status, extraMetadata = {}) {
  const { data: current } = await supabase
    .from(BATCHES_TABLE)
    .select('metadata')
    .eq('id', batchId)
    .maybeSingle();
  const metadata = { ...(current?.metadata || {}) };
  metadata.confirmedImport = { ...(metadata.confirmedImport || {}), ...extraMetadata, status };
  const { error } = await supabase
    .from(BATCHES_TABLE)
    .update({ import_status: status, metadata })
    .eq('id', batchId);
  if (error) {
    throw new ValidationError(`Failed to update the workbook batch state: ${error.message}`);
  }
  return status;
}

async function writeReceipt(supabase, {
  tenantId,
  batchId,
  confirmationId,
  rowId,
  rowNumber,
  sheetName,
  outcome,
  entityType = null,
  entityRef = null,
  errorCode = null,
  errorMessage = null,
  attempt = 1,
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
      error_message: errorMessage ? String(errorMessage).slice(0, 300) : null,
      attempt,
    })
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) return null;
    throw new ValidationError(`Failed to write an import receipt: ${error.message}`);
  }
  return data;
}

/**
 * Soft-delete one record created by the current import run.
 *
 * The payload intentionally contains no generic status field. Every allow-listed Phase 1F target has
 * deleted_at and updated_by; three valid targets do not have status, so writing status caused a 42703
 * and left rows applied.
 */
export async function compensateConfirmedImportAction(
  supabase,
  applied,
  actorId,
  compensatedAt = new Date().toISOString(),
) {
  const { table, recordId } = applied || {};
  if (!table || !recordId) return { ok: false, reason: 'NO_RECORD_TO_COMPENSATE' };
  if (!WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES.has(table)) {
    return { ok: false, reason: 'TARGET_TABLE_NOT_ALLOW_LISTED' };
  }
  if (!actorId) return { ok: false, reason: 'NO_ACTOR_TO_COMPENSATE' };

  const { error } = await supabase
    .from(table)
    .update({ deleted_at: compensatedAt, updated_by: actorId })
    .eq('id', recordId)
    .is('deleted_at', null);

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

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

  const validation = await validateConfirmation({
    confirmationId,
    batchId,
    userContext,
    supabaseClient: supabase,
    now,
  });
  if (!validation.ok) {
    throw new ValidationError(explainRefusal(validation.reason), {
      batchId,
      confirmationId,
      errorCode: validation.reason,
      imported: false,
    });
  }
  const { confirmation, batch } = validation;
  const tenantId = confirmation.tenant_id;

  await requireFeature(supabase, {
    tenantId,
    userId: userContext.id,
    featureKey: CONFIRMED_IMPORT_FEATURE_KEY,
  });

  const consumed = await consumeConfirmation({ confirmationId, supabaseClient: supabase, now });
  if (!consumed) {
    throw new ValidationError(explainRefusal('CONFIRMATION_CONSUMED'), {
      batchId,
      confirmationId,
      errorCode: 'CONFIRMATION_CONSUMED',
      imported: false,
    });
  }

  const { data: rows, error: rowsError } = await supabase
    .from(ROWS_TABLE)
    .select('*')
    .eq('batch_id', batchId)
    .is('deleted_at', null);
  if (rowsError) throw new ValidationError(`Failed to read workbook rows: ${rowsError.message}`);

  const plan = buildWorkbookImportPlan(batch, rows || [], userContext);
  const executable = (plan.actions || []).filter((action) => !action.blocked);

  let quota = null;
  try {
    quota = await reserveQuotaForFeature(supabase, {
      tenantId,
      userId: userContext.id,
      featureKey: CONFIRMED_IMPORT_FEATURE_KEY,
      amount: executable.length || 1,
      idempotencyKey: `confirmed-import:${confirmationId}`,
    });
  } catch (error) {
    await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.FAILED_IMPORT, {
      reason: 'QUOTA_DENIED',
      correlationId,
    });
    throw new ValidationError(
      'Your plan does not have enough remaining import capacity for this workbook. Nothing was imported.',
      {
        batchId,
        errorCode: 'QUOTA_DENIED',
        imported: false,
        detail: error?.message,
      },
    );
  }

  await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.IMPORTING, {
    confirmationId,
    startedAt: new Date().toISOString(),
    correlationId,
    plannedRows: executable.length,
  });

  const applied = [];
  const receipts = [];
  const executionContext = {};
  let failure = null;

  for (const action of plan.actions || []) {
    const rowNumber = Number(
      action.rowNumber ?? action.row?.row_number ?? receipts.length + 1,
    );
    const base = {
      tenantId,
      batchId,
      confirmationId,
      rowId: action.rowId || action.row?.id || null,
      rowNumber,
      sheetName: action.sheetName || action.row?.sheet_name || null,
    };

    if (action.blocked) {
      receipts.push(await writeReceipt(supabase, {
        ...base,
        outcome: RECEIPT_OUTCOME.REJECTED,
        errorCode: action.blockedReason || 'ROW_BLOCKED',
        errorMessage: 'This row was blocked by validation and was not imported.',
      }));
      continue;
    }

    try {
      const result = await executeWorkbookImportAction(action, batch, userContext, {
        supabaseClient: supabase,
        executionContext,
      });
      const decision = classifyExecutionResult(result);
      if (decision.applied) {
        applied.push({
          table: action.targetTable,
          recordId: decision.recordId,
          rowNumber,
        });
      }
      receipts.push(await writeReceipt(
        supabase,
        decision.outcome === RECEIPT_OUTCOME.ACCEPTED
          ? {
            ...base,
            outcome: RECEIPT_OUTCOME.ACCEPTED,
            entityType: action.targetTable,
            entityRef: decision.recordId,
          }
          : {
            ...base,
            outcome: decision.outcome,
            errorCode: decision.errorCode,
            errorMessage: decision.errorMessage,
          },
      ));
    } catch (error) {
      failure = {
        rowNumber,
        message: error?.message,
        code: error?.code || 'ROW_EXECUTION_FAILED',
      };
      receipts.push(await writeReceipt(supabase, {
        ...base,
        outcome: RECEIPT_OUTCOME.REJECTED,
        errorCode: failure.code,
        errorMessage: failure.message,
      }));
      break;
    }
  }

  if (!failure) {
    await quota.commit({ actor: userContext.id, req });
    await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.IMPORTED, {
      confirmationId,
      completedAt: new Date().toISOString(),
      correlationId,
      appliedRows: applied.length,
    });
    await appendCriticalAudit(supabase, {
      tenantId,
      actorId: userContext.id,
      action: 'DIASPORA_WORKBOOK_IMPORT_EXECUTED',
      resourceType: 'diaspora_workbook_import_batch',
      resourceId: batchId,
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

  await setBatchStatus(supabase, batchId, CONFIRMED_IMPORT_STATUSES.COMPENSATING, {
    confirmationId,
    failedAtRow: failure.rowNumber,
    correlationId,
    appliedRows: applied.length,
  });

  const compensationFailures = [];
  for (const record of applied) {
    const outcome = await compensateConfirmedImportAction(
      supabase,
      record,
      userContext.id,
    );
    if (outcome.ok) {
      await writeReceipt(supabase, {
        tenantId,
        batchId,
        confirmationId,
        rowId: null,
        rowNumber: record.rowNumber,
        sheetName: null,
        outcome: RECEIPT_OUTCOME.COMPENSATED,
        entityType: record.table,
        entityRef: record.recordId,
        attempt: 2,
        errorCode: 'COMPENSATED_AFTER_FAILURE',
        errorMessage: 'This row was applied and then reversed because a later row failed.',
      });
    } else {
      compensationFailures.push({ ...record, reason: outcome.reason });
    }
  }

  await quota.release({ actor: userContext.id, req });

  const finalStatus = compensationFailures.length > 0
    ? CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR
    : CONFIRMED_IMPORT_STATUSES.COMPENSATED;

  await setBatchStatus(supabase, batchId, finalStatus, {
    confirmationId,
    correlationId,
    failedAtRow: failure.rowNumber,
    compensatedRows: applied.length - compensationFailures.length,
    compensationFailures: compensationFailures.length,
  });

  await appendCriticalAudit(supabase, {
    tenantId,
    actorId: userContext.id,
    action: 'DIASPORA_WORKBOOK_IMPORT_FAILED',
    resourceType: 'diaspora_workbook_import_batch',
    resourceId: batchId,
    newState: {
      failedAtRow: failure.rowNumber,
      errorCode: failure.code,
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

export async function listReceipts({
  batchId,
  tenantId = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(RECEIPTS_TABLE)
    .select(
      'id, batch_id, row_number, sheet_name, outcome, entity_type, entity_ref, error_code, error_message, compensated_at, attempt, created_at',
    )
    .eq('batch_id', batchId)
    .order('row_number', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to read import receipts: ${error.message}`);
  return data || [];
}

function csvCell(value) {
  const stringValue = value == null ? '' : String(value);
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

export function buildReceiptCsv(receipts = []) {
  const header = [
    'row_number',
    'sheet',
    'outcome',
    'entity_type',
    'entity_ref',
    'error_code',
    'error_message',
  ];
  const lines = [header.join(',')];
  for (const receipt of receipts) {
    lines.push([
      csvCell(receipt.row_number),
      csvCell(receipt.sheet_name),
      csvCell(receipt.outcome),
      csvCell(receipt.entity_type),
      csvCell(receipt.entity_ref),
      csvCell(receipt.error_code),
      csvCell(receipt.error_message),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export async function listInterruptedBatches({
  tenantId = null,
  supabaseClient = null,
  requireTenant = false,
} = {}) {
  if (requireTenant && !tenantId) return [];
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(BATCHES_TABLE)
    .select('id, tenant_id, import_status, total_rows, updated_at, metadata')
    .in('import_status', [
      ...RESUMABLE_STATUSES,
      CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR,
    ]);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list interrupted imports: ${error.message}`);
  return (data || []).map((batch) => ({
    id: batch.id,
    tenantId: batch.tenant_id,
    status: batch.import_status,
    totalRows: batch.total_rows,
    updatedAt: batch.updated_at,
    confirmedImport: batch.metadata?.confirmedImport || null,
    needsHuman: batch.import_status === CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR,
  }));
}

export function describeImportForUser(status) {
  switch (String(status || '').toUpperCase()) {
    case CONFIRMED_IMPORT_STATUSES.IMPORTED:
      return { settled: true, ok: true, message: 'Imported.' };
    case CONFIRMED_IMPORT_STATUSES.COMPENSATED:
      return {
        settled: true,
        ok: false,
        message: 'The import failed and every applied row was reversed. Nothing was imported.',
      };
    case CONFIRMED_IMPORT_STATUSES.FAILED_IMPORT:
      return { settled: true, ok: false, message: 'The import did not run. Nothing was imported.' };
    case CONFIRMED_IMPORT_STATUSES.NEEDS_OPERATOR:
      return {
        settled: false,
        ok: false,
        message: 'This import is partly applied and could not be fully reversed. Our team is resolving it — do not retry.',
      };
    case CONFIRMED_IMPORT_STATUSES.IMPORTING:
      return { settled: false, ok: false, message: 'Import in progress.' };
    case CONFIRMED_IMPORT_STATUSES.COMPENSATING:
      return { settled: false, ok: false, message: 'The import failed and is being reversed.' };
    case CONFIRMED_IMPORT_STATUSES.PARTIALLY_IMPORTED:
      return {
        settled: false,
        ok: false,
        message: 'This import is only partly applied and is being resolved.',
      };
    default:
      return { settled: false, ok: false, message: 'Not imported.' };
  }
}
