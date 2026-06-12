import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBOOK_IMPORT_STATUSES } from '../constants/diaspora/diasporaWorkbookImportStatuses.js';
import {
  getDiasporaWorkbookImportBatch,
  getWorkbookImportBatchSummary,
} from '../services/diaspora/diasporaWorkbookReviewService.js';
import {
  assertWorkbookBatchExecutable,
  executeDiasporaWorkbookDraftImport,
} from '../services/diaspora/diasporaWorkbookImportExecutionService.js';
import {
  WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES,
  buildDiasporaWorkbookDraftImportRetryPlan,
  getDiasporaWorkbookDraftImportAudit,
} from '../services/diaspora/diasporaWorkbookImportAuditService.js';
import {
  getDiasporaWorkbookOperatorBatchSummary,
  getDiasporaWorkbookOperatorDashboard,
} from '../services/diaspora/diasporaWorkbookOperatorConsoleService.js';
import { DatabaseError, NotFoundError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');
const executionServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookImportExecutionService.js', import.meta.url), 'utf8');
const auditServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookImportAuditService.js', import.meta.url), 'utf8');
const operatorServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookOperatorConsoleService.js', import.meta.url), 'utf8');

const ownerContext = {
  id: 'owner-1',
  userId: 'owner-1',
  tenantId: 'tenant-1',
  role: 'owner',
  baseRole: 'member',
  platformRole: 'member',
};

const otherUserContext = {
  id: 'other-user',
  userId: 'other-user',
  tenantId: 'tenant-2',
  role: 'owner',
  baseRole: 'member',
  platformRole: 'member',
};

const reviewerContext = {
  id: 'reviewer-1',
  userId: 'reviewer-1',
  tenantId: 'tenant-review',
  role: 'reviewer',
  baseRole: 'reviewer',
  platformRole: 'reviewer',
};

function batch(overrides = {}) {
  return {
    id: overrides.id || 'batch-hardening-1',
    tenant_id: overrides.tenant_id || 'tenant-1',
    uploaded_by: overrides.uploaded_by || 'owner-1',
    template_type: 'enterprise',
    total_rows: overrides.total_rows ?? 1,
    accepted_rows: overrides.accepted_rows ?? 1,
    rejected_rows: overrides.rejected_rows ?? 0,
    warning_count: overrides.warning_count ?? 0,
    error_count: overrides.error_count ?? 0,
    import_status: overrides.import_status || WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    metadata: overrides.metadata ?? { phase: '1I' },
    created_by: overrides.created_by || overrides.uploaded_by || 'owner-1',
    updated_by: overrides.updated_by || overrides.uploaded_by || 'owner-1',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: overrides.id || 'row-hardening-1',
    tenant_id: overrides.tenant_id || 'tenant-1',
    batch_id: overrides.batch_id || 'batch-hardening-1',
    sheet_name: overrides.sheet_name || 'DIASPORA_IMPORT_ORDERS',
    workbook_row_number: overrides.workbook_row_number || 2,
    workbook_record_id: overrides.workbook_record_id || 'DIO-HARDEN-1',
    target_table: overrides.target_table || 'diaspora_import_orders',
    target_record_id: overrides.target_record_id || null,
    action_type: overrides.action_type || 'UPSERT_DRAFT',
    validation_status: overrides.validation_status || 'ACCEPTED',
    import_result: overrides.import_result ?? {},
    normalized_payload: overrides.normalized_payload || {
      IMPORT_ORDER_ID: overrides.workbook_record_id || 'DIO-HARDEN-1',
      ORDER_TYPE: 'parts_import',
      ORIGIN_COUNTRY: 'Japan',
      DESTINATION_COUNTRY: 'Zimbabwe',
      STATUS: 'IMPORT_REQUESTED',
      BUDGET_CURRENCY: 'USD',
    },
    row_payload: {},
    validation_errors: [],
    validation_warnings: [],
    metadata: {},
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
    diaspora_stock_items: [],
    diaspora_stock_ledger: [],
    diaspora_payment_milestones: [],
    diaspora_compliance_reviews: [],
  };

  function tableRows(table) {
    if (!db[table]) db[table] = [];
    return db[table];
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
    const configuredError = overrides.errors?.[state.table]?.[state.op];
    if (configuredError) return { data: null, error: configuredError };

    let rows = tableRows(state.table);
    if (state.op === 'insert') {
      const payload = Array.isArray(state.payload) ? state.payload : [state.payload];
      const inserted = payload.map((item, index) => ({ id: item.id || `gen-${state.table}-${index}`, ...item }));
      rows.push(...inserted);
      return { data: Array.isArray(state.payload) ? inserted : inserted[0], error: null };
    }

    let matched = rows.filter((candidate) => matches(candidate, state));
    if (state.op === 'update') {
      matched.forEach((candidate) => Object.assign(candidate, state.payload));
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
        state.orFilters = String(expression || '').split(',').filter(Boolean).map((part) => {
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

function assertNoTargetWrites(client) {
  const targetWrites = client.calls.filter((call) => ['insert', 'update'].includes(call.op)
    && !['diaspora_workbook_import_batches', 'diaspora_workbook_import_rows'].includes(call.table));
  assert.deepEqual(targetWrites, []);
}

test('Phase 1I routes keep auth middleware on dashboard, audit, and execution endpoints', () => {
  assert.ok(routeFile.includes("router.get('/workbook/operator-dashboard', auth"));
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/execution-audit', auth"));
  assert.ok(routeFile.includes("router.post('/workbook/import-batches/:id/execute-drafts', auth"));
});

test('Phase 1I unauthenticated dashboard access is rejected', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookOperatorDashboard({}, {}, { supabaseClient: createMockSupabaseClient() }),
    ValidationError,
  );
});

test('Phase 1I unauthenticated audit access is rejected', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookDraftImportAudit('batch-hardening-1', {}, { supabaseClient: createMockSupabaseClient() }),
    ValidationError,
  );
});

test('Phase 1I unauthenticated execution access is rejected', async () => {
  await assert.rejects(
    () => executeDiasporaWorkbookDraftImport('batch-hardening-1', {}, { supabaseClient: createMockSupabaseClient() }),
    ValidationError,
  );
});

test('Phase 1I normal user cannot read another user batch outside tenant scope', async () => {
  const client = createMockSupabaseClient({
    batches: [batch({ uploaded_by: 'someone-else', created_by: 'someone-else', updated_by: 'someone-else', tenant_id: 'tenant-x' })],
  });
  await assert.rejects(
    () => getDiasporaWorkbookImportBatch('batch-hardening-1', ownerContext, { supabaseClient: client }),
    NotFoundError,
  );
});

test('Phase 1I tenant mismatch cannot read batch', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookImportBatch('batch-hardening-1', otherUserContext, { supabaseClient: createMockSupabaseClient() }),
    NotFoundError,
  );
});

test('Phase 1I reviewer can access batch according to existing role rules', async () => {
  const data = await getDiasporaWorkbookImportBatch('batch-hardening-1', reviewerContext, { supabaseClient: createMockSupabaseClient() });
  assert.equal(data.id, 'batch-hardening-1');
});

test('Phase 1I cancelled batch cannot execute drafts', () => {
  assert.throws(
    () => assertWorkbookBatchExecutable(batch({ import_status: WORKBOOK_IMPORT_STATUSES.CANCELLED }), { actions: [] }, reviewerContext),
    /Cancelled workbook import batches cannot execute/,
  );
});

test('Phase 1I imported batch cannot execute drafts again', () => {
  assert.throws(
    () => assertWorkbookBatchExecutable(batch({ import_status: WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS }), { actions: [] }, reviewerContext),
    /already completed/,
  );
});

test('Phase 1I held batch cannot execute drafts', () => {
  assert.throws(
    () => assertWorkbookBatchExecutable(
      batch({ metadata: { operatorHold: { active: true, reason: 'Manual review' } } }),
      { actions: [] },
      reviewerContext,
    ),
    (error) => error instanceof ValidationError && error.details?.errorCode === 'WORKBOOK_BATCH_ON_OPERATOR_HOLD',
  );
});

test('Phase 1I failed draft batch exposes retry plan but does not retry', async () => {
  const client = createMockSupabaseClient({
    batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
    rows: [row({ import_result: { success: false, status: 'failed', errorCode: 'DRAFT_IMPORT_FAILED' } })],
  });
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, { supabaseClient: client });
  assert.equal(retryPlan.canRetry, true);
  assert.equal(retryPlan.safeRetryPolicy.retryExecutionEndpointAvailable, false);
  assertNoTargetWrites(client);
});

test('Phase 1I partial draft batch exposes retry plan but does not retry', async () => {
  const client = createMockSupabaseClient({
    batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS })],
    rows: [row({ import_result: { success: false, status: 'failed', errorCode: 'DRAFT_IMPORT_FAILED' } })],
  });
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, { supabaseClient: client });
  assert.equal(retryPlan.canRetry, true);
  assertNoTargetWrites(client);
});

test('Phase 1I ready batch with rejected rows cannot execute', async () => {
  await assert.rejects(
    () => executeDiasporaWorkbookDraftImport('batch-hardening-1', reviewerContext, {
      supabaseClient: createMockSupabaseClient({
        batches: [batch({ rejected_rows: 1, error_count: 0 })],
        rows: [row({ validation_status: 'REJECTED', action_type: 'ERROR' })],
      }),
    }),
    /zero rejected rows/,
  );
});

test('Phase 1I missing metadata does not crash audit service', async () => {
  const audit = await getDiasporaWorkbookDraftImportAudit('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({ batches: [batch({ metadata: null })] }),
  });
  assert.equal(audit.executionPhase, null);
  assert.equal(audit.aiExecuted, false);
});

test('Phase 1I malformed operatorHold does not crash summary service', async () => {
  const summary = await getDiasporaWorkbookOperatorBatchSummary('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({ batches: [batch({ metadata: { operatorHold: 'bad-hold' } })] }),
  });
  assert.equal(summary.operator.held, false);
  assert.equal(summary.operator.holdReason, null);
});

test('Phase 1I malformed operatorNotes does not crash summary service', async () => {
  const summary = await getDiasporaWorkbookOperatorBatchSummary('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({ batches: [batch({ metadata: { operatorNotes: 'bad-notes' } })] }),
  });
  assert.deepEqual(summary.operator.notes, []);
});

test('Phase 1I empty import_result does not make target_record_id row retryable', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({
      batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
      rows: [row({ target_record_id: 'target-1', import_result: {} })],
    }),
  });
  assert.equal(retryPlan.canRetry, false);
  assert.ok(retryPlan.nonRetryableRows.some((entry) => entry.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK));
});

test('Phase 1I held batch returns WORKBOOK_BATCH_ON_OPERATOR_HOLD', () => {
  assert.throws(
    () => assertWorkbookBatchExecutable(batch({ metadata: { operatorHold: { active: true } } }), { actions: [] }, reviewerContext),
    (error) => {
      assert.equal(error.details?.errorCode, 'WORKBOOK_BATCH_ON_OPERATOR_HOLD');
      return true;
    },
  );
});

test('Phase 1I inaccessible batch returns safe not-found error', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookImportBatch('batch-hardening-1', otherUserContext, { supabaseClient: createMockSupabaseClient() }),
    (error) => error instanceof NotFoundError && !String(error.message).includes('tenant-1'),
  );
});

test('Phase 1I missing batch returns safe not-found error', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookImportBatch('missing-batch', ownerContext, { supabaseClient: createMockSupabaseClient({ batches: [] }) }),
    (error) => error instanceof NotFoundError && error.message === 'Diaspora workbook import batch not found.',
  );
});

test('Phase 1I Supabase mock error is not exposed raw', async () => {
  await assert.rejects(
    () => getWorkbookImportBatchSummary('batch-hardening-1', ownerContext, {
      supabaseClient: createMockSupabaseClient({
        errors: {
          diaspora_workbook_import_rows: {
            select: { message: 'SECRET_RAW_SUPABASE_ERROR', code: 'PGRST999' },
          },
        },
      }),
    }),
    (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.message.includes('SECRET_RAW_SUPABASE_ERROR'), false);
      assert.equal(error.details.errorCode, 'PGRST999');
      return true;
    },
  );
});

test('Phase 1I executed row is non-retryable', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({
      batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS })],
      rows: [row({ target_record_id: 'target-1', import_result: { success: true, status: 'executed' } })],
    }),
  });
  assert.equal(retryPlan.canRetry, false);
  assert.ok(retryPlan.nonRetryableRows.some((entry) => entry.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.EXECUTED_DRAFT));
});

test('Phase 1I duplicate-risk row is non-retryable', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({
      batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
      rows: [row({ target_record_id: 'target-1', import_result: { success: false, status: 'failed' } })],
    }),
  });
  assert.equal(retryPlan.canRetry, false);
  assert.ok(retryPlan.nonRetryableRows.some((entry) => entry.executionStatus === WORKBOOK_DRAFT_IMPORT_AUDIT_ROW_STATUSES.DUPLICATE_RISK));
});

test('Phase 1I failed safe row with no target_record_id can appear in retry plan', async () => {
  const retryPlan = await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, {
    supabaseClient: createMockSupabaseClient({
      batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
      rows: [row({ import_result: { success: false, status: 'failed', errorCode: 'DRAFT_IMPORT_FAILED' } })],
    }),
  });
  assert.equal(retryPlan.retryableRows.length, 1);
  assert.equal(retryPlan.retryableRows[0].rowId, 'row-hardening-1');
});

test('Phase 1I retry plan never executes anything', async () => {
  const client = createMockSupabaseClient({
    batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
    rows: [row({ import_result: { success: false, status: 'failed' } })],
  });
  await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, { supabaseClient: client });
  assert.equal(client.calls.some((call) => ['insert', 'update'].includes(call.op)), false);
});

test('Phase 1I no AI execution is called from workbook hardening surfaces', () => {
  for (const source of [executionServiceFile, auditServiceFile, operatorServiceFile]) {
    assert.equal(source.includes('askGemini'), false);
    assert.equal(source.includes('executeAi'), false);
    assert.equal(source.includes('GeminiClient'), false);
  }
});

test('Phase 1I no Drive or OAuth call is made from workbook hardening surfaces', () => {
  for (const source of [executionServiceFile, auditServiceFile, operatorServiceFile]) {
    assert.equal(source.includes('saveDiasporaWorkbookToDrive'), false);
    assert.equal(source.includes('OAuth'), false);
  }
});

test('Phase 1I no live import table writes occur from retry/audit/operator read paths', async () => {
  const client = createMockSupabaseClient({
    batches: [batch({ import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT })],
    rows: [row({ import_result: { success: false, status: 'failed' } })],
  });
  await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  await getDiasporaWorkbookDraftImportAudit('batch-hardening-1', ownerContext, { supabaseClient: client });
  await buildDiasporaWorkbookDraftImportRetryPlan('batch-hardening-1', ownerContext, { supabaseClient: client });
  assertNoTargetWrites(client);
});

test('Phase 1I no stock overwrite path is exposed', () => {
  assert.equal(auditServiceFile.includes('diaspora_stock_items'), false);
  assert.equal(operatorServiceFile.includes('diaspora_stock_items'), false);
  assert.equal(executionServiceFile.includes('QUANTITY_ON_HAND'), false);
});

test('Phase 1I no payment release path is exposed', () => {
  assert.equal(executionServiceFile.includes('RELEASE_PAYMENT'), false);
  assert.equal(operatorServiceFile.includes('RELEASE_PAYMENT'), true);
  assert.ok(operatorServiceFile.includes("'RELEASE_PAYMENT'"));
});

test('Phase 1I no compliance approval path is exposed', () => {
  assert.equal(executionServiceFile.includes('APPROVE_COMPLIANCE'), false);
  assert.equal(operatorServiceFile.includes('APPROVE_COMPLIANCE'), true);
  assert.ok(operatorServiceFile.includes("'APPROVE_COMPLIANCE'"));
});
