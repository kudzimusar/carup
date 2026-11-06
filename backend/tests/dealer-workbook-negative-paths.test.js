// CARUP-DEALER-ONB-001-LR01-R4 P0-4: executed proof for DEV 7 T07, T08 and T09 against the real
// workbook/CSV parsers. A fictional claim-bound workbook is built by the real exporter, then tampered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { buildPrefilledDealerWorkbook, parseCompletedDealerWorkbook } from '../services/dealer/dealerWorkbookRoundtrip.js';
import { inspectDealerCsvImport, stageConfirmedDealerCsv } from '../services/dealer/dealerCsvIntake.js';
import * as intake from '../services/dealer/dealerIntakeWorkbook.js';

const claim = Object.freeze({ claim_id: 'c63ef593-6e41-4ed5-8026-26b7ad451c46', claimant_user_id: 'applicant1',
  seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED' });
const source = Object.freeze({ seed_dealer_id: 'ZW-DEAL-0001', source_row_sha256: 'a'.repeat(64),
  source_snapshot: { 'Seed Dealer ID': 'ZW-DEAL-0001', 'Dealer / Company Name': 'TEST FIXTURE Car Sales',
    'Physical Address': 'Fixture only street', 'Suburb / Area': 'Fixture Suburb', 'City / Town': 'Harare',
    'Phone / WhatsApp': '+263 FIXTURE', 'Website / Source URL': 'https://example.invalid' } });
const registry = intake.TEMPLATE_FIELD_REGISTRY || intake.CUSTOMER_TABS;
const col = (tab, key) => {
  const index = registry.find((t) => t.name === tab).fields.findIndex((f) => f.key === key);
  assert.ok(index >= 0, tab + '.' + key + ' exists in the template');
  return index + 1;
};
async function workbook() {
  const wb = await buildPrefilledDealerWorkbook(claim, source, { issuedAt: new Date('2026-11-03T00:00:00Z') });
  wb.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'legal_name')).value = 'Fictional Legal Business Ltd';
  return wb;
}
const bytesOf = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());
const refuses = async (wb, code) => assert.rejects(parseCompletedDealerWorkbook(await bytesOf(wb), claim, source),
  (e) => String(e.message).includes(code), code);

test('control: the untampered fictional workbook parses and carries no authority field', async () => {
  const { document, has_authority_writes } = await parseCompletedDealerWorkbook(await bytesOf(await workbook()), claim, source);
  assert.equal(has_authority_writes, false);
  assert.equal(document.applicant_verified, false);
  assert.equal(document.compliance_approved, false);
  const keys = JSON.stringify(document.tab_rows);
  for (const forbidden of ['"tenant_id"', '"verified"', '"paid"', '"payment_status"', '"role"']) {
    assert.ok(!keys.includes(forbidden), forbidden + ' never appears in a parsed application');
  }
});

test('T07: bytes changed after the mapping was previewed are refused at confirmation', async () => {
  const previewed = Buffer.from('Company Name,Country\nFictional Group Ltd,ZW\n');
  const preview = inspectDealerCsvImport(previewed, 'BUSINESS');
  assert.equal(preview.csv_sha256, createHash('sha256').update(previewed).digest('hex'));
  const changed = Buffer.from('Company Name,Country\nFictional Group Ltd (edited),ZW\n');
  await assert.rejects(stageConfirmedDealerCsv({ bytes: changed, tab: 'BUSINESS',
    approvedMapping: { 'Company Name': 'legal_name', Country: 'operating_country' },
    acknowledged: true, expectedSha: preview.csv_sha256, claim, source }), /CSV_MAPPING_CONFIRMATION_OR_CHECKSUM_REQUIRED/);
});

test('T08: forged tenant_id/verified/status/paid cannot enter through the workbook', async () => {
  const widened = await workbook();
  const business = widened.getWorksheet('BUSINESS');
  const extra = registry.find((t) => t.name === 'BUSINESS').fields.length + 1;
  business.getRow(1).getCell(extra).value = 'tenant_id';
  business.getRow(2).getCell(extra).value = 'someone-elses-tenant';
  await refuses(widened, 'WORKBOOK_ROW_OR_COLUMN_LIMIT');
  const relabelled = await workbook();
  relabelled.getWorksheet('BUSINESS').getRow(1).getCell(col('BUSINESS', 'legal_name')).value = 'verified';
  await refuses(relabelled, 'WORKBOOK_HEADER_DRIFT');
  const injected = await workbook();
  injected.addWorksheet('PAYMENT_STATUS').getRow(1).getCell(1).value = 'paid';
  await refuses(injected, 'UNEXPECTED_WORKBOOK_TABS');
  const otherClaim = await workbook();
  otherClaim.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'claim_reference')).value =
    '00000000-0000-4000-8000-000000000000';
  await refuses(otherClaim, 'WORKBOOK_CLAIM_REFERENCE_MISMATCH');
});

test('T09: invalid dates, non-geographic GPS and unresolved branch keys are refused', async () => {
  const badDate = await workbook();
  badDate.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'tax_clearance_expiry')).value = '2026-02-30';
  await refuses(badDate, 'INVALID_CALENDAR_DATE');
  const badFormat = await workbook();
  badFormat.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'tax_clearance_expiry')).value = '30/02/2026';
  await refuses(badFormat, 'INVALID_DATE');
  const badGps = await workbook();
  badGps.getWorksheet('BRANCHES').getRow(2).getCell(col('BRANCHES', 'gps_latitude')).value = '91';
  await refuses(badGps, 'INVALID_LATITUDE');
  const badLongitude = await workbook();
  badLongitude.getWorksheet('BRANCHES').getRow(2).getCell(col('BRANCHES', 'gps_longitude')).value = '-181';
  await refuses(badLongitude, 'INVALID_LONGITUDE');
  const orphan = await workbook();
  const licences = orphan.getWorksheet('LICENCES_AUTHORIZATIONS');
  licences.getRow(2).getCell(col('LICENCES_AUTHORIZATIONS', 'branch_ref')).value = 'BRANCH-THAT-DOES-NOT-EXIST';
  await refuses(orphan, 'ORPHAN_BRANCH_REFERENCE');
  const duplicate = await workbook();
  const branches = duplicate.getWorksheet('BRANCHES');
  const firstRef = branches.getRow(2).getCell(col('BRANCHES', 'branch_ref')).value;
  branches.getRow(3).getCell(col('BRANCHES', 'branch_ref')).value = firstRef;
  branches.getRow(3).getCell(col('BRANCHES', 'branch_name')).value = 'Fictional duplicate branch';
  await refuses(duplicate, 'DUPLICATE_OR_MISSING_BRANCH_REF');
});
