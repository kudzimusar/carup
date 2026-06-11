import {
  WORKBOOK_IMPORT_ACTION_TYPES,
  WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES,
  WORKBOOK_IMPORT_MAP,
  WORKBOOK_IMPORT_RISK_LEVELS,
} from '../../constants/diaspora/diasporaWorkbookImportMap.js';

const PLANNABLE_BATCH_STATUSES = new Set(['QUEUED', 'VALIDATED']);
const PLANNABLE_ROW_STATUSES = new Set(['ACCEPTED', 'WARNING']);
const DIRECT_VERIFICATION_STATUSES = new Set(['VERIFIED', 'APPROVED']);
const DIRECT_ORDER_RELEASE_STATUSES = new Set(['RELEASED', 'COMPLETED', 'CANCELLED']);
const DIRECT_QUOTE_SELECTION_STATUSES = new Set(['ACCEPTED']);
const DIRECT_COMPLIANCE_OUTCOME_STATUSES = new Set(['APPROVED']);
const DIRECT_PAYMENT_OUTCOME_STATUSES = new Set(['PAID', 'REFUNDED', 'RELEASED']);
const DIRECT_SHIPMENT_FINAL_STATUSES = new Set(['DELIVERED', 'RELEASED', 'COMPLETED']);

function normalizeValue(value) {
  return String(value || '').trim();
}

function normalizeUpper(value) {
  return normalizeValue(value).toUpperCase();
}

function payloadForRow(row = {}) {
  return row.normalized_payload || row.normalizedPayload || row.row_payload || row.rowPayload || {};
}

function rowSheetName(row = {}) {
  return normalizeUpper(row.sheet_name || row.sheetName);
}

function rowValidationStatus(row = {}) {
  return normalizeUpper(row.validation_status || row.validationStatus);
}

function rowActionType(row = {}) {
  return normalizeUpper(row.action_type || row.actionType);
}

function rowTargetTable(row = {}) {
  return normalizeValue(row.target_table || row.targetTable);
}

function rowWorkbookNumber(row = {}) {
  return row.workbook_row_number || row.workbookRowNumber || null;
}

function rowRecordId(row = {}, mapping) {
  const payload = payloadForRow(row);
  return row.workbook_record_id
    || row.workbookRecordId
    || payload.TRADE_PROFILE_ID
    || payload.IMPORT_ORDER_ID
    || payload.QUOTE_ID
    || payload.DOCUMENT_ID
    || payload.CONTAINER_ID
    || payload.RESERVATION_ID
    || payload.SHIPMENT_ID
    || payload.COMPLIANCE_REVIEW_ID
    || payload.PAYMENT_MILESTONE_ID
    || payload.REPUTATION_RECORD_ID
    || payload.COMMAND_ID
    || `${mapping?.targetTable || 'workbook'}:${rowWorkbookNumber(row) || 'row'}`;
}

function makePayloadPreview(payload = {}) {
  return Object.fromEntries(Object.entries(payload).slice(0, 12));
}

function makeBlockedAction(row, mapping, reason, extra = {}) {
  const payload = payloadForRow(row);
  return {
    rowId: row.id || null,
    sheetName: rowSheetName(row),
    workbookRowNumber: rowWorkbookNumber(row),
    workbookRecordId: rowRecordId(row, mapping),
    targetTable: mapping?.targetTable || rowTargetTable(row) || null,
    serviceOwner: mapping?.serviceOwner || null,
    proposedAction: extra.proposedAction || mapping?.actionType || WORKBOOK_IMPORT_ACTION_TYPES.BLOCKED,
    riskLevel: extra.riskLevel || mapping?.riskLevel || WORKBOOK_IMPORT_RISK_LEVELS.HIGH,
    requiresApproval: Boolean(extra.requiresApproval ?? mapping?.requiresApproval),
    requiresReview: Boolean(extra.requiresReview ?? extra.requiresApproval ?? mapping?.requiresApproval),
    blocked: true,
    blockedReason: reason,
    sourceValidationStatus: rowValidationStatus(row),
    sourceActionType: rowActionType(row),
    payloadPreview: makePayloadPreview(payload),
  };
}

function statusFromPayload(payload = {}, ...columns) {
  for (const column of columns) {
    const value = normalizeUpper(payload[column]);
    if (value) return value;
  }
  return '';
}

function directStateBlockReason(sheetName, payload) {
  if (sheetName === 'TRADE_PROFILES' && DIRECT_VERIFICATION_STATUSES.has(statusFromPayload(payload, 'VERIFICATION_STATUS'))) {
    return 'PROFILE_VERIFICATION_REQUIRES_REVIEWER_APPROVAL';
  }
  if (sheetName === 'DIASPORA_IMPORT_ORDERS' && DIRECT_ORDER_RELEASE_STATUSES.has(statusFromPayload(payload, 'STATUS'))) {
    return 'IMPORT_ORDER_RELEASE_OR_COMPLETION_BLOCKED';
  }
  if (sheetName === 'IMPORT_QUOTES' && DIRECT_QUOTE_SELECTION_STATUSES.has(statusFromPayload(payload, 'STATUS'))) {
    return 'QUOTE_ACCEPTANCE_CANNOT_BE_SELECTED_FROM_WORKBOOK';
  }
  if (sheetName === 'TRADE_DOCUMENTS' && DIRECT_VERIFICATION_STATUSES.has(statusFromPayload(payload, 'VERIFICATION_STATUS'))) {
    return 'DOCUMENT_VERIFICATION_CANNOT_BE_IMPORTED_FROM_WORKBOOK';
  }
  if (sheetName === 'COMPLIANCE_REVIEWS' && DIRECT_COMPLIANCE_OUTCOME_STATUSES.has(statusFromPayload(payload, 'STATUS', 'VERIFICATION_STATUS'))) {
    return 'COMPLIANCE_APPROVAL_CANNOT_BE_IMPORTED_FROM_WORKBOOK';
  }
  if (sheetName === 'PAYMENT_MILESTONES' && DIRECT_PAYMENT_OUTCOME_STATUSES.has(statusFromPayload(payload, 'STATUS', 'PAYMENT_STATUS'))) {
    return 'PAYMENT_RELEASE_OR_PAID_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK';
  }
  if (sheetName === 'SHIPMENTS' && DIRECT_SHIPMENT_FINAL_STATUSES.has(statusFromPayload(payload, 'STATUS'))) {
    return 'SHIPMENT_DELIVERED_OR_RELEASED_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK';
  }
  if (sheetName === 'REPUTATION_RECORDS') {
    return 'REPUTATION_REQUIRES_COMPLETED_TRANSACTION_REVIEW';
  }
  return null;
}

function stockLedgerBlockReason(row, payload) {
  const targetTable = rowTargetTable(row);
  const hasQuantityOverwrite = payload.QUANTITY_ON_HAND !== undefined
    || payload.quantity_on_hand !== undefined
    || payload.QUANTITY !== undefined
    || payload.quantity !== undefined;

  if (targetTable === 'diaspora_stock_ledger') return null;
  if (targetTable === 'diaspora_stock_items' && hasQuantityOverwrite) {
    return 'STOCK_QUANTITY_OVERWRITE_REQUIRES_LEDGER_ACTION';
  }
  return null;
}

function aiCommandBlockReason(payload) {
  if (normalizeUpper(payload.RISK_LEVEL) !== WORKBOOK_IMPORT_RISK_LEVELS.HIGH) return null;
  if (normalizeUpper(payload.APPROVAL_STATUS) === 'APPROVED') return null;
  return 'HIGH_RISK_AI_COMMAND_REQUIRES_APPROVAL';
}

export function classifyWorkbookImportRow(row = {}, batch = {}, userContext = {}) {
  const sheetName = rowSheetName(row);
  const mapping = WORKBOOK_IMPORT_MAP[sheetName];
  const payload = payloadForRow(row);
  const batchStatus = normalizeUpper(batch.import_status || batch.importStatus);
  const validationStatus = rowValidationStatus(row);
  const actionType = rowActionType(row);
  const sourceTargetTable = rowTargetTable(row);

  if (!PLANNABLE_BATCH_STATUSES.has(batchStatus)) {
    return makeBlockedAction(row, mapping, 'BATCH_IMPORT_STATUS_NOT_PLANNABLE');
  }
  if (validationStatus === 'REJECTED') {
    return makeBlockedAction(row, mapping, 'ROW_REJECTED_BY_DRY_RUN');
  }
  if (actionType === 'ERROR') {
    return makeBlockedAction(row, mapping, 'ROW_ACTION_TYPE_ERROR');
  }
  if (!PLANNABLE_ROW_STATUSES.has(validationStatus)) {
    return makeBlockedAction(row, mapping, 'ROW_VALIDATION_STATUS_NOT_PLANNABLE');
  }
  if (!mapping) {
    return makeBlockedAction(row, null, 'MISSING_WORKBOOK_IMPORT_MAP');
  }
  if (mapping.actionType === WORKBOOK_IMPORT_ACTION_TYPES.BLOCKED) {
    return makeBlockedAction(row, mapping, 'WORKBOOK_IMPORT_MAP_BLOCKED');
  }

  const stockBlock = stockLedgerBlockReason(row, payload);
  if (stockBlock) {
    return makeBlockedAction(row, mapping, stockBlock, {
      proposedAction: WORKBOOK_IMPORT_ACTION_TYPES.LEDGER_REQUIRED,
      requiresApproval: true,
      requiresReview: true,
      riskLevel: WORKBOOK_IMPORT_RISK_LEVELS.HIGH,
    });
  }

  if (sourceTargetTable && !WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES.has(sourceTargetTable)) {
    return makeBlockedAction(row, mapping, 'TARGET_TABLE_NOT_ALLOW_LISTED');
  }

  const directBlock = directStateBlockReason(sheetName, payload);
  if (directBlock) return makeBlockedAction(row, mapping, directBlock);

  const aiBlock = sheetName === 'AI_COMMAND_CENTER' ? aiCommandBlockReason(payload) : null;
  if (aiBlock) return makeBlockedAction(row, mapping, aiBlock, { requiresApproval: true, requiresReview: true });

  const requiresReview = validationStatus === 'WARNING' || Boolean(mapping.requiresApproval);
  return {
    rowId: row.id || null,
    sheetName,
    workbookRowNumber: rowWorkbookNumber(row),
    workbookRecordId: rowRecordId(row, mapping),
    targetTable: mapping.targetTable,
    serviceOwner: mapping.serviceOwner,
    proposedAction: mapping.actionType,
    riskLevel: mapping.riskLevel,
    requiresApproval: Boolean(mapping.requiresApproval),
    requiresReview,
    blocked: false,
    blockedReason: null,
    sourceValidationStatus: validationStatus,
    sourceActionType: actionType,
    payloadPreview: makePayloadPreview(payload),
  };
}

function countActions(actions, predicate) {
  return actions.filter(predicate).length;
}

export function validateWorkbookImportPlan(plan = {}) {
  const errors = [];
  if (plan.canProceedToExecution !== false) {
    errors.push({ code: 'PHASE_1E_EXECUTION_MUST_REMAIN_DISABLED', message: 'Phase 1E import plans must not be executable.' });
  }
  if (!Array.isArray(plan.actions)) {
    errors.push({ code: 'ACTIONS_REQUIRED', message: 'Import plan must include an actions array.' });
  }
  for (const action of plan.actions || []) {
    if (action.targetTable && !WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES.has(action.targetTable)) {
      errors.push({ code: 'TARGET_TABLE_NOT_ALLOW_LISTED', rowId: action.rowId, targetTable: action.targetTable });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildWorkbookImportPlan(batch = {}, rows = [], userContext = {}) {
  const actions = (rows || []).map((row) => classifyWorkbookImportRow(row, batch, userContext));
  const blockedActions = actions.filter((action) => action.blocked);
  const validation = validateWorkbookImportPlan({ actions, canProceedToExecution: false });

  return {
    batchId: batch.id || null,
    templateType: batch.template_type || batch.templateType || null,
    importStatus: batch.import_status || batch.importStatus || null,
    canProceedToExecution: false,
    requiresApproval: actions.some((action) => action.requiresApproval || action.requiresReview),
    blockedReason: blockedActions.length > 0 ? 'ONE_OR_MORE_ROWS_BLOCKED' : 'PHASE_1E_PLANNING_ONLY',
    totals: {
      totalRows: actions.length,
      plannedActions: countActions(actions, (action) => !action.blocked),
      blockedActions: blockedActions.length,
      requiresApproval: countActions(actions, (action) => action.requiresApproval),
      requiresReview: countActions(actions, (action) => action.requiresReview),
      acceptedRows: countActions(actions, (action) => action.sourceValidationStatus === 'ACCEPTED'),
      warningRows: countActions(actions, (action) => action.sourceValidationStatus === 'WARNING'),
      rejectedRows: countActions(actions, (action) => action.sourceValidationStatus === 'REJECTED'),
    },
    actions,
    validation,
  };
}
