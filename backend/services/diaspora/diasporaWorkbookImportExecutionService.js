import { DatabaseError, ValidationError } from '../../utils/errors.js';
import { WORKBOOK_IMPORT_ACTION_TYPES, WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES } from '../../constants/diaspora/diasporaWorkbookImportMap.js';
import {
  WORKBOOK_IMPORT_COMPLETED_STATUSES,
  WORKBOOK_IMPORT_EXECUTABLE_STATUSES,
  WORKBOOK_IMPORT_IN_PROGRESS_STATUSES,
  WORKBOOK_IMPORT_STATUSES,
} from '../../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { buildWorkbookImportPlan } from './diasporaWorkbookImportPlanningService.js';
import {
  getDiasporaWorkbookImportBatch,
  listDiasporaWorkbookImportRows,
} from './diasporaWorkbookReviewService.js';
import {
  normalizeOperatorHold,
  normalizeWorkbookBatchMetadata,
} from './diasporaWorkbookMetadataUtils.js';

const IMPORT_PLAN_PAGE_SIZE = 500;
const REVIEW_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government_reviewer', 'reviewer']);
const DRAFT_EXECUTION_ACTIONS = new Set([
  WORKBOOK_IMPORT_ACTION_TYPES.CREATE_DRAFT,
  WORKBOOK_IMPORT_ACTION_TYPES.UPSERT_DRAFT,
]);
const PHASE_1F_DRAFT_TARGETS = new Set([
  'diaspora_import_orders',
  'diaspora_import_quotes',
  'diaspora_trade_documents',
  'diaspora_container_shipments',
  'diaspora_cargo_reservations',
  'diaspora_shipments',
  'diaspora_ai_commands',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function defaultSupabaseClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

function actorId(userContext = {}) {
  return userContext.id || userContext.userId;
}

function isReviewer(userContext = {}) {
  return REVIEW_ROLES.has(String(userContext.platformRole || userContext.baseRole || userContext.role || '').toLowerCase());
}

function assertAuthenticated(userContext = {}) {
  if (!actorId(userContext)) {
    throw new ValidationError('Workbook draft import execution requires an authenticated user context.');
  }
}

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  return value;
}

function payloadValue(payload = {}, ...keys) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
    const lowerKey = key.toLowerCase();
    if (payload[lowerKey] !== undefined && payload[lowerKey] !== null && payload[lowerKey] !== '') return payload[lowerKey];
  }
  return null;
}

function numberValue(payload = {}, ...keys) {
  const value = payloadValue(payload, ...keys);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

function safeUuid(value) {
  return isUuid(value) ? String(value) : null;
}

function safeDatabaseDetails(table, operation, error = {}) {
  return {
    table,
    operation,
    errorCode: error.code || null,
  };
}

function payloadForAction(action = {}) {
  return action.row?.normalized_payload
    || action.row?.normalizedPayload
    || action.row?.row_payload
    || action.row?.rowPayload
    || {};
}

function metadataForAction(action = {}, batch = {}, userContext = {}) {
  const payload = payloadForAction(action);
  return {
    source: 'diaspora_workbook_import',
    batchId: batch.id || action.row?.batch_id || null,
    workbookRowId: action.rowId || action.row?.id || null,
    workbookRecordId: action.workbookRecordId || action.row?.workbook_record_id || null,
    workbookSheetName: action.sheetName || action.row?.sheet_name || null,
    workbookRowNumber: action.workbookRowNumber || action.row?.workbook_row_number || null,
    requestedBy: actorId(userContext),
    phase: '1F',
    draftOnly: true,
    liveImportExecuted: false,
    aiExecuted: false,
    originalWorkbookStatus: payloadValue(payload, 'STATUS', 'VERIFICATION_STATUS', 'RESERVATION_STATUS', 'EXECUTION_STATUS'),
  };
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return value;
  return String(value).split(/\n|;/).map((item) => item.trim()).filter(Boolean);
}

function mapWorkbookOrderType(value) {
  const normalized = normalizeUpper(value);
  if (normalized === 'VEHICLE_IMPORT') return 'vehicle';
  if (['PARTS_IMPORT', 'PARTS_EXPORT', 'STOCK_SUPPLY'].includes(normalized)) return 'parts';
  if (['CONTAINER_SPACE', 'MIXED'].includes(normalized)) return 'mixed';
  if (['VEHICLE', 'PARTS'].includes(normalized)) return normalized.toLowerCase();
  return 'mixed';
}

function recordMapKey(sheetName, workbookRecordId) {
  return `${normalizeUpper(sheetName)}:${String(workbookRecordId || '').trim()}`;
}

function rememberTargetRecord(action = {}, targetRecordId, executionContext = {}) {
  if (!targetRecordId || !executionContext.recordIdMap) return;
  if (action.sheetName && action.workbookRecordId) {
    executionContext.recordIdMap.set(recordMapKey(action.sheetName, action.workbookRecordId), targetRecordId);
  }
}

function resolveLinkedUuid(payload = {}, executionContext = {}, sheetName, workbookColumn, ...uuidColumns) {
  for (const column of uuidColumns) {
    const uuid = safeUuid(payloadValue(payload, column));
    if (uuid) return uuid;
  }

  const workbookRecordId = payloadValue(payload, workbookColumn);
  if (!workbookRecordId || !executionContext.recordIdMap) return null;
  return executionContext.recordIdMap.get(recordMapKey(sheetName, workbookRecordId)) || null;
}

function makeSkippedResult(action, code, message) {
  return {
    rowId: action.rowId || null,
    sheetName: action.sheetName || null,
    workbookRowNumber: action.workbookRowNumber || null,
    targetTable: action.targetTable || null,
    targetRecordId: null,
    status: 'skipped',
    action: action.proposedAction || null,
    message,
    blockedReason: action.blockedReason || null,
    errorCode: code,
  };
}

function makeBlockedResult(action, code, message = 'Workbook row is blocked from draft execution.') {
  return {
    rowId: action.rowId || null,
    sheetName: action.sheetName || null,
    workbookRowNumber: action.workbookRowNumber || null,
    targetTable: action.targetTable || null,
    targetRecordId: null,
    status: 'blocked',
    action: action.proposedAction || null,
    message,
    blockedReason: action.blockedReason || code,
    errorCode: code,
  };
}

function makeExecutedResult(action, targetRecordId) {
  return {
    rowId: action.rowId || null,
    sheetName: action.sheetName || null,
    workbookRowNumber: action.workbookRowNumber || null,
    targetTable: action.targetTable || null,
    targetRecordId,
    status: 'executed',
    action: action.proposedAction || null,
    message: 'Draft record created from reviewed workbook row.',
    blockedReason: null,
    errorCode: null,
  };
}

function makeAlreadyExecutedResult(action) {
  return {
    rowId: action.rowId || null,
    sheetName: action.sheetName || null,
    workbookRowNumber: action.workbookRowNumber || null,
    targetTable: action.targetTable || null,
    targetRecordId: action.row?.target_record_id || action.row?.targetRecordId || null,
    status: 'alreadyExecuted',
    action: action.proposedAction || null,
    message: 'Workbook row already has a successful draft import result.',
    blockedReason: null,
    errorCode: null,
  };
}

function rowAlreadyExecuted(row = {}) {
  return Boolean(row.target_record_id || row.targetRecordId || row.import_result?.success === true || row.importResult?.success === true);
}

function draftOrderPayload(action, batch, userContext) {
  const payload = payloadForAction(action);
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    buyer_id: actorId(userContext),
    linked_vehicle_vin: normalizeValue(payloadValue(payload, 'LINKED_VEHICLE_VIN')),
    order_type: mapWorkbookOrderType(payloadValue(payload, 'ORDER_TYPE')),
    origin_country: payloadValue(payload, 'ORIGIN_COUNTRY') || 'Unknown',
    origin_city: normalizeValue(payloadValue(payload, 'ORIGIN_CITY')),
    destination_country: payloadValue(payload, 'DESTINATION_COUNTRY') || 'Zimbabwe',
    destination_city: normalizeValue(payloadValue(payload, 'DESTINATION_CITY')),
    requested_make: normalizeValue(payloadValue(payload, 'REQUESTED_MAKE')),
    requested_model: normalizeValue(payloadValue(payload, 'REQUESTED_MODEL')),
    requested_year_min: numberValue(payload, 'REQUESTED_YEAR_MIN'),
    requested_year_max: numberValue(payload, 'REQUESTED_YEAR_MAX'),
    budget_amount: numberValue(payload, 'BUDGET_AMOUNT'),
    budget_currency: payloadValue(payload, 'BUDGET_CURRENCY') || 'USD',
    auction_lot_number: normalizeValue(payloadValue(payload, 'AUCTION_LOT_NUMBER')),
    chassis_number: normalizeValue(payloadValue(payload, 'CHASSIS_NUMBER')),
    vin: normalizeValue(payloadValue(payload, 'VIN')),
    status: 'IMPORT_REQUESTED',
    verification_status: 'PENDING_REVIEW',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftQuotePayload(action, batch, userContext, executionContext) {
  const payload = payloadForAction(action);
  const importOrderId = resolveLinkedUuid(
    payload,
    executionContext,
    'DIASPORA_IMPORT_ORDERS',
    'IMPORT_ORDER_ID',
    'CARUP_IMPORT_ORDER_UUID',
    'IMPORT_ORDER_UUID',
    'IMPORT_ORDER_ID',
  );
  if (!importOrderId) return { skipCode: 'IMPORT_ORDER_DB_ID_REQUIRED_FOR_DRAFT', skipMessage: 'Quote draft requires a safe import order database id.' };
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    import_order_id: importOrderId,
    seller_id: normalizeValue(payloadValue(payload, 'SELLER_ID', 'SELLER_USER_ID')),
    quote_amount: numberValue(payload, 'QUOTE_AMOUNT') || 0,
    quote_currency: payloadValue(payload, 'QUOTE_CURRENCY') || 'USD',
    valid_until: normalizeValue(payloadValue(payload, 'VALID_UNTIL')),
    inclusions: parseJsonList(payloadValue(payload, 'INCLUSIONS')),
    exclusions: parseJsonList(payloadValue(payload, 'EXCLUSIONS')),
    status: 'DRAFT',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftTradeDocumentPayload(action, batch, userContext, executionContext) {
  const payload = payloadForAction(action);
  const importOrderId = resolveLinkedUuid(
    payload,
    executionContext,
    'DIASPORA_IMPORT_ORDERS',
    'IMPORT_ORDER_ID',
    'CARUP_IMPORT_ORDER_UUID',
    'IMPORT_ORDER_UUID',
    'IMPORT_ORDER_ID',
  );
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    import_order_id: importOrderId,
    uploaded_by: actorId(userContext),
    document_type: payloadValue(payload, 'DOCUMENT_TYPE') || 'commercial_invoice',
    document_url: normalizeValue(payloadValue(payload, 'DOCUMENT_URL')),
    storage_path: normalizeValue(payloadValue(payload, 'STORAGE_PATH')),
    ocr_document_id: normalizeValue(payloadValue(payload, 'OCR_DOCUMENT_ID')),
    verification_status: normalizeUpper(payloadValue(payload, 'VERIFICATION_STATUS')) === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'UPLOADED',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftContainerPayload(action, batch, userContext) {
  const payload = payloadForAction(action);
  const total = numberValue(payload, 'TOTAL_CAPACITY_VOLUME') || 0;
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    origin_country: payloadValue(payload, 'ORIGIN_COUNTRY') || 'Unknown',
    origin_city: payloadValue(payload, 'ORIGIN_CITY') || 'Unknown',
    destination_country: payloadValue(payload, 'DESTINATION_COUNTRY') || 'Zimbabwe',
    destination_city: payloadValue(payload, 'DESTINATION_CITY') || 'Unknown',
    departure_date: payloadValue(payload, 'DEPARTURE_DATE') || new Date().toISOString(),
    booking_deadline: payloadValue(payload, 'BOOKING_DEADLINE') || new Date().toISOString(),
    estimated_arrival_date: normalizeValue(payloadValue(payload, 'ESTIMATED_ARRIVAL_DATE')),
    container_type: payloadValue(payload, 'CONTAINER_TYPE') || '40HQ',
    total_capacity_volume: total,
    used_capacity_volume: 0,
    available_capacity_volume: total,
    status: 'DRAFT',
    coordinator_id: actorId(userContext),
    verification_status: 'PENDING_REVIEW',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftReservationPayload(action, batch, userContext, executionContext) {
  const payload = payloadForAction(action);
  const importOrderId = resolveLinkedUuid(payload, executionContext, 'DIASPORA_IMPORT_ORDERS', 'IMPORT_ORDER_ID', 'CARUP_IMPORT_ORDER_UUID', 'IMPORT_ORDER_UUID', 'IMPORT_ORDER_ID');
  const containerId = resolveLinkedUuid(payload, executionContext, 'CONTAINER_SHIPMENTS', 'CONTAINER_ID', 'CARUP_CONTAINER_UUID', 'CONTAINER_UUID', 'CONTAINER_ID');
  if (!importOrderId || !containerId) return { skipCode: 'RESERVATION_LINKED_DB_IDS_REQUIRED', skipMessage: 'Cargo reservation draft requires safe container and import order database ids.' };
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    container_id: containerId,
    import_order_id: importOrderId,
    buyer_id: actorId(userContext),
    seller_id: normalizeValue(payloadValue(payload, 'SELLER_ID', 'SELLER_USER_ID')),
    cargo_type: payloadValue(payload, 'CARGO_TYPE') || 'parts',
    estimated_volume: numberValue(payload, 'ESTIMATED_VOLUME') || 0,
    estimated_weight: numberValue(payload, 'ESTIMATED_WEIGHT'),
    declared_value: numberValue(payload, 'DECLARED_VALUE'),
    currency: payloadValue(payload, 'CURRENCY') || 'USD',
    cargo_description: normalizeValue(payloadValue(payload, 'CARGO_DESCRIPTION')),
    pickup_location: normalizeValue(payloadValue(payload, 'PICKUP_LOCATION')),
    receiver_name: normalizeValue(payloadValue(payload, 'RECEIVER_NAME')),
    receiver_phone: normalizeValue(payloadValue(payload, 'RECEIVER_PHONE')),
    receiver_location: normalizeValue(payloadValue(payload, 'RECEIVER_LOCATION')),
    invoice_document_id: safeUuid(payloadValue(payload, 'INVOICE_DOCUMENT_ID')),
    dimensions_document_id: safeUuid(payloadValue(payload, 'DIMENSIONS_DOCUMENT_ID')),
    reservation_status: 'REQUESTED',
    verification_status: 'PENDING_REVIEW',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftShipmentPayload(action, batch, userContext, executionContext) {
  const payload = payloadForAction(action);
  const importOrderId = resolveLinkedUuid(payload, executionContext, 'DIASPORA_IMPORT_ORDERS', 'IMPORT_ORDER_ID', 'CARUP_IMPORT_ORDER_UUID', 'IMPORT_ORDER_UUID', 'IMPORT_ORDER_ID');
  if (!importOrderId) return { skipCode: 'SHIPMENT_IMPORT_ORDER_DB_ID_REQUIRED', skipMessage: 'Shipment draft requires a safe import order database id.' };
  const containerId = resolveLinkedUuid(payload, executionContext, 'CONTAINER_SHIPMENTS', 'CONTAINER_ID', 'CARUP_CONTAINER_UUID', 'CONTAINER_UUID', 'CONTAINER_ID');
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    import_order_id: importOrderId,
    container_id: containerId,
    carrier_name: normalizeValue(payloadValue(payload, 'CARRIER_NAME')),
    tracking_number: normalizeValue(payloadValue(payload, 'TRACKING_NUMBER')),
    origin_port: normalizeValue(payloadValue(payload, 'ORIGIN_PORT')),
    destination_port: normalizeValue(payloadValue(payload, 'DESTINATION_PORT')),
    departure_date: normalizeValue(payloadValue(payload, 'DEPARTURE_DATE')),
    estimated_arrival_date: normalizeValue(payloadValue(payload, 'ESTIMATED_ARRIVAL_DATE')),
    actual_arrival_date: null,
    status: 'PLANNED',
    verification_status: 'PENDING_REVIEW',
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

function draftAiCommandPayload(action, batch, userContext) {
  const payload = payloadForAction(action);
  const riskLevel = normalizeUpper(payloadValue(payload, 'RISK_LEVEL')) || 'LOW';
  return {
    tenant_id: userContext.tenantId || batch.tenant_id || null,
    requested_by: actorId(userContext),
    workbook_batch_id: batch.id || null,
    raw_command: payloadValue(payload, 'RAW_COMMAND') || '',
    voice_transcript: normalizeValue(payloadValue(payload, 'VOICE_TRANSCRIPT')),
    intent: payloadValue(payload, 'INTENT') || 'WORKBOOK_DRAFT_ACTION',
    risk_level: riskLevel,
    confidence_score: numberValue(payload, 'CONFIDENCE_SCORE') || 0,
    target_entity_type: normalizeValue(payloadValue(payload, 'TARGET_SHEET')),
    target_entity_id: normalizeValue(payloadValue(payload, 'TARGET_RECORD_ID')),
    extracted_entities: {
      partId: payloadValue(payload, 'EXTRACTED_PART_ID'),
      vehicleId: payloadValue(payload, 'EXTRACTED_VEHICLE_ID'),
      quantity: payloadValue(payload, 'EXTRACTED_QUANTITY'),
    },
    proposed_action: {
      intent: payloadValue(payload, 'INTENT') || 'WORKBOOK_DRAFT_ACTION',
      targetSheet: payloadValue(payload, 'TARGET_SHEET'),
      targetRecordId: payloadValue(payload, 'TARGET_RECORD_ID'),
      draftOnly: true,
    },
    approval_status: riskLevel === 'HIGH' ? 'PENDING' : 'NOT_REQUIRED',
    execution_status: 'DRAFT',
    error_message: null,
    metadata: metadataForAction(action, batch, userContext),
    created_by: actorId(userContext),
    updated_by: actorId(userContext),
  };
}

export function buildDraftPayloadForAction(action, batch, userContext, options = {}) {
  if (!PHASE_1F_DRAFT_TARGETS.has(action.targetTable)) {
    return { skipCode: 'TARGET_TABLE_NOT_EXECUTABLE_IN_PHASE_1F', skipMessage: 'Target table is review-only or not draft-executable in Phase 1F.' };
  }
  if (!WORKBOOK_IMPORT_ALLOWED_TARGET_TABLES.has(action.targetTable)) {
    return { skipCode: 'TARGET_TABLE_NOT_ALLOW_LISTED', skipMessage: 'Target table is not allow-listed for workbook imports.' };
  }

  const executionContext = options.executionContext || {};
  if (action.targetTable === 'diaspora_import_orders') return { table: action.targetTable, payload: draftOrderPayload(action, batch, userContext) };
  if (action.targetTable === 'diaspora_import_quotes') return { table: action.targetTable, payload: draftQuotePayload(action, batch, userContext, executionContext) };
  if (action.targetTable === 'diaspora_trade_documents') return { table: action.targetTable, payload: draftTradeDocumentPayload(action, batch, userContext, executionContext) };
  if (action.targetTable === 'diaspora_container_shipments') return { table: action.targetTable, payload: draftContainerPayload(action, batch, userContext) };
  if (action.targetTable === 'diaspora_cargo_reservations') return { table: action.targetTable, payload: draftReservationPayload(action, batch, userContext, executionContext) };
  if (action.targetTable === 'diaspora_shipments') return { table: action.targetTable, payload: draftShipmentPayload(action, batch, userContext, executionContext) };
  if (action.targetTable === 'diaspora_ai_commands') return { table: action.targetTable, payload: draftAiCommandPayload(action, batch, userContext) };

  return { skipCode: 'NO_DRAFT_ADAPTER_FOR_TARGET_TABLE', skipMessage: 'No Phase 1F draft adapter exists for this target table.' };
}

export function assertWorkbookBatchExecutable(batch = {}, plan = {}, userContext = {}) {
  assertAuthenticated(userContext);
  const status = normalizeUpper(batch.import_status || batch.importStatus);
  const operatorHold = normalizeOperatorHold(normalizeWorkbookBatchMetadata(batch.metadata));
  if (operatorHold?.active === true) {
    throw new ValidationError('WORKBOOK_BATCH_ON_OPERATOR_HOLD', {
      batchId: batch.id,
      importStatus: status,
      errorCode: 'WORKBOOK_BATCH_ON_OPERATOR_HOLD',
    });
  }
  if (WORKBOOK_IMPORT_IN_PROGRESS_STATUSES.has(status)) {
    throw new ValidationError('Workbook draft import execution is already in progress.', { batchId: batch.id, importStatus: status });
  }
  if (WORKBOOK_IMPORT_COMPLETED_STATUSES.has(status)) {
    throw new ValidationError('Workbook draft import execution has already completed.', { batchId: batch.id, importStatus: status });
  }
  if (status === WORKBOOK_IMPORT_STATUSES.CANCELLED) {
    throw new ValidationError('Cancelled workbook import batches cannot execute draft imports.', { batchId: batch.id, importStatus: status });
  }
  if (status === WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT) {
    throw new ValidationError('Retrying failed draft imports is blocked until a safe retry workflow is implemented.', { batchId: batch.id, importStatus: status });
  }
  if (!WORKBOOK_IMPORT_EXECUTABLE_STATUSES.has(status)) {
    throw new ValidationError('Workbook draft import execution requires READY_FOR_REVIEW status.', { batchId: batch.id, importStatus: status });
  }
  if (Number(batch.error_count || batch.errorCount || 0) > 0 || Number(batch.rejected_rows || batch.rejectedRows || 0) > 0) {
    throw new ValidationError('Workbook draft import execution requires zero rejected rows and zero errors.', {
      batchId: batch.id,
      rejectedRows: batch.rejected_rows || batch.rejectedRows || 0,
      errorCount: batch.error_count || batch.errorCount || 0,
    });
  }
  if (!plan || !Array.isArray(plan.actions)) {
    throw new ValidationError('Workbook draft import execution requires a valid import plan.', { batchId: batch.id });
  }
}

async function insertDraftRecord(client, table, payload) {
  const { data, error } = await client
    .from(table)
    .insert(payload)
    .select()
    .single();
  if (error) throw new DatabaseError('Failed to create workbook draft record.', safeDatabaseDetails(table, 'insert', error));
  return data;
}

export async function executeWorkbookImportAction(action, batch, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  if (rowAlreadyExecuted(action.row)) return makeAlreadyExecutedResult(action);
  if (action.blocked) return makeBlockedResult(action, action.blockedReason || 'ACTION_BLOCKED');
  if (!DRAFT_EXECUTION_ACTIONS.has(action.proposedAction)) {
    return makeSkippedResult(action, action.proposedAction || 'ACTION_NOT_DRAFT_EXECUTABLE', 'Workbook action is not draft-executable in Phase 1F.');
  }
  if (action.requiresApproval && !isReviewer(userContext)) {
    return makeSkippedResult(action, 'APPROVAL_REQUIRED', 'Workbook action requires reviewer/admin approval before draft execution.');
  }

  const built = buildDraftPayloadForAction(action, batch, userContext, options);
  if (built.skipCode) return makeSkippedResult(action, built.skipCode, built.skipMessage);

  const client = options.supabaseClient || await defaultSupabaseClient();
  const record = await insertDraftRecord(client, built.table, built.payload);
  rememberTargetRecord(action, record?.id || null, options.executionContext || {});
  return makeExecutedResult(action, record?.id || null);
}

export async function markWorkbookRowExecutionResult(rowId, result, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  if (!rowId) throw new ValidationError('Workbook row id is required to mark execution result.');
  const client = options.supabaseClient || await defaultSupabaseClient();
  const success = result.status === 'executed' || result.status === 'alreadyExecuted';
  const importResult = {
    phase: '1F',
    success,
    status: result.status,
    action: result.action,
    message: result.message,
    blockedReason: result.blockedReason || null,
    errorCode: result.errorCode || null,
    draftImportExecuted: result.status === 'executed',
    liveImportExecuted: false,
    aiExecuted: false,
    executedAt: new Date().toISOString(),
    executedBy: actorId(userContext),
  };
  const updatePayload = {
    import_result: importResult,
    updated_by: actorId(userContext),
  };
  if (result.targetRecordId) updatePayload.target_record_id = result.targetRecordId;

  const { data, error } = await client
    .from('diaspora_workbook_import_rows')
    .update(updatePayload)
    .eq('id', rowId)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update workbook row execution result.', {
    ...safeDatabaseDetails('diaspora_workbook_import_rows', 'update', error),
    rowId,
  });
  return data;
}

export async function markWorkbookBatchExecutionResult(batchId, result, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  if (!batchId) throw new ValidationError('Workbook batch id is required to mark execution result.');
  const client = options.supabaseClient || await defaultSupabaseClient();
  const metadata = {
    ...normalizeWorkbookBatchMetadata(result.previousMetadata),
    phase: '1F',
    draftImportExecuted: Boolean(result.draftImportExecuted),
    liveImportExecuted: false,
    aiExecuted: false,
    executionStatus: result.nextStatus,
    executionSummary: result.summary || null,
    executionUpdatedAt: new Date().toISOString(),
    executionUpdatedBy: actorId(userContext),
  };

  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .update({
      import_status: result.nextStatus,
      metadata,
      updated_by: actorId(userContext),
    })
    .eq('id', batchId)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update workbook batch execution result.', {
    ...safeDatabaseDetails('diaspora_workbook_import_batches', 'update', error),
    batchId,
  });
  return data;
}

function resultCounts(results = []) {
  return {
    executedDrafts: results.filter((result) => result.status === 'executed').length,
    skippedActions: results.filter((result) => result.status === 'skipped').length,
    blockedActions: results.filter((result) => result.status === 'blocked').length,
    failedActions: results.filter((result) => result.status === 'failed').length,
    alreadyExecuted: results.filter((result) => result.status === 'alreadyExecuted').length,
  };
}

function finalStatusForResults(counts) {
  if (counts.executedDrafts > 0 && counts.skippedActions === 0 && counts.blockedActions === 0 && counts.failedActions === 0) {
    return WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS;
  }
  if (counts.executedDrafts > 0 || counts.alreadyExecuted > 0) {
    return WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS;
  }
  return WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT;
}

async function listAllWorkbookImportRows(batchId, userContext, options = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const result = await listDiasporaWorkbookImportRows(
      batchId,
      { limit: IMPORT_PLAN_PAGE_SIZE, offset },
      userContext,
      options,
    );
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < IMPORT_PLAN_PAGE_SIZE) break;
    offset += IMPORT_PLAN_PAGE_SIZE;
  }
  return rows;
}

export async function executeDiasporaWorkbookDraftImport(batchId, userContext = {}, options = {}) {
  assertAuthenticated(userContext);
  const client = options.supabaseClient || await defaultSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(batchId, userContext, { supabaseClient: client });
  const rows = await listAllWorkbookImportRows(batchId, userContext, { supabaseClient: client });
  const plan = buildWorkbookImportPlan(batch, rows, userContext);
  assertWorkbookBatchExecutable(batch, plan, userContext);

  const previousStatus = batch.import_status;
  await markWorkbookBatchExecutionResult(batch.id, {
    nextStatus: WORKBOOK_IMPORT_STATUSES.IMPORTING_DRAFTS,
    previousMetadata: batch.metadata,
    draftImportExecuted: false,
    summary: { started: true, phase: '1F' },
  }, userContext, { supabaseClient: client });

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const executionContext = { recordIdMap: new Map() };
  const results = [];

  for (const action of plan.actions) {
    const row = rowById.get(action.rowId) || null;
    const executableAction = { ...action, row };
    let result;
    try {
      result = await executeWorkbookImportAction(executableAction, batch, userContext, {
        ...options,
        supabaseClient: client,
        executionContext,
      });
    } catch (error) {
      result = {
        rowId: action.rowId || null,
        sheetName: action.sheetName || null,
        workbookRowNumber: action.workbookRowNumber || null,
        targetTable: action.targetTable || null,
        targetRecordId: null,
        status: 'failed',
        action: action.proposedAction || null,
        message: 'Draft record creation failed.',
        blockedReason: null,
        errorCode: error.code || 'DRAFT_IMPORT_FAILED',
      };
    }

    results.push(result);
    await markWorkbookRowExecutionResult(action.rowId, result, userContext, { supabaseClient: client });
  }

  const counts = resultCounts(results);
  const nextStatus = finalStatusForResults(counts);
  const summary = {
    totalActions: plan.actions.length,
    ...counts,
  };
  await markWorkbookBatchExecutionResult(batch.id, {
    nextStatus,
    previousMetadata: batch.metadata,
    draftImportExecuted: counts.executedDrafts > 0,
    summary,
  }, userContext, { supabaseClient: client });

  return {
    batchId: batch.id,
    previousStatus,
    nextStatus,
    draftImportExecuted: counts.executedDrafts > 0,
    liveImportExecuted: false,
    aiExecuted: false,
    totals: summary,
    results,
  };
}
