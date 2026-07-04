/**
 * Tenant-scoped, DATABASE-sourced XLSX export tests (Completion Track W).
 *
 * These are true end-to-end assertions: the service reads rows from an in-memory mock Supabase
 * (never from a request body), builds the workbook through the REUSED exportWorkbook engine, and we
 * re-parse the emitted .xlsx with parseWorkbook to inspect exactly what a caller would receive.
 *
 * Headline invariant proven here: a tenant-A caller's export contains ONLY tenant-A rows; a platform
 * admin/reviewer sees every tenant; PII/storage columns are never emitted; and the data is sourced
 * from the DB, not from any caller-supplied payload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { exportWorkbookFromDatabase } = await import('../services/diaspora/workbook/diasporaWorkbookDbExportService.js');
const { parseWorkbook } = await import('../services/diaspora/workbook/diasporaWorkbookXlsxService.js');
const { ValidationError, UnauthorizedError } = await import('../utils/errors.js');

const TEMPLATE_TYPE = 'enterprise';

// Non-privileged callers scoped to a tenant.
const tenantACaller = { id: 'user-a', userId: 'user-a', role: 'dealer', platformRole: 'dealer', tenantId: 'tenant-A' };
const tenantBCaller = { id: 'user-b', userId: 'user-b', role: 'dealer', platformRole: 'dealer', tenantId: 'tenant-B' };
// Privileged callers (server-derived platformRole) span tenants.
const adminCaller = { id: 'admin-1', userId: 'admin-1', role: 'admin', platformRole: 'platform_admin', tenantId: null };
const reviewerCaller = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

const SECRET_STORAGE_PATH = 'private/tenant-A/secret-passport.pdf';
const SECRET_DRIVE_ID = 'drive-file-SECRET-123';
const SECRET_ID_NUMBER = 'ZW-ID-999-SECRET';

function seededClient() {
  return createMockSupabase({
    diaspora_trade_profiles: [
      { id: 'TP-A', tenant_id: 'tenant-A', user_id: 'user-a', country: 'Japan', city: 'Tokyo', role_type: 'seller', verification_status: 'VERIFIED', created_by: 'user-a', deleted_at: null },
      { id: 'TP-B', tenant_id: 'tenant-B', user_id: 'user-b', country: 'UAE', city: 'Dubai', role_type: 'seller', verification_status: 'VERIFIED', created_by: 'user-b', deleted_at: null },
    ],
    diaspora_import_orders: [
      { id: 'ORD-A', tenant_id: 'tenant-A', buyer_trade_profile_id: 'TP-A', order_type: 'vehicle_import', origin_country: 'Japan', destination_country: 'Zimbabwe', status: 'IMPORT_REQUESTED', budget_currency: 'USD', created_by: 'user-a', deleted_at: null },
      { id: 'ORD-B', tenant_id: 'tenant-B', buyer_trade_profile_id: 'TP-B', order_type: 'parts_import', origin_country: 'UAE', destination_country: 'Zimbabwe', status: 'IMPORT_REQUESTED', budget_currency: 'USD', created_by: 'user-b', deleted_at: null },
    ],
    diaspora_trade_documents: [
      {
        id: 'DOC-A', tenant_id: 'tenant-A', document_type: 'passport', verification_status: 'VERIFIED',
        storage_path: SECRET_STORAGE_PATH, drive_file_id: SECRET_DRIVE_ID, extracted_id_number: SECRET_ID_NUMBER,
        notes: 'tenant-A passport', created_by: 'user-a', deleted_at: null,
      },
      {
        id: 'DOC-B', tenant_id: 'tenant-B', document_type: 'passport', verification_status: 'VERIFIED',
        storage_path: 'private/tenant-B/other.pdf', notes: 'tenant-B passport', created_by: 'user-b', deleted_at: null,
      },
    ],
  });
}

async function exportAndParse(templateType, caller, client, options = {}) {
  const buffer = await exportWorkbookFromDatabase(templateType, caller, { supabaseClient: client, ...options });
  assert.equal(Buffer.isBuffer(buffer), true, 'export must return a Buffer');
  const parsed = await parseWorkbook(buffer, { templateType });
  return { buffer, parsed };
}

function ids(rows, key) {
  return (rows || []).map((row) => row[key]);
}

function everyCellValue(parsed) {
  const values = [];
  for (const rows of Object.values(parsed.sheets)) {
    for (const row of rows) {
      for (const value of Object.values(row)) values.push(String(value));
    }
  }
  return values;
}

// 1. HEADLINE: a tenant-A caller's export contains ONLY tenant-A rows; tenant-B is absent.
test('tenant-A caller export contains only tenant-A rows (tenant-B never leaks)', async () => {
  const client = seededClient();
  const { parsed } = await exportAndParse(TEMPLATE_TYPE, tenantACaller, client);

  assert.deepEqual(ids(parsed.sheets.TRADE_PROFILES, 'TRADE_PROFILE_ID'), ['TP-A']);
  assert.deepEqual(ids(parsed.sheets.DIASPORA_IMPORT_ORDERS, 'IMPORT_ORDER_ID'), ['ORD-A']);
  assert.deepEqual(ids(parsed.sheets.TRADE_DOCUMENTS, 'DOCUMENT_ID'), ['DOC-A']);

  // No tenant-B identifier appears anywhere in the emitted workbook.
  const allValues = everyCellValue(parsed);
  assert.equal(allValues.includes('TP-B'), false);
  assert.equal(allValues.includes('ORD-B'), false);
  assert.equal(allValues.includes('DOC-B'), false);

  // Symmetric check: a tenant-B caller sees only tenant-B.
  const { parsed: parsedB } = await exportAndParse(TEMPLATE_TYPE, tenantBCaller, seededClient());
  assert.deepEqual(ids(parsedB.sheets.TRADE_PROFILES, 'TRADE_PROFILE_ID'), ['TP-B']);
  assert.deepEqual(ids(parsedB.sheets.DIASPORA_IMPORT_ORDERS, 'IMPORT_ORDER_ID'), ['ORD-B']);
});

// 2. A platform admin, and a platform reviewer, export EVERY tenant.
test('platform admin and reviewer exports include both tenants', async () => {
  for (const privileged of [adminCaller, reviewerCaller]) {
    const { parsed } = await exportAndParse(TEMPLATE_TYPE, privileged, seededClient());
    assert.deepEqual(ids(parsed.sheets.TRADE_PROFILES, 'TRADE_PROFILE_ID').sort(), ['TP-A', 'TP-B']);
    assert.deepEqual(ids(parsed.sheets.DIASPORA_IMPORT_ORDERS, 'IMPORT_ORDER_ID').sort(), ['ORD-A', 'ORD-B']);
    assert.deepEqual(ids(parsed.sheets.TRADE_DOCUMENTS, 'DOCUMENT_ID').sort(), ['DOC-A', 'DOC-B']);
  }
});

// 3. PII / storage columns are never emitted — even to a legitimately-scoped tenant caller.
test('storage and PII columns are redacted and never present in the output', async () => {
  const client = seededClient();
  const { parsed } = await exportAndParse(TEMPLATE_TYPE, tenantACaller, client);

  const doc = parsed.sheets.TRADE_DOCUMENTS.find((row) => row.DOCUMENT_ID === 'DOC-A');
  assert.ok(doc, 'expected the tenant-A document row');
  // Sensitive headers exist in the template but carry a redaction marker, never the secret.
  assert.equal(doc.STORAGE_PATH, '[REDACTED]');
  assert.equal(doc.DRIVE_FILE_ID, '[REDACTED]');
  assert.equal(doc.EXTRACTED_ID_NUMBER, '[REDACTED]');
  // A non-sensitive column still flows through so the export is useful.
  assert.equal(doc.DOCUMENT_TYPE, 'passport');

  // The raw secrets appear in NO cell of the re-parsed workbook.
  const allValues = everyCellValue(parsed);
  for (const secret of [SECRET_STORAGE_PATH, SECRET_DRIVE_ID, SECRET_ID_NUMBER]) {
    assert.equal(allValues.some((value) => value.includes(secret)), false, `secret leaked: ${secret}`);
  }
});

// 4. The data is DB-sourced (seeded via the mock), not echoed from any request body.
test('export reflects DB state, not caller-supplied rows', async () => {
  // Empty DB -> zero data rows, proving nothing is fabricated/echoed from input.
  const emptyClient = createMockSupabase({ diaspora_trade_profiles: [], diaspora_import_orders: [], diaspora_trade_documents: [] });
  const { parsed: empty } = await exportAndParse(TEMPLATE_TYPE, adminCaller, emptyClient);
  assert.equal(empty.sheets.TRADE_PROFILES.length, 0);
  assert.equal(empty.sheets.DIASPORA_IMPORT_ORDERS.length, 0);

  // Seeded DB -> the seeded rows appear. Same caller, same (absent) body, different DB => different output.
  const { parsed: seeded } = await exportAndParse(TEMPLATE_TYPE, adminCaller, seededClient());
  assert.equal(seeded.sheets.TRADE_PROFILES.length, 2);
  // The projected identifier comes from the DB row's `id`, and other headers from lower_snake columns.
  const profileA = seeded.sheets.TRADE_PROFILES.find((row) => row.TRADE_PROFILE_ID === 'TP-A');
  assert.equal(profileA.USER_ID, 'user-a');
  assert.equal(profileA.CITY, 'Tokyo');
  assert.equal(profileA.ROLE_TYPE, 'seller');
});

// 5. soft-deleted rows (deleted_at set) are excluded from the export.
test('soft-deleted rows are excluded', async () => {
  const client = seededClient();
  client._rows('diaspora_trade_profiles').push({
    id: 'TP-A-DEL', tenant_id: 'tenant-A', user_id: 'user-a', country: 'Japan', city: 'Osaka',
    role_type: 'seller', verification_status: 'VERIFIED', created_by: 'user-a', deleted_at: new Date().toISOString(),
  });
  const { parsed } = await exportAndParse(TEMPLATE_TYPE, tenantACaller, client);
  assert.deepEqual(ids(parsed.sheets.TRADE_PROFILES, 'TRADE_PROFILE_ID'), ['TP-A']);
});

// 6. A non-privileged caller with NO tenant sees only rows they created/own — never a leak.
test('untenanted non-privileged caller is scoped to owned rows', async () => {
  const client = createMockSupabase({
    diaspora_trade_profiles: [
      { id: 'TP-X', tenant_id: null, user_id: 'owner-x', country: 'Japan', city: 'Tokyo', role_type: 'seller', verification_status: 'VERIFIED', created_by: 'owner-x', deleted_at: null },
      { id: 'TP-Y', tenant_id: null, user_id: 'owner-y', country: 'UAE', city: 'Dubai', role_type: 'seller', verification_status: 'VERIFIED', created_by: 'owner-y', deleted_at: null },
    ],
    diaspora_import_orders: [],
    diaspora_trade_documents: [],
  });
  const ownerX = { id: 'owner-x', userId: 'owner-x', role: 'dealer', platformRole: 'dealer', tenantId: null };
  const { parsed } = await exportAndParse(TEMPLATE_TYPE, ownerX, client);
  assert.deepEqual(ids(parsed.sheets.TRADE_PROFILES, 'TRADE_PROFILE_ID'), ['TP-X']);
  assert.equal(everyCellValue(parsed).includes('TP-Y'), false);
});

// 7. Caller-supplied redactFields are honored in addition to the always-redacted PII set.
test('extra redactFields are applied on top of the always-redacted set', async () => {
  const client = seededClient();
  const { parsed } = await exportAndParse(TEMPLATE_TYPE, tenantACaller, client, { redactFields: ['CITY'] });
  const profileA = parsed.sheets.TRADE_PROFILES.find((row) => row.TRADE_PROFILE_ID === 'TP-A');
  assert.equal(profileA.CITY, '[REDACTED]');
  assert.equal(profileA.COUNTRY, 'Japan');
});

// 8. Guardrails: unknown template rejected; missing user context rejected.
test('unknown template type and missing user context are rejected', async () => {
  await assert.rejects(
    () => exportWorkbookFromDatabase('not-a-template', adminCaller, { supabaseClient: seededClient() }),
    ValidationError,
  );
  await assert.rejects(
    () => exportWorkbookFromDatabase(TEMPLATE_TYPE, {}, { supabaseClient: seededClient() }),
    UnauthorizedError,
  );
});
