import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKBOOK_IMPORT_STATUSES } from '../constants/diaspora/diasporaWorkbookImportStatuses.js';
import { executeDiasporaWorkbookDraftImport } from '../services/diaspora/diasporaWorkbookImportExecutionService.js';

/**
 * Workstream 5a — atomic (all-or-nothing) workbook DRAFT execution.
 *
 * Mirrors the in-memory mock supabase harness used by
 * diaspora-workbook-import-execution.test.js, extended with:
 *   - unique ids per insert (so multiple import-order rows get distinct target ids), and
 *   - fault-injection hooks (fail the Nth insert, or fail a compensation soft-delete),
 * so we can prove the compensating rollback undoes every draft created in a failed run.
 */

const reviewerContext = {
  id: 'reviewer-1',
  userId: 'reviewer-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: 'reviewer',
  baseRole: 'reviewer',
  platformRole: 'reviewer',
};

function batch(overrides = {}) {
  return {
    id: overrides.id || 'batch-atomic-1',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    uploaded_by: 'owner-1',
    template_type: 'enterprise',
    total_rows: 3,
    accepted_rows: 3,
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

function orderRow(index) {
  return {
    id: `DIASPORA_IMPORT_ORDERS-row-${index}`,
    tenant_id: '11111111-1111-4111-8111-111111111111',
    batch_id: 'batch-atomic-1',
    sheet_name: 'DIASPORA_IMPORT_ORDERS',
    workbook_row_number: index + 1,
    workbook_record_id: `WB-${index}`,
    target_table: 'diaspora_import_orders',
    target_record_id: null,
    action_type: 'UPSERT_DRAFT',
    row_payload: {},
    normalized_payload: {
      IMPORT_ORDER_ID: `DIO-${index}`,
      ORDER_TYPE: 'parts_import',
      ORIGIN_COUNTRY: 'Japan',
      DESTINATION_COUNTRY: 'Zimbabwe',
      STATUS: 'IMPORT_REQUESTED',
      BUDGET_CURRENCY: 'USD',
    },
    validation_status: 'ACCEPTED',
    validation_errors: [],
    validation_warnings: [],
    import_result: {},
    metadata: {},
    created_by: 'owner-1',
    updated_by: 'owner-1',
    deleted_at: null,
  };
}

// faults: {
//   failInsert: (table, attemptNumber) => boolean,
//   failCompensation: (table, payload) => boolean,   // update carrying deleted_at on a target table
// }
function createMockSupabaseClient({ rows, faults = {} } = {}) {
  const calls = [];
  const db = {
    diaspora_workbook_import_batches: [batch()],
    diaspora_workbook_import_rows: rows || [orderRow(1), orderRow(2), orderRow(3)],
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
    const short = String(insertCounters[table]).padStart(4, '0');
    // Distinct, valid-shaped uuid per insert so compensation can target rows individually.
    return `00000000-0000-4000-8000-0000000${short}`;
  }

  function matches(candidate, state) {
    const eqMatch = state.filters.every(({ column, value }) => candidate[column] === value);
    const nullMatch = state.nullFilters.every(({ column, value }) => (
      value === null ? candidate[column] === null || candidate[column] === undefined : candidate[column] === value
    ));
    return eqMatch && nullMatch;
  }

  function resolve(state) {
    calls.push({ table: state.table, op: state.op, payload: state.payload, filters: state.filters });
    const rows = tableRows(state.table);

    if (state.op === 'insert') {
      const attempt = (insertCounters[`${state.table}:attempts`] = (insertCounters[`${state.table}:attempts`] || 0) + 1);
      if (typeof faults.failInsert === 'function' && faults.failInsert(state.table, attempt)) {
        return { data: null, error: { message: 'injected insert failure', code: 'INJECTED_INSERT_FAILURE' } };
      }
      const payload = Array.isArray(state.payload) ? state.payload : [state.payload];
      const inserted = payload.map((item) => ({ id: item.id || makeId(state.table), ...item }));
      rows.push(...inserted);
      return { data: Array.isArray(state.payload) ? inserted : inserted[0], error: null };
    }

    if (state.op === 'update') {
      const carriesDeletedAt = state.payload && Object.prototype.hasOwnProperty.call(state.payload, 'deleted_at') && state.payload.deleted_at;
      if (carriesDeletedAt && typeof faults.failCompensation === 'function' && faults.failCompensation(state.table, state.payload)) {
        return { data: null, error: { message: 'injected compensation failure', code: 'INJECTED_COMPENSATION_FAILURE' } };
      }
      let matched = rows.filter((candidate) => matches(candidate, state));
      matched = matched.map((candidate) => {
        Object.assign(candidate, state.payload);
        return candidate;
      });
      if (state.single) {
        const first = matched[0] || null;
        return first ? { data: first, error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: matched, error: null };
    }

    if (state.op === 'delete') {
      const survivors = rows.filter((candidate) => !matches(candidate, state));
      const removed = rows.length - survivors.length;
      db[state.table] = survivors;
      return { data: { removed }, error: null };
    }

    let matched = rows.filter((candidate) => matches(candidate, state));
    if (state.range) matched = matched.slice(state.range.from, state.range.to + 1);
    if (state.single) {
      const first = matched[0] || null;
      return first ? { data: first, error: null } : { data: null, error: { message: 'not found' } };
    }
    return { data: matched, error: null };
  }

  function makeBuilder(table) {
    const state = { table, op: 'select', payload: null, filters: [], nullFilters: [], range: null, single: false };
    const chain = {
      select() { return chain; },
      eq(column, value) { state.filters.push({ column, value }); return chain; },
      is(column, value) { state.nullFilters.push({ column, value }); return chain; },
      or() { return chain; },
      order() { return chain; },
      range(from, to) { state.range = { from, to }; return chain; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
      update(payload) { state.op = 'update'; state.payload = payload; return chain; },
      delete() { state.op = 'delete'; return chain; },
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
    from(table) { return makeBuilder(table); },
  };
}

function activeRows(client, table) {
  return client.db[table].filter((r) => r.deleted_at === null || r.deleted_at === undefined);
}

test('atomic happy path: all draft rows applied and batch completes', async () => {
  const client = createMockSupabaseClient();
  const result = await executeDiasporaWorkbookDraftImport('batch-atomic-1', reviewerContext, { supabaseClient: client });

  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.IMPORTED_DRAFTS);
  assert.equal(result.atomic, true);
  assert.equal(result.rollbackPerformed, false);
  assert.equal(result.totals.executedDrafts, 3);
  // All three drafts present and none soft-deleted.
  assert.equal(activeRows(client, 'diaspora_import_orders').length, 3);
});

test('atomic mid-plan failure compensates every earlier draft and marks the batch FAILED', async () => {
  const client = createMockSupabaseClient({
    // Fail the 3rd insert into the target table (the Nth action).
    faults: { failInsert: (table, attempt) => table === 'diaspora_import_orders' && attempt === 3 },
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-atomic-1', reviewerContext, { supabaseClient: client });

  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT);
  assert.equal(result.rollbackPerformed, true);
  assert.equal(result.canRollback, true);
  // No draft executed survives — the two created before the failure were compensated.
  assert.equal(result.totals.executedDrafts, 0);
  assert.equal(result.totals.rolledBackDrafts, 2);
  assert.equal(result.totals.netAppliedRecords, 0);
  assert.deepEqual(result.compensationErrors, []);
  // The end state: NO partial draft rows survive.
  assert.equal(activeRows(client, 'diaspora_import_orders').length, 0);
  // Every created draft row was soft-deleted, not hard-deleted (all targets have deleted_at).
  assert.equal(client.db.diaspora_import_orders.length, 2);
  assert.equal(client.db.diaspora_import_orders.every((r) => r.deleted_at), true);

  // The failing action is reported failed; the earlier two are reported rolled back.
  const statuses = result.results.map((r) => r.status).sort();
  assert.deepEqual(statuses, ['failed', 'rolledBack', 'rolledBack']);

  // Workbook rows for compensated drafts no longer point at a surviving target record.
  const compensatedRows = client.db.diaspora_workbook_import_rows.filter((r) => r.import_result?.status === 'rolledBack');
  assert.equal(compensatedRows.length, 2);
  assert.equal(compensatedRows.every((r) => r.target_record_id === null), true);
  assert.equal(compensatedRows.every((r) => r.import_result.rolledBack === true && r.import_result.success === false), true);
});

test('atomic compensation-error path: batch still FAILED and compensationErrors is populated (no throw)', async () => {
  const client = createMockSupabaseClient({
    faults: {
      failInsert: (table, attempt) => table === 'diaspora_import_orders' && attempt === 3,
      // Compensation soft-delete of the target table fails too.
      failCompensation: (table) => table === 'diaspora_import_orders',
    },
  });

  // Must NOT throw — compensation failures are captured, not propagated.
  const result = await executeDiasporaWorkbookDraftImport('batch-atomic-1', reviewerContext, { supabaseClient: client });

  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.FAILED_DRAFT_IMPORT);
  assert.equal(result.rollbackPerformed, true);
  assert.equal(result.compensationErrors.length, 2);
  assert.equal(result.compensationErrors.every((e) => e.errorCode === 'DATABASE_ERROR'), true);
  assert.equal(result.compensationErrors.every((e) => e.dbErrorCode === 'INJECTED_COMPENSATION_FAILURE'), true);
  // Two drafts could not be undone => they survive as net-applied state, surfaced to operators.
  assert.equal(result.totals.netAppliedRecords, 2);
  assert.equal(activeRows(client, 'diaspora_import_orders').length, 2);

  // Those rows are reported as rolledBackFailed and retain their orphan target id for manual review.
  const failedCompRows = client.db.diaspora_workbook_import_rows.filter((r) => r.import_result?.status === 'rolledBackFailed');
  assert.equal(failedCompRows.length, 2);
  assert.equal(failedCompRows.every((r) => r.target_record_id !== null), true);
  assert.equal(failedCompRows.every((r) => r.import_result.rolledBack === true), true);
});

test('atomic opt-out (options.atomic=false) preserves best-effort behavior on failure', async () => {
  const client = createMockSupabaseClient({
    faults: { failInsert: (table, attempt) => table === 'diaspora_import_orders' && attempt === 3 },
  });
  const result = await executeDiasporaWorkbookDraftImport('batch-atomic-1', reviewerContext, {
    supabaseClient: client,
    atomic: false,
  });

  // Legacy behavior: partial drafts remain, no rollback performed.
  assert.equal(result.rollbackPerformed, false);
  assert.equal(result.totals.executedDrafts, 2);
  assert.equal(result.nextStatus, WORKBOOK_IMPORT_STATUSES.PARTIALLY_IMPORTED_DRAFTS);
  assert.equal(activeRows(client, 'diaspora_import_orders').length, 2);
});
