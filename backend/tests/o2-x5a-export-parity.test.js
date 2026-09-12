/**
 * O2-X5A — engine parity (B2) + server-sourced export (B9).
 *
 * Parity: a diaspora template passed as a STRING and as its own template OBJECT
 * produce content-identical workbooks — the generalization changed nothing.
 * (Raw bytes are zip-timestamp nondeterministic, so content is the contract.)
 * Export: database-sourced, caller-scoped, redacted by default; caller-supplied
 * rows have no path in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { generateTemplate, parseWorkbook } from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import { getXlsxTemplate } from '../constants/diaspora/diasporaWorkbookTemplates.js';
import { exportVehicleWorkbookFromDatabase } from '../services/workbook/workbookDbExportService.js';
import { buildVehicleWorkbookTemplate, VEHICLE_TEMPLATE_KEYS } from '../constants/workbook/workbookFieldRegistry.js';

const db = {
  vehicles: [
    {
      vin: 'JT123456789012345', current_seller_id: 'seller-1', make: 'Toyota', model: 'Hilux', year: 2018,
      color: 'White', mileage: 85000, body_style: 'Pickup', seller_stated_condition: 'Used', fuel_type: 'Diesel',
      transmission: 'Automatic', drivetrain: 'RWD', engine_number: 'ENG-SECRET-1', chassis_number: 'CHS-SECRET-1',
      registration_status: 'customs_cleared_cvr_pending', price: 15500, currency: 'USD', listing_city: 'Harare',
      listing_province: 'Harare Metropolitan', seller_description: 'A fine truck with a fully honest description that is long enough.',
      seller_features: ['Air conditioning'], listing_location_visibility: 'province_only', public_seller_display_enabled: false,
      seller_accident_disclosure: { state: 'yes', events: [{ approx_date: '2023', damage_area: 'front-left wing' }] },
      seller_insurance_disclosure: { state: 'insured', insurer_name: 'Old Mutual' },
      seller_finance_disclosure: { state: 'cleared', finance_type: 'bank_loan', lender_name: 'CBZ' },
    },
    { vin: 'ZZ999999999999999', current_seller_id: 'someone-else', make: 'Nissan', model: 'Navara', year: 2020 },
  ],
  listing_images: [
    { vin: 'JT123456789012345', image_url: 'https://x.test/front.jpg', photo_label: 'Front', is_primary: true, display_order: 0 },
  ],
  dealer_profiles: [{ id: 'dp-1', user_id: 'dealer-1', legal_name: 'Moyo Motors (Pvt) Ltd', trading_name: 'Moyo Motors', operating_country: 'Zimbabwe' }],
  dealer_branches: [{ id: 'b1', dealer_id: 'dp-1', name: 'Harare CBD', address: '12 Samora Machel Ave' }],
};

function builder(table) {
  const filters = [];
  const api = {
    select() { return api; },
    eq(column, value) { filters.push({ op: 'eq', column, value }); return api; },
    in(column, value) { filters.push({ op: 'in', column, value }); return api; },
    limit() { return api; },
    then(resolve) {
      const rows = (db[table] || []).filter((row) => filters.every((f) =>
        f.op === 'eq' ? row[f.column] === f.value : f.value.includes(row[f.column])));
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}
const mockClient = { from: (table) => builder(table) };

test('B2 parity: a diaspora template as string vs as its own object generates content-identical workbooks', async () => {
  // NOTE: raw .xlsx bytes are nondeterministic (zip entry timestamps) — even two
  // string-typed calls differ at the byte level. The parity contract is CONTENT:
  // identical sheets, headers, rows and instructions. Behavior is additionally
  // pinned by the unmodified diaspora-workbook-xlsx suite staying green.
  const context = { now: '2026-09-04T00:00:00.000Z' };
  for (const templateType of ['buyer', 'seller', 'supplier', 'enterprise', 'container_reservation']) {
    const asString = await generateTemplate(templateType, context);
    const asObject = await generateTemplate(getXlsxTemplate(templateType), context);
    const template = getXlsxTemplate(templateType);
    const parsedString = await parseWorkbook(asString, { templateType });
    const parsedObject = await parseWorkbook(asObject, { templateType: template });
    assert.deepEqual(parsedObject.sheets, parsedString.sheets, `${templateType} sheets identical`);
    assert.equal(parsedObject.templateType, parsedString.templateType);
    const [wbA, wbB] = await Promise.all([
      new ExcelJS.Workbook().xlsx.load(asString),
      new ExcelJS.Workbook().xlsx.load(asObject),
    ]);
    assert.deepEqual(wbB.worksheets.map((ws) => ws.name), wbA.worksheets.map((ws) => ws.name));
    const rowsOf = (wb) => {
      const rows = [];
      wb.getWorksheet('Instructions').eachRow((row) => rows.push([row.getCell(1).value, row.getCell(2).value]));
      return rows;
    };
    assert.deepEqual(rowsOf(wbB), rowsOf(wbA), `${templateType} instructions identical`);
  }
});

test('export is DB-sourced and caller-scoped: only my vehicles; engine/chassis redacted by default; labels humanized', async () => {
  const result = await exportVehicleWorkbookFromDatabase(
    VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES, { id: 'seller-1', role: 'owner' }, { supabaseClient: mockClient, context: { now: '2026-09-04T00:00:00Z' } });
  assert.equal(result.vehicleCount, 1, 'the other seller\'s vehicle is not mine to export');
  assert.ok(result.redactedHeaders.includes('Engine number'));

  const template = buildVehicleWorkbookTemplate(VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES);
  const parsed = await parseWorkbook(result.buffer, { templateType: template });
  const vehicleRow = parsed.sheets.VEHICLES[0];
  assert.equal(vehicleRow['VIN / Vehicle Identifier'], 'JT123456789012345');
  assert.equal(vehicleRow['Registration stage'], 'Customs cleared — local registration pending', 'canonical value exports as its human label');
  assert.equal(vehicleRow['Engine number'], '[REDACTED]');
  assert.equal(vehicleRow['Chassis number'], '[REDACTED]');
  const listingRow = parsed.sheets.LISTINGS[0];
  assert.equal(listingRow['Who can see the vehicle location?'], 'Show my province only, not my city');
  const accidentRow = parsed.sheets.ACCIDENT_HISTORY[0];
  assert.equal(accidentRow['Has this vehicle been in an accident?'], 'Yes — it has been in an accident');
  assert.equal(parsed.sheets.MEDIA[0]['Photo web address (http/https)'], 'https://x.test/front.jpg');
  assert.equal(parsed.sheets.EVIDENCE_NOTES.length, 0, 'evidence links never export');
});

test('dealer export adds BUSINESS + BRANCHES from the caller\'s OWN dealer application', async () => {
  db.vehicles.push({ vin: 'JD111111111111111', current_seller_id: 'dealer-1', make: 'Mazda', model: 'BT-50', year: 2019 });
  const result = await exportVehicleWorkbookFromDatabase(
    VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY, { id: 'dealer-1', role: 'dealer' }, { supabaseClient: mockClient, context: { now: '2026-09-04T00:00:00Z' } });
  const template = buildVehicleWorkbookTemplate(VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY);
  const parsed = await parseWorkbook(result.buffer, { templateType: template });
  assert.equal(parsed.sheets.BUSINESS[0]['Legal business name'], 'Moyo Motors (Pvt) Ltd');
  assert.equal(parsed.sheets.BRANCHES[0]['Branch name'], 'Harare CBD');
  assert.equal(parsed.sheets.VEHICLES.length, 1);
});

test('there is no caller-supplied-rows path: the export signature takes only templateKey + actor + options', () => {
  assert.equal(exportVehicleWorkbookFromDatabase.length, 1); // (templateKey, actor = {}, options = {}) — defaults don't count
});
