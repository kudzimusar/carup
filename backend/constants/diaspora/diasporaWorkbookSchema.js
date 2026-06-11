import {
  CONTAINER_STATUSES,
  DOCUMENT_STATUSES,
  IMPORT_ORDER_STATUSES,
  RESERVATION_STATUSES,
  SHIPMENT_STATUSES,
} from './diasporaStatuses.js';

export const WORKBOOK_TEMPLATE_TYPES = Object.freeze({
  BUYER: 'buyer',
  SELLER: 'seller',
  ENTERPRISE: 'enterprise',
});

export const WORKBOOK_ROLE_TYPES = Object.freeze([
  'buyer',
  'seller',
  'supplier',
  'logistics_partner',
  'clearing_agent',
  'reviewer',
  'enterprise_partner',
]);

export const WORKBOOK_ORDER_TYPES = Object.freeze([
  'vehicle_import',
  'parts_import',
  'parts_export',
  'stock_supply',
  'container_space',
]);

export const WORKBOOK_CURRENCIES = Object.freeze(['USD', 'JPY', 'ZWL', 'ZAR', 'AED', 'GBP']);

export const WORKBOOK_QUOTE_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);

export const WORKBOOK_COMPLIANCE_STATUSES = Object.freeze([
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'FLAGGED',
  'REJECTED',
]);

export const WORKBOOK_PAYMENT_STATUSES = Object.freeze([
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'FAILED',
  'REFUNDED',
  'DISPUTED',
]);

export const WORKBOOK_VERIFICATION_STATUSES = Object.freeze([
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'FLAGGED',
  'SUSPENDED',
]);

export const WORKBOOK_DOCUMENT_TYPES = Object.freeze([
  'passport',
  'national_id',
  'residence_card',
  'vehicle_registration',
  'auction_sheet',
  'bill_of_lading',
  'commercial_invoice',
  'export_certificate',
  'customs_declaration',
  'inspection_certificate',
  'insurance_certificate',
  'duty_receipt',
  'packing_list',
  'port_release_order',
  'police_clearance',
  'mechanical_report',
  'supplier_invoice',
  'payment_proof',
]);

export const WORKBOOK_RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
export const WORKBOOK_APPROVAL_STATUSES = Object.freeze(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']);
export const WORKBOOK_EXECUTION_STATUSES = Object.freeze(['DRAFT', 'VALIDATED', 'BLOCKED', 'READY_FOR_IMPORT', 'IMPORTED']);

export const WORKBOOK_STATUS_LISTS = Object.freeze({
  IMPORT_ORDER_STATUSES: Object.freeze(Object.values(IMPORT_ORDER_STATUSES)),
  DOCUMENT_STATUSES: Object.freeze(Object.values(DOCUMENT_STATUSES)),
  CONTAINER_STATUSES: Object.freeze(Object.values(CONTAINER_STATUSES)),
  RESERVATION_STATUSES: Object.freeze(Object.values(RESERVATION_STATUSES)),
  SHIPMENT_STATUSES: Object.freeze(Object.values(SHIPMENT_STATUSES)),
  ROLE_TYPES: WORKBOOK_ROLE_TYPES,
  ORDER_TYPES: WORKBOOK_ORDER_TYPES,
  CURRENCIES: WORKBOOK_CURRENCIES,
  QUOTE_STATUSES: WORKBOOK_QUOTE_STATUSES,
  COMPLIANCE_STATUSES: WORKBOOK_COMPLIANCE_STATUSES,
  PAYMENT_STATUSES: WORKBOOK_PAYMENT_STATUSES,
  VERIFICATION_STATUSES: WORKBOOK_VERIFICATION_STATUSES,
  DOCUMENT_TYPES: WORKBOOK_DOCUMENT_TYPES,
  RISK_LEVELS: WORKBOOK_RISK_LEVELS,
  APPROVAL_STATUSES: WORKBOOK_APPROVAL_STATUSES,
  EXECUTION_STATUSES: WORKBOOK_EXECUTION_STATUSES,
});

export const WORKBOOK_SHEETS = Object.freeze({
  TRADE_PROFILES: Object.freeze({
    description: 'Diaspora buyer, seller, supplier, logistics, and enterprise trade profiles.',
    primaryKey: 'TRADE_PROFILE_ID',
    apiTable: 'diaspora_trade_profiles',
    requiredColumns: Object.freeze(['TRADE_PROFILE_ID', 'USER_ID', 'COUNTRY', 'CITY', 'ROLE_TYPE', 'VERIFICATION_STATUS']),
    optionalColumns: Object.freeze(['CARUP_PROFILE_UUID', 'ORGANIZATION_ID', 'TRUST_SCORE', 'COMPLETED_SHIPMENTS_COUNT', 'DISPUTE_COUNT', 'RATING_AVERAGE', 'NOTES']),
    statusColumns: Object.freeze({ ROLE_TYPE: 'ROLE_TYPES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  DIASPORA_IMPORT_ORDERS: Object.freeze({
    description: 'Buyer demand, import/export orders, and workbook-staged active order documents.',
    primaryKey: 'IMPORT_ORDER_ID',
    apiTable: 'diaspora_import_orders',
    requiredColumns: Object.freeze(['IMPORT_ORDER_ID', 'BUYER_TRADE_PROFILE_ID', 'ORDER_TYPE', 'ORIGIN_COUNTRY', 'DESTINATION_COUNTRY', 'STATUS', 'BUDGET_CURRENCY']),
    optionalColumns: Object.freeze(['CARUP_IMPORT_ORDER_UUID', 'LINKED_VEHICLE_VIN', 'PART_ID', 'VEHICLE_ID', 'ORIGIN_CITY', 'DESTINATION_CITY', 'REQUESTED_MAKE', 'REQUESTED_MODEL', 'REQUESTED_YEAR_MIN', 'REQUESTED_YEAR_MAX', 'BUDGET_AMOUNT', 'AUCTION_LOT_NUMBER', 'CHASSIS_NUMBER', 'VIN', 'VERIFICATION_STATUS', 'PAYMENT_STATUS', 'COMPLIANCE_STATUS', 'CONTAINER_ID', 'SHIPMENT_ID', 'NOTES']),
    statusColumns: Object.freeze({ ORDER_TYPE: 'ORDER_TYPES', STATUS: 'IMPORT_ORDER_STATUSES', BUDGET_CURRENCY: 'CURRENCIES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES', PAYMENT_STATUS: 'PAYMENT_STATUSES', COMPLIANCE_STATUS: 'COMPLIANCE_STATUSES' }),
  }),
  IMPORT_QUOTES: Object.freeze({
    description: 'Supplier quotes attached to import orders or active buyer requests.',
    primaryKey: 'QUOTE_ID',
    apiTable: 'diaspora_import_quotes',
    requiredColumns: Object.freeze(['QUOTE_ID', 'IMPORT_ORDER_ID', 'SELLER_TRADE_PROFILE_ID', 'QUOTE_AMOUNT', 'QUOTE_CURRENCY', 'STATUS']),
    optionalColumns: Object.freeze(['CARUP_QUOTE_UUID', 'VALID_UNTIL', 'INCLUSIONS', 'EXCLUSIONS', 'LEAD_TIME_DAYS', 'NOTES']),
    statusColumns: Object.freeze({ QUOTE_CURRENCY: 'CURRENCIES', STATUS: 'QUOTE_STATUSES' }),
  }),
  TRADE_DOCUMENTS: Object.freeze({
    description: 'Passports, invoices, bills of lading, customs documents, OCR output, and verification state.',
    primaryKey: 'DOCUMENT_ID',
    apiTable: 'diaspora_trade_documents',
    requiredColumns: Object.freeze(['DOCUMENT_ID', 'DOCUMENT_TYPE', 'VERIFICATION_STATUS']),
    optionalColumns: Object.freeze(['CARUP_DOCUMENT_UUID', 'IMPORT_ORDER_ID', 'TRADE_PROFILE_ID', 'UPLOADED_BY', 'DOCUMENT_URL', 'DRIVE_FILE_ID', 'STORAGE_PATH', 'OCR_DOCUMENT_ID', 'EXTRACTED_NAME', 'EXTRACTED_ID_NUMBER', 'EXTRACTED_CHASSIS_NUMBER', 'EXTRACTED_INVOICE_AMOUNT', 'OCR_CONFIDENCE', 'REVIEWED_BY', 'REVIEWED_AT', 'NOTES']),
    statusColumns: Object.freeze({ DOCUMENT_TYPE: 'DOCUMENT_TYPES', VERIFICATION_STATUS: 'DOCUMENT_STATUSES' }),
  }),
  CONTAINER_SHIPMENTS: Object.freeze({
    description: 'Container co-loading marketplace capacity and lifecycle tracking.',
    primaryKey: 'CONTAINER_ID',
    apiTable: 'diaspora_container_shipments',
    requiredColumns: Object.freeze(['CONTAINER_ID', 'ORIGIN_COUNTRY', 'ORIGIN_CITY', 'DESTINATION_COUNTRY', 'DESTINATION_CITY', 'DEPARTURE_DATE', 'BOOKING_DEADLINE', 'CONTAINER_TYPE', 'TOTAL_CAPACITY_VOLUME', 'STATUS']),
    optionalColumns: Object.freeze(['CARUP_CONTAINER_UUID', 'ESTIMATED_ARRIVAL_DATE', 'TOTAL_CAPACITY_WEIGHT', 'USED_CAPACITY_VOLUME', 'AVAILABLE_CAPACITY_VOLUME', 'FILL_PERCENT', 'CAPACITY_FLAG', 'COORDINATOR_ID', 'VERIFICATION_STATUS', 'NOTES']),
    statusColumns: Object.freeze({ STATUS: 'CONTAINER_STATUSES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  CARGO_RESERVATIONS: Object.freeze({
    description: 'Cargo slot reservations against a container and import order.',
    primaryKey: 'RESERVATION_ID',
    apiTable: 'diaspora_cargo_reservations',
    requiredColumns: Object.freeze(['RESERVATION_ID', 'CONTAINER_ID', 'IMPORT_ORDER_ID', 'CARGO_TYPE', 'ESTIMATED_VOLUME', 'CURRENCY', 'RESERVATION_STATUS']),
    optionalColumns: Object.freeze(['CARUP_RESERVATION_UUID', 'BUYER_TRADE_PROFILE_ID', 'SELLER_TRADE_PROFILE_ID', 'ESTIMATED_WEIGHT', 'DECLARED_VALUE', 'CARGO_DESCRIPTION', 'PICKUP_LOCATION', 'RECEIVER_NAME', 'RECEIVER_PHONE', 'RECEIVER_LOCATION', 'INVOICE_DOCUMENT_ID', 'DIMENSIONS_DOCUMENT_ID', 'VERIFICATION_STATUS', 'NOTES']),
    statusColumns: Object.freeze({ CURRENCY: 'CURRENCIES', RESERVATION_STATUS: 'RESERVATION_STATUSES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  SHIPMENTS: Object.freeze({
    description: 'Shipment records and timeline anchors linked to import orders and containers.',
    primaryKey: 'SHIPMENT_ID',
    apiTable: 'diaspora_shipments',
    requiredColumns: Object.freeze(['SHIPMENT_ID', 'IMPORT_ORDER_ID', 'STATUS']),
    optionalColumns: Object.freeze(['CARUP_SHIPMENT_UUID', 'CONTAINER_ID', 'CARRIER_NAME', 'TRACKING_NUMBER', 'ORIGIN_PORT', 'DESTINATION_PORT', 'DEPARTURE_DATE', 'ESTIMATED_ARRIVAL_DATE', 'ACTUAL_ARRIVAL_DATE', 'VERIFICATION_STATUS', 'DELAY_FLAG', 'NOTES']),
    statusColumns: Object.freeze({ STATUS: 'SHIPMENT_STATUSES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  COMPLIANCE_REVIEWS: Object.freeze({
    description: 'Government, customs, duty, and compliance review controls.',
    primaryKey: 'COMPLIANCE_REVIEW_ID',
    apiTable: 'diaspora_compliance_reviews',
    requiredColumns: Object.freeze(['COMPLIANCE_REVIEW_ID', 'IMPORT_ORDER_ID', 'REVIEW_TYPE', 'STATUS']),
    optionalColumns: Object.freeze(['CARUP_COMPLIANCE_UUID', 'ASSIGNED_TO', 'REVIEWED_BY', 'REVIEWED_AT', 'HS_CODE', 'CUSTOMS_VALUE', 'DUTY_RATE', 'VAT_RATE', 'DUTY_AMOUNT', 'TOTAL_TAX_DUTY', 'VERIFICATION_STATUS', 'NOTES']),
    statusColumns: Object.freeze({ STATUS: 'COMPLIANCE_STATUSES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  PAYMENT_MILESTONES: Object.freeze({
    description: 'Deposits, balances, duty, freight, insurance, escrow, and payment milestones.',
    primaryKey: 'PAYMENT_MILESTONE_ID',
    apiTable: 'diaspora_payment_milestones',
    requiredColumns: Object.freeze(['PAYMENT_MILESTONE_ID', 'IMPORT_ORDER_ID', 'MILESTONE_TYPE', 'AMOUNT', 'CURRENCY', 'STATUS']),
    optionalColumns: Object.freeze(['CARUP_PAYMENT_UUID', 'DUE_DATE', 'EXTERNAL_REFERENCE', 'CONFIRMED_BY', 'CONFIRMED_AT', 'VERIFICATION_STATUS', 'NOTES']),
    statusColumns: Object.freeze({ CURRENCY: 'CURRENCIES', STATUS: 'PAYMENT_STATUSES', VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  REPUTATION_RECORDS: Object.freeze({
    description: 'Buyer, seller, supplier, and logistics partner ratings after transactions.',
    primaryKey: 'REPUTATION_RECORD_ID',
    apiTable: 'diaspora_reputation_records',
    requiredColumns: Object.freeze(['REPUTATION_RECORD_ID', 'TRADE_PROFILE_ID', 'RATING']),
    optionalColumns: Object.freeze(['CARUP_REPUTATION_UUID', 'IMPORT_ORDER_ID', 'REVIEWER_ID', 'REVIEW_TEXT', 'DISPUTE_FLAG', 'VERIFICATION_STATUS', 'NOTES']),
    statusColumns: Object.freeze({ VERIFICATION_STATUS: 'VERIFICATION_STATUSES' }),
  }),
  AI_COMMAND_CENTER: Object.freeze({
    description: 'AI text/voice command staging surface. Commands validate into draft actions; they never bypass service-layer authorization.',
    primaryKey: 'COMMAND_ID',
    apiTable: null,
    requiredColumns: Object.freeze(['COMMAND_ID', 'RAW_COMMAND', 'INTENT', 'RISK_LEVEL', 'CONFIDENCE_SCORE', 'APPROVAL_STATUS', 'EXECUTION_STATUS']),
    optionalColumns: Object.freeze(['VOICE_TRANSCRIPT', 'REQUESTED_BY', 'TARGET_SHEET', 'TARGET_RECORD_ID', 'EXTRACTED_PART_ID', 'EXTRACTED_VEHICLE_ID', 'EXTRACTED_QUANTITY', 'ERROR_MESSAGE', 'CREATED_AT', 'NOTES']),
    statusColumns: Object.freeze({ RISK_LEVEL: 'RISK_LEVELS', APPROVAL_STATUS: 'APPROVAL_STATUSES', EXECUTION_STATUS: 'EXECUTION_STATUSES' }),
  }),
});

export const WORKBOOK_TEMPLATE_SHEETS = Object.freeze({
  [WORKBOOK_TEMPLATE_TYPES.BUYER]: Object.freeze(['DIASPORA_IMPORT_ORDERS', 'TRADE_DOCUMENTS', 'PAYMENT_MILESTONES', 'AI_COMMAND_CENTER']),
  [WORKBOOK_TEMPLATE_TYPES.SELLER]: Object.freeze(['TRADE_PROFILES', 'IMPORT_QUOTES', 'TRADE_DOCUMENTS', 'CARGO_RESERVATIONS', 'AI_COMMAND_CENTER']),
  [WORKBOOK_TEMPLATE_TYPES.ENTERPRISE]: Object.freeze(Object.keys(WORKBOOK_SHEETS)),
});

export function normalizeWorkbookTemplateType(templateType = WORKBOOK_TEMPLATE_TYPES.ENTERPRISE) {
  const normalized = String(templateType || WORKBOOK_TEMPLATE_TYPES.ENTERPRISE).trim().toLowerCase();
  return Object.values(WORKBOOK_TEMPLATE_TYPES).includes(normalized)
    ? normalized
    : WORKBOOK_TEMPLATE_TYPES.ENTERPRISE;
}

export function getRequiredSheetsForTemplate(templateType = WORKBOOK_TEMPLATE_TYPES.ENTERPRISE) {
  return WORKBOOK_TEMPLATE_SHEETS[normalizeWorkbookTemplateType(templateType)];
}
