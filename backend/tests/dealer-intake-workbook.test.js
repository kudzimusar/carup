import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  DEALER_INTAKE_VERSION, CUSTOMER_TABS, TEMPLATE_FIELD_REGISTRY,
  SOURCE_40_FIELD_DISPOSITIONS, safeXlsxText, exportBlankDealerIntakeXlsx,
} from '../services/dealer/dealerIntakeWorkbook.js';

test('D3 customer workbook is twelve domain tabs, never twenty internal research tabs', async () => {
  const bytes = await exportBlankDealerIntakeXlsx();
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.length > 5000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map(s=>s.name),CUSTOMER_TABS.map(t=>t.name));
  assert.equal(workbook.worksheets.length,12);
  assert.equal(workbook.getWorksheet('README - Instructions').getCell(2,2).value,DEALER_INTAKE_VERSION);
  for (const name of ['Verification Tracker','Evidence Register','DEV 8 - Seed Catalogue','Buyer Feedback Log']) {
    assert.equal(workbook.getWorksheet(name),undefined);
  }
});

test('D3 40/40 original intake source column labels have explicit disposition and real field destination', () => {
  assert.equal(SOURCE_40_FIELD_DISPOSITIONS.length,40);
  const known = new Set(TEMPLATE_FIELD_REGISTRY.flatMap(t=>t.fields.map(f=>t.name+'.'+f.key)));
  for (const [original, destination, disposition] of SOURCE_40_FIELD_DISPOSITIONS) {
    assert.ok(original.length > 0);
    assert.ok(disposition.length > 0);
    if (destination) assert.ok(known.has(destination),destination);
  }
});

test('D3 customer workbook never exposes reviewer, verified, merchant or paid flags as editable fields', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportBlankDealerIntakeXlsx());
  const headers = workbook.worksheets.map(w=>w.getRow(1).values.slice(1).join(' ')).join(' ').toLowerCase();
  for (const key of ['reviewer_verified','reviewer_decision','tenant_id',
    'verified payment','verified buyer count','approved plan','reviewer notes']) {
    assert.ok(!headers.includes(key),'Unexpected authority column '+key);
  }
});

test('D3 template is blank and cannot auto-publish private source facts', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportBlankDealerIntakeXlsx());
  const business = workbook.getWorksheet('BUSINESS');
  assert.equal(business.getRow(2).getCell(4).value, ''); // legal name has no fake source prefill
  const branch = workbook.getWorksheet('BRANCHES');
  assert.equal(branch.getRow(2).getCell(4).value, '');
});

test('D3 research candidate cell escapes spreadsheet formula injection', () => {
  for (const value of ['=cmd|calc','+SUM(1,2)','-1+2','@foobar','\t=RISK']) {
    const escaped = safeXlsxText(value);
    assert.equal(escaped[0],"'");
  }
  assert.equal(safeXlsxText('Harare'),'Harare');
});
