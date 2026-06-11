import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBOOK_IMPORT_STATUSES } from '../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import {
  getDiasporaWorkbookOperatorDashboard,
  getDiasporaWorkbookOperatorBatchSummary,
  getDiasporaWorkbookOperatorNextActions,
  addDiasporaWorkbookOperatorNote,
  setDiasporaWorkbookOperatorHold,
  clearDiasporaWorkbookOperatorHold,
} from '../services/diaspora/diasporaWorkbookOperatorConsoleService.js';
import {
  executeDiasporaWorkbookDraftImport,
  assertWorkbookBatchExecutable,
} from '../services/diaspora/diasporaWorkbookImportExecutionService.js';

const routeFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');

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

const otherTenantContext = {
  id: 'other-owner',
  userId: 'other-owner',
  tenantId: 'tenant-2',
  role: 'owner',
  baseRole: 'member',
  platformRole: 'member',
};

function createMockBatch(overrides = {}) {
  const uploadedBy = overrides.uploaded_by || 'owner-1';
  return {
    id: overrides.id || 'batch-1',
    tenant_id: overrides.tenant_id || 'tenant-1',
    uploaded_by: uploadedBy,
    template_type: overrides.template_type || 'enterprise',
    total_rows: overrides.total_rows !== undefined ? overrides.total_rows : 2,
    accepted_rows: overrides.accepted_rows !== undefined ? overrides.accepted_rows : 2,
    rejected_rows: overrides.rejected_rows !== undefined ? overrides.rejected_rows : 0,
    warning_count: overrides.warning_count !== undefined ? overrides.warning_count : 0,
    error_count: overrides.error_count !== undefined ? overrides.error_count : 0,
    import_status: overrides.import_status || WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    metadata: overrides.metadata || { phase: '1H' },
    created_by: overrides.created_by || uploadedBy,
    updated_by: overrides.updated_by || uploadedBy,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    deleted_at: null,
  };
}

function createMockRow(overrides = {}) {
  return {
    id: overrides.id || 'row-1',
    tenant_id: overrides.tenant_id || 'tenant-1',
    batch_id: overrides.batch_id || 'batch-1',
    sheet_name: overrides.sheet_name || 'DIASPORA_IMPORT_ORDERS',
    workbook_row_number: overrides.workbook_row_number || 2,
    workbook_record_id: overrides.workbook_record_id || 'WB-1',
    target_table: overrides.target_table || 'diaspora_import_orders',
    action_type: overrides.action_type || 'UPSERT_DRAFT',
    validation_status: overrides.validation_status || 'ACCEPTED',
    validation_errors: overrides.validation_errors || [],
    validation_warnings: overrides.validation_warnings || [],
    import_result: overrides.import_result || {},
    created_by: overrides.created_by || 'owner-1',
    updated_by: overrides.updated_by || 'owner-1',
    deleted_at: null,
    ...overrides,
  };
}

function createMockSupabaseClient(batches = [], rows = []) {
  const calls = [];
  const db = {
    diaspora_workbook_import_batches: [...batches],
    diaspora_workbook_import_rows: [...rows],
    diaspora_import_orders: [],
  };

  function resolve(state) {
    calls.push({ table: state.table, op: state.op, payload: state.payload, filters: state.filters });
    let tableRows = db[state.table] || [];

    if (state.op === 'insert') {
      const payload = Array.isArray(state.payload) ? state.payload : [state.payload];
      const inserted = payload.map((item) => ({ id: item.id || `gen-${Math.random()}`, ...item }));
      tableRows.push(...inserted);
      return { data: Array.isArray(state.payload) ? inserted : inserted[0], error: null };
    }

    let matched = tableRows.filter((candidate) => {
      // Basic eq filter
      const eqMatch = state.filters.every(({ column, value }) => candidate[column] === value);
      const isMatch = state.nullFilters.every(({ column, value }) => {
        if (value === null) return candidate[column] === null || candidate[column] === undefined;
        return candidate[column] === value;
      });
      const orMatch = state.orFilters.length === 0 || state.orFilters.some(({ column, operator, value }) => {
        if (operator === 'eq') return candidate[column] === value;
        return false;
      });
      return eqMatch && isMatch && orMatch;
    });

    if (state.op === 'update') {
      matched.forEach((candidate) => {
        Object.assign(candidate, state.payload);
      });
    }

    if (state.range) {
      matched = matched.slice(state.range.from, state.range.to + 1);
    }

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

// 1. operator-dashboard route exists
test('operator-dashboard route exists', () => {
  assert.ok(routeFile.includes("router.get('/workbook/operator-dashboard'"));
});

// 2. operator-summary route exists
test('operator-summary route exists', () => {
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/operator-summary'"));
});

// 3. next-actions route exists
test('next-actions route exists', () => {
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/next-actions'"));
});

// 4. operator-notes route exists
test('operator-notes route exists', () => {
  assert.ok(routeFile.includes("router.post('/workbook/import-batches/:id/operator-notes'"));
});

// 5. operator-hold route exists
test('operator-hold route exists', () => {
  assert.ok(routeFile.includes("router.post('/workbook/import-batches/:id/operator-hold'"));
});

// 6. clear operator-hold route exists
test('clear operator-hold route exists', () => {
  assert.ok(routeFile.includes("router.delete('/workbook/import-batches/:id/operator-hold'"));
});

// 7. unauthenticated access is rejected
test('unauthenticated access is rejected', async () => {
  await assert.rejects(
    () => getDiasporaWorkbookOperatorDashboard({}, {}),
    /authenticated user context/
  );
  await assert.rejects(
    () => getDiasporaWorkbookOperatorBatchSummary('batch-1', {}),
    /authenticated user context/
  );
  await assert.rejects(
    () => getDiasporaWorkbookOperatorNextActions('batch-1', {}),
    /authenticated user context/
  );
  await assert.rejects(
    () => addDiasporaWorkbookOperatorNote('batch-1', { note: 'Hi' }, {}),
    /authenticated user context/
  );
  await assert.rejects(
    () => setDiasporaWorkbookOperatorHold('batch-1', { reason: 'Hold' }, {}),
    /authenticated user context/
  );
  await assert.rejects(
    () => clearDiasporaWorkbookOperatorHold('batch-1', {}),
    /authenticated user context/
  );
});

// 8. inaccessible batch is rejected
test('inaccessible batch is rejected', async () => {
  const batch1 = createMockBatch({ id: 'batch-other-tenant', tenant_id: 'tenant-2', uploaded_by: 'other' });
  const client = createMockSupabaseClient([batch1]);
  await assert.rejects(
    () => getDiasporaWorkbookOperatorBatchSummary('batch-other-tenant', ownerContext, { supabaseClient: client }),
    NotFoundError
  );
});

// 9. dashboard returns only accessible batches for normal user
test('dashboard returns only accessible batches for normal user', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const b2 = createMockBatch({ id: 'b2', tenant_id: 'tenant-2', uploaded_by: 'other' });
  const client = createMockSupabaseClient([b1, b2]);

  const dashboard = await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  assert.equal(dashboard.items.length, 1);
  assert.equal(dashboard.items[0].batchId, 'b1');
});

// 10. reviewer/admin dashboard can see scoped/global batches according to existing role conventions
test('reviewer/admin dashboard can see scoped/global batches', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const b2 = createMockBatch({ id: 'b2', tenant_id: 'tenant-2', uploaded_by: 'other' });
  const client = createMockSupabaseClient([b1, b2]);

  const dashboard = await getDiasporaWorkbookOperatorDashboard({}, reviewerContext, { supabaseClient: client });
  assert.equal(dashboard.items.length, 2);
});

// 11. dashboard item includes row counts and status badges
test('dashboard item includes row counts and status badges', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1', total_rows: 5, accepted_rows: 4, warning_count: 1, rejected_rows: 1, error_count: 1 });
  const row1 = createMockRow({ batch_id: 'b1', validation_status: 'ACCEPTED' });
  const client = createMockSupabaseClient([b1], [row1]);

  const dashboard = await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  const item = dashboard.items[0];
  assert.equal(item.totalRows, 5);
  assert.equal(item.acceptedRows, 4);
  assert.equal(item.warningRows, 1);
  assert.equal(item.rejectedRows, 1);
  assert.equal(item.errorCount, 1);
  assert.ok(item.summaryBadges.includes('HAS_REJECTED_ROWS'));
  assert.ok(item.summaryBadges.includes('HAS_WARNINGS'));
});

// 12. dashboard item flags failed draft imports
test('dashboard item flags failed draft imports', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1', import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT });
  const client = createMockSupabaseClient([b1]);

  const dashboard = await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  const item = dashboard.items[0];
  assert.ok(item.summaryBadges.includes('HAS_FAILED_DRAFT_ROWS'));
});

// 13. dashboard item flags retry-review-needed without executing retry
test('dashboard item flags retry-review-needed without executing retry', async () => {
  const b1 = createMockBatch({
    id: 'b1',
    tenant_id: 'tenant-1',
    import_status: WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT,
    metadata: { draftImportExecuted: true }
  });
  // Failed row result with no target_record_id, making it retryable
  const row1 = createMockRow({
    id: 'row-1',
    batch_id: 'b1',
    target_record_id: null,
    import_result: { success: false, status: 'failed', errorCode: 'SOME_ERR' }
  });
  const client = createMockSupabaseClient([b1], [row1]);

  const dashboard = await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  const item = dashboard.items[0];
  assert.ok(item.hasRetryableRows);
  assert.ok(item.summaryBadges.includes('RETRY_REVIEW_NEEDED'));
  // Ensure retry is not actually executed
  assert.equal(client.calls.some(c => c.op === 'insert' && c.table === 'diaspora_import_orders'), false);
});

// 14. operator-summary combines batch, plan, audit, retry plan, and next actions
test('operator-summary combines batch, plan, audit, retry plan, and next actions', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const row1 = createMockRow({ batch_id: 'b1' });
  const client = createMockSupabaseClient([b1], [row1]);

  const summary = await getDiasporaWorkbookOperatorBatchSummary('b1', ownerContext, { supabaseClient: client });
  assert.ok(summary.batch);
  assert.ok(summary.plan);
  assert.ok(summary.operator);
  assert.ok(Array.isArray(summary.operator.nextActions));
  assert.ok(Array.isArray(summary.operator.forbiddenActions));
});

// 15. next-actions allows MARK_READY_FOR_REVIEW for VALIDATED zero-error batch
test('next-actions allows MARK_READY_FOR_REVIEW for VALIDATED zero-error batch', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1', import_status: WORKBOOK_IMPORT_STATUSES.VALIDATED });
  const row1 = createMockRow({ batch_id: 'b1' });
  const client = createMockSupabaseClient([b1], [row1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.ok(res.allowed.includes('MARK_READY_FOR_REVIEW'));
});

// 16. next-actions allows EXECUTE_DRAFTS only for READY_FOR_REVIEW zero-error unheld batch
test('next-actions allows EXECUTE_DRAFTS for READY_FOR_REVIEW zero-error unheld batch', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1', import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW });
  const row1 = createMockRow({ batch_id: 'b1' });
  const client = createMockSupabaseClient([b1], [row1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.ok(res.allowed.includes('EXECUTE_DRAFTS'));
});

// 17. next-actions forbids EXECUTE_DRAFTS for held batch
test('next-actions forbids EXECUTE_DRAFTS for held batch', async () => {
  const b1 = createMockBatch({
    id: 'b1',
    tenant_id: 'tenant-1',
    import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    metadata: { operatorHold: { active: true, reason: 'Testing hold' } }
  });
  const row1 = createMockRow({ batch_id: 'b1' });
  const client = createMockSupabaseClient([b1], [row1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.equal(res.allowed.includes('EXECUTE_DRAFTS'), false);
  assert.ok(res.warnings.some(w => w.includes('operator hold')));
});

// 18. next-actions forbids EXECUTE_LIVE_IMPORT always
test('next-actions forbids EXECUTE_LIVE_IMPORT always', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.ok(res.forbidden.includes('EXECUTE_LIVE_IMPORT'));
});

// 19. next-actions forbids EXECUTE_AI always
test('next-actions forbids EXECUTE_AI always', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.ok(res.forbidden.includes('EXECUTE_AI'));
});

// 20. next-actions forbids RETRY_DRAFT_IMPORT execution in Phase 1H
test('next-actions forbids RETRY_DRAFT_IMPORT execution in Phase 1H', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  const res = await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });
  assert.ok(res.forbidden.includes('RETRY_DRAFT_IMPORT'));
});

// 21. adding operator note writes only batch metadata
test('adding operator note writes only batch metadata', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  const res = await addDiasporaWorkbookOperatorNote('b1', { note: 'Important operator note' }, ownerContext, { supabaseClient: client });
  assert.ok(res.note.id);
  assert.equal(res.note.note, 'Important operator note');
  
  const updateCall = client.calls.find(c => c.op === 'update');
  assert.ok(updateCall);
  assert.equal(updateCall.table, 'diaspora_workbook_import_batches');
  assert.ok(updateCall.payload.metadata.operatorNotes);
  assert.equal(updateCall.payload.metadata.operatorNotes[0].note, 'Important operator note');
});

// 22. operator note rejects empty note
test('operator note rejects empty note', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  await assert.rejects(
    () => addDiasporaWorkbookOperatorNote('b1', { note: '' }, ownerContext, { supabaseClient: client }),
    ValidationError
  );
  await assert.rejects(
    () => addDiasporaWorkbookOperatorNote('b1', { note: '   ' }, ownerContext, { supabaseClient: client }),
    ValidationError
  );
});

// 23. operator note rejects too-long note
test('operator note rejects too-long note', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  const longNote = 'a'.repeat(2001);
  await assert.rejects(
    () => addDiasporaWorkbookOperatorNote('b1', { note: longNote }, ownerContext, { supabaseClient: client }),
    /must not exceed 2000 characters/
  );
});

// 24. operator hold writes only batch metadata
test('operator hold writes only batch metadata', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  await setDiasporaWorkbookOperatorHold('b1', { reason: 'Pending compliance verification' }, ownerContext, { supabaseClient: client });

  const updateCall = client.calls.find(c => c.op === 'update');
  assert.ok(updateCall);
  assert.equal(updateCall.table, 'diaspora_workbook_import_batches');
  assert.equal(updateCall.payload.metadata.operatorHold.active, true);
  assert.equal(updateCall.payload.metadata.operatorHold.reason, 'Pending compliance verification');
});

// 25. clear operator hold updates metadata only
test('clear operator hold updates metadata only', async () => {
  const b1 = createMockBatch({
    id: 'b1',
    tenant_id: 'tenant-1',
    metadata: { operatorHold: { active: true, reason: 'Test' } }
  });
  const client = createMockSupabaseClient([b1]);

  await clearDiasporaWorkbookOperatorHold('b1', ownerContext, { supabaseClient: client });

  const updateCall = client.calls.find(c => c.op === 'update');
  assert.ok(updateCall);
  assert.equal(updateCall.table, 'diaspora_workbook_import_batches');
  assert.equal(updateCall.payload.metadata.operatorHold.active, false);
  assert.ok(updateCall.payload.metadata.operatorHold.clearedAt);
});

// 26. execute-drafts refuses held batch
test('execute-drafts refuses held batch', async () => {
  const b1 = createMockBatch({
    id: 'b1',
    tenant_id: 'tenant-1',
    import_status: WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
    metadata: { operatorHold: { active: true, reason: 'Under review' } }
  });
  const row1 = createMockRow({ batch_id: 'b1' });
  const client = createMockSupabaseClient([b1], [row1]);

  await assert.rejects(
    () => executeDiasporaWorkbookDraftImport('b1', reviewerContext, { supabaseClient: client }),
    /WORKBOOK_BATCH_ON_OPERATOR_HOLD/
  );
});

// 27. audit/read endpoints still remain read-only
test('audit/read endpoints still remain read-only', () => {
  // Check the audit endpoints in routes only perform selects/GETs
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/execution-audit'"));
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/execution-rows'"));
  assert.ok(routeFile.includes("router.get('/workbook/import-batches/:id/failed-execution-rows'"));
});

// 28. no target trade-table writes occur from operator console service
test('no target trade-table writes occur from operator console service', async () => {
  const b1 = createMockBatch({ id: 'b1', tenant_id: 'tenant-1' });
  const client = createMockSupabaseClient([b1]);

  await getDiasporaWorkbookOperatorDashboard({}, ownerContext, { supabaseClient: client });
  await getDiasporaWorkbookOperatorBatchSummary('b1', ownerContext, { supabaseClient: client });
  await getDiasporaWorkbookOperatorNextActions('b1', ownerContext, { supabaseClient: client });

  const writeCalls = client.calls.filter(c => c.op === 'insert' || (c.op === 'update' && c.table !== 'diaspora_workbook_import_batches'));
  assert.equal(writeCalls.length, 0);
});

// 29. no AI execution calls are inside the service file
test('no AI execution calls are inside the operator console service file', () => {
  const serviceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookOperatorConsoleService.js', import.meta.url), 'utf8');
  assert.equal(serviceFile.includes('Gemini'), false);
  assert.equal(serviceFile.includes('askGemini'), false);
  assert.equal(serviceFile.includes('executeAi'), false);
});

// 30. no Drive/OAuth calls are inside the service file
test('no Drive/OAuth calls are inside the operator console service file', () => {
  const serviceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookOperatorConsoleService.js', import.meta.url), 'utf8');
  assert.equal(serviceFile.includes('saveDiasporaWorkbookToDrive'), false);
  assert.equal(serviceFile.includes('OAuth'), false);
});
