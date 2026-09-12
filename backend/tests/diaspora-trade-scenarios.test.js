import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORKBOOK_TEMPLATE_TYPES,
  getRequiredSheetsForTemplate,
} from '../constants/diaspora/diasporaWorkbookSchema.js';
import { listSupportedXlsxTemplateTypes } from '../constants/diaspora/diasporaWorkbookTemplates.js';
import { TRADE_SCENARIO_IDS } from '../constants/diaspora/diasporaTradeScenarioConstants.js';
import { validateDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookValidationService.js';
import { persistDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookPersistenceService.js';
import { parseWorkbook } from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import {
  generateDiasporaTradeScenarioWorkbook,
  listDiasporaTradeScenarios,
  previewDiasporaTradeScenario,
} from '../services/diaspora/diasporaTradeScenarioService.js';

const scenarioUser = { id: 'scenario-reviewer-1', tenantId: 'scenario-tenant-1', role: 'reviewer' };
const workbookRouteFile = readFileSync(new URL('../routes/diasporaWorkbookRoutes.js', import.meta.url), 'utf8');

function emptyBuyerSheets(order) {
  return {
    DIASPORA_IMPORT_ORDERS: order ? [order] : [],
    TRADE_DOCUMENTS: [],
    PAYMENT_MILESTONES: [],
    AI_COMMAND_CENTER: [],
  };
}

function validBuyerOrder(overrides = {}) {
  return {
    IMPORT_ORDER_ID: 'DIO-EXT-1',
    BUYER_TRADE_PROFILE_ID: 'TP-EXTERNAL-BUYER',
    ORDER_TYPE: 'vehicle_import',
    SERVICE_SCOPE: 'FULL_TRADE',
    ORIGIN_COUNTRY: 'Japan',
    DESTINATION_COUNTRY: 'Zimbabwe',
    STATUS: 'IMPORT_REQUESTED',
    BUDGET_CURRENCY: 'USD',
    ...overrides,
  };
}

function createPersistenceMockClient() {
  const inserts = [];
  return {
    inserts,
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          if (table === 'diaspora_workbook_import_batches') {
            return {
              select: () => ({
                single: async () => ({ data: { id: 'scenario-batch-1', import_status: payload.import_status }, error: null }),
              }),
            };
          }
          return Promise.resolve({ data: payload, error: null });
        },
      };
    },
  };
}

test('canonical workbook schema and XLSX catalog agree on exactly five template families', () => {
  const schemaTypes = Object.values(WORKBOOK_TEMPLATE_TYPES).sort();
  const xlsxTypes = listSupportedXlsxTemplateTypes().sort();
  assert.deepEqual(xlsxTypes, schemaTypes);
  assert.equal(schemaTypes.length, 5);

  for (const templateType of schemaTypes) {
    const sheets = getRequiredSheetsForTemplate(templateType);
    assert.equal(Array.isArray(sheets), true);
    assert.equal(sheets.length > 0, true);
  }
});

test('buyer role workbook treats omitted authoritative profile as a domain-resolution warning, not a false rejection', () => {
  const result = validateDiasporaWorkbookDryRun({
    templateType: 'buyer',
    sheets: emptyBuyerSheets(validBuyerOrder()),
  }, scenarioUser);

  assert.equal(result.canImport, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((finding) => finding.code === 'EXTERNAL_REFERENCE_REQUIRES_RESOLUTION'), true);
  assert.equal(result.warnings.some((finding) => finding.validationLayer === 'DOMAIN'), true);
});

test('supplier workbook may reference an existing RFQ outside the role workbook and preserves source currency', () => {
  const result = validateDiasporaWorkbookDryRun({
    templateType: 'supplier',
    sheets: {
      TRADE_PROFILES: [{
        TRADE_PROFILE_ID: 'TP-SUP-1', USER_ID: 'fixture-supplier', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'supplier', VERIFICATION_STATUS: 'PENDING_REVIEW',
      }],
      IMPORT_QUOTES: [{
        QUOTE_ID: 'Q-EXT-1', IMPORT_ORDER_ID: 'DIO-EXTERNAL-RFQ', SELLER_TRADE_PROFILE_ID: 'TP-SUP-1', QUOTE_AMOUNT: 1250000, QUOTE_CURRENCY: 'JPY', STATUS: 'SUBMITTED',
      }],
      TRADE_DOCUMENTS: [],
    },
  }, scenarioUser);

  assert.equal(result.canImport, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((finding) => finding.code === 'EXTERNAL_REFERENCE_REQUIRES_RESOLUTION' && finding.column === 'IMPORT_ORDER_ID'), true);
});

test('shipping-only workbook requires a concrete vehicle reference', () => {
  const result = validateDiasporaWorkbookDryRun({
    templateType: 'buyer',
    sheets: emptyBuyerSheets(validBuyerOrder({ SERVICE_SCOPE: 'SHIPPING_ONLY' })),
  }, scenarioUser);

  assert.equal(result.canImport, false);
  const finding = result.errors.find((item) => item.code === 'SHIPPING_ONLY_VEHICLE_REFERENCE_REQUIRED');
  assert.ok(finding);
  assert.equal(finding.validationLayer, 'DOMAIN');
});

test('scenario routes are preview/download only and do not expose a scenario execution route', () => {
  assert.equal(workbookRouteFile.includes("router.get('/workbook/scenarios'"), true);
  assert.equal(workbookRouteFile.includes("router.post('/workbook/scenarios/:scenarioId/preview'"), true);
  assert.equal(workbookRouteFile.includes("router.get('/workbook/scenarios/:scenarioId/inputs/:inputId.xlsx'"), true);
  assert.equal(workbookRouteFile.includes("/workbook/scenarios/:scenarioId/execute"), false);
  assert.equal(workbookRouteFile.includes("/workbook/scenarios/:scenarioId/seed"), false);
});

test('Golden Scenario catalog exposes the three T5 scenarios only', () => {
  const ids = listDiasporaTradeScenarios().map((scenario) => scenario.scenarioId).sort();
  assert.deepEqual(ids, Object.values(TRADE_SCENARIO_IDS).sort());
});

for (const scenarioId of Object.values(TRADE_SCENARIO_IDS)) {
  test(`${scenarioId} completes canonical XLSX round-trip and strict zero-write preview`, async () => {
    const preview = await previewDiasporaTradeScenario(scenarioId, scenarioUser, {
      environmentClass: 'test',
      runId: `test-run-${scenarioId}`,
      now: '2026-09-13T00:00:00.000Z',
    });

    assert.equal(preview.scenarioId, scenarioId);
    assert.equal(preview.dryRunOnly, true);
    assert.equal(preview.wroteToDatabase, false);
    assert.equal(preview.productionForbidden, true);
    assert.equal(preview.perInput.length > 0, true);
    assert.equal(preview.perInput.every((input) => input.generatedBytes > 0), true);
    assert.equal(preview.perInput.every((input) => input.dryRun.wroteToDatabase === false), true);
    assert.equal(preview.perInput.every((input) => input.dryRun.canImport === true), true);
    assert.equal(preview.combinedDryRun.canImport, true);
    assert.equal(preview.importPlan.totals.blockedActions, 0);
    assert.equal(preview.assertions.allPassed, true);
    assert.equal(preview.readyForReviewedImport, true);
  });
}

test('Alphard scenario preserves competing quote history and original JPY source currency in assertions', async () => {
  const preview = await previewDiasporaTradeScenario(TRADE_SCENARIO_IDS.ALPHARD_HARARE, scenarioUser, {
    environmentClass: 'test', runId: 'alpha-assertions',
  });
  const byId = new Map(preview.assertions.results.map((result) => [result.id, result]));
  assert.equal(byId.get('A2')?.actual, 3);
  assert.equal(byId.get('A3')?.actual, 'SUBMITTED');
  assert.equal(byId.get('A4')?.actual, 'EXPIRED');
  assert.equal(byId.get('A5')?.actual, 'REJECTED');
  assert.equal(byId.get('A6')?.actual, 'JPY');
});

test('BYO scenario proves shipping-only scope round-trips without Marketplace vehicle id', async () => {
  const preview = await previewDiasporaTradeScenario(TRADE_SCENARIO_IDS.BYO_VEHICLE_SHIPPING, scenarioUser, {
    environmentClass: 'test', runId: 'byo-assertions',
  });
  const byId = new Map(preview.assertions.results.map((result) => [result.id, result]));
  assert.equal(byId.get('B2')?.actual, 'SHIPPING_ONLY');
  assert.equal(byId.get('B3')?.actual, true);
  assert.equal(byId.get('B4')?.actual, true);
});

test('generated Golden Scenario workbook uses canonical XLSX parser and preserves SERVICE_SCOPE', async () => {
  const generated = await generateDiasporaTradeScenarioWorkbook(
    TRADE_SCENARIO_IDS.BYO_VEHICLE_SHIPPING,
    'buyer',
    { environmentClass: 'test', now: '2026-09-13T00:00:00.000Z' },
  );
  assert.equal(generated.buffer.length > 0, true);
  const parsed = await parseWorkbook(generated.buffer, { templateType: 'buyer' });
  assert.equal(parsed.templateType, 'buyer');
  assert.equal(parsed.sheets.DIASPORA_IMPORT_ORDERS[0].SERVICE_SCOPE, 'SHIPPING_ONLY');
  assert.equal(parsed.sheets.DIASPORA_IMPORT_ORDERS[0].LINKED_VEHICLE_VIN, 'BYOJPZW00000000001');
});

test('persisted workbook diagnostics retain scenario/run/provenance metadata without a schema migration', async () => {
  const payload = {
    templateType: 'buyer',
    idempotencyKey: 'scenario-provenance-test',
    scenario: {
      scenarioId: 'SCN-PROVENANCE-TEST',
      scenarioRunId: 'run-123',
      scenarioVersion: 1,
      productionForbidden: true,
    },
    provenance: { sourceType: 'TEST_FIXTURE', fixtureClass: 'TEST_FIXTURE' },
    sheets: emptyBuyerSheets(validBuyerOrder()),
  };
  const dryRun = validateDiasporaWorkbookDryRun(payload, scenarioUser);
  assert.equal(dryRun.canImport, true);

  const client = createPersistenceMockClient();
  const result = await persistDiasporaWorkbookDryRun(payload, dryRun, scenarioUser, { supabaseClient: client });
  assert.equal(result.persisted, true);
  assert.equal(result.scenario.scenarioId, 'SCN-PROVENANCE-TEST');

  const batchInsert = client.inserts.find((entry) => entry.table === 'diaspora_workbook_import_batches');
  const rowInsert = client.inserts.find((entry) => entry.table === 'diaspora_workbook_import_rows');
  assert.equal(batchInsert.payload.metadata.scenario.scenarioRunId, 'run-123');
  assert.equal(batchInsert.payload.metadata.scenario.sourceType, 'TEST_FIXTURE');
  assert.equal(rowInsert.payload[0].metadata.scenario.scenarioId, 'SCN-PROVENANCE-TEST');
});

test('Golden Scenario preview and workbook generation fail closed in production', async () => {
  await assert.rejects(
    () => previewDiasporaTradeScenario(TRADE_SCENARIO_IDS.ALPHARD_HARARE, scenarioUser, { environmentClass: 'production' }),
    (error) => error?.details?.code === 'TRADE_SCENARIO_PRODUCTION_FORBIDDEN',
  );
  await assert.rejects(
    () => generateDiasporaTradeScenarioWorkbook(TRADE_SCENARIO_IDS.ALPHARD_HARARE, 'buyer', { environmentClass: 'production' }),
    (error) => error?.details?.code === 'TRADE_SCENARIO_PRODUCTION_FORBIDDEN',
  );
});
