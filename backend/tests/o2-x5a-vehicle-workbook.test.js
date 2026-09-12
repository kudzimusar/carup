/**
 * O2-X5A — Seller/Dealer vehicle workbook: template → inspect → mapping
 * confirmation → dry run → explicit confirm → execution through the canonical
 * create contract (injected dispatch), receipts, recent imports.
 *
 * Pinned laws: version gate refuses old templates by name; a data sheet without
 * a live checksum-bound confirmation refuses the dry run; forbidden targets are
 * refused; deterministic (registry) mapping resolves template-generated files
 * with AI NEVER invoked; execution replays ONLY the canonical payload with a
 * STABLE per-vehicle client_submission_id; uploader scoping fails closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { generateTemplate } from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import {
  VEHICLE_TEMPLATE_KEYS,
  buildVehicleWorkbookTemplate,
} from '../constants/workbook/workbookFieldRegistry.js';
import {
  inspectVehicleWorkbook,
  confirmVehicleWorkbookMappings,
  runVehicleWorkbookDryRun,
  executeVehicleWorkbookImport,
  listRecentVehicleImports,
  buildCreatePayload,
  validateVehicleWorkbookPayload,
} from '../services/workbook/vehicleWorkbookImportService.js';

/* ── chainable mock supabase over an in-memory db ─────────────────────────── */
const db = { dealer_workbook_mapping_confirmations: [], diaspora_workbook_import_batches: [], diaspora_workbook_import_rows: [], diaspora_workbook_import_receipts: [], vehicles: [], audit_logs: [] };
let seq = 1;

function matches(row, filters) {
  return filters.every(({ op, column, value }) => {
    if (op === 'eq') return row[column] === value;
    if (op === 'in') return value.includes(row[column]);
    return true;
  });
}

function builder(table) {
  const state = { filters: [], insertRows: null, updatePatch: null, order: null, limit: null, single: false };
  const api = {
    select() { return api; },
    eq(column, value) { state.filters.push({ op: 'eq', column, value }); return api; },
    in(column, value) { state.filters.push({ op: 'in', column, value }); return api; },
    order(column, opts = {}) { state.order = { column, ascending: opts.ascending !== false }; return api; },
    limit(n) { state.limit = n; return api; },
    single() { state.single = true; return api; },
    insert(rows) {
      state.insertRows = Array.isArray(rows) ? rows : [rows];
      return api;
    },
    update(patch) { state.updatePatch = patch; return api; },
    then(resolve) {
      if (state.insertRows) {
        const inserted = state.insertRows.map((row) => ({ id: `${table}-${seq}`, seq: seq++, created_at: new Date(2026, 8, 4, 0, 0, seq).toISOString(), ...row }));
        (db[table] ||= []).push(...inserted);
        return resolve({ data: state.single ? inserted[0] : inserted, error: null });
      }
      if (state.updatePatch) {
        const rows = (db[table] || []).filter((row) => matches(row, state.filters));
        rows.forEach((row) => Object.assign(row, state.updatePatch));
        return resolve({ data: rows, error: null });
      }
      let rows = (db[table] || []).filter((row) => matches(row, state.filters));
      if (state.order) rows = rows.slice().sort((a, b) => (a[state.order.column] < b[state.order.column] ? 1 : -1) * (state.order.ascending ? -1 : 1));
      if (state.limit) rows = rows.slice(0, state.limit);
      return resolve({ data: state.single ? (rows[0] ?? null) : rows, error: state.single && !rows[0] ? { message: 'not found' } : null });
    },
  };
  return api;
}
const mockClient = { from: (table) => builder(table) };

function resetDb() {
  for (const key of Object.keys(db)) db[key] = [];
  seq = 1;
}

const seller = { id: 'seller-1', role: 'owner' };
const aiMustNotRun = async () => { throw new Error('AI must not be called for template-generated headers'); };

/* ── helpers: build a filled workbook from the real template ──────────────── */
async function filledWorkbook({ vin = 'JT123456789012345', mutate } = {}) {
  const template = buildVehicleWorkbookTemplate(VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES);
  const buffer = await generateTemplate(template, { now: '2026-09-04T00:00:00Z' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const put = (sheetName, rowIndex, values) => {
    const sheet = workbook.getWorksheet(sheetName);
    const headers = sheet.getRow(1).values.slice(1);
    const row = sheet.getRow(rowIndex);
    for (const [header, value] of Object.entries(values)) {
      const col = headers.indexOf(header) + 1;
      if (col > 0) row.getCell(col).value = value;
    }
    row.commit();
  };

  // Overwrite the EXAMPLE row (row 3) with real data.
  put('VEHICLES', 3, {
    'VIN / Vehicle Identifier': vin, Make: 'Toyota', Model: 'Hilux', Year: 2018,
    Color: 'White', 'Mileage (km)': 85000, 'Body style': 'Pickup', 'Condition (your words)': 'Used',
    'Fuel type': 'Diesel', Transmission: 'Auto', // alias — must normalize deterministically
    'Registration stage': 'Customs cleared — local registration pending',
  });
  put('LISTINGS', 3, {
    'VIN / Vehicle Identifier': vin, 'Asking price': 15500, Currency: 'USD', City: 'Harare',
    Description: 'Well maintained single-owner Hilux, full service history, new tyres, ready for local registration transfer.',
    'Who can see the vehicle location?': 'Show my province only, not my city',
    'Show seller name publicly?': 'No',
  });
  put('ACCIDENT_HISTORY', 3, {
    'VIN / Vehicle Identifier': vin,
    'Has this vehicle been in an accident?': 'No known accident history',
  });
  put('DISCLOSURES', 3, {
    'VIN / Vehicle Identifier': vin, 'Currently insured?': "I don't know",
    'Finance / lender interest?': 'No finance or lender interest that I know of',
  });
  put('MEDIA', 3, {
    'VIN / Vehicle Identifier': vin, 'Photo web address (http/https)': 'https://example.com/front.jpg',
    'What the photo shows': 'Front three-quarter', 'Cover photo? (one per vehicle)': 'Yes',
  });
  if (mutate) mutate(workbook, put);
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function confirmAllSheets(buffer, inspection) {
  const sheets = inspection.sheets
    .filter((sheet) => sheet.row_count > 0)
    .map((sheet) => ({
      sheet_name: sheet.sheet_name,
      mappings: sheet.proposals.map((proposal) => ({ source: proposal.source, target: proposal.proposed_target || 'ignore' })),
    }));
  return confirmVehicleWorkbookMappings(mockClient, seller, {
    templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES,
    workbookChecksum: inspection.checksum,
    sheets,
  }, {});
}

/* ── tests ────────────────────────────────────────────────────────────────── */

test('inspect: template-generated file resolves every header deterministically (registry match; AI never called)', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  const inspection = await inspectVehicleWorkbook(
    { file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, { ai: aiMustNotRun });
  assert.equal(inspection.schema_version, '2026.09.x5a.vehicle-v1');
  const dataSheets = inspection.sheets.filter((sheet) => sheet.row_count > 0);
  assert.equal(dataSheets.length, 5);
  for (const sheet of dataSheets) {
    for (const proposal of sheet.proposals) {
      assert.equal(proposal.provider, 'deterministic', `${sheet.sheet_name}/${proposal.source}`);
      assert.equal(proposal.reason, 'registry_header_match');
    }
  }
});

test('version gate: a workbook stamped with an old template version is refused by name with the upgrade path', async () => {
  resetDb();
  const buffer = await filledWorkbook({
    mutate: (workbook) => {
      const instructions = workbook.getWorksheet('Instructions');
      instructions.eachRow((row) => {
        if (String(row.getCell(1).value) === 'schemaVersion') { row.getCell(2).value = '2025.01.obsolete-v0'; row.commit(); }
      });
    },
  });
  await assert.rejects(
    inspectVehicleWorkbook({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, {}),
    (error) => error.message.includes('TEMPLATE_VERSION_UNSUPPORTED') && error.message.includes('no longer supported'),
  );
});

test('mapping confirmation refuses forbidden targets: governed results and private banking keys', async () => {
  resetDb();
  for (const target of ['trust_score', 'verification_status', 'outstanding_balance', 'tenant_id']) {
    await assert.rejects(
      confirmVehicleWorkbookMappings(mockClient, seller, {
        templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES,
        workbookChecksum: 'a'.repeat(64),
        sheets: [{ sheet_name: 'VEHICLES', mappings: [{ source: 'Anything', target }] }],
      }, {}),
      (error) => /protected field/.test(error.message),
      `target ${target} must be refused`,
    );
  }
});

test('dry run without a live confirmation for these exact bytes refuses by name', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  await assert.rejects(
    runVehicleWorkbookDryRun({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller,
      { supabaseClient: mockClient, lookupExistingVins: async () => [] }),
    (error) => /MAPPING_CONFIRMATION_REQUIRED/.test(error.message),
  );
});

test('dry run: valid workbook validates, normalizes labels/aliases to canonical values, persists the batch in the EXISTING store', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  const inspection = await inspectVehicleWorkbook({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, { ai: aiMustNotRun });
  await confirmAllSheets(buffer, inspection);

  const dryRun = await runVehicleWorkbookDryRun(
    { file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller,
    { supabaseClient: mockClient, lookupExistingVins: async () => [], sourceFilename: 'stock.xlsx' });

  assert.equal(dryRun.canImport, true);
  assert.equal(dryRun.totals.acceptedVehicles, 1);
  assert.ok(dryRun.warnings.some((w) => w.code === 'VALUE_NORMALIZED' && w.message.includes('Auto')));

  assert.equal(db.diaspora_workbook_import_batches.length, 1);
  const batch = db.diaspora_workbook_import_batches[0];
  assert.equal(batch.template_type, 'seller_vehicles');
  assert.equal(batch.uploaded_by, 'seller-1');
  assert.equal(batch.import_status, 'VALIDATED');
  assert.equal(batch.checksum_sha256, dryRun.checksum);

  const row = db.diaspora_workbook_import_rows[0];
  const payload = row.normalized_payload;
  assert.equal(payload.transmission, 'Automatic'); // alias normalized
  assert.equal(payload.registration_status, 'customs_cleared_cvr_pending'); // label → canonical
  assert.equal(payload.location_visibility, 'province_only');
  assert.equal(payload.location, 'Harare');
  assert.equal(payload.public_seller_display_enabled, false);
  assert.deepEqual(payload.accident_disclosure, { state: 'no_known_accident_history' });
  assert.equal(payload.insurance_disclosure.state, 'unknown');
  assert.equal(payload.finance_disclosure.state, 'none_known');
  assert.equal(payload.images.length, 1);
  assert.equal(payload.images[0].is_primary, true);
  assert.ok(/^[0-9a-f-]{36}$/.test(payload.client_submission_id));
});

test('dry run blocks: an existing CarUp VIN is rejected — a bulk import never overrides a Passport', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  const inspection = await inspectVehicleWorkbook({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, { ai: aiMustNotRun });
  await confirmAllSheets(buffer, inspection);
  const dryRun = await runVehicleWorkbookDryRun(
    { file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller,
    { supabaseClient: mockClient, lookupExistingVins: async () => ['JT123456789012345'] });
  assert.equal(dryRun.canImport, false);
  assert.ok(dryRun.errors.some((e) => e.code === 'VEHICLE_ALREADY_EXISTS'));
  assert.equal(db.diaspora_workbook_import_batches[0].import_status, 'BLOCKED');
});

test('validation refuses fabrication-shaped input: markers ignored, unknown vocab errors, multiple covers, orphan child rows', async () => {
  const { errors, warnings, totals } = await validateVehicleWorkbookPayload({
    templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES,
    sheetRows: {
      VEHICLES: [{ vin: 'JT123456789012345', make: 'Toyota', model: 'Hilux', year: '2018', color: 'Chartreuse', mileage: 'N/A', body_style: 'Pickup', seller_stated_condition: 'Used', fuel_type: 'Diesel', transmission: 'Automatic' }],
      LISTINGS: [{ vin: 'JT123456789012345', price: '15500', currency: 'USD', listing_city: 'Harare', seller_description: 'A perfectly honest and sufficiently long description of the vehicle for the import to accept.' }],
      ACCIDENT_HISTORY: [],
      DISCLOSURES: [],
      MEDIA: [
        { vin: 'JT123456789012345', image_url: 'https://x.test/a.jpg', is_primary: 'Yes' },
        { vin: 'JT123456789012345', image_url: 'https://x.test/b.jpg', is_primary: 'Yes' },
        { vin: 'ZZ999999999999999', image_url: 'https://x.test/c.jpg' },
      ],
      EVIDENCE_NOTES: [],
    },
  }, { lookupExistingVins: async () => [] });

  assert.ok(warnings.some((w) => w.code === 'FALLBACK_MARKER_IGNORED'), 'N/A mileage is a marker, not data');
  assert.ok(errors.some((e) => e.code === 'REQUIRED_MISSING' && e.field === 'mileage'), 'marker leaves required mileage missing');
  assert.ok(errors.some((e) => e.code === 'VOCABULARY_MISMATCH' && e.field === 'color'));
  assert.ok(errors.some((e) => e.code === 'MULTIPLE_COVER_PHOTOS'));
  assert.ok(errors.some((e) => e.code === 'VIN_NOT_IN_VEHICLES'));
  assert.equal(totals.acceptedVehicles, 0);
});

test('execute: refuses without explicit confirm; replays the canonical payload once per vehicle; receipts land; batch becomes IMPORTED', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  const inspection = await inspectVehicleWorkbook({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, { ai: aiMustNotRun });
  await confirmAllSheets(buffer, inspection);
  const dryRun = await runVehicleWorkbookDryRun(
    { file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller,
    { supabaseClient: mockClient, lookupExistingVins: async () => [] });

  await assert.rejects(
    executeVehicleWorkbookImport({ batchId: dryRun.batchId, confirm: false }, seller, { supabaseClient: mockClient }),
    (error) => /CONFIRMATION_REQUIRED/.test(error.message),
  );

  const dispatched = [];
  const dispatch = async (routePath, method, body) => {
    dispatched.push({ routePath, method, body });
    return { status: 201, body: { vehicle: { id: 'veh-1', vin: body.vin } } };
  };
  const result = await executeVehicleWorkbookImport(
    { batchId: dryRun.batchId, confirm: true }, seller, { supabaseClient: mockClient, dispatch });

  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].routePath, '/api/vehicles/add');
  assert.equal(dispatched[0].body.vin, 'JT123456789012345');
  const receipts = db.diaspora_workbook_import_receipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].outcome, 'accepted');
  assert.equal(receipts[0].entity_type, 'vehicle');

  // Idempotency: a re-execute of the same batch replays the SAME client_submission_id.
  const firstSubmissionId = dispatched[0].body.client_submission_id;
  db.diaspora_workbook_import_batches[0].import_status = 'PARTIALLY_IMPORTED';
  await executeVehicleWorkbookImport({ batchId: dryRun.batchId, confirm: true }, seller, { supabaseClient: mockClient, dispatch });
  assert.equal(dispatched[1].body.client_submission_id, firstSubmissionId);
});

test('uploader scoping fails closed: another account cannot execute or list this batch', async () => {
  resetDb();
  const buffer = await filledWorkbook();
  const inspection = await inspectVehicleWorkbook({ file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller, { ai: aiMustNotRun });
  await confirmAllSheets(buffer, inspection);
  const dryRun = await runVehicleWorkbookDryRun(
    { file: buffer, templateKey: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES }, seller,
    { supabaseClient: mockClient, lookupExistingVins: async () => [] });

  const stranger = { id: 'other-1', role: 'owner' };
  await assert.rejects(
    executeVehicleWorkbookImport({ batchId: dryRun.batchId, confirm: true }, stranger, { supabaseClient: mockClient }),
    (error) => /not found/i.test(error.message),
  );
  const theirs = await listRecentVehicleImports(stranger, { supabaseClient: mockClient });
  assert.equal(theirs.length, 0);
  const mine = await listRecentVehicleImports(seller, { supabaseClient: mockClient });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].can_execute, true);
});

test('NO-RE-ENTRY PIN: every importable VEHICLES/LISTINGS field lands in the canonical create payload under the key the site reads', async () => {
  const group = {
    vin: 'JT123456789012345', rowIndex: 1,
    vehicle: {
      vin: 'JT123456789012345', make: 'Toyota', model: 'Hilux', year: 2018, color: 'White',
      mileage: 85000, body_style: 'Pickup', seller_stated_condition: 'Used', fuel_type: 'Diesel',
      transmission: 'Automatic', drivetrain: 'RWD', engine_number: 'EN1', chassis_number: 'CH1',
      generation: 'VIII', trim: 'SR5', registration_status: 'locally_registered', plate_number: 'ABX 1234',
      temp_plate_id: '', registration_country: 'Zimbabwe',
    },
    listing: {
      vin: 'JT123456789012345', price: 15500, currency: 'USD', listing_city: 'Harare',
      listing_province: 'Harare Metropolitan', listing_country: 'Zimbabwe',
      seller_description: 'A perfectly honest and sufficiently long description of the vehicle for the import to accept.',
      seller_features: ['Air conditioning', 'Tow bar'], location_visibility: 'public',
      public_seller_display_enabled: true,
    },
    accident: [{ approx_date: '2023', damage_area: 'front-left wing' }], accidentState: 'yes',
    disclosures: { insurance_state: 'insured', insurer_name: 'Old Mutual', finance_state: 'cleared', finance_type: 'bank_loan', lender_name: 'CBZ' },
    media: [{ row: { image_url: 'https://x.test/a.jpg', photo_label: 'Front', is_primary: true }, rowIndex: 1 }],
    evidence: [],
  };
  const payload = buildCreatePayload(group, '11111111-2222-4333-8444-555555555555');
  // The exact keys the certified create route destructures (server.js) — the same
  // columns SellVehicle/VehicleProfile read back, so nothing is re-typed on the site.
  for (const key of ['vin', 'make', 'model', 'year', 'color', 'mileage', 'body_style',
    'seller_stated_condition', 'fuel_type', 'transmission', 'drivetrain', 'engine_number',
    'chassis_number', 'generation', 'trim', 'registration_status', 'plate_number',
    'registration_country', 'price', 'currency', 'location', 'province', 'listing_country',
    'description', 'features', 'location_visibility', 'public_seller_display_enabled',
    'accident_disclosure', 'insurance_disclosure', 'finance_disclosure', 'images',
    'client_submission_id']) {
    assert.ok(payload[key] !== undefined, `create payload carries ${key}`);
  }
  assert.deepEqual(payload.accident_disclosure.events, [{ approx_date: '2023', damage_area: 'front-left wing' }]);
  assert.equal(payload.insurance_disclosure.insurer_name, 'Old Mutual');
  // And NEVER an authority outcome.
  for (const forbidden of ['trust_score', 'verification_status', 'publication_status', 'owner_id', 'current_seller_id', 'tenant_id']) {
    assert.ok(!(forbidden in payload), `${forbidden} never rides the import payload`);
  }
});
