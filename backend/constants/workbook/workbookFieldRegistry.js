/**
 * O2-X5A — Canonical Workbook Field Registry (carup_workbook_registry.v1).
 *
 * The single code-level source for the NEW stakeholder vehicle workbooks
 * (seller_vehicles, dealer_vehicle_inventory): canonical keys, human workbook
 * labels, help text, vocabularies (imported from their OWNING modules — never
 * retyped), importability/exportability, authority class, privacy class and
 * validation metadata. It powers template generation, label↔key/value
 * resolution on import, deterministic normalization (catalog aliases), export
 * column selection, AI-safe metadata and the completeness/drift tests.
 *
 * LAWS (from CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md):
 *   - authority-only (`governed_result`) fields are NEVER importable and are
 *     listed by name so tooling refuses them;
 *   - the 11 private-banking keys (M17/INV-18) may not even exist as columns;
 *   - diaspora sheets are NOT duplicated here — diasporaWorkbookSchema.js
 *     remains their single source and their templates are consumed as-is.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ZIMBABWE_REGISTRATION_STATUSES,
  ZIMBABWE_REGISTRATION_PRESENTATION,
} from '../../services/registration/zimbabweRegistrationLifecycle.js';
import {
  ACCIDENT_DISCLOSURE_STATES,
  INSURANCE_DISCLOSURE_STATES,
  FINANCE_DISCLOSURE_STATES,
  FINANCE_TYPES,
  PRIVATE_FINANCE_KEYS,
} from '../../services/seller/vehicleHistoryDisclosures.js';
import { CLAIM_VISIBILITY } from '../../utils/publicVehicleProjection.js';
import { EVIDENCE_CLASSES, CLASS_SUBTYPES } from '../../services/evidence/evidenceTaxonomy.js';

export const WORKBOOK_REGISTRY_VERSION = 'carup_workbook_registry.v1';
export const VEHICLE_WORKBOOK_SCHEMA_VERSION = '2026.09.x5a.vehicle-v1';

export const VEHICLE_TEMPLATE_KEYS = Object.freeze({
  SELLER_VEHICLES: 'seller_vehicles',
  DEALER_VEHICLE_INVENTORY: 'dealer_vehicle_inventory',
});

/* ------------------------------------------------------------------ *
 * Vocabularies — imported from their owning modules.
 * ------------------------------------------------------------------ */

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../shared/taxonomy/vehicle/catalog.json',
);
const vehicleCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

function catalogVocabulary(dimension) {
  return (vehicleCatalog.dimensions[dimension] || []).map((entry) => ({
    value: entry.label, // the server-accepted value IS the catalog label (see inventory)
    label: entry.label,
    aliases: entry.aliases || [],
  }));
}

function plainVocabulary(values, labels = {}) {
  return values.map((value) => ({ value, label: labels[value] || value, aliases: [] }));
}

const REGISTRATION_STATUS_VOCAB = ZIMBABWE_REGISTRATION_STATUSES.map((value) => ({
  value,
  label: ZIMBABWE_REGISTRATION_PRESENTATION[value].label,
  aliases: [ZIMBABWE_REGISTRATION_PRESENTATION[value].shortLabel],
}));

const LOCATION_VISIBILITY_VOCAB = [
  { value: CLAIM_VISIBILITY.WITHHELD ?? 'withheld', label: 'Keep my location private until I reply to a buyer', aliases: ['private', 'hidden'] },
  { value: CLAIM_VISIBILITY.PROVINCE_ONLY ?? 'province_only', label: 'Show my province only, not my city', aliases: ['province only'] },
  { value: CLAIM_VISIBILITY.PUBLIC ?? 'public', label: 'Show my city and province on the listing', aliases: [] },
];

const BOOLEAN_VOCAB = [
  { value: true, label: 'Yes', aliases: ['y', 'true', '1'] },
  { value: false, label: 'No', aliases: ['n', 'false', '0'] },
];

// Owned by the sell-flow web UI (SellVehicle LISTING_PHOTO_SEQUENCE / GuestSell
// PHOTO_LABELS); duplicated here BY DECISION with a source-pin test that fails
// if the web list changes (o2-x5a-field-registry.test.js).
export const PHOTO_LABELS = Object.freeze([
  'Front three-quarter', 'Front', 'Driver side', 'Passenger side', 'Rear three-quarter',
  'Rear', 'Interior', 'Dashboard', 'Odometer', 'Engine', 'Tyres', 'Any known damage', 'Other',
]);

// Owned by web/src/data/mockData.ts (zimbabweLocations / zimbabweProvinces);
// duplicated BY DECISION with the same source-pin discipline. Advisory (soft)
// vocabularies: an off-list value warns, it does not reject.
export const ZIMBABWE_CITIES = Object.freeze([
  'Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo', 'Chinhoyi', 'Bindura', 'Kadoma',
  'Kwekwe', 'Victoria Falls', 'Marondera', 'Norton', 'Chitungwiza', 'Epworth', 'Redcliff',
]);
export const ZIMBABWE_PROVINCES = Object.freeze([
  'Harare Metropolitan', 'Bulawayo Metropolitan', 'Manicaland', 'Mashonaland Central',
  'Mashonaland East', 'Mashonaland West', 'Masvingo', 'Matabeleland North',
  'Matabeleland South', 'Midlands',
]);

export const LISTING_CURRENCIES = Object.freeze(['USD', 'ZiG']);

const ACCIDENT_STATE_LABELS = {
  yes: 'Yes — it has been in an accident',
  no_known_accident_history: 'No known accident history',
  unknown: "I don't know",
};
const INSURANCE_STATE_LABELS = {
  insured: 'Currently insured',
  not_insured: 'Not currently insured',
  unknown: "I don't know",
};
const FINANCE_STATE_LABELS = {
  none_known: 'No finance or lender interest that I know of',
  active: 'Active finance / lease / lender interest',
  settlement_pending: 'Settlement in progress',
  cleared: 'Finance previously held, now cleared',
  unknown: "I don't know",
};
const FINANCE_TYPE_LABELS = {
  bank_loan: 'Bank loan', vehicle_finance: 'Vehicle finance', lease: 'Lease',
  hire_purchase: 'Hire purchase', secured_lien: 'Secured lending / lien', other: 'Other',
};

const EVIDENCE_CLASS_VOCAB = EVIDENCE_CLASSES.map((value) => ({ value, label: value.replace(/_/g, ' '), aliases: [] }));
const EVIDENCE_SUBTYPE_VALUES = Object.freeze(
  Object.values(CLASS_SUBTYPES).flatMap((subtypes) => Object.keys(subtypes)),
);
export const EVENT_DATE_PRECISIONS = Object.freeze(['day', 'month', 'year', 'unknown']);

/* ------------------------------------------------------------------ *
 * Field definitions.
 *
 * Shared shape: { key, header, help, type, required, vocabulary,
 *   vocabularyMode ('strict' rejects, 'advisory' warns), importable,
 *   exportable, exportRedacted, authority, privacy, validation, example }
 * All fields: AI assistance allowed, AI decision NOT allowed (registry-wide
 * law; no per-field exception exists in v1).
 * ------------------------------------------------------------------ */

const f = (def) => Object.freeze({
  type: 'text', required: false, vocabulary: null, vocabularyMode: 'strict',
  importable: true, exportable: true, exportRedacted: false,
  authority: 'claim', privacy: 'P0', validation: null, example: '', ...def,
});

export const VEHICLE_WORKBOOK_SHEETS = Object.freeze({
  VEHICLES: Object.freeze({
    name: 'VEHICLES',
    description: 'One row per vehicle — identity and Zimbabwe registration claims.',
    identifierKey: 'vin',
    minRowsRequired: true,
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true, privacy: 'P0',
        help: 'The 17-character VIN, or a 12–17 character identifier for older vehicles. Letters, digits and dashes only.',
        validation: { pattern: '^[A-Za-z0-9-]{12,17}$', noIOQat17: true }, example: 'JT1234567890EXMPL' }),
      f({ key: 'make', header: 'Make', required: true, vocabularyMode: 'advisory',
        vocabulary: (vehicleCatalog.makes || []).map((m) => ({ value: m.label || m.name || m.id, label: m.label || m.name || m.id, aliases: m.aliases || [] })),
        help: 'Manufacturer, e.g. Toyota.', example: 'Toyota' }),
      f({ key: 'model', header: 'Model', required: true, help: 'Model, e.g. Hilux.', example: 'Hilux' }),
      f({ key: 'year', header: 'Year', required: true, type: 'number',
        help: 'Year of manufacture (4 digits).', validation: { min: vehicleCatalog.yearPolicy?.technicalMin || 1886, maxOffsetFromCurrentYear: 1 }, example: '2018' }),
      f({ key: 'color', header: 'Color', required: true, vocabulary: catalogVocabulary('colors'),
        help: 'Main exterior color (choose from the list).', example: 'White' }),
      f({ key: 'mileage', header: 'Mileage (km)', required: true, type: 'number',
        help: 'Current odometer reading in kilometres. If you do not know it yet, leave the whole row out until you do — CarUp never records a guessed mileage.',
        validation: { min: 0, integer: true }, example: '85000' }),
      f({ key: 'body_style', header: 'Body style', required: true, vocabulary: catalogVocabulary('bodyStyles'),
        help: 'Body style (choose from the list).', example: 'Pickup' }),
      f({ key: 'seller_stated_condition', header: 'Condition (your words)', required: true, vocabulary: catalogVocabulary('sellerConditions'),
        help: 'Your own statement of condition — this is never a CarUp verdict.', example: 'Used' }),
      f({ key: 'fuel_type', header: 'Fuel type', required: true, vocabulary: catalogVocabulary('fuelTypes'),
        help: 'Fuel type (choose from the list).', example: 'Diesel' }),
      f({ key: 'transmission', header: 'Transmission', required: true, vocabulary: catalogVocabulary('transmissions'),
        help: 'Transmission (choose from the list).', example: 'Automatic' }),
      f({ key: 'drivetrain', header: 'Drivetrain', vocabulary: catalogVocabulary('drivetrains'),
        help: 'Drivetrain, if known (choose from the list).', example: 'RWD' }),
      f({ key: 'engine_number', header: 'Engine number', privacy: 'P2', exportRedacted: true,
        help: 'Engine number as stamped. Needed before the listing can publish.', example: '' }),
      f({ key: 'chassis_number', header: 'Chassis number', privacy: 'P2', exportRedacted: true,
        help: 'Chassis number as stamped. Needed before the listing can publish.', example: '' }),
      f({ key: 'generation', header: 'Generation (optional)', help: 'Generation/series, if known.', example: '' }),
      f({ key: 'trim', header: 'Trim (optional)', help: 'Trim level, if known.', example: '' }),
      f({ key: 'registration_status', header: 'Registration stage', vocabulary: REGISTRATION_STATUS_VOCAB,
        help: 'Where the vehicle is in the Zimbabwe registration journey (choose from the list). "Registration status not established" and "Temporary foreign vehicle — TIP" block publication until resolved.',
        example: ZIMBABWE_REGISTRATION_PRESENTATION.locally_registered.label }),
      f({ key: 'plate_number', header: 'Zimbabwe number plate (if issued)', privacy: 'P1',
        help: 'Required when the stage is "Locally registered in Zimbabwe".', example: '' }),
      f({ key: 'temp_plate_id', header: 'Temporary Import Permit no.', privacy: 'P1',
        help: 'Only for a temporary foreign vehicle (TIP).', example: '' }),
      f({ key: 'registration_country', header: 'Country of registration (optional)',
        help: 'Where the vehicle is currently registered, if outside Zimbabwe.', example: '' }),
    ],
  }),

  LISTINGS: Object.freeze({
    name: 'LISTINGS',
    description: 'One row per vehicle — the commercial listing claims.',
    identifierKey: 'vin',
    minRowsRequired: true,
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true,
        help: 'Must match a row on the VEHICLES sheet.', example: 'JT1234567890EXMPL' }),
      f({ key: 'price', header: 'Asking price', required: true, type: 'number', privacy: 'P1',
        help: 'Asking price (number only, no currency symbol).', validation: { min: 1 }, example: '15500' }),
      f({ key: 'currency', header: 'Currency', required: true, privacy: 'P1',
        vocabulary: plainVocabulary([...LISTING_CURRENCIES], { USD: 'USD', ZiG: 'ZiG' }),
        help: 'USD or ZiG.', example: 'USD' }),
      f({ key: 'listing_city', header: 'City', required: true, vocabularyMode: 'advisory',
        vocabulary: plainVocabulary([...ZIMBABWE_CITIES]),
        help: 'City where the vehicle is offered.', example: 'Harare' }),
      f({ key: 'listing_province', header: 'Province', vocabularyMode: 'advisory',
        vocabulary: plainVocabulary([...ZIMBABWE_PROVINCES]),
        help: 'Province (optional).', example: 'Harare Metropolitan' }),
      f({ key: 'listing_country', header: 'Listing country (optional)',
        help: 'Only if the vehicle is offered outside Zimbabwe.', example: '' }),
      f({ key: 'seller_description', header: 'Description', required: true,
        help: 'Describe the vehicle in your own words (50–500 characters).',
        validation: { minLength: 50, maxLength: 500 }, example: 'Well maintained single-owner Hilux, full service history, new tyres, ready for local registration transfer.' }),
      f({ key: 'seller_features', header: 'Features (comma-separated)', type: 'list',
        help: 'Optional features, separated by commas (max 50).', validation: { maxItems: 50 }, example: 'Air conditioning, Tow bar' }),
      f({ key: 'location_visibility', header: 'Who can see the vehicle location?', privacy: 'P1',
        vocabulary: LOCATION_VISIBILITY_VOCAB,
        help: 'Your privacy choice. If blank, your location stays private.', example: LOCATION_VISIBILITY_VOCAB[0].label }),
      f({ key: 'public_seller_display_enabled', header: 'Show seller name publicly?', type: 'boolean', privacy: 'P1',
        vocabulary: BOOLEAN_VOCAB, help: 'Yes or No. If blank, your name is NOT shown.', example: 'No' }),
    ],
  }),

  ACCIDENT_HISTORY: Object.freeze({
    name: 'ACCIDENT_HISTORY',
    description: 'Accident disclosure — one row per accident event (up to 10 per vehicle). Add a single row with just VIN + the answer if there are no events to describe.',
    identifierKey: 'vin',
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true, help: 'Must match a VEHICLES row.', example: 'JT1234567890EXMPL' }),
      f({ key: 'accident_state', header: 'Has this vehicle been in an accident?', privacy: 'P1',
        vocabulary: plainVocabulary([...ACCIDENT_DISCLOSURE_STATES], ACCIDENT_STATE_LABELS),
        help: 'Answer once per vehicle. Leaving it blank means "not recorded" — it never means "No".',
        example: ACCIDENT_STATE_LABELS.no_known_accident_history }),
      f({ key: 'approx_date', header: 'Approximate date', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. 2023 or 2023-06.', example: '' }),
      f({ key: 'event_mileage', header: 'Mileage at the time (if known)', privacy: 'P1', validation: { maxLength: 200 }, help: 'In your own words.', example: '' }),
      f({ key: 'damage_area', header: 'Damaged area', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. front-left wing.', example: '' }),
      f({ key: 'severity', header: 'Severity (your words)', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. light panel damage.', example: '' }),
      f({ key: 'insurer_involved', header: 'Insurer involved?', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. yes — claim lodged.', example: '' }),
      f({ key: 'police_report_state', header: 'Police report', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. filed / none.', example: '' }),
      f({ key: 'repair_state', header: 'Repair state', privacy: 'P1', validation: { maxLength: 200 }, help: 'e.g. fully repaired.', example: '' }),
      f({ key: 'repairer', header: 'Repairer / garage (if known)', privacy: 'P1', validation: { maxLength: 200 }, help: 'Who repaired it.', example: '' }),
    ],
  }),

  DISCLOSURES: Object.freeze({
    name: 'DISCLOSURES',
    description: 'One row per vehicle — insurance and finance/lender disclosure. CarUp never asks for balances, repayment amounts, rates or account numbers.',
    identifierKey: 'vin',
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true, help: 'Must match a VEHICLES row.', example: 'JT1234567890EXMPL' }),
      f({ key: 'insurance_state', header: 'Currently insured?', privacy: 'P1',
        vocabulary: plainVocabulary([...INSURANCE_DISCLOSURE_STATES], INSURANCE_STATE_LABELS),
        help: 'Blank means "not recorded".', example: INSURANCE_STATE_LABELS.unknown }),
      f({ key: 'insurer_name', header: 'Insurer (optional)', privacy: 'P1', validation: { maxLength: 200 },
        help: 'Only used when the vehicle is currently insured.', example: '' }),
      f({ key: 'finance_state', header: 'Finance / lender interest?', privacy: 'P1',
        vocabulary: plainVocabulary([...FINANCE_DISCLOSURE_STATES], FINANCE_STATE_LABELS),
        help: 'Blank means "not recorded".', example: FINANCE_STATE_LABELS.none_known }),
      f({ key: 'finance_type', header: 'Type of finance', privacy: 'P1',
        vocabulary: plainVocabulary([...FINANCE_TYPES], FINANCE_TYPE_LABELS),
        help: 'Only when there is (or was) finance.', example: '' }),
      f({ key: 'lender_name', header: 'Lender / provider (optional)', privacy: 'P1', validation: { maxLength: 200 },
        help: 'Name only — never account details.', example: '' }),
    ],
  }),

  MEDIA: Object.freeze({
    name: 'MEDIA',
    description: 'Photo REFERENCES — one row per photo (up to 15 per vehicle). Files themselves are uploaded on the site; this sheet carries web addresses.',
    identifierKey: 'vin',
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true, help: 'Must match a VEHICLES row.', example: 'JT1234567890EXMPL' }),
      f({ key: 'image_url', header: 'Photo web address (http/https)', required: true, type: 'url',
        help: 'A public http(s) address of the photo.', validation: { pattern: '^https?://' }, example: 'https://example.com/hilux-front.jpg' }),
      f({ key: 'photo_label', header: 'What the photo shows', vocabulary: plainVocabulary([...PHOTO_LABELS]),
        help: 'Choose from the list.', example: 'Front three-quarter' }),
      f({ key: 'is_primary', header: 'Cover photo? (one per vehicle)', type: 'boolean', vocabulary: BOOLEAN_VOCAB,
        help: 'Mark exactly one photo per vehicle as the cover.', example: 'No' }),
      f({ key: 'display_order', header: 'Display order', type: 'number', validation: { min: 0, integer: true },
        help: 'Optional — row order is used if blank.', example: '' }),
    ],
  }),

  EVIDENCE_NOTES: Object.freeze({
    name: 'EVIDENCE_NOTES',
    description: 'Evidence REFERENCES — documents/photos supporting the vehicle history. Imported evidence always starts as PENDING; CarUp review decides verification.',
    identifierKey: 'vin',
    fields: [
      f({ key: 'vin', header: 'VIN / Vehicle Identifier', required: true, authority: 'evidence_ref', help: 'Must match a VEHICLES row.', example: 'JT1234567890EXMPL' }),
      f({ key: 'evidence_class', header: 'Evidence category', required: true, authority: 'evidence_ref', privacy: 'P1',
        vocabulary: EVIDENCE_CLASS_VOCAB, help: 'What kind of history this evidences.', example: 'registration' }),
      f({ key: 'evidence_subtype', header: 'Evidence type', authority: 'evidence_ref', privacy: 'P1', vocabularyMode: 'advisory',
        vocabulary: plainVocabulary([...EVIDENCE_SUBTYPE_VALUES]), help: 'The specific document type, if known.', example: 'registration_book' }),
      f({ key: 'file_url', header: 'Document/photo web address', required: true, type: 'url', authority: 'evidence_ref', privacy: 'P2', exportable: false,
        validation: { pattern: '^https?://' }, help: 'A web address CarUp can fetch the file from.', example: 'https://example.com/regbook.pdf' }),
      f({ key: 'event_date', header: 'Date of the event', type: 'date', authority: 'evidence_ref', privacy: 'P1',
        help: 'ISO date (YYYY-MM-DD), if known.', example: '2024-06-15' }),
      f({ key: 'event_date_precision', header: 'How precise is the date?', authority: 'evidence_ref', privacy: 'P1',
        vocabulary: plainVocabulary([...EVENT_DATE_PRECISIONS]), help: 'day, month, year or unknown.', example: 'day' }),
      f({ key: 'evidence_label', header: 'Your label for this document', authority: 'evidence_ref', privacy: 'P1',
        validation: { maxLength: 200 }, help: 'A short label so you can find it later.', example: 'Registration book (front)' }),
    ],
  }),

  BUSINESS: Object.freeze({
    name: 'BUSINESS',
    description: 'One row — your dealer application profile. tenant assignment is NEVER a workbook column.',
    identifierKey: 'legal_name',
    dealerOnly: true,
    fields: [
      f({ key: 'legal_name', header: 'Legal business name', required: true, privacy: 'P1', help: 'As registered.', example: 'Moyo Motors (Pvt) Ltd' }),
      f({ key: 'trading_name', header: 'Trading name', privacy: 'P1', help: 'If different from the legal name.', example: 'Moyo Motors' }),
      f({ key: 'registration_number', header: 'Company registration number', privacy: 'P2', help: 'Company registry number.', example: 'CR-12345' }),
      f({ key: 'tax_id', header: 'Tax ID', privacy: 'P2', help: 'Tax identifier.', example: '' }),
      f({ key: 'physical_address', header: 'Physical address', privacy: 'P2', help: 'Main business address.', example: '' }),
      f({ key: 'responsible_person', header: 'Responsible person', privacy: 'P2', help: 'The accountable person for this application.', example: '' }),
      f({ key: 'operating_country', header: 'Operating country', privacy: 'P1', help: 'Where the business operates.', example: 'Zimbabwe' }),
    ],
  }),

  BRANCHES: Object.freeze({
    name: 'BRANCHES',
    description: 'One row per proposed branch.',
    identifierKey: 'branch_name',
    dealerOnly: true,
    fields: [
      f({ key: 'branch_name', header: 'Branch name', required: true, privacy: 'P1', help: 'Branch name.', example: 'Harare CBD' }),
      f({ key: 'branch_address', header: 'Branch address', privacy: 'P2', help: 'Branch address.', example: '12 Samora Machel Ave' }),
    ],
  }),
});

/* ------------------------------------------------------------------ *
 * Forbidden columns — refused BY NAME at the import boundary.
 * ------------------------------------------------------------------ */

// governed_result facts: server-derived authority outcomes. A workbook column
// mapping onto any of these is refused before validation ever runs.
export const GOVERNED_RESULT_FIELDS = Object.freeze([
  'trust_score', 'verification_status', 'duty_paid', 'police_verified', 'publication_status',
  'owner_id', 'current_seller_id', 'tenant_id', 'seller_authority_status', 'can_publish',
  'identity_status', 'compliance_review_state', 'active_state', 'restriction_state',
  'suspension_state', 'investigation_state', 'expiry_state', 'trust_impact', 'trust_score_impact',
]);

// M17/INV-18 — the 11 private-banking keys may not exist as workbook columns at all.
export const FORBIDDEN_WORKBOOK_COLUMNS = Object.freeze([
  ...GOVERNED_RESULT_FIELDS,
  ...PRIVATE_FINANCE_KEYS,
]);

/* ------------------------------------------------------------------ *
 * Template composition + engine template objects.
 * ------------------------------------------------------------------ */

const VEHICLE_MODULES = ['VEHICLES', 'LISTINGS', 'ACCIDENT_HISTORY', 'DISCLOSURES', 'MEDIA', 'EVIDENCE_NOTES'];

export const VEHICLE_TEMPLATE_SHEETS = Object.freeze({
  [VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES]: Object.freeze([...VEHICLE_MODULES]),
  [VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY]: Object.freeze(['BUSINESS', 'BRANCHES', ...VEHICLE_MODULES]),
});

const PRIVACY_WARNING =
  'PRIVACY: This workbook may contain personal and commercial information (engine/chassis '
  + 'numbers, plates, business identifiers, pricing). Do not email it unencrypted, do not store '
  + 'it on shared/unmanaged drives, and delete local copies after import. Workbook rows are '
  + 'offline claims only — nothing becomes CarUp truth until you confirm an import, and '
  + 'imported vehicles start as private DRAFTS. CarUp never asks for bank balances, repayment '
  + 'amounts, rates or account numbers in any workbook.';

const IMPORT_INSTRUCTIONS = Object.freeze([
  'Keep the header row (row 1) exactly as generated — the column names identify the fields.',
  'Row 2 is a help row describing each column; it is ignored on import.',
  'Example rows are marked "EXAMPLE" in the first column — delete them before uploading.',
  'One record per row. Only the VEHICLES and LISTINGS sheets need rows; the rest are optional.',
  'For columns with a dropdown, choose only from the offered values.',
  'Do not add formulas — cells are read as text. Dates are YYYY-MM-DD.',
  'Photos and documents travel as web addresses; files themselves are uploaded on the site.',
  'Upload the saved .xlsx in Workbook tools. Nothing is imported until you confirm the mapping,',
  'review the dry run, and explicitly confirm the import. Imported vehicles are DRAFTS —',
  'publication stays a separate governed step on the site.',
  'This workbook also opens in Google Sheets (File → Import); re-download as .xlsx to upload.',
]);

function sheetToEngineSheet(sheetDef) {
  return {
    name: sheetDef.name,
    primaryKey: sheetDef.fields[0].header,
    identifierKey: sheetDef.fields.find((field) => field.key === sheetDef.identifierKey)?.header
      || sheetDef.fields[0].header,
    apiTable: null,
    description: sheetDef.description,
    columns: sheetDef.fields.map((field) => ({
      key: field.key,
      header: field.header,
      help: field.help || '',
      required: Boolean(field.required),
      type: field.vocabulary ? 'enum' : field.type,
      validationList: field.vocabulary ? field.vocabulary.map((entry) => entry.label) : null,
      statusListName: field.vocabulary ? `${sheetDef.name}.${field.key}` : null,
      exampleValue: field.example ?? '',
    })),
  };
}

function referenceListsForTemplate(templateKey) {
  const lists = {};
  for (const sheetName of VEHICLE_TEMPLATE_SHEETS[templateKey]) {
    for (const field of VEHICLE_WORKBOOK_SHEETS[sheetName].fields) {
      if (field.vocabulary) {
        lists[`${sheetName}.${field.key}`] = field.vocabulary.map((entry) => entry.label);
      }
    }
  }
  return lists;
}

export function isVehicleWorkbookTemplateKey(templateKey) {
  return Object.values(VEHICLE_TEMPLATE_KEYS).includes(templateKey);
}

/**
 * Build the template OBJECT the (generalized) XLSX engine consumes — the same
 * shape diasporaWorkbookTemplates.js produces, so ONE engine serves both.
 */
export function buildVehicleWorkbookTemplate(templateKey) {
  if (!isVehicleWorkbookTemplateKey(templateKey)) return null;
  return {
    templateType: templateKey,
    schemaVersion: VEHICLE_WORKBOOK_SCHEMA_VERSION,
    registryVersion: WORKBOOK_REGISTRY_VERSION,
    privacyWarning: PRIVACY_WARNING,
    importInstructions: [...IMPORT_INSTRUCTIONS],
    referenceSheets: [
      { name: '_REFERENCE', hidden: true, protected: true, statusLists: referenceListsForTemplate(templateKey) },
    ],
    sheets: VEHICLE_TEMPLATE_SHEETS[templateKey].map((sheetName) => sheetToEngineSheet(VEHICLE_WORKBOOK_SHEETS[sheetName])),
  };
}

/* ------------------------------------------------------------------ *
 * Resolution helpers (import side): header → field, cell → canonical value.
 * ------------------------------------------------------------------ */

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getSheetDefinition(sheetName) {
  return VEHICLE_WORKBOOK_SHEETS[sheetName] || null;
}

/** Accepts the human header OR the canonical key (case/space-insensitive). */
export function resolveFieldForHeader(sheetName, headerText) {
  const sheet = getSheetDefinition(sheetName);
  if (!sheet) return null;
  const token = normalizeToken(headerText);
  if (!token) return null;
  return sheet.fields.find(
    (field) => normalizeToken(field.header) === token || normalizeToken(field.key) === token,
  ) || null;
}

/**
 * Resolve a cell against a field's vocabulary.
 * Returns { value, method } — method 'canonical' | 'label' | 'alias' | null.
 * Alias hits are DETERMINISTIC normalization (the catalog owns the aliases).
 */
export function resolveVocabularyValue(field, cellText) {
  if (!field?.vocabulary) return { value: cellText, method: 'free' };
  const token = normalizeToken(cellText);
  if (!token) return { value: null, method: 'blank' };
  for (const entry of field.vocabulary) {
    if (normalizeToken(entry.value) === token) return { value: entry.value, method: 'canonical' };
  }
  for (const entry of field.vocabulary) {
    if (normalizeToken(entry.label) === token) return { value: entry.value, method: 'label' };
  }
  for (const entry of field.vocabulary) {
    if ((entry.aliases || []).some((alias) => normalizeToken(alias) === token)) {
      return { value: entry.value, method: 'alias' };
    }
  }
  return { value: null, method: null };
}

/** Every importable field key for a template — the completeness-test surface. */
export function listImportableFieldKeys(templateKey) {
  const keys = new Set();
  for (const sheetName of VEHICLE_TEMPLATE_SHEETS[templateKey] || []) {
    for (const field of VEHICLE_WORKBOOK_SHEETS[sheetName].fields) {
      if (field.importable) keys.add(field.key);
    }
  }
  return [...keys];
}

/**
 * Documented intentional exclusions — user-enterable on the site but NOT
 * importable, with the reason (mirrors catalogue §4). The drift tripwire test
 * requires every accepted sell-flow key to be importable, listed here, or
 * server-internal.
 */
export const INTENTIONALLY_NON_IMPORTABLE = Object.freeze({
  claim_type: 'Seller-authority claims are one-at-a-time governed actions on the site — bulk claiming is refused.',
  import_status: 'Legacy alias of registration_status — the workbook carries the canonical field.',
  images: 'Media travels as MEDIA-sheet URL references, not as an inline images array.',
  reuse_existing_passport: 'An interactive duplicate-VIN decision made against a live warning, not a bulk assertion.',
  client_submission_id: 'Generated per row by the importer (idempotency machinery).',
  condition: 'Alias of seller_stated_condition — the workbook carries the canonical field.',
  category: 'Alias of body_style — the workbook carries the canonical field.',
  description: 'Alias of seller_description — the workbook carries the canonical field.',
  features: 'Alias of seller_features — the workbook carries the canonical field.',
  location: 'Alias of listing_city — the workbook carries the canonical field.',
  province: 'Alias of listing_province — the workbook carries the canonical field.',
  country: 'Alias of listing_country — the workbook carries the canonical field.',
  accident_disclosure: 'Carried as the ACCIDENT_HISTORY sheet (state + events), not a JSON cell.',
  insurance_disclosure: 'Carried as DISCLOSURES-sheet columns, not a JSON cell.',
  finance_disclosure: 'Carried as DISCLOSURES-sheet columns, not a JSON cell.',
});
