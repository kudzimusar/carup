import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

import {
  assertAllowedSpreadsheet,
  normalizeFilename,
  neutralizeFormula,
  sha256Checksum,
  DEFAULT_LIMITS,
  XLSX_UPLOAD_MIME,
  XLSX_UPLOAD_EXTENSION,
} from '../services/diaspora/workbook/diasporaWorkbookUploadSecurity.js';
import {
  generateTemplate,
  parseWorkbook,
  exportWorkbook,
  XLSX_REFERENCE_SHEET_NAME,
  XLSX_INSTRUCTIONS_SHEET_NAME,
} from '../services/diaspora/workbook/diasporaWorkbookXlsxService.js';
import { getXlsxTemplate } from '../constants/diaspora/diasporaWorkbookTemplates.js';
import { runDiasporaWorkbookDryRun } from '../services/diaspora/diasporaWorkbookSyncService.js';
import { ValidationError } from '../utils/errors.js';

const FIXED_NOW = '2026-06-21T00:00:00.000Z';
const TEMPLATE_TYPE = 'enterprise';

// Route file is read as TEXT (not imported) — importing it would pull authMiddleware ->
// db/supabase, which requires environment variables. Mirrors diaspora-workbook.test.js.
const xlsxRouteFile = readFileSync(new URL('../routes/diasporaWorkbookXlsxRoutes.js', import.meta.url), 'utf8');

function tradeProfilesRows(extra = []) {
  return [
    { TRADE_PROFILE_ID: 'TP-1', USER_ID: 'u1', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED' },
    { TRADE_PROFILE_ID: 'TP-2', USER_ID: 'u2', COUNTRY: 'Japan', CITY: 'Osaka', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'VERIFIED' },
    ...extra,
  ];
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/* ---------------------------- upload security ---------------------------- */

test('assertAllowedSpreadsheet accepts a genuine .xlsx within limits', () => {
  const result = assertAllowedSpreadsheet({ filename: 'workbook.xlsx', mimeType: XLSX_UPLOAD_MIME, sizeBytes: 2048 });
  assert.equal(result.extension, XLSX_UPLOAD_EXTENSION);
  assert.equal(result.mimeType, XLSX_UPLOAD_MIME);
  assert.equal(result.sizeBytes, 2048);
});

test('assertAllowedSpreadsheet rejects .xlsm and .xls by extension/MIME allowlist', () => {
  assert.throws(
    () => assertAllowedSpreadsheet({ filename: 'macros.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', sizeBytes: 1024 }),
    ValidationError,
  );
  assert.throws(
    () => assertAllowedSpreadsheet({ filename: 'legacy.xls', mimeType: 'application/vnd.ms-excel', sizeBytes: 1024 }),
    ValidationError,
  );
  assert.throws(
    () => assertAllowedSpreadsheet({ filename: 'data.csv', mimeType: 'text/csv', sizeBytes: 1024 }),
    ValidationError,
  );
});

test('assertAllowedSpreadsheet rejects a mismatched MIME even with .xlsx extension', () => {
  assert.throws(
    () => assertAllowedSpreadsheet({ filename: 'spoof.xlsx', mimeType: 'text/csv', sizeBytes: 1024 }),
    ValidationError,
  );
});

test('assertAllowedSpreadsheet rejects an oversized buffer', () => {
  assert.throws(
    () => assertAllowedSpreadsheet({ filename: 'big.xlsx', mimeType: XLSX_UPLOAD_MIME, sizeBytes: DEFAULT_LIMITS.maxBytes + 1 }),
    ValidationError,
  );
});

test('normalizeFilename strips path traversal and unsafe segments', () => {
  assert.equal(normalizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(normalizeFilename('..\\..\\windows\\evil.xlsx'), 'evil.xlsx');
  assert.equal(normalizeFilename('/abs/path/report.xlsx'), 'report.xlsx');
  assert.equal(normalizeFilename(''), 'workbook.xlsx');
  // No directory separators remain.
  assert.equal(normalizeFilename('a/b/c.xlsx').includes('/'), false);
});

test('neutralizeFormula prefixes an apostrophe for formula triggers and leaves benign values alone', () => {
  assert.equal(neutralizeFormula('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(neutralizeFormula('+1+2'), "'+1+2");
  assert.equal(neutralizeFormula('-1'), "'-1");
  assert.equal(neutralizeFormula('@cmd'), "'@cmd");
  assert.equal(neutralizeFormula('\tTAB'), "'\tTAB");
  assert.equal(neutralizeFormula('hello'), 'hello');
  assert.equal(neutralizeFormula(42), 42);
});

test('sha256Checksum returns a stable hex digest', () => {
  assert.equal(sha256Checksum(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

/* ---------------------------- generateTemplate ---------------------------- */

test('generateTemplate produces a workbook whose data sheets, headers, and reserved sheets are present', async () => {
  const buffer = await generateTemplate(TEMPLATE_TYPE, { now: FIXED_NOW });
  assert.equal(Buffer.isBuffer(buffer), true);
  const workbook = await loadWorkbook(buffer);

  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  assert.equal(sheetNames.includes(XLSX_INSTRUCTIONS_SHEET_NAME), true);
  assert.equal(sheetNames.includes(XLSX_REFERENCE_SHEET_NAME), true);

  const templateDef = getXlsxTemplate(TEMPLATE_TYPE);
  for (const sheetDef of templateDef.sheets) {
    const worksheet = workbook.getWorksheet(sheetDef.name);
    assert.ok(worksheet, `expected sheet ${sheetDef.name}`);
    const headers = [];
    worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => { headers[colNumber - 1] = cell.value; });
    assert.deepEqual(headers, sheetDef.columns.map((column) => column.header));
  }
});

test('generateTemplate writes the fixed generatedAt timestamp into the Instructions sheet', async () => {
  const buffer = await generateTemplate(TEMPLATE_TYPE, { now: FIXED_NOW });
  const workbook = await loadWorkbook(buffer);
  const instructions = workbook.getWorksheet(XLSX_INSTRUCTIONS_SHEET_NAME);
  let foundGeneratedAt = null;
  instructions.eachRow((row) => {
    if (String(row.getCell(1).value) === 'generatedAt') foundGeneratedAt = String(row.getCell(2).value);
  });
  assert.equal(foundGeneratedAt, FIXED_NOW);
});

test('generateTemplate wires dropdown data-validation for enum columns', async () => {
  const buffer = await generateTemplate(TEMPLATE_TYPE, { now: FIXED_NOW });
  const workbook = await loadWorkbook(buffer);
  const worksheet = workbook.getWorksheet('TRADE_PROFILES');
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => { headers[colNumber] = cell.value; });
  const roleColumn = headers.indexOf('ROLE_TYPE');
  const validation = worksheet.getCell(3, roleColumn).dataValidation;
  assert.ok(validation, 'expected ROLE_TYPE dropdown');
  assert.equal(validation.type, 'list');
  assert.equal(validation.formulae[0].includes('buyer'), true);
});

test('generateTemplate marks the reference sheet hidden and protected', async () => {
  const buffer = await generateTemplate(TEMPLATE_TYPE, { now: FIXED_NOW });
  const workbook = await loadWorkbook(buffer);
  const reference = workbook.getWorksheet(XLSX_REFERENCE_SHEET_NAME);
  assert.ok(['hidden', 'veryHidden'].includes(reference.state));
  assert.ok(reference.sheetProtection, 'expected reference sheet to be protected');
});

test('generateTemplate output re-parses with no data rows (EXAMPLE/help dropped)', async () => {
  const buffer = await generateTemplate(TEMPLATE_TYPE, { now: FIXED_NOW });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });
  assert.equal(parsed.templateType, TEMPLATE_TYPE);
  for (const rows of Object.values(parsed.sheets)) {
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows.length, 0);
  }
});

test('generateTemplate rejects an unknown templateType', async () => {
  await assert.rejects(() => generateTemplate('definitely-not-a-template', { now: FIXED_NOW }), ValidationError);
});

/* ---------------------------- parseWorkbook ---------------------------- */

test('exportWorkbook -> parseWorkbook round-trip preserves identifier columns and values', async () => {
  const rows = { TRADE_PROFILES: tradeProfilesRows() };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { context: { now: FIXED_NOW } });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });

  assert.equal(parsed.sheets.TRADE_PROFILES.length, 2);
  assert.deepEqual(
    parsed.sheets.TRADE_PROFILES.map((row) => row.TRADE_PROFILE_ID),
    ['TP-1', 'TP-2'],
  );
  assert.equal(parsed.sheets.TRADE_PROFILES[0].ROLE_TYPE, 'buyer');
  assert.equal(parsed.sheets.TRADE_PROFILES[1].CITY, 'Osaka');
});

test('parseWorkbook produces the exact normalized payload shape the validator consumes', async () => {
  const rows = { TRADE_PROFILES: tradeProfilesRows() };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { context: { now: FIXED_NOW } });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });

  assert.deepEqual(Object.keys(parsed).sort(), ['meta', 'sheets', 'templateType']);
  assert.equal(typeof parsed.sheets, 'object');
  assert.equal(Array.isArray(parsed.sheets), false);
  assert.equal(Array.isArray(parsed.sheets.TRADE_PROFILES), true);
  // Rows are plain objects keyed by the column header text.
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.sheets.TRADE_PROFILES[0], 'TRADE_PROFILE_ID'), true);

  // The normalized payload flows through the EXISTING dry-run validator unchanged.
  const dryRun = runDiasporaWorkbookDryRun(
    { templateType: parsed.templateType, sheets: parsed.sheets },
    { id: 'user-1', tenantId: 'tenant-1' },
  );
  assert.equal(dryRun.dryRunOnly, true);
  assert.equal(dryRun.wroteToDatabase, false);
});

test('parseWorkbook surfaces duplicate identifier rows in meta.duplicates', async () => {
  const rows = {
    TRADE_PROFILES: tradeProfilesRows([
      { TRADE_PROFILE_ID: 'TP-1', USER_ID: 'u3', COUNTRY: 'Japan', CITY: 'Kyoto', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'VERIFIED' },
    ]),
  };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { context: { now: FIXED_NOW } });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });

  assert.equal(parsed.sheets.TRADE_PROFILES.length, 3);
  assert.ok(parsed.meta.duplicates.TRADE_PROFILES, 'expected duplicate metadata');
  assert.equal(parsed.meta.duplicates.TRADE_PROFILES.identifierKey, 'TRADE_PROFILE_ID');
  assert.deepEqual(parsed.meta.duplicates.TRADE_PROFILES.values, ['TP-1']);
});

test('parseWorkbook never evaluates formulas — neutralized cells round-trip as literal text', async () => {
  const rows = {
    TRADE_PROFILES: [
      { TRADE_PROFILE_ID: 'TP-1', USER_ID: 'u1', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED', NOTES: '=SUM(A1)' },
    ],
  };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { context: { now: FIXED_NOW } });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });
  assert.equal(parsed.sheets.TRADE_PROFILES[0].NOTES, "'=SUM(A1)");
});

test('parseWorkbook reads a genuine formula cell as its cached result, never the formula', async () => {
  // Build a workbook by hand with a real formula cell to prove formulas are not evaluated.
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('TRADE_PROFILES');
  const headers = getXlsxTemplate(TEMPLATE_TYPE).sheets.find((s) => s.name === 'TRADE_PROFILES').columns.map((c) => c.header);
  worksheet.getRow(1).values = headers;
  const notesCol = headers.indexOf('NOTES') + 1;
  const dataRow = worksheet.getRow(2);
  dataRow.getCell(1).value = 'TP-1';
  dataRow.getCell(2).value = 'u1';
  dataRow.getCell(3).value = 'Japan';
  dataRow.getCell(4).value = 'Tokyo';
  dataRow.getCell(5).value = 'buyer';
  dataRow.getCell(6).value = 'VERIFIED';
  dataRow.getCell(notesCol).value = { formula: 'SUM(1,2)', result: 3 };
  const buffer = await workbook.xlsx.writeBuffer();

  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });
  // We surface the cached result (3) — we do not re-run SUM.
  assert.equal(parsed.sheets.TRADE_PROFILES[0].NOTES, 3);
});

test('parseWorkbook enforces the per-sheet row limit', async () => {
  const many = {
    TRADE_PROFILES: Array.from({ length: 6 }, (_, i) => ({
      TRADE_PROFILE_ID: `X${i}`, USER_ID: 'u', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED',
    })),
  };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, many, { context: { now: FIXED_NOW } });
  await assert.rejects(
    () => parseWorkbook(buffer, { templateType: TEMPLATE_TYPE, limits: { ...DEFAULT_LIMITS, maxRows: 3 } }),
    ValidationError,
  );
});

test('parseWorkbook rejects an unreadable / non-xlsx buffer', async () => {
  await assert.rejects(
    () => parseWorkbook(Buffer.from('this is not a real xlsx file'), { templateType: TEMPLATE_TYPE }),
    ValidationError,
  );
});

test('parseWorkbook rejects an unknown templateType', async () => {
  const buffer = await exportWorkbook(TEMPLATE_TYPE, { TRADE_PROFILES: tradeProfilesRows() }, { context: { now: FIXED_NOW } });
  await assert.rejects(() => parseWorkbook(buffer, { templateType: 'nope' }), ValidationError);
});

/* ---------------------------- exportWorkbook ---------------------------- */

test('exportWorkbook neutralizes formula injection on string cells', async () => {
  const rows = {
    TRADE_PROFILES: [
      { TRADE_PROFILE_ID: 'TP-1', USER_ID: 'u1', COUNTRY: 'Japan', CITY: 'Tokyo', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'VERIFIED', NOTES: '=HYPERLINK("http://evil")' },
    ],
  };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { context: { now: FIXED_NOW } });
  const workbook = await loadWorkbook(buffer);
  const worksheet = workbook.getWorksheet('TRADE_PROFILES');
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => { headers[colNumber] = cell.value; });
  const notesCol = headers.indexOf('NOTES');
  const value = worksheet.getCell(2, notesCol).value;
  assert.equal(String(value).startsWith("'="), true);
});

test('exportWorkbook redacts requested fields and stamps export metadata', async () => {
  const rows = { TRADE_PROFILES: tradeProfilesRows() };
  const buffer = await exportWorkbook(TEMPLATE_TYPE, rows, { redactFields: ['USER_ID'], context: { now: FIXED_NOW } });
  const parsed = await parseWorkbook(buffer, { templateType: TEMPLATE_TYPE });
  assert.equal(parsed.sheets.TRADE_PROFILES[0].USER_ID, '[REDACTED]');

  const workbook = await loadWorkbook(buffer);
  const metaSheet = workbook.getWorksheet('_EXPORT_META');
  assert.ok(metaSheet, 'expected export metadata sheet');
  let exportedAt = null;
  metaSheet.eachRow((row) => {
    if (String(row.getCell(1).value) === 'exportedAt') exportedAt = String(row.getCell(2).value);
  });
  assert.equal(exportedAt, FIXED_NOW);

  const reference = workbook.getWorksheet(XLSX_REFERENCE_SHEET_NAME);
  assert.ok(reference.sheetProtection, 'expected export reference sheet to be protected');
});

/* ---------------------------- route wiring ---------------------------- */

test('XLSX routes file declares the expected endpoints and is integrator-mounted', () => {
  assert.equal(xlsxRouteFile.includes('// Mounted by integrator inside /api/diaspora'), true);
  assert.equal(xlsxRouteFile.includes("router.get('/workbook/template.xlsx'"), true);
  assert.equal(xlsxRouteFile.includes("router.post('/workbook/xlsx/dry-run'"), true);
  assert.equal(xlsxRouteFile.includes("router.post('/workbook/xlsx/export'"), true);
  // Reuses the existing dry-run/persist entry point — does not fork the JSON path.
  assert.equal(xlsxRouteFile.includes('runAndPersistDiasporaWorkbookDryRun'), true);
  assert.equal(xlsxRouteFile.includes('authorizeRole'), true);
  // Sets the OOXML spreadsheet content type for downloads (via the shared MIME constant).
  assert.equal(xlsxRouteFile.includes("res.setHeader('Content-Type', XLSX_UPLOAD_MIME)"), true);
  assert.equal(xlsxRouteFile.includes('Content-Disposition'), true);
});
