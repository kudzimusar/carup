/**
 * Config-driven XLSX template catalog (Completion Track W).
 *
 * This catalog describes the concrete .xlsx workbook templates we hand to diaspora
 * operators (buyer request/order, seller stock, supplier supply-document, enterprise
 * combined, container reservation). It is the single source of truth that the
 * ExcelJS service (diasporaWorkbookXlsxService.js) consumes to:
 *   - render header rows with STABLE field keys (the same uppercase column keys the
 *     existing JSON dry-run/validation pipeline expects),
 *   - render a human-friendly help row,
 *   - wire data-validation dropdowns from the shared status allowlists, and
 *   - emit a hidden/protected reference sheet carrying those allowlists.
 *
 * IMPORTANT: We do NOT duplicate sheet/column/status definitions. Column keys,
 * required/optional columns, primary keys and status->allowlist mappings are all
 * imported from diasporaWorkbookSchema.js. The catalog only adds presentation
 * metadata (help text, example values, protection flags) on top of those keys, so a
 * parsed workbook reuses the EXISTING validation unchanged.
 */
import {
  WORKBOOK_SHEETS,
  WORKBOOK_STATUS_LISTS,
  WORKBOOK_TEMPLATE_TYPES,
  getRequiredSheetsForTemplate,
} from './diasporaWorkbookSchema.js';

export const XLSX_SCHEMA_VERSION = '2026.06.trackW.xlsx-v1';

export const XLSX_TEMPLATE_TYPES = Object.freeze({
  BUYER: WORKBOOK_TEMPLATE_TYPES.BUYER,
  SELLER: WORKBOOK_TEMPLATE_TYPES.SELLER,
  SUPPLIER: 'supplier',
  ENTERPRISE: WORKBOOK_TEMPLATE_TYPES.ENTERPRISE,
  CONTAINER_RESERVATION: 'container_reservation',
});

const REFERENCE_SHEET_NAME = '_REFERENCE';
const INSTRUCTIONS_SHEET_NAME = 'Instructions';

export const XLSX_RESERVED_SHEET_NAMES = Object.freeze({
  REFERENCE: REFERENCE_SHEET_NAME,
  INSTRUCTIONS: INSTRUCTIONS_SHEET_NAME,
});

const PRIVACY_WARNING =
  'PRIVACY: This workbook may contain personal identity data (passport/national ID numbers, ' +
  'names, phone numbers) and commercial pricing. Do not email it unencrypted, do not store it ' +
  'on shared/unmanaged drives, and delete local copies after import. Workbook rows are offline ' +
  'staging records only — CarUp remains the source of truth until dry-run validation and import ' +
  'confirmation pass.';

const IMPORT_INSTRUCTIONS = Object.freeze([
  'Keep the header row (row 1) exactly as generated — the field keys are stable identifiers.',
  'Row 2 is a human help row describing each column; it is ignored on import.',
  'Example rows are clearly marked "EXAMPLE" in the first column — delete them before uploading.',
  'Fill one record per row. Required columns must not be blank.',
  'For columns with a dropdown, choose only from the offered values (see the reference sheet).',
  'Do not rename, reorder, hide, or delete sheets. Do not add formulas — cells are treated as text.',
  'Dates must be ISO format (YYYY-MM-DD). IDs prefixed IMPORT_*/DIO-*/etc. are your offline keys.',
  'Upload the saved .xlsx to the dry-run endpoint. Nothing is written to CarUp until you confirm.',
]);

/**
 * Curated help + example values per column key. Keyed by column key so a single entry
 * is reused across every sheet/template that surfaces that column. Anything not listed
 * falls back to a generic descriptor derived from the key.
 */
const COLUMN_HELP = Object.freeze({
  TRADE_PROFILE_ID: { help: 'Your offline trade profile identifier.', example: 'TP-BUYER-1' },
  USER_ID: { help: 'CarUp user id or your internal user reference.', example: 'buyer-1' },
  COUNTRY: { help: 'Country of the trade profile.', example: 'Japan' },
  CITY: { help: 'City of the trade profile.', example: 'Tokyo' },
  ROLE_TYPE: { help: 'Role of this profile (dropdown).', example: 'seller' },
  VERIFICATION_STATUS: { help: 'Verification state (dropdown).', example: 'VERIFIED' },
  ORGANIZATION_ID: { help: 'Optional organization/tenant reference.', example: '' },
  TRUST_SCORE: { help: 'Optional numeric trust score.', example: '' },
  NOTES: { help: 'Free-text notes (optional).', example: '' },

  IMPORT_ORDER_ID: { help: 'Your offline import/export order id.', example: 'DIO-1' },
  BUYER_TRADE_PROFILE_ID: { help: 'TRADE_PROFILE_ID of the buyer.', example: 'TP-BUYER-1' },
  ORDER_TYPE: { help: 'Order type (dropdown).', example: 'vehicle_import' },
  ORIGIN_COUNTRY: { help: 'Origin country.', example: 'Japan' },
  ORIGIN_CITY: { help: 'Origin city (optional).', example: 'Yokohama' },
  DESTINATION_COUNTRY: { help: 'Destination country.', example: 'Zimbabwe' },
  DESTINATION_CITY: { help: 'Destination city (optional).', example: 'Harare' },
  STATUS: { help: 'Record status (dropdown).', example: 'IMPORT_REQUESTED' },
  BUDGET_CURRENCY: { help: 'Budget currency (dropdown).', example: 'USD' },
  BUDGET_AMOUNT: { help: 'Optional numeric budget amount.', example: '5000' },
  REQUESTED_MAKE: { help: 'Requested vehicle make (optional).', example: 'Toyota' },
  REQUESTED_MODEL: { help: 'Requested vehicle model (optional).', example: 'Hilux' },
  CONTAINER_ID: { help: 'CONTAINER_ID this order is linked to (optional).', example: 'CONT-1' },
  SHIPMENT_ID: { help: 'SHIPMENT_ID this order is linked to (optional).', example: 'SHIP-1' },

  QUOTE_ID: { help: 'Your offline quote id.', example: 'Q-1' },
  SELLER_TRADE_PROFILE_ID: { help: 'TRADE_PROFILE_ID of the seller/supplier.', example: 'TP-SELLER-1' },
  QUOTE_AMOUNT: { help: 'Positive numeric quote amount.', example: '350' },
  QUOTE_CURRENCY: { help: 'Quote currency (dropdown).', example: 'USD' },
  VALID_UNTIL: { help: 'ISO date the quote expires (YYYY-MM-DD).', example: '2026-08-01' },
  LEAD_TIME_DAYS: { help: 'Optional lead time in days.', example: '14' },

  DOCUMENT_ID: { help: 'Your offline document id.', example: 'DOC-1' },
  DOCUMENT_TYPE: { help: 'Document type (dropdown).', example: 'commercial_invoice' },
  DOCUMENT_URL: { help: 'Optional URL/reference to the file.', example: '' },

  CONTAINER_TYPE: { help: 'Container type, e.g. 40HQ.', example: '40HQ' },
  DEPARTURE_DATE: { help: 'ISO departure date (YYYY-MM-DD).', example: '2026-07-15' },
  BOOKING_DEADLINE: { help: 'ISO booking deadline (YYYY-MM-DD).', example: '2026-07-01' },
  ESTIMATED_ARRIVAL_DATE: { help: 'ISO estimated arrival (optional).', example: '2026-08-10' },
  TOTAL_CAPACITY_VOLUME: { help: 'Positive numeric total volume (m3).', example: '30' },
  TOTAL_CAPACITY_WEIGHT: { help: 'Optional numeric total weight (kg).', example: '' },

  RESERVATION_ID: { help: 'Your offline reservation id.', example: 'RES-1' },
  CARGO_TYPE: { help: 'Type of cargo being reserved.', example: 'parts' },
  ESTIMATED_VOLUME: { help: 'Positive numeric reserved volume (m3).', example: '2' },
  ESTIMATED_WEIGHT: { help: 'Optional numeric reserved weight (kg).', example: '' },
  DECLARED_VALUE: { help: 'Optional declared value.', example: '' },
  CURRENCY: { help: 'Currency (dropdown).', example: 'USD' },
  RESERVATION_STATUS: { help: 'Reservation status (dropdown).', example: 'REQUESTED' },
  RECEIVER_NAME: { help: 'Receiver name (optional).', example: '' },
  RECEIVER_PHONE: { help: 'Receiver phone (optional).', example: '' },

  SHIPMENT_ID_PK: { help: 'Your offline shipment id.', example: 'SHIP-1' },
  CARRIER_NAME: { help: 'Carrier name (optional).', example: '' },
  TRACKING_NUMBER: { help: 'Tracking number (optional).', example: '' },

  COMPLIANCE_REVIEW_ID: { help: 'Your offline compliance review id.', example: 'CR-1' },
  REVIEW_TYPE: { help: 'Type of compliance review.', example: 'customs' },

  PAYMENT_MILESTONE_ID: { help: 'Your offline payment milestone id.', example: 'PM-1' },
  MILESTONE_TYPE: { help: 'Milestone type, e.g. deposit/balance/duty.', example: 'deposit' },
  AMOUNT: { help: 'Positive numeric amount.', example: '350' },
  DUE_DATE: { help: 'ISO due date (optional).', example: '2026-07-20' },

  REPUTATION_RECORD_ID: { help: 'Your offline reputation record id.', example: 'RR-1' },
  RATING: { help: 'Numeric rating between 1 and 5.', example: '5' },
  REVIEW_TEXT: { help: 'Optional free-text review.', example: '' },

  COMMAND_ID: { help: 'Your offline AI command id.', example: 'CMD-1' },
  RAW_COMMAND: { help: 'The natural-language command text.', example: 'Create a parts import order for Harare.' },
  INTENT: { help: 'Parsed intent label.', example: 'CREATE_IMPORT_ORDER' },
  RISK_LEVEL: { help: 'Risk level (dropdown).', example: 'LOW' },
  CONFIDENCE_SCORE: { help: 'Confidence between 0 and 1.', example: '0.95' },
  APPROVAL_STATUS: { help: 'Approval state (dropdown).', example: 'NOT_REQUIRED' },
  EXECUTION_STATUS: { help: 'Execution state (dropdown).', example: 'VALIDATED' },
});

function prettifyKey(key) {
  return String(key)
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function buildColumn(sheetName, definition, key) {
  const isRequired = definition.requiredColumns.includes(key);
  const statusListName = (definition.statusColumns || {})[key] || null;
  const validationList = statusListName ? [...(WORKBOOK_STATUS_LISTS[statusListName] || [])] : null;
  const helpEntry = COLUMN_HELP[key] || null;
  const help = helpEntry?.help || `${prettifyKey(key)}${isRequired ? ' (required)' : ' (optional)'}.`;
  const exampleValue =
    helpEntry && 'example' in helpEntry
      ? helpEntry.example
      : (validationList && validationList.length ? validationList[0] : '');

  return {
    key,
    header: key,
    help,
    required: isRequired,
    type: validationList ? 'enum' : 'string',
    validationList,
    statusListName,
    exampleValue,
  };
}

function buildSheet(sheetName, { protectedSheet = false, hidden = false } = {}) {
  const definition = WORKBOOK_SHEETS[sheetName];
  if (!definition) {
    throw new Error(`Unknown workbook sheet '${sheetName}' referenced by template catalog.`);
  }
  const orderedKeys = [...definition.requiredColumns, ...definition.optionalColumns];
  return {
    name: sheetName,
    primaryKey: definition.primaryKey,
    identifierKey: definition.primaryKey,
    apiTable: definition.apiTable,
    description: definition.description,
    protected: protectedSheet,
    hidden,
    columns: orderedKeys.map((key) => buildColumn(sheetName, definition, key)),
  };
}

/**
 * Reference sheets surfaced (hidden + protected) inside generated workbooks. We carry the
 * full set of shared status allowlists so dropdowns resolve and reviewers can audit the
 * exact allowed vocabulary offline.
 */
export const XLSX_REFERENCE_SHEETS = Object.freeze([
  {
    name: REFERENCE_SHEET_NAME,
    hidden: true,
    protected: true,
    statusLists: Object.fromEntries(
      Object.entries(WORKBOOK_STATUS_LISTS).map(([key, value]) => [key, [...value]]),
    ),
  },
]);

function buildTemplate(templateType, sheetNames) {
  return {
    templateType,
    schemaVersion: XLSX_SCHEMA_VERSION,
    privacyWarning: PRIVACY_WARNING,
    importInstructions: [...IMPORT_INSTRUCTIONS],
    referenceSheets: XLSX_REFERENCE_SHEETS,
    sheets: sheetNames.map((name) => buildSheet(name)),
  };
}

/**
 * Template catalog. Sheet membership reuses getRequiredSheetsForTemplate where a base
 * template type already exists in the schema; the new supplier and container-reservation
 * templates compose existing sheet definitions (never new column sets).
 */
export const XLSX_TEMPLATES = Object.freeze({
  // Buyer request/order workbook.
  [XLSX_TEMPLATE_TYPES.BUYER]: buildTemplate(
    XLSX_TEMPLATE_TYPES.BUYER,
    getRequiredSheetsForTemplate(WORKBOOK_TEMPLATE_TYPES.BUYER),
  ),
  // Seller stock / quotes workbook.
  [XLSX_TEMPLATE_TYPES.SELLER]: buildTemplate(
    XLSX_TEMPLATE_TYPES.SELLER,
    getRequiredSheetsForTemplate(WORKBOOK_TEMPLATE_TYPES.SELLER),
  ),
  // Supplier supply-document workbook (profile + quotes + documents).
  [XLSX_TEMPLATE_TYPES.SUPPLIER]: buildTemplate(
    XLSX_TEMPLATE_TYPES.SUPPLIER,
    ['TRADE_PROFILES', 'IMPORT_QUOTES', 'TRADE_DOCUMENTS'],
  ),
  // Enterprise combined workbook (every sheet).
  [XLSX_TEMPLATE_TYPES.ENTERPRISE]: buildTemplate(
    XLSX_TEMPLATE_TYPES.ENTERPRISE,
    getRequiredSheetsForTemplate(WORKBOOK_TEMPLATE_TYPES.ENTERPRISE),
  ),
  // Container reservation workbook (containers + reservations + linked orders).
  [XLSX_TEMPLATE_TYPES.CONTAINER_RESERVATION]: buildTemplate(
    XLSX_TEMPLATE_TYPES.CONTAINER_RESERVATION,
    ['CONTAINER_SHIPMENTS', 'CARGO_RESERVATIONS', 'DIASPORA_IMPORT_ORDERS'],
  ),
});

export function isSupportedXlsxTemplateType(templateType) {
  return typeof templateType === 'string' && Object.prototype.hasOwnProperty.call(XLSX_TEMPLATES, templateType);
}

export function getXlsxTemplate(templateType) {
  return isSupportedXlsxTemplateType(templateType) ? XLSX_TEMPLATES[templateType] : null;
}

export function listSupportedXlsxTemplateTypes() {
  return Object.keys(XLSX_TEMPLATES);
}
