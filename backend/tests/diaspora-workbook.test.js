import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDiasporaWorkbookTemplateSchema } from '../services/diaspora/diasporaWorkbookTemplateService.js';
import { runDiasporaWorkbookDryRun, runAndPersistDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookSyncService.js';
import { buildWorkbookRowDiagnostics } from '../services/diaspora/diasporaWorkbookPersistenceService.js';
import {
  cancelDiasporaWorkbookImportBatch,
  getDiasporaWorkbookImportBatch,
  getWorkbookImportBatchSummary,
  listDiasporaWorkbookImportBatches,
  listDiasporaWorkbookImportRows,
  markDiasporaWorkbookImportBatchReady,
} from '../services/diaspora/diasporaWorkbookReviewService.js';
import { validateDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookValidationService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
const workbookRouteFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');
const validationServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookValidationService.js', import.meta.url), 'utf8');
const syncServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookSyncService.js', import.meta.url), 'utf8');
const templateServiceFile = readFileSync(new URL('../services/diaspora/diasporaWorkbookTemplateService.js', import.meta.url), 'utf8');

function validEnterpriseWorkbook(overrides = {}) {
  const base = {
    templateType: 'enterprise',
    idempotencyKey: 'test-workbook-key-1',
    sheets: {
      TRADE_PROFILES: [
        { TRADE_PROFILE_ID: 'TP-BUYER-1', USER_ID: 'buyer-1', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED' },
        { TRADE_PROFILE_ID: 'TP-SELLER-1', USER_ID: 'seller-1', COUNTRY: 'Japan', CITY: 'Yokohama', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'VERIFIED' },
      ],
      DIASPORA_IMPORT_ORDERS: [
        {
          IMPORT_ORDER_ID: 'DIO-1', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-1', ORDER_TYPE: 'parts_import', ORIGIN_COUNTRY: 'Japan',
          DESTINATION_COUNTRY: 'Zimbabwe', STATUS: 'IMPORT_REQUESTED', BUDGET_CURRENCY: 'USD', BUDGET_AMOUNT: 500, CONTAINER_ID: 'CONT-1', SHIPMENT_ID: 'SHIP-1',
        },
      ],
      IMPORT_QUOTES: [{ QUOTE_ID: 'Q-1', IMPORT_ORDER_ID: 'DIO-1', SELLER_TRADE_PROFILE_ID: 'TP-SELLER-1', QUOTE_AMOUNT: 350, QUOTE_CURRENCY: 'USD', STATUS: 'SUBMITTED' }],
      TRADE_DOCUMENTS: [{ DOCUMENT_ID: 'DOC-1', IMPORT_ORDER_ID: 'DIO-1', TRADE_PROFILE_ID: 'TP-BUYER-1', DOCUMENT_TYPE: 'passport', VERIFICATION_STATUS: 'UPLOADED' }],
      CONTAINER_SHIPMENTS: [
        { CONTAINER_ID: 'CONT-1', ORIGIN_COUNTRY: 'Japan', ORIGIN_CITY: 'Yokohama', DESTINATION_COUNTRY: 'Zimbabwe', DESTINATION_CITY: 'Harare', DEPARTURE_DATE: '2026-07-15', BOOKING_DEADLINE: '2026-07-01', CONTAINER_TYPE: '40HQ', TOTAL_CAPACITY_VOLUME: 10, STATUS: 'BOOKING_OPEN' },
      ],
      CARGO_RESERVATIONS: [
        { RESERVATION_ID: 'RES-1', CONTAINER_ID: 'CONT-1', IMPORT_ORDER_ID: 'DIO-1', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-1', SELLER_TRADE_PROFILE_ID: 'TP-SELLER-1', CARGO_TYPE: 'parts', ESTIMATED_VOLUME: 2, CURRENCY: 'USD', RESERVATION_STATUS: 'APPROVED' },
      ],
      SHIPMENTS: [{ SHIPMENT_ID: 'SHIP-1', IMPORT_ORDER_ID: 'DIO-1', CONTAINER_ID: 'CONT-1', STATUS: 'PLANNED' }],
      COMPLIANCE_REVIEWS: [{ COMPLIANCE_REVIEW_ID: 'CR-1', IMPORT_ORDER_ID: 'DIO-1', REVIEW_TYPE: 'customs', STATUS: 'APPROVED' }],
      PAYMENT_MILESTONES: [{ PAYMENT_MILESTONE_ID: 'PM-1', IMPORT_ORDER_ID: 'DIO-1', MILESTONE_TYPE: 'deposit', AMOUNT: 350, CURRENCY: 'USD', STATUS: 'PAID' }],
      REPUTATION_RECORDS: [{ REPUTATION_RECORD_ID: 'RR-1', TRADE_PROFILE_ID: 'TP-SELLER-1', IMPORT_ORDER_ID: 'DIO-1', RATING: 5 }],
      AI_COMMAND_CENTER: [{ COMMAND_ID: 'CMD-1', RAW_COMMAND: 'Create a parts import order for Harare.', INTENT: 'CREATE_IMPORT_ORDER', RISK_LEVEL: 'LOW', CONFIDENCE_SCORE: 0.95, APPROVAL_STATUS: 'NOT_REQUIRED', EXECUTION_STATUS: 'VALIDATED' }],
    },
  };

  return { ...base, ...overrides, sheets: { ...base.sheets, ...(overrides.sheets || {}) } };
}

function createMockSupabaseClient() {
  const inserts = [];
  return {
    inserts,
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          if (table === 'diaspora_workbook_import_batches') {
            return { select: () => ({ single: async () => ({ data: { id: 'batch-1', import_status: payload.import_status }, error: null }) }) };
          }
          return Promise.resolve({ data: payload, error: null });
        },
      };
    },
  };
}

function createWorkbookReviewMockSupabaseClient(overrides = {}) {
  const calls = [];
  const db = {
    batches: overrides.batches || [
      {
        id: 'batch-ready-1',
        tenant_id: 'tenant-1',
        uploaded_by: 'user-1',
        template_type: 'enterprise',
        source_filename: 'diaspora.xlsx',
        dry_run_result: { dryRunOnly: true },
        total_rows: 2,
        accepted_rows: 2,
        rejected_rows: 0,
        warning_count: 0,
        error_count: 0,
        import_status: 'VALIDATED',
        rollback_status: 'NOT_REQUIRED',
        metadata: { phase: '1C' },
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'batch-blocked-1',
        tenant_id: 'tenant-1',
        uploaded_by: 'user-1',
        template_type: 'enterprise',
        dry_run_result: { dryRunOnly: true },
        total_rows: 2,
        accepted_rows: 1,
        rejected_rows: 1,
        warning_count: 0,
        error_count: 1,
        import_status: 'BLOCKED',
        rollback_status: 'NOT_REQUIRED',
        metadata: { phase: '1C' },
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-06-09T00:00:00.000Z',
        updated_at: '2026-06-09T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'batch-other-user',
        tenant_id: 'tenant-2',
        uploaded_by: 'other-user',
        template_type: 'enterprise',
        dry_run_result: { dryRunOnly: true },
        total_rows: 1,
        accepted_rows: 1,
        rejected_rows: 0,
        warning_count: 0,
        error_count: 0,
        import_status: 'VALIDATED',
        rollback_status: 'NOT_REQUIRED',
        metadata: { phase: '1C' },
        created_by: 'other-user',
        updated_by: 'other-user',
        created_at: '2026-06-08T00:00:00.000Z',
        updated_at: '2026-06-08T00:00:00.000Z',
        deleted_at: null,
      },
    ],
    rows: overrides.rows || [
      {
        id: 'row-1',
        tenant_id: 'tenant-1',
        batch_id: 'batch-ready-1',
        sheet_name: 'DIASPORA_IMPORT_ORDERS',
        workbook_row_number: 2,
        validation_status: 'ACCEPTED',
        action_type: 'UPSERT_DRAFT',
        target_table: 'diaspora_import_orders',
        row_payload: { IMPORT_ORDER_ID: 'DIO-1' },
        normalized_payload: { IMPORT_ORDER_ID: 'DIO-1' },
        validation_errors: [],
        validation_warnings: [],
        deleted_at: null,
      },
      {
        id: 'row-2',
        tenant_id: 'tenant-1',
        batch_id: 'batch-ready-1',
        sheet_name: 'IMPORT_QUOTES',
        workbook_row_number: 2,
        validation_status: 'WARNING',
        action_type: 'UPSERT_DRAFT',
        target_table: 'diaspora_import_quotes',
        row_payload: { QUOTE_ID: 'Q-1' },
        normalized_payload: { QUOTE_ID: 'Q-1' },
        validation_errors: [],
        validation_warnings: [{ code: 'REVIEW_RECOMMENDED' }],
        deleted_at: null,
      },
    ],
  };

  function tableRows(table) {
    if (table === 'diaspora_workbook_import_batches') return db.batches;
    if (table === 'diaspora_workbook_import_rows') return db.rows;
    return [];
  }

  function makeBuilder(table) {
    const state = { table, filters: [], nullFilters: [], orFilters: [], payload: null, op: 'select', single: false, range: null };
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
      update(payload) { state.op = 'update'; state.payload = payload; return chain; },
      single() { state.single = true; return chain; },
      then(resolve, reject) {
        try {
          const result = resolveReviewQuery(state);
          return Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          return reject ? reject(error) : Promise.reject(error);
        }
      },
    };
    return chain;
  }

  function matches(row, state) {
    const eqMatch = state.filters.every(({ column, value }) => row[column] === value);
    const nullMatch = state.nullFilters.every(({ column, value }) => value === null ? row[column] === null || row[column] === undefined : row[column] === value);
    const orMatch = state.orFilters.length === 0 || state.orFilters.some(({ column, operator, value }) => operator === 'eq' && row[column] === value);
    return eqMatch && nullMatch && orMatch;
  }

  function resolveReviewQuery(state) {
    calls.push({ table: state.table, op: state.op, filters: state.filters, payload: state.payload });
    let rows = tableRows(state.table).filter((row) => matches(row, state));

    if (state.op === 'update') {
      rows = rows.map((row) => {
        Object.assign(row, state.payload);
        return row;
      });
    }

    if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
    if (state.single) {
      const row = rows[0] || null;
      return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
    }
    return { data: rows, error: null };
  }

  return {
    calls,
    db,
    from(table) {
      return makeBuilder(table);
    },
  };
}

test('Diaspora workbook routes are mounted inside the existing bounded context', () => {
  assert.equal(routeFile.includes("import diasporaWorkbookRouter from './diasporaWorkbookRoutes.js'"), true);
  assert.equal(routeFile.includes('router.use(diasporaWorkbookRouter)'), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/template-schema'"), true);
  assert.equal(workbookRouteFile.includes("router.post('/workbook/dry-run'"), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/import-batches'"), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/import-batches/:id'"), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/import-batches/:id/summary'"), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/import-batches/:id/rows'"), true);
  assert.equal(workbookRouteFile.includes("router.post('/workbook/import-batches/:id/cancel'"), true);
  assert.equal(workbookRouteFile.includes("router.post('/workbook/import-batches/:id/mark-ready'"), true);
  assert.equal(workbookRouteFile.includes('runAndPersistDiasporaWorkbookDryRun'), true);
});

test('Workbook template schema exposes enterprise sheets, status lists, and dry-run safety rules', () => {
  const schema = getDiasporaWorkbookTemplateSchema('enterprise');
  const sheetNames = schema.sheets.map((sheet) => sheet.sheetName);
  assert.equal(schema.templateType, 'enterprise');
  assert.equal(sheetNames.includes('DIASPORA_IMPORT_ORDERS'), true);
  assert.equal(sheetNames.includes('TRADE_PROFILES'), true);
  assert.equal(sheetNames.includes('AI_COMMAND_CENTER'), true);
  assert.equal(schema.statusLists.IMPORT_ORDER_STATUSES.includes('IMPORT_REQUESTED'), true);
  assert.equal(schema.statusLists.CONTAINER_STATUSES.includes('BOOKING_OPEN'), true);
  assert.equal(schema.safetyRules.some((rule) => rule.includes('Dry-run validation must never write')), true);
});

test('Dry-run validator remains a no-write service and persistence is isolated in persistence service', () => {
  assert.equal(validationServiceFile.includes("from '../../db/supabase"), false);
  assert.equal(validationServiceFile.includes("from('../db/supabase"), false);
  assert.equal(validationServiceFile.includes('.from('), false);
  assert.equal(syncServiceFile.includes('persistDiasporaWorkbookDryRun'), true);
  assert.equal(templateServiceFile.includes('sourceOfTruth'), true);
});

test('Valid enterprise workbook dry-run succeeds and marks validation as no live import', () => {
  const result = runDiasporaWorkbookDryRun(validEnterpriseWorkbook(), { id: 'user-1', tenantId: 'tenant-1' });
  assert.equal(result.dryRunOnly, true);
  assert.equal(result.wroteToDatabase, false);
  assert.equal(result.canImport, true);
  assert.equal(result.totals.errorCount, 0);
  assert.equal(result.userId, 'user-1');
  assert.equal(result.tenantId, 'tenant-1');
});

test('Phase 1C persists dry-run batch and row diagnostics without live import writes', async () => {
  const mockSupabaseClient = createMockSupabaseClient();
  const result = await runAndPersistDiasporaWorkbookDryRun(
    validEnterpriseWorkbook(),
    { id: 'user-1', tenantId: '11111111-1111-1111-1111-111111111111' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(result.dryRunOnly, true);
  assert.equal(result.wroteToDatabase, false);
  assert.equal(result.persistence.persisted, true);
  assert.equal(result.persistence.batchId, 'batch-1');
  assert.equal(result.persistence.importStatus, 'VALIDATED');
  assert.equal(mockSupabaseClient.inserts[0].table, 'diaspora_workbook_import_batches');
  assert.equal(mockSupabaseClient.inserts[0].payload.import_status, 'VALIDATED');
  assert.equal(mockSupabaseClient.inserts[1].table, 'diaspora_workbook_import_rows');
  assert.equal(Array.isArray(mockSupabaseClient.inserts[1].payload), true);
  assert.equal(mockSupabaseClient.inserts[1].payload.length, result.persistence.rowDiagnosticsPersisted);
  assert.equal(mockSupabaseClient.inserts[1].payload.some((row) => row.target_table === 'diaspora_import_orders'), true);
});

test('Workbook row diagnostics mark row-level validation status', () => {
  const workbook = validEnterpriseWorkbook({
    sheets: {
      DIASPORA_IMPORT_ORDERS: [
        { IMPORT_ORDER_ID: 'DIO-1', BUYER_TRADE_PROFILE_ID: 'MISSING-BUYER', ORDER_TYPE: 'parts_import', ORIGIN_COUNTRY: 'Japan', DESTINATION_COUNTRY: 'Zimbabwe', STATUS: 'IMPORT_REQUESTED', BUDGET_CURRENCY: 'USD' },
      ],
    },
  });
  const dryRun = validateDiasporaWorkbookDryRun(workbook);
  const diagnostics = buildWorkbookRowDiagnostics(workbook, dryRun);
  const rejectedOrder = diagnostics.find((row) => row.sheetName === 'DIASPORA_IMPORT_ORDERS');
  assert.equal(dryRun.canImport, false);
  assert.equal(rejectedOrder.validationStatus, 'REJECTED');
  assert.equal(rejectedOrder.actionType, 'ERROR');
  assert.equal(rejectedOrder.validationErrors.some((error) => error.code === 'UNKNOWN_REFERENCE'), true);
});

test('Phase 1D lists only accessible persisted workbook import batches', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  const result = await listDiasporaWorkbookImportBatches(
    {},
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(result.data.length, 2);
  assert.equal(result.data.some((batch) => batch.id === 'batch-other-user'), false);
  assert.equal(result.pagination.count, 2);
  assert.equal(mockSupabaseClient.calls.every((call) => call.table === 'diaspora_workbook_import_batches'), true);
});

test('Phase 1D returns batch detail and row diagnostics without live trade-table writes', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  const batch = await getDiasporaWorkbookImportBatch(
    'batch-ready-1',
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );
  const rows = await listDiasporaWorkbookImportRows(
    'batch-ready-1',
    { validationStatus: 'WARNING' },
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(batch.id, 'batch-ready-1');
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0].validation_status, 'WARNING');
  assert.deepEqual(
    [...new Set(mockSupabaseClient.calls.map((call) => call.table))].sort(),
    ['diaspora_workbook_import_batches', 'diaspora_workbook_import_rows'],
  );
});

test('Phase 1D blocks unrelated users from persisted workbook batch detail', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  await assert.rejects(
    () => getDiasporaWorkbookImportBatch(
      'batch-other-user',
      { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
      { supabaseClient: mockSupabaseClient },
    ),
    NotFoundError,
  );
});

test('Phase 1D summarizes workbook import batches from accessible batch rows only', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient({
    batches: [
      {
        id: 'batch-summary-1',
        tenant_id: 'tenant-1',
        uploaded_by: 'user-1',
        template_type: 'enterprise',
        dry_run_result: { dryRunOnly: true },
        total_rows: 4,
        accepted_rows: 2,
        rejected_rows: 1,
        warning_count: 1,
        error_count: 1,
        import_status: 'VALIDATED',
        rollback_status: 'NOT_REQUIRED',
        metadata: { phase: '1C' },
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
        deleted_at: null,
      },
    ],
    rows: [
      {
        id: 'summary-row-1',
        tenant_id: 'tenant-1',
        batch_id: 'batch-summary-1',
        sheet_name: 'DIASPORA_IMPORT_ORDERS',
        workbook_row_number: 2,
        validation_status: 'ACCEPTED',
        action_type: 'UPSERT_DRAFT',
        target_table: 'diaspora_import_orders',
        deleted_at: null,
      },
      {
        id: 'summary-row-2',
        tenant_id: 'tenant-1',
        batch_id: 'batch-summary-1',
        sheet_name: 'DIASPORA_IMPORT_ORDERS',
        workbook_row_number: 3,
        validation_status: 'WARNING',
        action_type: 'UPSERT_DRAFT',
        target_table: 'diaspora_import_orders',
        deleted_at: null,
      },
      {
        id: 'summary-row-3',
        tenant_id: 'tenant-1',
        batch_id: 'batch-summary-1',
        sheet_name: 'IMPORT_QUOTES',
        workbook_row_number: 2,
        validation_status: 'ACCEPTED',
        action_type: 'UPSERT_DRAFT',
        target_table: 'diaspora_import_quotes',
        deleted_at: null,
      },
      {
        id: 'summary-row-4',
        tenant_id: 'tenant-1',
        batch_id: 'batch-summary-1',
        sheet_name: 'AI_COMMAND_CENTER',
        workbook_row_number: 2,
        validation_status: 'REJECTED',
        action_type: 'ERROR',
        target_table: 'diaspora_ai_commands',
        deleted_at: null,
      },
    ],
  });

  const summary = await getWorkbookImportBatchSummary(
    'batch-summary-1',
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(summary.batchId, 'batch-summary-1');
  assert.equal(summary.importStatus, 'VALIDATED');
  assert.equal(summary.templateType, 'enterprise');
  assert.equal(summary.totalRows, 4);
  assert.equal(summary.acceptedRows, 2);
  assert.equal(summary.warningRows, 1);
  assert.equal(summary.rejectedRows, 1);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.deepEqual(summary.rowsBySheet, {
    DIASPORA_IMPORT_ORDERS: 2,
    IMPORT_QUOTES: 1,
    AI_COMMAND_CENTER: 1,
  });
  assert.deepEqual(summary.rowsByValidationStatus, {
    ACCEPTED: 2,
    WARNING: 1,
    REJECTED: 1,
  });
  assert.deepEqual(summary.rowsByTargetTable, {
    diaspora_import_orders: 2,
    diaspora_import_quotes: 1,
    diaspora_ai_commands: 1,
  });
  assert.deepEqual(summary.rowsByActionType, {
    UPSERT_DRAFT: 3,
    ERROR: 1,
  });
  assert.deepEqual(
    [...new Set(mockSupabaseClient.calls.map((call) => call.table))].sort(),
    ['diaspora_workbook_import_batches', 'diaspora_workbook_import_rows'],
  );
  assert.equal(mockSupabaseClient.calls.some((call) => call.op === 'update'), false);
});

test('Phase 1D summary verifies parent batch access before reading rows', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  await assert.rejects(
    () => getWorkbookImportBatchSummary(
      'batch-other-user',
      { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
      { supabaseClient: mockSupabaseClient },
    ),
    NotFoundError,
  );
  assert.deepEqual(
    [...new Set(mockSupabaseClient.calls.map((call) => call.table))],
    ['diaspora_workbook_import_batches'],
  );
});

test('Phase 1D can mark validated workbook dry-run batches ready for review without import execution', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  const result = await markDiasporaWorkbookImportBatchReady(
    'batch-ready-1',
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(result.data.import_status, 'READY_FOR_REVIEW');
  assert.equal(result.liveImportExecuted, false);
  assert.equal(result.data.metadata.liveImportExecuted, false);
  assert.equal(mockSupabaseClient.calls.some((call) => call.op === 'update' && call.table === 'diaspora_workbook_import_batches'), true);
  assert.equal(mockSupabaseClient.calls.some((call) => call.op === 'update' && call.table !== 'diaspora_workbook_import_batches'), false);
});

test('Phase 1D refuses to mark rejected workbook dry-run batches ready for review', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  await assert.rejects(
    () => markDiasporaWorkbookImportBatchReady(
      'batch-blocked-1',
      { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
      { supabaseClient: mockSupabaseClient },
    ),
    ValidationError,
  );
  assert.equal(mockSupabaseClient.db.batches.find((batch) => batch.id === 'batch-blocked-1').import_status, 'BLOCKED');
});

test('Phase 1D can cancel a persisted workbook review batch without import execution', async () => {
  const mockSupabaseClient = createWorkbookReviewMockSupabaseClient();
  const result = await cancelDiasporaWorkbookImportBatch(
    'batch-ready-1',
    { id: 'user-1', tenantId: 'tenant-1', role: 'owner' },
    { supabaseClient: mockSupabaseClient },
  );

  assert.equal(result.data.import_status, 'CANCELLED');
  assert.equal(result.liveImportExecuted, false);
  assert.equal(result.data.metadata.reviewAction, 'cancelled');
  assert.equal(mockSupabaseClient.calls.some((call) => call.table === 'diaspora_import_orders'), false);
  assert.equal(mockSupabaseClient.calls.some((call) => call.table === 'diaspora_import_quotes'), false);
});

test('Dry-run rejects missing required sheets', () => {
  const workbook = validEnterpriseWorkbook();
  delete workbook.sheets.TRADE_PROFILES;
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'MISSING_REQUIRED_SHEET' && error.sheetName === 'TRADE_PROFILES'), true);
});

test('Dry-run rejects invalid statuses and unknown references', () => {
  const workbook = validEnterpriseWorkbook({
    sheets: {
      DIASPORA_IMPORT_ORDERS: [{ IMPORT_ORDER_ID: 'DIO-1', BUYER_TRADE_PROFILE_ID: 'MISSING-BUYER', ORDER_TYPE: 'parts_import', ORIGIN_COUNTRY: 'Japan', DESTINATION_COUNTRY: 'Zimbabwe', STATUS: 'SHIPPED_DIRECTLY_WITHOUT_WORKFLOW', BUDGET_CURRENCY: 'USD' }],
    },
  });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'INVALID_STATUS_VALUE'), true);
  assert.equal(result.errors.some((error) => error.code === 'UNKNOWN_REFERENCE'), true);
});

test('Dry-run rejects duplicate workbook IDs', () => {
  const workbook = validEnterpriseWorkbook({
    sheets: {
      TRADE_PROFILES: [
        { TRADE_PROFILE_ID: 'TP-DUP', USER_ID: 'buyer-1', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED' },
        { TRADE_PROFILE_ID: 'TP-DUP', USER_ID: 'seller-1', COUNTRY: 'Japan', CITY: 'Yokohama', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'VERIFIED' },
      ],
    },
  });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'DUPLICATE_WORKBOOK_ID'), true);
});

test('Dry-run rejects overfilled container reservations', () => {
  const workbook = validEnterpriseWorkbook({ sheets: { CARGO_RESERVATIONS: [{ RESERVATION_ID: 'RES-1', CONTAINER_ID: 'CONT-1', IMPORT_ORDER_ID: 'DIO-1', CARGO_TYPE: 'parts', ESTIMATED_VOLUME: 11, CURRENCY: 'USD', RESERVATION_STATUS: 'APPROVED' }] } });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'CONTAINER_OVERFILLED'), true);
});

test('Dry-run warns when container is ready to close but not overfilled', () => {
  const workbook = validEnterpriseWorkbook({ sheets: { CARGO_RESERVATIONS: [{ RESERVATION_ID: 'RES-1', CONTAINER_ID: 'CONT-1', IMPORT_ORDER_ID: 'DIO-1', CARGO_TYPE: 'parts', ESTIMATED_VOLUME: 9.5, CURRENCY: 'USD', RESERVATION_STATUS: 'APPROVED' }] } });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, true);
  assert.equal(result.warnings.some((warning) => ['CONTAINER_READY_TO_CLOSE', 'CONTAINER_FULL'].includes(warning.code)), true);
});

test('Dry-run blocks release when compliance is flagged or payment milestones are unpaid', () => {
  const workbook = validEnterpriseWorkbook({
    sheets: {
      DIASPORA_IMPORT_ORDERS: [{ IMPORT_ORDER_ID: 'DIO-1', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-1', ORDER_TYPE: 'parts_import', ORIGIN_COUNTRY: 'Japan', DESTINATION_COUNTRY: 'Zimbabwe', STATUS: 'RELEASED', BUDGET_CURRENCY: 'USD' }],
      COMPLIANCE_REVIEWS: [{ COMPLIANCE_REVIEW_ID: 'CR-1', IMPORT_ORDER_ID: 'DIO-1', REVIEW_TYPE: 'customs', STATUS: 'FLAGGED' }],
      PAYMENT_MILESTONES: [{ PAYMENT_MILESTONE_ID: 'PM-1', IMPORT_ORDER_ID: 'DIO-1', MILESTONE_TYPE: 'balance', AMOUNT: 350, CURRENCY: 'USD', STATUS: 'PENDING' }],
    },
  });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'FLAGGED_COMPLIANCE_BLOCKS_RELEASE'), true);
  assert.equal(result.errors.some((error) => error.code === 'UNPAID_MILESTONES_BLOCK_RELEASE'), true);
});

test('Dry-run blocks high-risk AI commands without approval', () => {
  const workbook = validEnterpriseWorkbook({ sheets: { AI_COMMAND_CENTER: [{ COMMAND_ID: 'CMD-1', RAW_COMMAND: 'Release escrow for this order.', INTENT: 'RELEASE_ESCROW', RISK_LEVEL: 'HIGH', CONFIDENCE_SCORE: 0.91, APPROVAL_STATUS: 'PENDING', EXECUTION_STATUS: 'VALIDATED' }] } });
  const result = validateDiasporaWorkbookDryRun(workbook);
  assert.equal(result.canImport, false);
  assert.equal(result.errors.some((error) => error.code === 'HIGH_RISK_AI_REQUIRES_APPROVAL'), true);
});

test('Phase 1C import/export/drive actions remain intentionally disabled', async () => {
  await assert.rejects(() => import('../services/diaspora/diasporaWorkbookSyncService.js').then((module) => module.importDiasporaWorkbook(validEnterpriseWorkbook(), { id: 'user-1' })), ValidationError);
  await assert.rejects(() => import('../services/diaspora/diasporaWorkbookSyncService.js').then((module) => module.exportDiasporaWorkbook()), ValidationError);
  await assert.rejects(() => import('../services/diaspora/diasporaWorkbookSyncService.js').then((module) => module.saveDiasporaWorkbookToDrive()), ValidationError);
});
