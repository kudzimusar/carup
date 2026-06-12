import { WORKBOOK_IMPORT_ACTION_TYPES } from '../../constants/diaspora/diasporaWorkbookImportMap.js';
import { WORKBOOK_IMPORT_STATUSES } from '../../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { buildWorkbookImportPlan } from './diasporaWorkbookImportPlanningService.js';
import {
  getDiasporaWorkbookImportBatch,
  listDiasporaWorkbookImportRows,
} from './diasporaWorkbookReviewService.js';
import {
  normalizeWorkbookBatchMetadata,
  safeGetImportResult,
} from './diasporaWorkbookMetadataUtils.js';

const AUDIT_PAGE_SIZE = 500;
const RETRYABLE_BATCH_STATUSES = new Set([
  WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS,
  WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT,
]);
const DRAFT_RETRY_ACTIONS = new Set([
  WORKBOOK_IMPORT_ACTION_TYPES.CREATE_DRAFT,
  WORKBOOK_IMPORT_ACTION_TYPES.UPSERT_DRAFT,
]);
const NON_RETRY_ACTIONS = new Set([
  WORKBOOK_IMPORT_ACTION_TYPES.REVIEW_ONLY,
  WORKBOOK_IMPORT_ACTION_TYPES.LEDGER_REQUIRED,
  WORKBOOK_IMPORT_ACTION_TYPES.APPROVAL_REQUIRED,
  WORKBOOK_IMPORT_ACTION_TYPES.BLOCKED,
]);

export const WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES = Object.freeze({
  EXECUTED_DRAFT: 'EXECUTED_DRAFT',
  ALREADY_EXECUTED: 'ALREADY_EXECUTED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  BLOCKED: 'BLOCKED',
  PENDING: 'PENDING',
  NOT_PLANNABLE: 'NOT_PLANNABLE',
  DUPLICATE_RISK: 'DUPLICATE_RISK',
});

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function rowPayload(row = {}) {
  return row.normalized_payload || row.normalizedPayload || row.row_payload || row.rowPayload || {};
}

function makePayloadPreview(payload = {}) {
  return Object.fromEntries(Object.entries(payload || {}).slice(0, 12));
}

function rowId(row = {}) {
  return row.id || row.rowId || null;
}

function rowTargetRecordId(row = {}) {
  return row.target_record_id || row.targetRecordId || null;
}

function rowImportResult(row = {}) {
  return safeGetImportResult(row);
}

function importResultStatus(importResult = {}) {
  return normalizeLower(importResult.status || importResult.resultStatus || importResult.executionStatus);
}

function importResultSuccess(importResult = {}) {
  return importResult.success === true;
}

function importResultFailureReason(importResult = {}) {
  return importResult.errorCode
    || importResult.error_code
    || importResult.failureReason
    || importResult.failure_reason
    || importResult.blockedReason
    || importResult.blocked_reason
    || null;
}

function importResultMessage(importResult = {}) {
  return importResult.message || importResult.details?.message || null;
}

function hasImportResult(importResult = {}) {
  return Boolean(importResult && typeof importResult === 'object' && Object.keys(importResult).length > 0);
}

function isRejectedOrError(row = {}) {
  return normalizeUpper(row.validation_status || row.validationStatus) === 'REJECTED'
    || normalizeUpper(row.action_type || row.actionType) === 'ERROR';
}

function isFailedStatus(status) {
  return ['failed', 'failure', 'error'].includes(status);
}

function isSkippedStatus(status) {
  return ['skipped', 'skip'].includes(status);
}

function isAlreadyExecutedStatus(status) {
  return ['alreadyexecuted', 'already_executed', 'already-executed'].includes(status);
}

function isPendingStatus(status) {
  return ['', 'pending'].includes(status);
}

function groupBy(rows = [], key) {
  return rows.reduce((groups, row) => {
    const value = row[key] || 'UNSPECIFIED';
    groups[value] = (groups[value] || 0) + 1;
    return groups;
  }, {});
}

function countRows(rows = [], status) {
  return rows.filter((row) => row.executionStatus === status).length;
}

function normalizeLimit(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

async function listAllWorkbookImportRows(batchId, userContext = {}, options = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const result = await listDiasporaWorkbookImportRows(
      batchId,
      { limit: AUDIT_PAGE_SIZE, offset },
      userContext,
      options,
    );
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < AUDIT_PAGE_SIZE) break;
    offset += AUDIT_PAGE_SIZE;
  }
  return rows;
}

function planActionByRow(plan = {}) {
  return new Map((plan.actions || []).map((action) => [action.rowId, action]));
}

function makeAuditPlanningBatch(batch = {}) {
  return {
    ...batch,
    import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
  };
}

export function classifyDiasporaWorkbookDraftImportRow(row = {}, action = {}) {
  const importResult = rowImportResult(row);
  const status = importResultStatus(importResult);
  const targetRecordId = rowTargetRecordId(row);

  if (isAlreadyExecutedStatus(status)) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.ALREADY_EXECUTED;
  }
  if (targetRecordId && importResultSuccess(importResult)) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.EXECUTED_DRAFT;
  }
  if (targetRecordId) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK;
  }
  if (isFailedStatus(status)) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED;
  }
  if (isSkippedStatus(status)) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED;
  }
  if (isRejectedOrError(row)) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.NOT_PLANNABLE;
  }
  if (action?.blocked) {
    return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.BLOCKED;
  }
  if (!hasImportResult(importResult) || isPendingStatus(status)) {
    return action && !action.blocked
      ? WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING
      : WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.NOT_PLANNABLE;
  }
  return WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING;
}

function retryBlockReason({ batch, row, action, executionStatus }) {
  if (!RETRYABLE_BATCH_STATUSES.has(batch.import_status)) return 'BATCH_STATUS_NOT_RETRYABLE';
  if (rowTargetRecordId(row)) return 'TARGET_RECORD_ALREADY_EXISTS';
  if (executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.EXECUTED_DRAFT) return 'ROW_ALREADY_EXECUTED';
  if (executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.ALREADY_EXECUTED) return 'ROW_ALREADY_EXECUTED';
  if (executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK) return 'DUPLICATE_RISK_REQUIRES_OPERATOR_REVIEW';
  if (executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.NOT_PLANNABLE) return 'ROW_NOT_PLANNABLE';
  if (executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED) return 'ROW_SKIPPED_REQUIRES_OPERATOR_REVIEW';
  if (!action || action.blocked) return action?.blockedReason || 'ROW_BLOCKED_BY_IMPORT_PLAN';
  if (NON_RETRY_ACTIONS.has(action.proposedAction)) return `${action.proposedAction}_NOT_RETRYABLE`;
  if (!DRAFT_RETRY_ACTIONS.has(action.proposedAction)) return 'ACTION_NOT_DRAFT_RETRYABLE';
  if (![WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING].includes(executionStatus)) {
    return 'ROW_STATUS_NOT_RETRYABLE';
  }
  return null;
}

function makeRowSummary(row = {}, action = {}, batch = {}) {
  const importResult = rowImportResult(row);
  const executionStatus = classifyDiasporaWorkbookDraftImportRow(row, action);
  const retryReason = retryBlockReason({ batch, row, action, executionStatus });
  const targetRecordId = rowTargetRecordId(row);
  const rollbackCandidate = Boolean(targetRecordId && importResultSuccess(importResult));

  return {
    rowId: rowId(row),
    sheetName: row.sheet_name || row.sheetName || null,
    workbookRowNumber: row.workbook_row_number || row.workbookRowNumber || null,
    workbookRecordId: row.workbook_record_id || row.workbookRecordId || null,
    targetTable: row.target_table || row.targetTable || action?.targetTable || null,
    targetRecordId,
    validationStatus: row.validation_status || row.validationStatus || null,
    actionType: row.action_type || row.actionType || null,
    executionStatus,
    retryable: !retryReason,
    rollbackCandidate,
    rollbackStatus: rollbackCandidate ? 'MANUAL_REVIEW_REQUIRED' : null,
    rollbackAction: rollbackCandidate ? 'DRAFT_RECORD_REVERSAL_NOT_IMPLEMENTED' : null,
    blockedReason: action?.blockedReason || importResult.blockedReason || importResult.blocked_reason || null,
    failureReason: importResultFailureReason(importResult),
    message: importResultMessage(importResult),
    payloadPreview: makePayloadPreview(rowPayload(row)),
  };
}

function applyExecutionRowFilters(rows = [], filters = {}) {
  const retryableFilter = normalizeBoolean(filters.retryable);
  return rows.filter((row) => {
    if (filters.sheetName && row.sheetName !== String(filters.sheetName).toUpperCase()) return false;
    if (filters.targetTable && row.targetTable !== filters.targetTable) return false;
    if (filters.executionStatus && row.executionStatus !== String(filters.executionStatus).toUpperCase()) return false;
    if (retryableFilter !== null && row.retryable !== retryableFilter) return false;
    return true;
  });
}

function paginateRows(rows = [], filters = {}) {
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  return {
    data: rows.slice(offset, offset + limit),
    pagination: {
      limit,
      offset,
      count: rows.length,
    },
  };
}

function buildCreatedTargetRecords(rows = []) {
  return rows
    .filter((row) => row.targetRecordId)
    .map((row) => ({
      rowId: row.rowId,
      sheetName: row.sheetName,
      workbookRecordId: row.workbookRecordId,
      targetTable: row.targetTable,
      targetRecordId: row.targetRecordId,
      rollbackCandidate: row.rollbackCandidate,
      rollbackStatus: row.rollbackStatus,
      rollbackAction: row.rollbackAction,
    }));
}

export function validateDiasporaWorkbookDraftImportConsistency(batch = {}, rows = [], plan = {}) {
  const errors = [];
  const warnings = [];
  const summaries = rows.map((row) => makeRowSummary(row, planActionByRow(plan).get(rowId(row)), batch));
  const targetRecords = new Map();

  for (const row of summaries) {
    if (row.targetRecordId && !row.targetTable) {
      errors.push({ code: 'TARGET_RECORD_WITHOUT_TARGET_TABLE', rowId: row.rowId });
    }
    if (row.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK) {
      warnings.push({ code: 'DUPLICATE_EXECUTION_RISK', rowId: row.rowId, targetRecordId: row.targetRecordId });
    }
    if (row.targetRecordId) {
      const key = `${row.targetTable || 'UNKNOWN'}:${row.targetRecordId}`;
      if (!targetRecords.has(key)) targetRecords.set(key, []);
      targetRecords.get(key).push(row.rowId);
    }
  }

  for (const [target, rowIds] of targetRecords.entries()) {
    if (rowIds.length > 1) {
      warnings.push({ code: 'TARGET_RECORD_REFERENCED_BY_MULTIPLE_ROWS', target, rowIds });
    }
  }

  const executedCount = summaries.filter((row) => row.targetRecordId).length;
  const status = batch.import_status;
  if (status === WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS && executedCount === 0) {
    warnings.push({ code: 'BATCH_MARKED_IMPORTED_WITHOUT_TARGET_RECORDS', batchId: batch.id });
  }
  if (status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT && executedCount > 0) {
    warnings.push({ code: 'FAILED_BATCH_HAS_TARGET_RECORDS', batchId: batch.id, targetRecordCount: executedCount });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function buildRetryPlanFromRows(batch = {}, rowSummaries = []) {
  const retryableRows = rowSummaries.filter((row) => row.retryable);
  const nonRetryableRows = rowSummaries.filter((row) => !row.retryable).map((row) => ({
    ...row,
    nonRetryableReason: row.targetRecordId
      ? 'TARGET_RECORD_ALREADY_EXISTS'
      : row.blockedReason || row.failureReason || 'ROW_NOT_SAFE_TO_RETRY',
  }));
  const batchRetryable = RETRYABLE_BATCH_STATUSES.has(batch.import_status);
  return {
    canRetry: batchRetryable && retryableRows.length > 0,
    reason: batchRetryable
      ? retryableRows.length > 0 ? 'SAFE_FAILED_OR_PENDING_DRAFT_ROWS_AVAILABLE' : 'NO_SAFE_RETRYABLE_ROWS'
      : 'BATCH_STATUS_NOT_RETRYABLE',
    retryableRows,
    nonRetryableRows,
    requiresOperatorReview: rowSummaries.some((row) => [
      WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK,
      WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.BLOCKED,
      WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED,
    ].includes(row.executionStatus)),
    safeRetryPolicy: {
      readOnly: true,
      retryExecutionEndpointAvailable: false,
      allowedBatchStatuses: [...RETRYABLE_BATCH_STATUSES],
      requiresNoTargetRecordId: true,
      allowedRowStatuses: [
        WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED,
        WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING,
      ],
      blockedActionTypes: [...NON_RETRY_ACTIONS],
      aiExecutionAllowed: false,
      driveSyncAllowed: false,
      stockLedgerAllowed: false,
      rollbackExecutionAvailable: false,
    },
  };
}

async function loadAuditContext(batchId, userContext = {}, options = {}) {
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, options);
  const rows = await listAllWorkbookImportRows(batch.id, userContext, options);
  const plan = buildWorkbookImportPlan(makeAuditPlanningBatch(batch), rows, userContext);
  const actionByRow = planActionByRow(plan);
  const rowSummaries = rows.map((row) => makeRowSummary(row, actionByRow.get(rowId(row)), batch));
  return { batch, rows, plan, rowSummaries };
}

export async function getDiasporaWorkbookDraftImportAudit(batchId, userContext = {}, options = {}) {
  const { batch, rows, plan, rowSummaries } = await loadAuditContext(batchId, userContext, options);
  const metadata = normalizeWorkbookBatchMetadata(batch.metadata);
  const consistency = validateDiasporaWorkbookDraftImportConsistency(batch, rows, plan);
  const retryPlan = buildRetryPlanFromRows(batch, rowSummaries);
  const rowsByStatus = groupBy(rowSummaries, 'executionStatus');

  return {
    batchId: batch.id,
    templateType: batch.template_type,
    importStatus: batch.import_status,
    executionPhase: metadata.phase || null,
    draftImportExecuted: Boolean(metadata.draftImportExecuted),
    liveImportExecuted: Boolean(metadata.liveImportExecuted),
    aiExecuted: Boolean(metadata.aiExecuted),
    canRetry: retryPlan.canRetry,
    canRollback: false,
    rollbackAvailable: false,
    rollbackReason: 'ROLLBACK_ENGINE_NOT_IMPLEMENTED_PHASE_1G',
    consistency,
    totals: {
      totalRows: rowSummaries.length,
      plannedRows: plan.totals?.plannedActions || 0,
      executedDrafts: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.EXECUTED_DRAFT),
      failedRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED),
      skippedRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED),
      blockedRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.BLOCKED),
      alreadyExecutedRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.ALREADY_EXECUTED),
      pendingRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING),
      duplicateRiskRows: countRows(rowSummaries, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK),
      retryableRows: retryPlan.retryableRows.length,
      nonRetryableRows: retryPlan.nonRetryableRows.length,
    },
    rowsByStatus,
    rowsBySheet: groupBy(rowSummaries, 'sheetName'),
    rowsByTargetTable: groupBy(rowSummaries, 'targetTable'),
    createdTargetRecords: buildCreatedTargetRecords(rowSummaries),
    failedRows: rowSummaries.filter((row) => row.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED),
    skippedRows: rowSummaries.filter((row) => row.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED),
    blockedRows: rowSummaries.filter((row) => row.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.BLOCKED),
    retryPlan,
  };
}

export async function listDiasporaWorkbookDraftImportExecutionRows(batchId, filters = {}, userContext = {}, options = {}) {
  const { rowSummaries } = await loadAuditContext(batchId, userContext, options);
  return paginateRows(applyExecutionRowFilters(rowSummaries, filters), filters);
}

export async function listDiasporaWorkbookDraftImportFailedRows(batchId, filters = {}, userContext = {}, options = {}) {
  const failedFilters = { ...filters, executionStatus: WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED };
  return listDiasporaWorkbookDraftImportExecutionRows(batchId, failedFilters, userContext, options);
}

export async function buildDiasporaWorkbookDraftImportRetryPlan(batchId, userContext = {}, options = {}) {
  const { batch, rowSummaries } = await loadAuditContext(batchId, userContext, options);
  return buildRetryPlanFromRows(batch, rowSummaries);
}
