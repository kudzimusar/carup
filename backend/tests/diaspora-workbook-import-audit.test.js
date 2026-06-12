import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBOOK_IMPORT_STATUSES } from '../constants/diaspora/diasporaWorkbookImportStatuses.js';
import {
  WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES,
  buildDiasporaWorkbookDraftImportRetryPlan,
  classifyDiasporaWorkbookDraftImportRow,
  getDiasporaWorkbookDraftImportAudit,
  listDiasporaWorkbookDraftImportExecutionRows,
  listDiasporaWorkbookDraftImportFailedRows,
  validateDiasporaWorkbookDraftImportConsistency,
} from '../services/diaspora/diasporaWorkbookImportAuditService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');
const auditServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookImportAuditService.js', import.meta.url), 'utf8');

const reviewerContext = {
  id: 'reviewer-1',
  userId: 'reviewer-1',
  tenantId: 'tenant-1',
  role: 'reviewer',
  baseRole: 'reviewer',
  platformRole: 'reviewer',
};

const ownerContext = {
  id: 'owner-1',
  userId: 'owner-1',
  tenantId: 'tenant-1',
  role: 'owner',
  baseRole: 'member',
  platformRole: 'member',
};

function batch(overrides = {}) {
  return {
    id: 'batch-audit-1',
    tenant_id: 'tenant-1',
    uploaded_by: 'owner-1',
    template_type: 'enterprise',
    total_rows: 8,
    accepted_rows: 7,
    rejected_rows: 1,
    warning_count: 0,
    error_count: 1,
    import_status: WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS,
    rollback_status: 'NOT_REQUIRED',
    metadata: {
      phase: '1F',
      draftImportExecuted: true,
      liveImportExecuted: false,
      aiExecuted: false,
    },
    created_by: 'owner-1',
    updated_by: 'owner-1',
    deleted_at: null,
    ...overrides,
  };
}

function row(overrides = {}) {
  const sheetName = overrides.sheet_name || 'DIASPORA_IMPORT_ORDERS';
  return {
    id: overrides.id || `${sheetName}-row`,
    tenant_id: 'tenant-1',
    batch_id: overrides.batch_id || 'batch-audit-1',
    sheet_name: sheetName,
    workbook_row_number: overrides.workbook_row_number || 2,
    workbook_record_id: overrides.workbook_record_id || 'WB-1',
    target_table: overrides.target_table || {
      DIASPORA_IMPORT_ORDERS: 'diaspora_import_orders',
      IMPORT_QUOTES: 'diaspora_import_quotes',
      TRADE_DOCUMENTS: 'diaspora_trade_documents',
      COMPLIANCE_REVIEWS: 'diaspora_compliance_reviews',
      PAYMENT_MILESTONES: 'diaspora_payment_milestones',
      REPUTATION_RECORDS: 'diaspora_reputation_records',
      AI_COMMAND_CENTER: 'diaspora_ai_commands',
    }[sheetName],
    target_record_id: overrides.target_record_id || null,
    action_type: overrides.action_type || 'UPSERT_DRAFT',
    validation_status: overrides.validation_status || 'ACCEPTED',
    import_result: overrides.import_result || {},
    normalized_payload: overrides.normalized_payload || {
      IMPORT_ORDER_ID: overrides.workbook_record_id || 'DIO-1',
      ORDER_TYPE: 'parts_import',
      ORIGIN_COUNTRY: 'Japan',
      DESTINATION_COUNTRY: 'Zimbabwe',
      STATUS: 'IMPORT_REQUESTED',
      BUDGET_CURRENCY: 'USD',
    },
    row_payload: overrides.normalized_payload || {},
    validation_errors: overrides.validation_errors || [],
    validation_warnings: overrides.validation_warnings || [],
    metadata: {},
    deleted_at: null,
    ...overrides,
  };
}

function fixtureRows() {
  return [
    row({
      id: 'executed-row',
      workbook_record_id: 'DIO-EXECUTED',
      target_record_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      import_result: { success: true, status: 'executed', message: 'created' },
    }),
    row({
      id: 'duplicate-risk-row',
      workbook_record_id: 'DIO-DUP',
      target_record_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      import_result: { success: false, status: 'failed', errorCode: 'DB_ERROR' },
    }),
    row({
      id: 'failed-row',
      workbook_record_id: 'DIO-FAILED',
      import_result: { success: false, status: 'failed', errorCode: 'DRAFT_IMPORT_FAILED', message: 'insert failed' },
    }),
    row({
      id: 'skipped-row',
      workbook_record_id: 'DIO-SKIPPED',
      import_result: { success: false, status: 'skipped', errorCode: 'APPROVAL_REQUIRED', message: 'approval needed' },
    }),
    row({
      id: 'blocked-row',
      sheet_name: 'COMPLIANCE_REVIEWS',
      workbook_record_id: 'CR-1',
      normalized_payload: { COMPLIANCE_REVIEW_ID: 'CR-1', IMPORT_ORDER_ID: 'DIO-1', REVIEW_TYPE: 'customs', STATUS: 'APPROVED' },
    }),
    row({
      id: 'not-plannable-row',
      workbook_record_id: 'DIO-REJECTED',
      validation_status: 'REJECTED',
      action_type: 'ERROR',
      import_result: {},
    }),
    row({
      id: 'pending-row',
      workbook_record_id: 'DIO-PENDING',
      import_result: {},
    }),
    row({
      id: 'already-row',
      workbook_record_id: 'DIO-ALREADY',
      target_record_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      import_result: { success: true, status: 'alreadyExecuted', message: 'already done' },
    }),
  ];
}

function createMockSupabaseClient(overrides = {}) {
  const calls = [];
  const db = {
    diaspora_workbook_import_batches: overrides.batches || [batch()],
    diaspora_workbook_import_rows: overrides.rows || fixtureRows(),
  };

  function tableRows(table) {
    return db[table] || [];
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
    calls.push({ table: state.table, op: state.op, filters: state.filters, payload: state.payload });
    let rows = tableRows(state.table).filter((candidate) => matches(candidate, state));
    if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
    if (state.single) {
      const first = rows[0] || null;
      return first ? { data: first, error: null } : { data: null, error: { message: 'not found' } };
    }
    return { data: rows, error: null };
  }

  function makeBuilder(table) {
    const state = { table, op: 'select', filters: [], nullFilters: [], orFilters: [], range: null, single: false, payload: null };
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
    from(table) {
      return makeBuilder(table);
    },
  };
}

test('Phase 1G audit routes exist', () => {
  assert.equal(routeFile.includes("router.get('/workbook/import-batches/:id/execution-audit'"), true);
  assert.equal(routeFile.includes("router.get('/workbook/import-batches/:id/execution-rows'"), true);
  assert.equal(routeFile.includes("router.get('/workbook/import-batches/:id/failed-execution-rows'"), true);
  assert.equal(routeFile.includes("router.get('/workbook/import-batches/:id/retry-plan'"), true);
});

test('Phase 1G audit service rejects unauthenticated access', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookDraftImportAudit('batch-audit-1', {}, { supabaseClient: createMockSupabaseClient() }),
    ValidationError,
  );
});

test('Phase 1G audit service rejects inaccessible batch', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookDraftImportAudit('batch-audit-1', { id: 'stranger', tenantId: 'tenant-x' }, { supabaseClient: createMockSupabaseClient() }),
    NotFoundError,
  );
});

test('Phase 1G audit service loads batch and rows using review access rules', async () => {
  const client = createMockSupabaseClient();
  const audit = await getDiasporaWorkbookDraftImportAudit('batch-audit-1', ownerContext, { supabaseClient: client });

  assert.equal(audit.batchId, 'batch-audit-1');
  assert.deepEqual(
    [...new Set(client.calls.map((call) => call.table))].sort(),
    ['diaspora_workbook_import_batches', 'diaspora_workbook_import_rows'],
  );
  assert.equal(client.calls.some((call) => call.op !== 'select'), false);
});

test('Phase 1G row status classification covers execution states', () => {
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ target_record_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', import_result: { success: true, status: 'executed' } }), {}), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.EXECUTED_DRAFT);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ target_record_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', import_result: {} }), {}), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ import_result: { status: 'failed' } }), {}), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ import_result: { status: 'skipped' } }), {}), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.SKIPPED);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ validation_status: 'REJECTED', action_type: 'ERROR' }), {}), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.NOT_PLANNABLE);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ import_result: {} }), { blocked: true }), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.BLOCKED);
  assert.equal(classifyDiasporaWorkbookDraftImportRow(row({ import_result: {} }), { blocked: false }), WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.PENDING);
});

test('Phase 1G audit output includes required row groups and rollback visibility', async () => {
  const audit = await getDiasporaWorkbookDraftImportAudit('batch-audit-1', ownerContext, { supabaseClient: createMockSupabaseClient() });

  assert.equal(audit.rollbackAvailable, false);
  assert.equal(audit.rollbackReason, 'ROLLBACK_ENGINE_NOT_IMPLEMENTED_PHASE_1G');
  assert.ok(audit.createdTargetRecords.length >= 1);
  assert.ok(audit.failedRows.some((row) => row.rowId === 'failed-row'));
  assert.ok(audit.skippedRows.some((row) => row.rowId === 'skipped-row'));
  assert.ok(audit.blockedRows.some((row) => row.rowId === 'blocked-row'));
  assert.ok(audit.consistency.warnings.some((warning) => warning.code === 'DUPLICATE_EXECUTION_RISK'));
  assert.equal(audit.totals.duplicateRiskRows, 1);
});

test('Phase 1G execution rows support filters and pagination', async () => {
  const result = await listDiasporaWorkbookDraftImportExecutionRows(
    'batch-audit-1',
    { executionStatus: 'FAILED', limit: 1, offset: 0 },
    ownerContext,
    { supabaseClient: createMockSupabaseClient() },
  );

  assert.equal(result.pagination.count, 1);
  assert.equal(result.data[0].executionStatus, WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.FAILED);
});

test('Phase 1G failed rows endpoint returns failed rows only', async () => {
  const result = await listDiasporaWorkbookDraftImportFailedRows(
    'batch-audit-1',
    {},
    ownerContext,
    { supabaseClient: createMockSupabaseClient() },
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].rowId, 'failed-row');
});

test('Phase 1G retry plan allows only safe failed or pending draft rows without target records', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan(
    'batch-audit-1',
    ownerContext,
    { supabaseClient: createMockSupabaseClient() },
  );

  assert.equal(retryPlan.canRetry, true);
  assert.ok(retryPlan.retryableRows.some((row) => row.rowId === 'failed-row'));
  assert.ok(retryPlan.retryableRows.some((row) => row.rowId === 'pending-row'));
  assert.ok(retryPlan.nonRetryableRows.some((row) => row.rowId === 'executed-row'));
  assert.ok(retryPlan.nonRetryableRows.some((row) => row.rowId === 'blocked-row'));
  assert.ok(retryPlan.nonRetryableRows.some((row) => row.rowId === 'duplicate-risk-row'));
});

test('Phase 1G retry plan blocks non-retryable batch statuses', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan(
    'batch-audit-1',
    ownerContext,
    { supabaseClient: createMockSupabaseClient({ batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS })] }) },
  );

  assert.equal(retryPlan.canRetry, false);
  assert.equal(retryPlan.reason, 'BATCH_STATUS_NOT_RETRYABLE');
});

test('Phase 1G consistency validator reports duplicate target record warnings', () => {
  const rows = [
    row({ id: 'row-a', target_record_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', import_result: { success: true, status: 'executed' } }),
    row({ id: 'row-b', target_record_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', import_result: { success: true, status: 'executed' } }),
  ];
  const consistency = validateDiasporaWorkbookDraftImportConsistency(batch(), rows, { actions: [] });
  assert.equal(consistency.valid, true);
  assert.ok(consistency.warnings.some((warning) => warning.code === 'TARGET_RECORD_REFERENCED_BY_MULTIPLE_ROWS'));
});

test('Phase 1G audit service remains read-only and does not execute imports, AI, or Drive/OAuth', () => {
  assert.equal(auditServiceFile.includes('.insert('), false);
  assert.equal(auditServiceFile.includes('.update('), false);
  assert.equal(auditServiceFile.includes('executeDiasporaWorkbookDraftImport'), false);
  assert.equal(auditServiceFile.includes('executeWorkbookImportAction'), false);
  assert.equal(auditServiceFile.includes('Gemini'), false);
  assert.equal(auditServiceFile.includes('askGemini'), false);
  assert.equal(auditServiceFile.includes('Drive'), false);
  assert.equal(auditServiceFile.includes('OAuth'), false);
});
