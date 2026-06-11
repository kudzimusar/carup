import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDiasporaWorkbookTemplateSchema } from '../services/diaspora/diasporaWorkbookTemplateService.js';
import { runDiasporaWorkbookDryRun, runAndPersistDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookSyncService.js';
import { buildWorkbookRowDiagnostics } from '../services/diaspora/diasporaWorkbookPersistenceService.js';
import { validateDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookValidationService.js';
import { ValidationError } from '../utils/errors.js';

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

test('Diaspora workbook routes are mounted inside the existing bounded context', () => {
  assert.equal(routeFile.includes("import diasporaWorkbookRouter from './diasporaWorkbookRoutes.js'"), true);
  assert.equal(routeFile.includes('router.use(diasporaWorkbookRouter)'), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/template-schema'"), true);
  assert.equal(workbookRouteFile.includes("router.post('/workbook/dry-run'"), true);
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
