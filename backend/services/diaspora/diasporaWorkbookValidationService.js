import { ValidationError } from '../../utils/errors.js';
import {
  WORKBOOK_SHEETS,
  WORKBOOK_STATUS_LISTS,
  getRequiredSheetsForTemplate,
  normalizeWorkbookTemplateType,
} from '../../constants/diaspora/diasporaWorkbookSchema.js';

const MAX_DRY_RUN_ROWS_PER_SHEET = 5000;
const MAX_ERROR_SAMPLES = 500;
const HIGH_RISK_AI_ACTIONS = new Set([
  'VERIFY_PROFILE',
  'VERIFY_DOCUMENT',
  'APPROVE_COMPLIANCE',
  'RELEASE_ESCROW',
  'OVERRIDE_STOCK_LEDGER',
  'CANCEL_PAID_ORDER',
  'CHANGE_CUSTOMS_CLEARANCE',
]);

function normalizeHeader(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function upperCell(value) {
  return normalizeCell(value).toUpperCase();
}

function isBlankRow(row) {
  if (!row || typeof row !== 'object') return true;
  return Object.values(row).every((value) => normalizeCell(value) === '');
}

function isPositiveNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0;
}

function isValidOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return true;
  return Number.isFinite(Number(value));
}

function parseSheetsPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Workbook dry-run payload must be a JSON object.');
  }

  const sheets = payload.sheets || payload.workbook || payload;
  if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) {
    throw new ValidationError('Workbook dry-run payload must include a sheets object.');
  }

  return sheets;
}

function normalizeRow(row = {}) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), value]));
}

function addFinding(collection, finding) {
  if (collection.length < MAX_ERROR_SAMPLES) collection.push(finding);
}

function buildSheetSummary(sheetName, definition, rows) {
  return {
    sheetName,
    apiTable: definition.apiTable,
    primaryKey: definition.primaryKey,
    totalRows: rows.length,
    acceptedRows: 0,
    rejectedRows: 0,
    warningRows: 0,
  };
}

function validateRequiredColumns({ sheetName, definition, rows, errors }) {
  if (rows.length === 0) return;
  const availableColumns = new Set(Object.keys(rows[0] || {}).map(normalizeHeader));
  for (const column of definition.requiredColumns) {
    if (!availableColumns.has(column)) {
      addFinding(errors, {
        sheetName,
        rowIndex: 1,
        column,
        code: 'MISSING_REQUIRED_COLUMN',
        message: `${sheetName} is missing required column ${column}.`,
      });
    }
  }
}

function validateRequiredCell({ sheetName, rowIndex, row, column, errors }) {
  if (normalizeCell(row[column]) === '') {
    addFinding(errors, {
      sheetName,
      rowIndex,
      column,
      code: 'MISSING_REQUIRED_VALUE',
      message: `${sheetName} row ${rowIndex} is missing ${column}.`,
    });
    return false;
  }
  return true;
}

function validateStatusCell({ sheetName, rowIndex, row, column, statusListName, errors }) {
  const value = upperCell(row[column]);
  if (!value) return true;
  const allowed = WORKBOOK_STATUS_LISTS[statusListName] || [];
  const normalizedAllowed = new Set(allowed.map((item) => String(item).toUpperCase()));
  if (!normalizedAllowed.has(value)) {
    addFinding(errors, {
      sheetName,
      rowIndex,
      column,
      code: 'INVALID_STATUS_VALUE',
      message: `${sheetName} row ${rowIndex} has invalid ${column}: ${row[column]}.`,
      allowed: [...allowed],
    });
    return false;
  }
  return true;
}

function validateUniquePrimaryKey({ sheetName, definition, rows, errors }) {
  const seen = new Map();
  const primaryKey = definition.primaryKey;
  rows.forEach((row, index) => {
    const rowIndex = index + 2;
    const id = normalizeCell(row[primaryKey]);
    if (!id) return;
    if (seen.has(id)) {
      addFinding(errors, {
        sheetName,
        rowIndex,
        column: primaryKey,
        code: 'DUPLICATE_WORKBOOK_ID',
        message: `${sheetName} row ${rowIndex} duplicates ${primaryKey} '${id}' from row ${seen.get(id)}.`,
      });
    } else {
      seen.set(id, rowIndex);
    }
  });
}

function buildReferenceSets(normalizedSheets) {
  const getIds = (sheetName, primaryKey) => new Set((normalizedSheets[sheetName] || []).map((row) => normalizeCell(row[primaryKey])).filter(Boolean));
  return {
    tradeProfileIds: getIds('TRADE_PROFILES', 'TRADE_PROFILE_ID'),
    importOrderIds: getIds('DIASPORA_IMPORT_ORDERS', 'IMPORT_ORDER_ID'),
    documentIds: getIds('TRADE_DOCUMENTS', 'DOCUMENT_ID'),
    containerIds: getIds('CONTAINER_SHIPMENTS', 'CONTAINER_ID'),
    shipmentIds: getIds('SHIPMENTS', 'SHIPMENT_ID'),
  };
}

function validateReference({ sheetName, rowIndex, row, column, referenceSet, errors, required = false }) {
  const value = normalizeCell(row[column]);
  if (!value) {
    if (required) {
      addFinding(errors, {
        sheetName,
        rowIndex,
        column,
        code: 'MISSING_REFERENCE',
        message: `${sheetName} row ${rowIndex} is missing reference ${column}.`,
      });
      return false;
    }
    return true;
  }
  if (!referenceSet.has(value)) {
    addFinding(errors, {
      sheetName,
      rowIndex,
      column,
      code: 'UNKNOWN_REFERENCE',
      message: `${sheetName} row ${rowIndex} references unknown ${column} '${value}'.`,
    });
    return false;
  }
  return true;
}

function validateCrossReferences({ normalizedSheets, referenceSets, errors }) {
  for (const [index, row] of (normalizedSheets.DIASPORA_IMPORT_ORDERS || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'DIASPORA_IMPORT_ORDERS', rowIndex, row, column: 'BUYER_TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors, required: true });
    validateReference({ sheetName: 'DIASPORA_IMPORT_ORDERS', rowIndex, row, column: 'CONTAINER_ID', referenceSet: referenceSets.containerIds, errors });
    validateReference({ sheetName: 'DIASPORA_IMPORT_ORDERS', rowIndex, row, column: 'SHIPMENT_ID', referenceSet: referenceSets.shipmentIds, errors });
  }

  for (const [index, row] of (normalizedSheets.IMPORT_QUOTES || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'IMPORT_QUOTES', rowIndex, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors, required: true });
    validateReference({ sheetName: 'IMPORT_QUOTES', rowIndex, row, column: 'SELLER_TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors, required: true });
  }

  for (const [index, row] of (normalizedSheets.TRADE_DOCUMENTS || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'TRADE_DOCUMENTS', rowIndex, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors });
    validateReference({ sheetName: 'TRADE_DOCUMENTS', rowIndex, row, column: 'TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors });
  }

  for (const [index, row] of (normalizedSheets.CARGO_RESERVATIONS || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'CONTAINER_ID', referenceSet: referenceSets.containerIds, errors, required: true });
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors, required: true });
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'BUYER_TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors });
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'SELLER_TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors });
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'INVOICE_DOCUMENT_ID', referenceSet: referenceSets.documentIds, errors });
    validateReference({ sheetName: 'CARGO_RESERVATIONS', rowIndex, row, column: 'DIMENSIONS_DOCUMENT_ID', referenceSet: referenceSets.documentIds, errors });
  }

  for (const [index, row] of (normalizedSheets.SHIPMENTS || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'SHIPMENTS', rowIndex, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors, required: true });
    validateReference({ sheetName: 'SHIPMENTS', rowIndex, row, column: 'CONTAINER_ID', referenceSet: referenceSets.containerIds, errors });
  }

  for (const sheetName of ['COMPLIANCE_REVIEWS', 'PAYMENT_MILESTONES']) {
    for (const [index, row] of (normalizedSheets[sheetName] || []).entries()) {
      validateReference({ sheetName, rowIndex: index + 2, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors, required: true });
    }
  }

  for (const [index, row] of (normalizedSheets.REPUTATION_RECORDS || []).entries()) {
    const rowIndex = index + 2;
    validateReference({ sheetName: 'REPUTATION_RECORDS', rowIndex, row, column: 'TRADE_PROFILE_ID', referenceSet: referenceSets.tradeProfileIds, errors, required: true });
    validateReference({ sheetName: 'REPUTATION_RECORDS', rowIndex, row, column: 'IMPORT_ORDER_ID', referenceSet: referenceSets.importOrderIds, errors });
  }
}

function validateContainerCapacity({ normalizedSheets, errors, warnings }) {
  const reservationsByContainer = new Map();
  for (const row of normalizedSheets.CARGO_RESERVATIONS || []) {
    if (upperCell(row.RESERVATION_STATUS) !== 'APPROVED') continue;
    const containerId = normalizeCell(row.CONTAINER_ID);
    if (!containerId) continue;
    const volume = Number(row.ESTIMATED_VOLUME || 0);
    reservationsByContainer.set(containerId, (reservationsByContainer.get(containerId) || 0) + volume);
  }

  for (const [index, row] of (normalizedSheets.CONTAINER_SHIPMENTS || []).entries()) {
    const rowIndex = index + 2;
    const containerId = normalizeCell(row.CONTAINER_ID);
    const totalVolume = Number(row.TOTAL_CAPACITY_VOLUME || 0);
    const usedVolume = reservationsByContainer.get(containerId) || Number(row.USED_CAPACITY_VOLUME || 0);

    if (!isPositiveNumber(totalVolume)) {
      addFinding(errors, {
        sheetName: 'CONTAINER_SHIPMENTS',
        rowIndex,
        column: 'TOTAL_CAPACITY_VOLUME',
        code: 'INVALID_CONTAINER_CAPACITY',
        message: `CONTAINER_SHIPMENTS row ${rowIndex} must have positive TOTAL_CAPACITY_VOLUME.`,
      });
      continue;
    }

    const fillPercent = usedVolume / totalVolume;
    if (usedVolume > totalVolume) {
      addFinding(errors, {
        sheetName: 'CONTAINER_SHIPMENTS',
        rowIndex,
        column: 'TOTAL_CAPACITY_VOLUME',
        code: 'CONTAINER_OVERFILLED',
        message: `Container ${containerId} is overfilled: ${usedVolume} exceeds ${totalVolume}.`,
      });
    } else if (fillPercent >= 0.98) {
      addFinding(warnings, {
        sheetName: 'CONTAINER_SHIPMENTS',
        rowIndex,
        column: 'TOTAL_CAPACITY_VOLUME',
        code: 'CONTAINER_FULL',
        message: `Container ${containerId} is at ${(fillPercent * 100).toFixed(1)}% fill and should be treated as full.`,
      });
    } else if (fillPercent >= 0.9) {
      addFinding(warnings, {
        sheetName: 'CONTAINER_SHIPMENTS',
        rowIndex,
        column: 'TOTAL_CAPACITY_VOLUME',
        code: 'CONTAINER_READY_TO_CLOSE',
        message: `Container ${containerId} is at ${(fillPercent * 100).toFixed(1)}% fill and is ready to close.`,
      });
    }
  }
}

function validateReleaseGuards({ normalizedSheets, errors }) {
  const complianceByOrder = new Map();
  for (const row of normalizedSheets.COMPLIANCE_REVIEWS || []) {
    const orderId = normalizeCell(row.IMPORT_ORDER_ID);
    if (!orderId) continue;
    const status = upperCell(row.STATUS);
    if (!complianceByOrder.has(orderId)) complianceByOrder.set(orderId, new Set());
    complianceByOrder.get(orderId).add(status);
  }

  const unpaidMilestonesByOrder = new Map();
  for (const row of normalizedSheets.PAYMENT_MILESTONES || []) {
    const orderId = normalizeCell(row.IMPORT_ORDER_ID);
    if (!orderId) continue;
    const status = upperCell(row.STATUS);
    if (!['PAID', 'REFUNDED'].includes(status)) {
      unpaidMilestonesByOrder.set(orderId, (unpaidMilestonesByOrder.get(orderId) || 0) + 1);
    }
  }

  for (const [index, row] of (normalizedSheets.DIASPORA_IMPORT_ORDERS || []).entries()) {
    const rowIndex = index + 2;
    const orderId = normalizeCell(row.IMPORT_ORDER_ID);
    const orderStatus = upperCell(row.STATUS);
    const complianceStatuses = complianceByOrder.get(orderId) || new Set();
    const unpaidCount = unpaidMilestonesByOrder.get(orderId) || 0;

    if (['RELEASED', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED', 'COMPLETED'].includes(orderStatus) && complianceStatuses.has('FLAGGED')) {
      addFinding(errors, {
        sheetName: 'DIASPORA_IMPORT_ORDERS',
        rowIndex,
        column: 'STATUS',
        code: 'FLAGGED_COMPLIANCE_BLOCKS_RELEASE',
        message: `Order ${orderId} cannot be ${orderStatus} while compliance is FLAGGED.`,
      });
    }

    if (['RELEASED', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED', 'COMPLETED'].includes(orderStatus) && unpaidCount > 0) {
      addFinding(errors, {
        sheetName: 'DIASPORA_IMPORT_ORDERS',
        rowIndex,
        column: 'STATUS',
        code: 'UNPAID_MILESTONES_BLOCK_RELEASE',
        message: `Order ${orderId} cannot be ${orderStatus} with ${unpaidCount} unpaid payment milestone(s).`,
      });
    }
  }
}

function validateAiCommands({ normalizedSheets, errors, warnings }) {
  for (const [index, row] of (normalizedSheets.AI_COMMAND_CENTER || []).entries()) {
    const rowIndex = index + 2;
    const intent = upperCell(row.INTENT);
    const riskLevel = upperCell(row.RISK_LEVEL);
    const confidence = Number(row.CONFIDENCE_SCORE);
    const approvalStatus = upperCell(row.APPROVAL_STATUS);
    const executionStatus = upperCell(row.EXECUTION_STATUS);

    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      addFinding(errors, {
        sheetName: 'AI_COMMAND_CENTER',
        rowIndex,
        column: 'CONFIDENCE_SCORE',
        code: 'INVALID_AI_CONFIDENCE',
        message: `AI_COMMAND_CENTER row ${rowIndex} confidence must be between 0 and 1.`,
      });
    }

    if (HIGH_RISK_AI_ACTIONS.has(intent) && approvalStatus !== 'APPROVED') {
      addFinding(errors, {
        sheetName: 'AI_COMMAND_CENTER',
        rowIndex,
        column: 'APPROVAL_STATUS',
        code: 'HIGH_RISK_AI_REQUIRES_APPROVAL',
        message: `High-risk AI intent ${intent} requires APPROVED status before import.`,
      });
    }

    if (riskLevel === 'MEDIUM' && !['APPROVED', 'PENDING'].includes(approvalStatus)) {
      addFinding(warnings, {
        sheetName: 'AI_COMMAND_CENTER',
        rowIndex,
        column: 'APPROVAL_STATUS',
        code: 'MEDIUM_RISK_AI_CONFIRMATION_EXPECTED',
        message: `Medium-risk AI command ${intent || '(missing intent)'} should be confirmed before execution.`,
      });
    }

    if (executionStatus === 'IMPORTED') {
      addFinding(errors, {
        sheetName: 'AI_COMMAND_CENTER',
        rowIndex,
        column: 'EXECUTION_STATUS',
        code: 'DRY_RUN_CANNOT_IMPORT_ALREADY_EXECUTED_COMMANDS',
        message: 'Dry-run imports must not accept AI commands already marked IMPORTED.',
      });
    }
  }
}

function validateNumericFields({ sheetName, rowIndex, row, errors }) {
  const positiveColumns = ['QUOTE_AMOUNT', 'ESTIMATED_VOLUME', 'TOTAL_CAPACITY_VOLUME', 'AMOUNT', 'RATING'];
  const optionalNumericColumns = ['BUDGET_AMOUNT', 'ESTIMATED_WEIGHT', 'DECLARED_VALUE', 'CUSTOMS_VALUE', 'DUTY_RATE', 'VAT_RATE', 'DUTY_AMOUNT', 'TOTAL_TAX_DUTY', 'TRUST_SCORE', 'RATING_AVERAGE'];

  for (const column of positiveColumns) {
    if (column in row && normalizeCell(row[column]) !== '' && !isPositiveNumber(row[column])) {
      addFinding(errors, {
        sheetName,
        rowIndex,
        column,
        code: 'INVALID_POSITIVE_NUMBER',
        message: `${sheetName} row ${rowIndex} requires positive numeric ${column}.`,
      });
    }
  }

  for (const column of optionalNumericColumns) {
    if (column in row && !isValidOptionalNumber(row[column])) {
      addFinding(errors, {
        sheetName,
        rowIndex,
        column,
        code: 'INVALID_NUMBER',
        message: `${sheetName} row ${rowIndex} has invalid numeric ${column}.`,
      });
    }
  }

  if ('RATING' in row && normalizeCell(row.RATING) !== '') {
    const rating = Number(row.RATING);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      addFinding(errors, {
        sheetName,
        rowIndex,
        column: 'RATING',
        code: 'INVALID_RATING_RANGE',
        message: `${sheetName} row ${rowIndex} rating must be between 1 and 5.`,
      });
    }
  }
}

export function validateDiasporaWorkbookDryRun(payload = {}, userContext = {}) {
  const templateType = normalizeWorkbookTemplateType(payload.templateType);
  const rawSheets = parseSheetsPayload(payload);
  const requiredSheetNames = getRequiredSheetsForTemplate(templateType);
  const normalizedSheets = {};
  const errors = [];
  const warnings = [];
  const summaries = [];

  for (const sheetName of requiredSheetNames) {
    const definition = WORKBOOK_SHEETS[sheetName];
    const rawRows = rawSheets[sheetName];

    if (!Array.isArray(rawRows)) {
      addFinding(errors, {
        sheetName,
        rowIndex: 0,
        code: 'MISSING_REQUIRED_SHEET',
        message: `Workbook is missing required sheet ${sheetName}.`,
      });
      normalizedSheets[sheetName] = [];
      summaries.push(buildSheetSummary(sheetName, definition, []));
      continue;
    }

    if (rawRows.length > MAX_DRY_RUN_ROWS_PER_SHEET) {
      addFinding(errors, {
        sheetName,
        rowIndex: 0,
        code: 'SHEET_ROW_LIMIT_EXCEEDED',
        message: `${sheetName} has ${rawRows.length} rows; maximum is ${MAX_DRY_RUN_ROWS_PER_SHEET}.`,
      });
    }

    const rows = rawRows.map(normalizeRow).filter((row) => !isBlankRow(row));
    normalizedSheets[sheetName] = rows;
    validateRequiredColumns({ sheetName, definition, rows, errors });
    validateUniquePrimaryKey({ sheetName, definition, rows, errors });

    const summary = buildSheetSummary(sheetName, definition, rows);
    for (const [index, row] of rows.entries()) {
      const rowIndex = index + 2;
      let rowHasError = false;

      for (const column of definition.requiredColumns) {
        rowHasError = !validateRequiredCell({ sheetName, rowIndex, row, column, errors }) || rowHasError;
      }
      for (const [column, statusListName] of Object.entries(definition.statusColumns || {})) {
        rowHasError = !validateStatusCell({ sheetName, rowIndex, row, column, statusListName, errors }) || rowHasError;
      }
      validateNumericFields({ sheetName, rowIndex, row, errors });

      if (rowHasError) summary.rejectedRows += 1;
      else summary.acceptedRows += 1;
    }
    summaries.push(summary);
  }

  const referenceSets = buildReferenceSets(normalizedSheets);
  validateCrossReferences({ normalizedSheets, referenceSets, errors });
  validateContainerCapacity({ normalizedSheets, errors, warnings });
  validateReleaseGuards({ normalizedSheets, errors });
  validateAiCommands({ normalizedSheets, errors, warnings });

  const dryRunId = `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const acceptedRows = summaries.reduce((sum, item) => sum + item.acceptedRows, 0);
  const totalRows = summaries.reduce((sum, item) => sum + item.totalRows, 0);

  return {
    dryRunId,
    dryRunOnly: true,
    wroteToDatabase: false,
    canImport: errors.length === 0,
    templateType,
    userId: userContext.id || userContext.userId || null,
    tenantId: userContext.tenantId || null,
    totals: {
      totalRows,
      acceptedRows,
      errorCount: errors.length,
      warningCount: warnings.length,
      sheetCount: summaries.length,
    },
    summaries: summaries.map((summary) => ({
      ...summary,
      rejectedRows: errors.filter((error) => error.sheetName === summary.sheetName && error.rowIndex > 0).length,
      warningRows: warnings.filter((warning) => warning.sheetName === summary.sheetName && warning.rowIndex > 0).length,
    })),
    errors,
    warnings,
  };
}
