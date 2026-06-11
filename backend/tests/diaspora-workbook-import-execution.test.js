import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBOOK_IMPORT_STATUSES } from '../constants/diaspora/diasporaWorkbookImportStatuses.js';
import {
  assertWorkbookBatchExecutable,
  buildDraftPayloadForAction,
  executeDiasporaWorkbookDraftImport,
  executeWorkbookImportAction,
} from '../services/diaspora/diasporaWorkbookImportExecutionService.js';
import { buildWorkbookImportPlan } from '../services/diaspora/diasporaWorkbookImportPlanningService.js';
import { ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');
const executionServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookImportExecutionService.js', import.meta.url), 'utf8');

const reviewerContext = {
  id: 'reviewer-1',
  userId: 'reviewer-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: 'reviewer',
  baseRole: 'reviewer',
  platformRole: 'reviewer',
};

const ownerContext = {
  id: 'owner-1',
  userId: 'owner-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: 'owner',
  baseRole: 'member',
  platformRole: 'member',
};

const ORDER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTAINER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function batch(overrides = {}) {
  return {
    id: overrides.id || 'batch-exec-1',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    uploaded_by: 'owner-1',
    template_type: 'enterprise',
    total_rows: 1,
    accepted_rows: 1,
    rejected_rows: 0,
    warning_count: 0,
    error_count: 0,
    import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    rollback_status: 'NOT_REQUIRED',
    metadata: { phase: '1D' },
    created_by: 'owner-1',
    updated_by: 'owner-1',
    deleted_at: null,
    ...overrides,
  };
}

function row(overrides = {}) {
  const sheetName = overrides.sheet_name || 'DIASPORA_IMPORT_ORDERS';
  return {
    id: overrides.id || `${sheetName}-row-1`,
    tenant_id: '11111111-1111-4111-8111-111111111111',
    batch_id: 'batch-exec-1',
    sheet_name: sheetName,
    workbook_row_number: overrides.workbook_row_number || 2,
    workbook_record_id: overrides.workbook_record_id || 'WB-1',
    target_table: overrides.target_table || {
      DIASPORA_IMPORT_ORDERS: 'diaspora_import_orders',
      IMPORT_QUOTES: 'diaspora_import_quotes',
      TRADE_DOCUMENTS: 'diaspora_trade_documents',
      CONTAINER_SHIPMENTS: 'diaspora_container_shipments',
      CARGO_RESERVATIONS: 'diaspora_cargo_reservations',
      SHIPMENTS: 'diaspora_shipments',
      COMPLIANCE_REVIEWS: 'diaspora_compliance_reviews',
      PAYMENT_MILESTONES: 'diaspora_payment_milestones',
      REPUTATION_RECORDS: 'diaspora_reputation_records',
      AI_COMMAND_CENTER: 'diaspora_ai_commands',
    }[sheetName],
    target_record_id: overrides.target_record_id || null,
    action_type: overrides.action_type || 'UPSERT_DRAFT',
    row_payload: overrides.normalized_payload || {},
    normalized_payload: overrides.normalized_payload || {
      IMPORT_ORDER_ID: 'DIO-1',
      ORDER_TYPE: 'parts_import',
      ORIGIN_COUNTRY: 'Japan',
      DESTINATION_COUNTRY: 'Zimbabwe',
      STATUS: 'IMPORT_REQUESTED',
      BUDGET_CURRENCY: 'USD',
    },
    validation_status: overrides.validation_status || 'ACCEPTED',
    validation_errors: overrides.validation_errors || [],
    validation_warnings: overrides.validation_warnings || [],
    import_result: overrides.import_result || {},
    metadata: {},
    created_by: 'owner-1',
    updated_by: 'owner-1',
    deleted_at: null,
    ...overrides,
  };
}

function createMockSupabaseClient(overrides = {}) {
  const calls = [];
  const db = {
    diaspora_workbook_import_batches: overrides.batches || [batch()],
    diaspora_workbook_import_rows: overrides.rows || [row()],
    diaspora_import_orders: [],
    diaspora_import_quotes: [],
    diaspora_trade_documents: [],
    diaspora_container_shipments: [],
    diaspora_cargo_reservations: [],
    diaspora_shipments: [],
    diaspora_ai_commands: [],
  };
  const insertCounters = {};

  function tableRows(table) {
    if (!db[table]) db[table] = [];
    return db[table];
  }

  function makeId(table) {
    insertCounters[table] = (insertCounters[table] || 0) + 1;
    if (table === 'diaspora_import_orders') return ORDER_UUID;
    if (table === 'diaspora_container_shipments') return CONTAINER_UUID;
    return `00000000-0000-4000-8000-${String(insertCounters[table]).padStart(12, '0')}`;
  }

  function matches(candidate, state) {
    const eqMatch = state.filters.every(({ column, value }) => candidate[column] === value);
    const nullMatch = state.nullFilters.every(({ column, value }) => (
      value === null ? candidate[column] === null || candidate[column] === undefined : candidate[column] === value
    ));
    const orMatch = state.orFilters.length === 0 || state.orFilters.some(({ column, operator, value }) => (
      operator === 'eq' && candidate[column] === value
    ));
    return eqMatch && nullMatch && orMatch;
  }

  function resolve(state) {
    calls.push({ table: state.table, op: state.op, payload: state.payload, filters: state.filters });
    let rows = tableRows(state.table);

    if (state.op === 'insert') {
      const payload = Array.isArray(state.payload) ? state.payload : [state.payload];
      const inserted = payload.map((item) => ({ id: item.id || makeId(state.table), ...item }));
      rows.push(...inserted);
      return { data: Array.isArray(state.payload) ? inserted : inserted[0], error: null };
    }

    let matched = rows.filter((candidate) => matches(candidate, state));
    if (state.op === 'update') {
      matched = matched.map((candidate) => {
        Object.assign(candidate, state.payload);
        return candidate;
      });
    }
    if (state.range) matched = matched.slice(state.range.from, state.range.to + 1);
    if (state.single) {
      const first = matched[0] || null;
      return first ? { data: first, error: null } : { data: null, error: { message: 'not found' } };
    }
    return { data: matched, error: null };
  }

  function makeBuilder(table) {
    const state = { table, op: 'select', payload: null, filters: [], nullFilters: [], orFilters: [], range: null, single: false };
    const chain = {
      select() { return chain; },
      eq(column, value) { state.filters.push({ column, value }); return chain; },
      is(column, value) { state.nullFilters.push({ column, value }); return chain; },
      or(expression) {
        state.orFilters = String(expression || '').split(',').map((part) => {
          const [column, operator, ...rest] = part.split('.');
          return { column, operator, value: rest.join('.') };
        });
        return chain;
      },
      order() { return chain; },
      range(from, to) { state.range = { from, to }; return chain; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
      update(payload) { state.op = 'update'; state.payload = payload; return chain; },
      single() { state.single = true; return chain; },
      then(resolvePromise, rejectPromise) {
        try {
          return Promise.resolve(resolve(state)).then(resolvePromise, rejectPromise);
        } catch (error) {
          return rejectPromise ? rejectPromise(error) : Promise.reject(error);
        }
      },
    };
    return chain;
  }

  return {
    calls,
    db,
    from(table) {
      return makeBuilder(table);
    },
  };
}

function insertedPayload(client, table, index = 0) {
  return client.calls.filter((call) => call.table === table && call.op === 'insert')[index]?.payload;
}

test('Phase 1F execute-drafts route exists', () => {
  assert.equal(routeFile.includes("router.post('/workbook/import-batches/:id/execute-drafts'"), true);
  assert.equal(routeFile.includes('executeDiasporaWorkbookDraftImport'), true);
});

test('Phase 1F execution service refuses non-authenticated user', async () => {
  await assert.rejects(
    () => executeDiasporaWorkbookDraftImport('batch-exec-1', {}, { supabaseClient: createMockSupabaseClient() }),
    ValidationError,
  );
});

test('Phase 1F execution service refuses CANCELLED batch', () => {
  const cancelled = batch({ import_status: WORKBOOK_IMPORT_STATUSES.CANCELLED });
  assert.throws(() => assertWorkbookBatchExecutable(cancelled, { actions: [] }, reviewerContext), ValidationError);
});

test('Phase 1H execution service refuses batch on operator hold', () => {
  const held = batch({
    import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    metadata: { operatorHold: { active: true, reason: 'operator hold' } }
  });
  assert.throws(
    () => assertWorkbookBatchExecutable(held, { actions: [] }, reviewerContext),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.details?.errorCode, 'WORKBOOK_BATCH_ON_OPERATOR_HOLD');
      return true;
    }
  );
});

test('Phase 1F execution service refuses VALIDATED batch that is not READY_FOR_REVIEW', () => {
  const validated = batch({ import_status: WORKBOOK_IMPORT_STATUSES.VALIDATED });
  assert.throws(() => assertWorkbookBatchExecutable(validated, { actions: [] }, reviewerContext), /READY_FOR_REVIEW/);
});

test('Phase 1F planning allows VALIDATED and READY_FOR_REVIEW but execution only allows READY_FOR_REVIEW', () => {
  const validated = batch({ import_status: WORKBOOK_IMPORT_STATUSES.VALIDATED });
  const ready = batch({ import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW });
  assert.equal(buildWorkbookImportPlan(validated, [row()], reviewerContext).totals.plannedActions, 1);
  assert.equal(buildWorkbookImportPlan(ready, [row()], reviewerContext).totals.plannedActions, 1);
  assert.throws(() => assertWorkbookBatchExecutable(validated, { actions: [row()] }, reviewerContext), ValidationError);
  assert.doesNotThrow(() => assertWorkbookBatchExecutable(ready, { actions: [row()] }, reviewerContext));
});

test('Phase 1F execution service refuses rejected/error batch', async () => {
  await assert.rejects(
    () => executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, {
      supabaseClient: createMockSupabaseClient({ batches: [batch({ rejected_rows: 1, error_count: 1 })] }),
    }),
    /zero rejected rows/,
  );
});

test('Phase 1F execution service uses import plan before executing', async () => {
  const client = createMockSupabaseClient();
  await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  const firstTargetInsert = client.calls.findIndex((call) => call.op === 'insert' && call.table === 'diaspora_import_orders');
  const rowRead = client.calls.findIndex((call) => call.op === 'select' && call.table === 'diaspora_workbook_import_rows');
  assert.ok(rowRead > -1);
  assert.ok(firstTargetInsert > rowRead);
});

test('Phase 1F execution service does not execute when plan has only blocked rows', async () => {
  const client = createMockSupabaseClient({
    rows: [row({ validation_status: 'REJECTED', action_type: 'UPSERT_DRAFT' })],
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT);
  assert.equal(result.totals.executedDrafts, 0);
  assert.equal(client.calls.some((call) => call.op === 'insert' && call.table === 'diaspora_import_orders'), false);
});

test('Phase 1F accepted draft import order row creates safe draft record', async () => {
  const client = createMockSupabaseClient();
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  const payload = insertedPayload(client, 'diaspora_import_orders');
  assert.equal(result.totals.executedDrafts, 1);
  assert.equal(payload.status, 'IMPORT_REQUESTED');
  assert.equal(payload.verification_status, 'PENDING_REVIEW');
  assert.equal(payload.metadata.draftOnly, true);
});

test('Phase 1F unsafe import order status is forced safe or blocked', async () => {
  const action = buildWorkbookImportPlan(batch(), [
    row({ normalized_payload: { IMPORT_ORDER_ID: 'DIO-1', ORDER_TYPE: 'parts_import', ORIGIN_COUNTRY: 'Japan', DESTINATION_COUNTRY: 'Zimbabwe', STATUS: 'ZIMBABWE_READY' } }),
  ], reviewerContext).actions[0];
  assert.equal(action.blocked, true);
  assert.equal(action.blockedReason, 'IMPORT_ORDER_RELEASE_OR_COMPLETION_BLOCKED');
});

test('Phase 1F accepted quote row creates draft/submitted quote only', async () => {
  const client = createMockSupabaseClient({
    rows: [row({
      sheet_name: 'IMPORT_QUOTES',
      workbook_record_id: 'Q-1',
      normalized_payload: { QUOTE_ID: 'Q-1', CARUP_IMPORT_ORDER_UUID: ORDER_UUID, QUOTE_AMOUNT: 1200, QUOTE_CURRENCY: 'USD', STATUS: 'SUBMITTED' },
    })],
  });
  await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  const payload = insertedPayload(client, 'diaspora_import_quotes');
  assert.equal(payload.status, 'DRAFT');
  assert.notEqual(payload.status, 'ACCEPTED');
});

test('Phase 1F accepted quote cannot become ACCEPTED automatically', () => {
  const action = buildWorkbookImportPlan(batch(), [
    row({ sheet_name: 'IMPORT_QUOTES', normalized_payload: { QUOTE_ID: 'Q-1', STATUS: 'ACCEPTED' } }),
  ], reviewerContext).actions[0];
  assert.equal(action.blockedReason, 'QUOTE_ACCEPTANCE_CANNOT_BE_SELECTED_FROM_WORKBOOK');
});

test('Phase 1F trade document row cannot become VERIFIED', async () => {
  const safe = buildDraftPayloadForAction({
    targetTable: 'diaspora_trade_documents',
    rowId: 'doc-row',
    sheetName: 'TRADE_DOCUMENTS',
    proposedAction: 'CREATE_DRAFT',
    row: row({ sheet_name: 'TRADE_DOCUMENTS', normalized_payload: { DOCUMENT_ID: 'DOC-1', DOCUMENT_TYPE: 'passport', VERIFICATION_STATUS: 'VERIFIED' } }),
  }, batch(), reviewerContext);
  assert.equal(safe.payload.verification_status, 'UPLOADED');
});

test('Phase 1F cargo reservation cannot become APPROVED automatically', () => {
  const action = buildWorkbookImportPlan(batch(), [
    row({ sheet_name: 'CARGO_RESERVATIONS', normalized_payload: { RESERVATION_ID: 'RES-1', RESERVATION_STATUS: 'APPROVED' } }),
  ], reviewerContext).actions[0];
  assert.equal(action.blockedReason, 'CARGO_RESERVATION_APPROVAL_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1F shipment cannot become DELIVERED, RELEASED, or COMPLETED', () => {
  for (const status of ['DELIVERED', 'RELEASED', 'COMPLETED']) {
    const action = buildWorkbookImportPlan(batch(), [
      row({ sheet_name: 'SHIPMENTS', normalized_payload: { SHIPMENT_ID: `SHIP-${status}`, STATUS: status } }),
    ], reviewerContext).actions[0];
    assert.equal(action.blockedReason, 'SHIPMENT_DELIVERED_OR_RELEASED_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
  }
});

test('Phase 1F payment milestone cannot become PAID, REFUNDED, or RELEASED', () => {
  for (const status of ['PAID', 'REFUNDED', 'RELEASED']) {
    const action = buildWorkbookImportPlan(batch(), [
      row({ sheet_name: 'PAYMENT_MILESTONES', normalized_payload: { PAYMENT_MILESTONE_ID: `PM-${status}`, STATUS: status } }),
    ], reviewerContext).actions[0];
    assert.equal(action.blockedReason, 'PAYMENT_RELEASE_OR_PAID_STATUS_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
  }
});

test('Phase 1F compliance review cannot become APPROVED', () => {
  const action = buildWorkbookImportPlan(batch(), [
    row({ sheet_name: 'COMPLIANCE_REVIEWS', normalized_payload: { COMPLIANCE_REVIEW_ID: 'CR-1', STATUS: 'APPROVED' } }),
  ], reviewerContext).actions[0];
  assert.equal(action.blockedReason, 'COMPLIANCE_APPROVAL_CANNOT_BE_IMPORTED_FROM_WORKBOOK');
});

test('Phase 1F reputation record is skipped as review-only', async () => {
  const client = createMockSupabaseClient({
    rows: [row({ sheet_name: 'REPUTATION_RECORDS', normalized_payload: { REPUTATION_RECORD_ID: 'RR-1', TRADE_PROFILE_ID: ORDER_UUID, RATING: 5 } })],
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  assert.equal(result.totals.executedDrafts, 0);
  assert.equal(result.results[0].status, 'blocked');
  assert.equal(client.calls.some((call) => call.table === 'diaspora_reputation_records' && call.op === 'insert'), false);
});

test('Phase 1F AI command row creates draft command only', async () => {
  const client = createMockSupabaseClient({
    rows: [row({
      sheet_name: 'AI_COMMAND_CENTER',
      workbook_record_id: 'CMD-1',
      normalized_payload: { COMMAND_ID: 'CMD-1', RAW_COMMAND: 'Draft an order', INTENT: 'CREATE_IMPORT_ORDER', RISK_LEVEL: 'LOW', CONFIDENCE_SCORE: 0.88, APPROVAL_STATUS: 'NOT_REQUIRED', EXECUTION_STATUS: 'VALIDATED' },
    })],
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  const payload = insertedPayload(client, 'diaspora_ai_commands');
  assert.equal(result.aiExecuted, false);
  assert.equal(payload.execution_status, 'DRAFT');
  assert.equal(payload.metadata.aiExecuted, false);
});

test('Phase 1F high-risk AI command does not execute', async () => {
  const client = createMockSupabaseClient({
    rows: [row({
      sheet_name: 'AI_COMMAND_CENTER',
      workbook_record_id: 'CMD-2',
      normalized_payload: { COMMAND_ID: 'CMD-2', RAW_COMMAND: 'Release payment', INTENT: 'RELEASE_PAYMENT', RISK_LEVEL: 'HIGH', CONFIDENCE_SCORE: 0.9, APPROVAL_STATUS: 'PENDING', EXECUTION_STATUS: 'VALIDATED' },
    })],
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  assert.equal(result.aiExecuted, false);
  assert.equal(result.results[0].status, 'blocked');
  assert.equal(result.results[0].blockedReason, 'HIGH_RISK_AI_COMMAND_REQUIRES_APPROVAL');
});

test('Phase 1F stock quantity overwrite is blocked or ledger-required', () => {
  const action = buildWorkbookImportPlan(batch(), [
    row({ sheet_name: 'TRADE_PROFILES', target_table: 'diaspora_stock_items', normalized_payload: { TRADE_PROFILE_ID: 'TP-1', QUANTITY_ON_HAND: 3 } }),
  ], reviewerContext).actions[0];
  assert.equal(action.proposedAction, 'LEDGER_REQUIRED');
  assert.equal(action.blockedReason, 'STOCK_QUANTITY_OVERWRITE_REQUIRES_LEDGER_ACTION');
});

test('Phase 1F row import_result is updated after execution', async () => {
  const client = createMockSupabaseClient();
  await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  const updatedRow = client.db.diaspora_workbook_import_rows[0];
  assert.equal(updatedRow.import_result.success, true);
  assert.equal(updatedRow.import_result.liveImportExecuted, false);
  assert.equal(updatedRow.target_record_id, ORDER_UUID);
});

test('Phase 1F batch import_status is updated after execution', async () => {
  const client = createMockSupabaseClient();
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS);
  assert.equal(client.db.diaspora_workbook_import_batches[0].import_status, WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS);
});

test('Phase 1F idempotency prevents duplicate target inserts', async () => {
  const client = createMockSupabaseClient({
    rows: [row({ target_record_id: ORDER_UUID, import_result: { success: true } })],
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', reviewerContext, { supabaseClient: client });
  assert.equal(result.totals.alreadyExecuted, 1);
  assert.equal(client.calls.some((call) => call.table === 'diaspora_import_orders' && call.op === 'insert'), false);
});

test('Phase 1F owner execution skips approval-required actions', async () => {
  const client = createMockSupabaseClient();
  const result = await executeDiasporaWorkbookDraftImport('batch-exec-1', ownerContext, { supabaseClient: client });
  assert.equal(result.results[0].status, 'skipped');
  assert.equal(result.results[0].errorCode, 'APPROVAL_REQUIRED');
  assert.equal(client.calls.some((call) => call.table === 'diaspora_import_orders' && call.op === 'insert'), false);
});

test('Phase 1F service never calls AI execution functions', () => {
  assert.equal(executionServiceFile.includes('Gemini'), false);
  assert.equal(executionServiceFile.includes('askGemini'), false);
  assert.equal(executionServiceFile.includes('executeAi'), false);
  assert.equal(executionServiceFile.includes('aiExecuted: true'), false);
});

test('Phase 1F service never calls Drive OAuth or sync functions', () => {
  assert.equal(executionServiceFile.includes('saveDiasporaWorkbookToDrive'), false);
  assert.equal(executionServiceFile.includes('drive_connections'), false);
  assert.equal(executionServiceFile.includes('drive_files'), false);
  assert.equal(executionServiceFile.includes('OAuth'), false);
});

test('Phase 1F service does not write to non-allow-listed tables', async () => {
  const client = createMockSupabaseClient();
  const result = await executeWorkbookImportAction({
    rowId: 'bad-target-row',
    sheetName: 'DIASPORA_IMPORT_ORDERS',
    workbookRowNumber: 2,
    targetTable: 'vehicles',
    proposedAction: 'CREATE_DRAFT',
    requiresApproval: false,
    blocked: false,
    row: row({ target_table: 'vehicles' }),
  }, batch(), reviewerContext, { supabaseClient: client });
  assert.equal(result.status, 'skipped');
  assert.equal(result.errorCode, 'TARGET_TABLE_NOT_EXECUTABLE_IN_PHASE_1F');
  assert.equal(client.calls.some((call) => call.op === 'insert'), false);
});
