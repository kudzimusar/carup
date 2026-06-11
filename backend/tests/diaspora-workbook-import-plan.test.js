import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBOOK_SHEETS, WORKBOOK_TEMPLATE_SHEETS, WORKBOOK_TEMPLATE_TYPES } from '../constants/diaspora/diasporaWorkbookSchema.js';
import {
  WORKBOOK_IMPORT_ACTION_TYPES,
  WORKBOOK_IMPORT_MAP,
} from '../constants/diaspora/diasporaWorkbookImportMap.js';
import {
  buildWorkbookImportPlan,
  classifyWorkbookImportRow,
  validateWorkbookImportPlan,
} from '../services/diaspora/diasporaWorkbookImportPlanningService.js';
import {
  getDiasporaWorkbookImportBatch,
  listDiasporaWorkbookImportRows,
} from '../services/diaspora/diasporaWorkbookReviewService.js';
import {
  exportDiasporaWorkbook,
  importDiasporaWorkbook,
  saveDiasporaWorkbookToDrive,
} from '../services/diaspora/diasporaWorkbookSyncService.js';
import { ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');
const planningServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookImportPlanningService.js', import.meta.url), 'utf8');

const userContext = { id: 'user-1', tenantId: 'tenant-1', role: 'owner' };
const batch = {
  id: 'batch-plan-1',
  tenant_id: 'tenant-1',
  uploaded_by: 'user-1',
  template_type: 'enterprise',
  import_status: 'VALIDATED',
  deleted_at: null,
  created_by: 'user-1',
  updated_by: 'user-1',
};

function row(overrides = {}) {
  const sheetName = overrides.sheet_name || 'DIASPORA_IMPORT_ORDERS';
  const definition = WORKBOOK_SHEETS[sheetName] || {};
  return {
    id: overrides.id || `${sheetName}-row-1`,
    tenant_id: 'tenant-1',
    batch_id: batch.id,
    sheet_name: sheetName,
    workbook_row_number: overrides.workbook_row_number || 2,
    workbook_record_id: overrides.workbook_record_id || 'WB-1',
    target_table: overrides.target_table === undefined ? definition.apiTable : overrides.target_table,
    action_type: overrides.action_type || 'UPSERT_DRAFT',
    validation_status: overrides.validation_status || 'ACCEPTED',
    normalized_payload: overrides.normalized_payload || { IMPORT_ORDER_ID: 'DIO-1', STATUS: 'IMPORT_REQUESTED' },
    row_payload: overrides.row_payload || overrides.normalized_payload || { IMPORT_ORDER_ID: 'DIO-1', STATUS: 'IMPORT_REQUESTED' },
    validation_errors: overrides.validation_errors || [],
    validation_warnings: overrides.validation_warnings || [],
    deleted_at: null,
  };
}

function createReviewMockSupabaseClient(overrides = {}) {
  const calls = [];
  const db = {
    batches: overrides.batches || [batch],
    rows: overrides.rows || [
      row({ id: 'accepted-row' }),
      row({
        id: 'warning-row',
        sheet_name: 'IMPORT_QUOTES',
        workbook_record_id: 'Q-1',
        validation_status: 'WARNING',
        normalized_payload: { QUOTE_ID: 'Q-1', STATUS: 'SUBMITTED' },
        validation_warnings: [{ code: 'REVIEW_RECOMMENDED' }],
      }),
    ],
  };

  function tableRows(table) {
    if (table === 'diaspora_workbook_import_batches') return db.batches;
    if (table === 'diaspora_workbook_import_rows') return db.rows;
    return [];
  }

  function makeBuilder(table) {
    const state = { table, filters: [], nullFilters: [], single: false, range: null };
    const chain = {
      select() { return chain; },
      eq(column, value) { state.filters.push({ column, value }); return chain; },
      is(column, value) { state.nullFilters.push({ column, value }); return chain; },
      order() { return chain; },
      range(from, to) { state.range = { from, to }; return chain; },
      single() { state.single = true; return chain; },
      then(resolve, reject) {
        try {
          calls.push({ table: state.table, op: 'select', filters: state.filters });
          let rows = tableRows(state.table).filter((candidate) => {
            const eqMatch = state.filters.every(({ column, value }) => candidate[column] === value);
            const nullMatch = state.nullFilters.every(({ column, value }) => value === null ? candidate[column] === null || candidate[column] === undefined : candidate[column] === value);
            return eqMatch && nullMatch;
          });
          if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
          const result = state.single
            ? rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
            : { data: rows, error: null };
          return Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          return reject ? reject(error) : Promise.reject(error);
        }
      },
    };
    return chain;
  }

  return {
    calls,
    from(table) {
      return makeBuilder(table);
    },
  };
}

test('Phase 1E import map includes every enterprise workbook sheet', () => {
  assert.deepEqual(
    Object.keys(WORKBOOK_IMPORT_MAP).sort(),
    [...WORKBOOK_TEMPLATE_SHEETS[WORKBOOK_TEMPLATE_TYPES.ENTERPRISE]].sort(),
  );
});

test('Phase 1E import map does not allow direct execution', () => {
  for (const [sheetName, mapping] of Object.entries(WORKBOOK_IMPORT_MAP)) {
    assert.equal(mapping.executionAllowedInPhase1E, false, `${sheetName} must not execute in Phase 1E`);
    assert.ok(mapping.serviceOwner);
    assert.ok(mapping.actionType);
  }
});

test('Phase 1E import plan endpoint exists', () => {
  assert.equal(routeFile.includes("router.get('/workbook/import-batches/:id/import-plan'"), true);
  assert.equal(routeFile.includes('buildWorkbookImportPlan'), true);
});

test('Phase 1E import planning flow reads workbook batch and row data only', async () => {
  const mockSupabaseClient = createReviewMockSupabaseClient();
  const persistedBatch = await getDiasporaWorkbookImportBatch(batch.id, userContext, { supabaseClient: mockSupabaseClient });
  const persistedRows = await listDiasporaWorkbookImportRows(batch.id, { limit: 500 }, userContext, { supabaseClient: mockSupabaseClient });
  const plan = buildWorkbookImportPlan(persistedBatch, persistedRows.data, userContext);

  assert.equal(plan.batchId, batch.id);
  assert.deepEqual(
    [...new Set(mockSupabaseClient.calls.map((call) => call.table))].sort(),
    ['diaspora_workbook_import_batches', 'diaspora_workbook_import_rows'],
  );
  assert.equal(mockSupabaseClient.calls.some((call) => call.op !== 'select'), false);
});

test('Phase 1E accepted row becomes a planned action', () => {
  const action = classifyWorkbookImportRow(row(), batch, userContext);
  assert.equal(action.blocked, false);
  assert.equal(action.proposedAction, WORKBOOK_IMPORT_ACTION_TYPES.CREATE_DRAFT);
  assert.equal(action.targetTable, 'diaspora_import_orders');
});

test('Phase 1E warning row becomes a planned action requiring review', () => {
  const action = classifyWorkbookImportRow(
    row({
      sheet_name: 'IMPORT_QUOTES',
      validation_status: 'WARNING',
      normalized_payload: { QUOTE_ID: 'Q-1', STATUS: 'SUBMITTED' },
      validation_warnings: [{ code: 'REVIEW_RECOMMENDED' }],
    }),
    batch,
    userContext,
  );
  assert.equal(action.blocked, false);
  assert.equal(action.requiresReview, true);
});

test('Phase 1E rejected and ERROR rows are blocked', () => {
  assert.equal(classifyWorkbookImportRow(row({ validation_status: 'REJECTED' }), batch, userContext).blockedReason, 'ROW_REJECTED_BY_DRY_RUN');
  assert.equal(classifyWorkbookImportRow(row({ action_type: 'ERROR' }), batch, userContext).blockedReason, 'ROW_ACTION_TYPE_ERROR');
});

test('Phase 1E high-risk AI command requires approval and remains blocked until approved', () => {
  const action = classifyWorkbookImportRow(
    row({
      sheet_name: 'AI_COMMAND_CENTER',
      target_table: null,
      workbook_record_id: 'CMD-1',
      normalized_payload: { COMMAND_ID: 'CMD-1', RISK_LEVEL: 'HIGH', APPROVAL_STATUS: 'PENDING', EXECUTION_STATUS: 'VALIDATED' },
    }),
    batch,
    userContext,
  );
  assert.equal(action.blocked, true);
  assert.equal(action.requiresApproval, true);
  assert.equal(action.blockedReason, 'HIGH_RISK_AI_COMMAND_REQUIRES_APPROVAL');
});

test('Phase 1E compliance approval from workbook is blocked', () => {
  const action = classifyWorkbookImportRow(
    row({ sheet_name: 'COMPLIANCE_REVIEWS', normalized_payload: { COMPLIANCE_REVIEW_ID: 'CR-1', STATUS: 'APPROVED' } }),
    batch,
    userContext,
  );
  assert.equal(action.blockedReason, 'COMPLIANCE_APPROVAL_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1E document verification from workbook is blocked', () => {
  const action = classifyWorkbookImportRow(
    row({ sheet_name: 'TRADE_DOCUMENTS', normalized_payload: { DOCUMENT_ID: 'DOC-1', VERIFICATION_STATUS: 'VERIFIED' } }),
    batch,
    userContext,
  );
  assert.equal(action.blockedReason, 'DOCUMENT_VERIFICATION_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1E payment release from workbook is blocked', () => {
  const action = classifyWorkbookImportRow(
    row({ sheet_name: 'PAYMENT_MILESTONES', normalized_payload: { PAYMENT_MILESTONE_ID: 'PM-1', STATUS: 'PAID' } }),
    batch,
    userContext,
  );
  assert.equal(action.blockedReason, 'PAYMENT_RELEASE_OR_PAID_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1E shipment delivered or released status from workbook is blocked', () => {
  const action = classifyWorkbookImportRow(
    row({ sheet_name: 'SHIPMENTS', normalized_payload: { SHIPMENT_ID: 'SHIP-1', STATUS: 'DELIVERED' } }),
    batch,
    userContext,
  );
  assert.equal(action.blockedReason, 'SHIPMENT_DELIVERED_OR_RELEASED_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1E stock quantity overwrite is blocked as ledger-required', () => {
  const action = classifyWorkbookImportRow(
    row({
      sheet_name: 'TRADE_PROFILES',
      target_table: 'diaspora_stock_items',
      normalized_payload: { TRADE_PROFILE_ID: 'TP-1', QUANTITY_ON_HAND: 10 },
    }),
    batch,
    userContext,
  );
  assert.equal(action.blocked, true);
  assert.equal(action.proposedAction, WORKBOOK_IMPORT_ACTION_TYPES.LEDGER_REQUIRED);
  assert.equal(action.blockedReason, 'STOCK_QUANTITY_OVERWRITE_REQUIRES_LEDGER_ACTION');
});

test('Phase 1E plan canProceedToExecution is false', () => {
  const plan = buildWorkbookImportPlan(batch, [row(), row({ validation_status: 'WARNING' })], userContext);
  assert.equal(plan.canProceedToExecution, false);
  assert.equal(plan.validation.valid, true);
  assert.equal(validateWorkbookImportPlan(plan).valid, true);
});

test('Phase 1E planning functions do not write to Supabase', () => {
  assert.equal(planningServiceFile.includes("from '../../db/supabase"), false);
  assert.equal(planningServiceFile.includes('.from('), false);
  assert.equal(planningServiceFile.includes('.insert('), false);
  assert.equal(planningServiceFile.includes('.update('), false);
  assert.equal(planningServiceFile.includes('.delete('), false);
});

test('Phase 1E live import/export/drive actions remain intentionally disabled', async () => {
  await assert.rejects(() => importDiasporaWorkbook({ sheets: {} }, userContext), ValidationError);
  await assert.rejects(() => exportDiasporaWorkbook(), ValidationError);
  await assert.rejects(() => saveDiasporaWorkbookToDrive(), ValidationError);
});
