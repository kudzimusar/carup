// CARUP-DEALER-1.0-VISUAL-UAT-R1 (Owner UAT defect): a workbook downloaded from Google Sheets carries
// ~1,000 rows x 26 columns of formatted-but-empty cells on every tab and used to be refused outright.
// Formatting-only cells are now ignored; real data beyond the limits is still refused, by tab, with the
// size found and the maximum accepted; a physically huge tab is refused before any cell is examined.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrefilledDealerWorkbook, parseCompletedDealerWorkbook,
  usedWorksheetExtent, workbookColumnLetter } from '../services/dealer/dealerWorkbookRoundtrip.js';
import * as intake from '../services/dealer/dealerIntakeWorkbook.js';

const claim = Object.freeze({ claim_id: 'c63ef593-6e41-4ed5-8026-26b7ad451c46', claimant_user_id: 'applicant1',
  seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED' });
const source = Object.freeze({ seed_dealer_id: 'ZW-DEAL-0001', source_row_sha256: 'a'.repeat(64),
  source_snapshot: { 'Seed Dealer ID': 'ZW-DEAL-0001', 'Dealer / Company Name': 'TEST FIXTURE Car Sales',
    'Physical Address': 'Fixture only street', 'Suburb / Area': 'Fixture Suburb', 'City / Town': 'Harare',
    'Phone / WhatsApp': '+263 FIXTURE', 'Website / Source URL': 'https://example.invalid' } });
const registry = intake.TEMPLATE_FIELD_REGISTRY;
const fields = (tab) => registry.find((t) => t.name === tab).fields;
const col = (tab, key) => fields(tab).findIndex((f) => f.key === key) + 1;
async function workbook() {
  const wb = await buildPrefilledDealerWorkbook(claim, source, { issuedAt: new Date('2026-11-03T00:00:00Z') });
  wb.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'legal_name')).value = 'Fictional Legal Business Ltd';
  return wb;
}
// What Google Sheets does on export: every tab 1,000 rows x 26 columns, empty cells carrying formatting.
function googleSheetsExpansion(wb) {
  for (const sheet of wb.worksheets) {
    for (let c = 1; c <= 26; c += 1) sheet.getColumn(c).width = 14;
    for (const r of [3, 120, 251, 600, 1000]) {
      for (const c of [1, 9, 26]) {
        const cell = sheet.getRow(r).getCell(c);
        if (cell.value == null) { cell.numFmt = '@'; cell.style = { ...cell.style, font: { name: 'Arial', size: 10 } }; }
      }
    }
    sheet.getRow(1000).getCell(26).value = '   '; // whitespace-only is not data
  }
  return wb;
}
const bytesOf = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());
const refusal = async (wb) => {
  try { await parseCompletedDealerWorkbook(await bytesOf(wb), claim, source); } catch (e) { return e; }
  assert.fail('the workbook was expected to be refused');
};

test('Google Sheets 1,000 x 26 formatting expansion parses exactly like the clean workbook', async () => {
  const clean = await parseCompletedDealerWorkbook(await bytesOf(await workbook()), claim, source);
  const expandedBook = googleSheetsExpansion(await workbook());
  // The physical size really is the Google Sheets size…
  const branches = expandedBook.getWorksheet('BRANCHES');
  const reread = await (async () => { const ExcelJS = (await import('exceljs')).default; const w = new ExcelJS.Workbook();
    await w.xlsx.load(await bytesOf(expandedBook)); return w; })();
  assert.equal(reread.getWorksheet('BRANCHES').rowCount, 1000);
  assert.ok(reread.getWorksheet('BRANCHES').columnCount >= 26);
  assert.ok(branches.columnCount > fields('BRANCHES').length, 'more columns than the BRANCHES contract');
  // …yet only real values count.
  assert.deepEqual(usedWorksheetExtent(reread.getWorksheet('BRANCHES')),
    usedWorksheetExtent((await workbook()).getWorksheet('BRANCHES')));
  const expanded = await parseCompletedDealerWorkbook(await bytesOf(expandedBook), claim, source);
  assert.deepEqual(expanded.document.tab_rows, clean.document.tab_rows);
  assert.deepEqual(expanded.record_counts, clean.record_counts);
});

test('real data beyond 249 data rows is refused with the tab, rows found and the maximum', async () => {
  const wb = googleSheetsExpansion(await workbook());
  wb.getWorksheet('BRANCHES').getRow(300).getCell(col('BRANCHES', 'branch_name')).value = 'A real branch on row 300';
  const e = await refusal(wb);
  assert.equal(e.code, 'WORKBOOK_TOO_MANY_DATA_ROWS');
  assert.equal(e.location, 'BRANCHES:rows=299;max=249');
});

test('a value in a column outside the tab is refused with the column letter and the last allowed column', async () => {
  const wb = googleSheetsExpansion(await workbook());
  const extra = fields('BRANCHES').length + 2;
  wb.getWorksheet('BRANCHES').getRow(4).getCell(extra).value = 'note typed to the right';
  const e = await refusal(wb);
  assert.equal(e.code, 'WORKBOOK_EXTRA_COLUMNS_WITH_DATA');
  assert.equal(e.location, `BRANCHES:column=${workbookColumnLetter(extra)};max=${workbookColumnLetter(fields('BRANCHES').length)}`);
});

test('a formula far below the data still counts as data (never silently dropped)', async () => {
  const wb = googleSheetsExpansion(await workbook());
  wb.getWorksheet('FINANCE_PAYMENTS').getRow(900).getCell(1).value = { formula: '1+1' };
  const e = await refusal(wb);
  assert.equal(e.code, 'WORKBOOK_TOO_MANY_DATA_ROWS');
  assert.equal(e.location, 'FINANCE_PAYMENTS:rows=899;max=249');
});

test('a physically huge tab is refused before its cells are examined', async () => {
  const wb = await workbook();
  wb.getWorksheet('DIGITAL_MEDIA').getRow(20001).getCell(1).numFmt = '@';
  const e = await refusal(wb);
  assert.equal(e.code, 'WORKBOOK_SHEET_TOO_LARGE');
  assert.match(e.location, /^DIGITAL_MEDIA:size=20001x\d+;max=20000x200$/);
});

test('an e-mail typed or autofilled into the registration number is refused at that cell', async () => {
  const wb = await workbook();
  wb.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'registration_number')).value = 'activator@example.invalid';
  const e = await refusal(wb);
  assert.equal(e.code, 'INVALID_REGISTRATION_NUMBER');
  assert.equal(e.location, 'BUSINESS!2.registration_number');
  const ok = await workbook();
  ok.getWorksheet('BUSINESS').getRow(2).getCell(col('BUSINESS', 'registration_number')).value = '1234/2010 (Pvt) Ltd-A';
  await parseCompletedDealerWorkbook(await bytesOf(ok), claim, source);
});
