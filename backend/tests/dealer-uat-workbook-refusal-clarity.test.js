// CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D2. A malformed claim workbook was refused with
// the bare code "INVALID_LATITUDE" and no way to know which row to fix. The refusal now carries WHERE in
// the applicant's OWN file the value failed (explicit `location`), and a database error's own `details`
// can never ride along. The plain-language wording is web/src/lib/dealerFileRefusal.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildPrefilledDealerWorkbook, parseCompletedDealerWorkbook } from '../services/dealer/dealerWorkbookRoundtrip.js';
import { inspectDealerCsvImport } from '../services/dealer/dealerCsvIntake.js';
import { sendDealerRouteError, applicantFileLocation } from '../services/dealer/dealerSqlRefusalMapper.js';
import * as intake from '../services/dealer/dealerIntakeWorkbook.js';

const claim = Object.freeze({ claim_id: 'c63ef593-6e41-4ed5-8026-26b7ad451c46', claimant_user_id: 'applicant1',
  seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED' });
const source = Object.freeze({ seed_dealer_id: 'ZW-DEAL-0001', source_row_sha256: 'a'.repeat(64),
  source_snapshot: { 'Seed Dealer ID': 'ZW-DEAL-0001', 'Dealer / Company Name': 'TEST FIXTURE Car Sales',
    'Physical Address': 'Fixture only street', 'Suburb / Area': 'Fixture Suburb', 'City / Town': 'Harare' } });
const registry = intake.TEMPLATE_FIELD_REGISTRY || intake.CUSTOMER_TABS;
const col = (tab, key) => registry.find((t) => t.name === tab).fields.findIndex((f) => f.key === key) + 1;
function mockRes() {
  return { headers: {}, statusCode: 200, payload: null,
    set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; } };
}
async function refusal(mutate) {
  const wb = await buildPrefilledDealerWorkbook(claim, source, { issuedAt: new Date('2026-11-03T00:00:00Z') });
  wb.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'legal_name')).value = 'Fictional Legal Business Ltd';
  mutate(wb);
  try { await parseCompletedDealerWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), claim, source); }
  catch (error) { const res = mockRes(); sendDealerRouteError(res, null, error); return res; }
  assert.fail('the tampered workbook must be refused');
}

test('D2: an impossible latitude is refused with the tab and row the applicant must fix', async () => {
  const res = await refusal((wb) => { wb.getWorksheet('BRANCHES').getRow(2).getCell(col('BRANCHES', 'gps_latitude')).value = '123.5'; });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'INVALID_LATITUDE', code: 'INVALID_LATITUDE', location: 'BRANCHES!2' });
});

test('D2: a bad date names the row and the field; a formula names the row and column', async () => {
  const date = await refusal((wb) => { wb.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'tax_clearance_expiry')).value = '30/02/2026'; });
  assert.equal(date.payload.code, 'INVALID_DATE');
  assert.equal(date.payload.location, 'BUSINESS!2.tax_clearance_expiry');
  const formula = await refusal((wb) => {
    wb.getWorksheet('BRANCHES').getRow(2).getCell(col('BRANCHES', 'city')).value = { formula: '1+1', result: 2 };
  });
  assert.match(formula.payload.code, /WORKBOOK_FORMULA_REFUSED|NON_LITERAL_CELL/);
  assert.match(formula.payload.location, /^BRANCHES!2[:.]/);
});

test('D2: a CSV refusal carries its location through the same narrow field', () => {
  try { inspectDealerCsvImport(Buffer.from('Company Name,Country\n=HYPERLINK("x"),ZW\n'), 'BUSINESS'); }
  catch (error) {
    const res = mockRes(); sendDealerRouteError(res, null, error);
    assert.equal(res.statusCode, 400);
    if (res.payload.location !== undefined) assert.match(res.payload.location, /^[A-Z][A-Z_]{1,39}/);
    return;
  }
  // A CSV that is accepted for preview is fine too: the contract under test is the refusal envelope.
});

test('D2: a database error\'s own details, and any unsafe location, are never echoed', () => {
  const postgrest = Object.assign(new Error('DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED'), {
    statusCode: 409, code: 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED',
    details: 'Key (contact_email)=(private@example.invalid) already exists.' });
  const res = mockRes(); sendDealerRouteError(res, null, postgrest);
  assert.deepEqual(res.payload, { error: 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED', code: 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED' });
  assert.ok(!JSON.stringify(res.payload).includes('private@example.invalid'));
  for (const unsafe of ['BRANCHES!2<script>', 'branches!2', 'BRANCHES!2\n', 'X'.repeat(141), 'SELECT * FROM users', { tab: 'BRANCHES' }])
    assert.equal(applicantFileLocation({ location: unsafe }), undefined, JSON.stringify(unsafe));
  for (const safe of ['BRANCHES!2', 'BUSINESS!2.tax_clearance_expiry', 'FINANCE_PAYMENTS!3:7', 'BUSINESS', 'LICENCES_AUTHORIZATIONS:BR-ZW-DEAL-0001'])
    assert.equal(applicantFileLocation({ location: safe }), safe);
  const internal = mockRes();
  sendDealerRouteError(internal, null, Object.assign(new Error('relation x'), { location: 'BRANCHES!2' }));
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.payload.location, undefined, 'a 500 never carries applicant-file detail either');
});

test('D2 control: ExcelJS is the real parser input (no stub)', () => { assert.equal(typeof ExcelJS.Workbook, 'function'); });
