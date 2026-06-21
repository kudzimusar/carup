/**
 * ExcelJS-backed XLSX service for the diaspora workbook surface (Completion Track W).
 *
 * Responsibilities:
 *   - generateTemplate: render a downloadable .xlsx template from the config-driven
 *     catalog (header row of stable column keys, a help row, dropdown data-validation,
 *     a hidden+protected reference sheet, an Instructions sheet, marked EXAMPLE rows).
 *   - parseWorkbook: read an uploaded .xlsx into the EXACT normalized payload shape the
 *     EXISTING JSON dry-run validator consumes:
 *         { templateType, sheets: { "<SheetName>": [ { "<HEADER>": value, ... } ] } }
 *     Formula cells are read as their cached RESULT only — formulas are NEVER evaluated.
 *   - exportWorkbook: render normalized rows back to .xlsx, neutralizing formula
 *     injection on every string cell, redacting requested fields, and stamping metadata.
 *
 * This service does NOT validate trade rules or touch the database; it only converts
 * between .xlsx bytes and the normalized payload, then hands that payload to the
 * existing validation/persistence entry points (owned by the integrator/routes).
 */
import ExcelJS from 'exceljs';
import { ValidationError } from '../../../utils/errors.js';
import {
  XLSX_REFERENCE_SHEETS,
  XLSX_RESERVED_SHEET_NAMES,
  XLSX_SCHEMA_VERSION,
  getXlsxTemplate,
  listSupportedXlsxTemplateTypes,
} from '../../../constants/diaspora/diasporaWorkbookTemplates.js';
import { DEFAULT_LIMITS, neutralizeFormula } from './diasporaWorkbookUploadSecurity.js';

const REFERENCE_SHEET_NAME = XLSX_RESERVED_SHEET_NAMES.REFERENCE;
const INSTRUCTIONS_SHEET_NAME = XLSX_RESERVED_SHEET_NAMES.INSTRUCTIONS;
const EXPORT_META_SHEET_NAME = '_EXPORT_META';
const RESERVED_SHEET_NAMES = new Set([REFERENCE_SHEET_NAME, INSTRUCTIONS_SHEET_NAME, EXPORT_META_SHEET_NAME]);

const HEADER_ROW_INDEX = 1;
const HELP_ROW_INDEX = 2;
const FIRST_DATA_ROW_INDEX = 3;
const SHEET_PROTECTION_PASSWORD = 'diaspora-reference-readonly';

function requireTemplate(templateType) {
  const template = getXlsxTemplate(templateType);
  if (!template) {
    throw new ValidationError(
      `Unsupported workbook template type "${templateType}".`,
      { code: 'UNSUPPORTED_TEMPLATE_TYPE', templateType, supported: listSupportedXlsxTemplateTypes() },
    );
  }
  return template;
}

function resolveTimestamp(context = {}) {
  if (context && context.now != null) return String(context.now);
  return new Date().toISOString();
}

function columnLetter(index) {
  // 1-based column index -> spreadsheet column letter (A, B, ... AA).
  let result = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Read a single ExcelJS cell value into a deterministic primitive:
 *   - formula cells: use the cached result / text only (NEVER evaluate),
 *   - dates: emit an ISO string (UTC) deterministically,
 *   - rich text / hyperlink objects: extract the text,
 *   - null/undefined: empty string.
 */
function readCellValue(cell) {
  const value = cell ? cell.value : null;
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    // Formula cell: { formula, result, ... } — take the cached result, never the formula.
    if ('formula' in value || 'sharedFormula' in value) {
      const result = value.result;
      if (result === null || result === undefined) return '';
      if (result instanceof Date) return result.toISOString();
      if (typeof result === 'object' && result && 'error' in result) return '';
      return result;
    }
    // Rich text.
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    // Hyperlink object.
    if ('text' in value) return value.text;
    if ('hyperlink' in value) return value.hyperlink;
    // Error object.
    if ('error' in value) return '';
  }

  return value;
}

function isReservedSheet(name) {
  return RESERVED_SHEET_NAMES.has(String(name || ''));
}

/* ------------------------------------------------------------------ *
 * generateTemplate
 * ------------------------------------------------------------------ */

export async function generateTemplate(templateType, context = {}) {
  const template = requireTemplate(templateType);
  const generatedAt = resolveTimestamp(context);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CarUp Diaspora';
  workbook.created = new Date(0); // deterministic; not derived from Date.now()

  // Instructions sheet first.
  const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET_NAME);
  instructions.columns = [{ width: 24 }, { width: 90 }];
  instructions.addRow(['schemaVersion', template.schemaVersion || XLSX_SCHEMA_VERSION]);
  instructions.addRow(['templateType', template.templateType]);
  instructions.addRow(['generatedAt', generatedAt]);
  instructions.addRow(['privacy', template.privacyWarning || '']);
  instructions.addRow([]);
  instructions.addRow(['How to use this workbook', '']);
  for (const line of template.importInstructions || []) {
    instructions.addRow(['', line]);
  }

  // Data sheets.
  for (const sheet of template.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    const headers = sheet.columns.map((column) => column.header);

    const headerRow = worksheet.getRow(HEADER_ROW_INDEX);
    headerRow.values = headers;
    headerRow.font = { bold: true };

    const helpRow = worksheet.getRow(HELP_ROW_INDEX);
    helpRow.values = sheet.columns.map((column) => column.help || '');
    helpRow.font = { italic: true };

    // Example row (clearly marked EXAMPLE in the first column).
    const exampleValues = sheet.columns.map((column, columnIndex) => {
      if (columnIndex === 0) return 'EXAMPLE';
      return column.exampleValue == null ? '' : column.exampleValue;
    });
    worksheet.getRow(FIRST_DATA_ROW_INDEX).values = exampleValues;

    // Column widths + dropdown data-validation for enum columns.
    sheet.columns.forEach((column, columnIndex) => {
      const colNumber = columnIndex + 1;
      worksheet.getColumn(colNumber).width = Math.min(Math.max(column.header.length + 2, 14), 32);

      if (Array.isArray(column.validationList) && column.validationList.length) {
        const formula = `"${column.validationList.join(',')}"`;
        // Apply the dropdown to a generous range of data rows.
        for (let rowNumber = FIRST_DATA_ROW_INDEX; rowNumber <= FIRST_DATA_ROW_INDEX + 500; rowNumber += 1) {
          worksheet.getCell(`${columnLetter(colNumber)}${rowNumber}`).dataValidation = {
            type: 'list',
            allowBlank: !column.required,
            formulae: [formula],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Invalid value',
            error: `Choose one of: ${column.validationList.join(', ')}`,
          };
        }
      }
    });

    worksheet.views = [{ state: 'frozen', ySplit: HELP_ROW_INDEX }];
  }

  // Hidden + protected reference sheet carrying the status allowlists.
  const reference = workbook.addWorksheet(REFERENCE_SHEET_NAME, { state: 'veryHidden' });
  reference.addRow(['StatusList', 'AllowedValues']);
  reference.getRow(1).font = { bold: true };
  for (const referenceSheet of XLSX_REFERENCE_SHEETS) {
    for (const [listName, values] of Object.entries(referenceSheet.statusLists || {})) {
      reference.addRow([listName, (values || []).join(', ')]);
    }
  }
  reference.getColumn(1).width = 28;
  reference.getColumn(2).width = 80;
  await reference.protect(SHEET_PROTECTION_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

/* ------------------------------------------------------------------ *
 * parseWorkbook
 * ------------------------------------------------------------------ */

export async function parseWorkbook(buffer, { templateType, limits = DEFAULT_LIMITS } = {}) {
  const template = requireTemplate(templateType);
  const effectiveLimits = { ...DEFAULT_LIMITS, ...(limits || {}) };

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new ValidationError('Workbook could not be read as a valid .xlsx file.', {
      code: 'UNREADABLE_WORKBOOK',
      reason: error && error.message,
    });
  }

  const knownSheetNames = new Set(template.sheets.map((sheet) => sheet.name));
  const dataWorksheets = workbook.worksheets.filter(
    (worksheet) => !isReservedSheet(worksheet.name),
  );

  if (dataWorksheets.length > effectiveLimits.maxSheets) {
    throw new ValidationError(
      `Workbook has ${dataWorksheets.length} sheets; maximum allowed is ${effectiveLimits.maxSheets}.`,
      { code: 'TOO_MANY_SHEETS', sheetCount: dataWorksheets.length, maxSheets: effectiveLimits.maxSheets },
    );
  }

  const sheets = {};
  const meta = { duplicates: {}, ignoredSheets: [], schemaVersion: XLSX_SCHEMA_VERSION };
  let totalCells = 0;

  for (const sheetDef of template.sheets) {
    const worksheet = workbook.getWorksheet(sheetDef.name);
    const rows = [];
    if (!worksheet) {
      sheets[sheetDef.name] = rows;
      continue;
    }

    // Resolve the header row (row 1) into the ordered list of header texts.
    const headerRow = worksheet.getRow(HEADER_ROW_INDEX);
    const headers = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber] = String(readCellValue(cell)).trim();
    });
    const firstHeader = headers.find((header) => header);

    // The generated template places a human help row at row 2. Real uploads (and our own
    // exportWorkbook output) may start data at row 2 instead, so we detect the help row by
    // value (it matches the catalog help text) rather than by a fixed row index.
    const helpTextByHeader = new Map(
      sheetDef.columns.map((column) => [column.header, String(column.help || '').trim()]),
    );
    const isHelpRow = (rowObject) => {
      const populatedHeaders = Object.keys(rowObject).filter(
        (header) => String(rowObject[header]).trim() !== '',
      );
      if (populatedHeaders.length === 0) return false;
      return populatedHeaders.every(
        (header) => String(rowObject[header]).trim() === helpTextByHeader.get(header),
      );
    };

    const identifierKey = sheetDef.identifierKey || sheetDef.primaryKey;
    const seenIdentifiers = new Map();
    const duplicateValues = new Set();

    let dataRowCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // Always skip the header row; everything below is data unless it is the help row,
      // a blank row, or an EXAMPLE seed row (filtered below).
      if (rowNumber <= HEADER_ROW_INDEX) return;

      const rowObject = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;
        const value = readCellValue(cell);
        const normalized = value === '' || value === null || value === undefined ? '' : value;
        rowObject[header] = normalized;
        if (String(normalized).trim() !== '') hasValue = true;
        totalCells += 1;
      });

      if (!hasValue) return; // skip blank rows

      // Skip the human help row (only meaningful at row 2 of a generated template).
      if (rowNumber === HELP_ROW_INDEX && isHelpRow(rowObject)) return;

      // Drop clearly-marked EXAMPLE seed rows (first column literally "EXAMPLE").
      if (firstHeader && String(rowObject[firstHeader]).trim().toUpperCase() === 'EXAMPLE') return;

      dataRowCount += 1;
      if (dataRowCount > effectiveLimits.maxRows) {
        throw new ValidationError(
          `Sheet ${sheetDef.name} has more than ${effectiveLimits.maxRows} data rows.`,
          { code: 'SHEET_ROW_LIMIT_EXCEEDED', sheetName: sheetDef.name, maxRows: effectiveLimits.maxRows },
        );
      }

      if (identifierKey && rowObject[identifierKey] != null && String(rowObject[identifierKey]).trim() !== '') {
        const idValue = String(rowObject[identifierKey]).trim();
        if (seenIdentifiers.has(idValue)) {
          duplicateValues.add(idValue);
        } else {
          seenIdentifiers.set(idValue, rowNumber);
        }
      }

      rows.push(rowObject);
    });

    if (totalCells > effectiveLimits.maxCells) {
      throw new ValidationError(
        `Workbook exceeds the populated-cell ceiling of ${effectiveLimits.maxCells}.`,
        { code: 'CELL_LIMIT_EXCEEDED', maxCells: effectiveLimits.maxCells },
      );
    }

    sheets[sheetDef.name] = rows;
    if (duplicateValues.size) {
      meta.duplicates[sheetDef.name] = { identifierKey, values: [...duplicateValues] };
    }
  }

  for (const worksheet of dataWorksheets) {
    if (!knownSheetNames.has(worksheet.name)) {
      meta.ignoredSheets.push(worksheet.name);
    }
  }

  return { templateType: template.templateType, sheets, meta };
}

/* ------------------------------------------------------------------ *
 * exportWorkbook
 * ------------------------------------------------------------------ */

export async function exportWorkbook(templateType, rows, { redactFields = [], context = {} } = {}) {
  const template = requireTemplate(templateType);
  const exportedAt = resolveTimestamp(context);
  const redactSet = new Set(redactFields || []);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CarUp Diaspora';
  workbook.created = new Date(0);

  // `rows` may be a flat array (single-sheet templates) or a map of sheetName -> rows[].
  const rowsBySheet = Array.isArray(rows)
    ? { [template.sheets[0].name]: rows }
    : (rows || {});

  for (const sheetDef of template.sheets) {
    const worksheet = workbook.addWorksheet(sheetDef.name);
    const headers = sheetDef.columns.map((column) => column.header);
    worksheet.getRow(HEADER_ROW_INDEX).values = headers;
    worksheet.getRow(HEADER_ROW_INDEX).font = { bold: true };

    const sheetRows = Array.isArray(rowsBySheet[sheetDef.name]) ? rowsBySheet[sheetDef.name] : [];
    for (const sourceRow of sheetRows) {
      const values = sheetDef.columns.map((column) => {
        if (redactSet.has(column.header)) return '[REDACTED]';
        let cellValue = sourceRow ? sourceRow[column.header] : undefined;
        if (cellValue === null || cellValue === undefined) return '';
        if (typeof cellValue === 'string') cellValue = neutralizeFormula(cellValue);
        return cellValue;
      });
      worksheet.addRow(values);
    }

    sheetDef.columns.forEach((column, columnIndex) => {
      worksheet.getColumn(columnIndex + 1).width = Math.min(Math.max(column.header.length + 2, 14), 32);
    });
  }

  // Export metadata sheet.
  const metaSheet = workbook.addWorksheet(EXPORT_META_SHEET_NAME);
  metaSheet.addRow(['schemaVersion', template.schemaVersion || XLSX_SCHEMA_VERSION]);
  metaSheet.addRow(['templateType', template.templateType]);
  metaSheet.addRow(['exportedAt', exportedAt]);
  metaSheet.addRow(['redactedFields', [...redactSet].join(', ')]);
  metaSheet.getColumn(1).width = 24;
  metaSheet.getColumn(2).width = 60;

  // Read-only reference sheet (hidden + protected) mirroring the template.
  const reference = workbook.addWorksheet(REFERENCE_SHEET_NAME, { state: 'veryHidden' });
  reference.addRow(['StatusList', 'AllowedValues']);
  reference.getRow(1).font = { bold: true };
  for (const referenceSheet of XLSX_REFERENCE_SHEETS) {
    for (const [listName, values] of Object.entries(referenceSheet.statusLists || {})) {
      reference.addRow([listName, (values || []).join(', ')]);
    }
  }
  reference.getColumn(1).width = 28;
  reference.getColumn(2).width = 80;
  await reference.protect(SHEET_PROTECTION_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export const XLSX_EXPORT_META_SHEET_NAME = EXPORT_META_SHEET_NAME;
export const XLSX_REFERENCE_SHEET_NAME = REFERENCE_SHEET_NAME;
export const XLSX_INSTRUCTIONS_SHEET_NAME = INSTRUCTIONS_SHEET_NAME;
