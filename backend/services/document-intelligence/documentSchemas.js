/**
 * Per-document-class extraction schemas.
 *
 * Each schema declares exactly which fields CarUp asks the vision provider to read off the
 * document, how each value is normalized, where it lands in the candidate envelope, and which
 * structured evidence row (if any) it can populate. A field is only ever present because it was
 * observed: there are no defaults here, and normalization only ever REMOVES a value it cannot
 * trust — it never invents one.
 */

export const OCR_SCHEMA_VERSION = '2026.09.ocr-v1';

/** Strings a document reader uses to say "this field is not on the document / not legible". */
const ABSENT_TOKENS = new Set([
  'n/a', 'na', 'n.a.', 'none', 'nil', 'null', 'undefined', 'unknown', 'not available',
  'not applicable', 'not visible', 'not legible', 'not readable', 'unreadable', 'illegible',
  'missing', 'blank', 'empty', '-', '--', '---', '?',
]);

export function normalizeText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  if (ABSENT_TOKENS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

function isRealCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Dates are accepted only where the calendar reading is unambiguous. A numeric date whose first
 * two components are both <= 12 (e.g. 03/04/1990) cannot be resolved to a day and a month without
 * guessing, so it is reported as unnormalized rather than silently read as either one.
 */
export function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return { value: undefined };

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isRealCalendarDate(year, month, day) ? { value: iso(year, month, day) } : { value: undefined, unnormalized: text };
  }

  match = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/.exec(text);
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (first > 12 && second <= 12 && isRealCalendarDate(year, second, first)) return { value: iso(year, second, first) };
    if (second > 12 && first <= 12 && isRealCalendarDate(year, first, second)) return { value: iso(year, first, second) };
    return { value: undefined, unnormalized: text, reason: 'ambiguous_day_month' };
  }

  match = /^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    const [day, year] = [Number(match[1]), Number(match[3])];
    if (month && isRealCalendarDate(year, month, day)) return { value: iso(year, month, day) };
  }

  match = /^([A-Za-z]{3,})[\s-](\d{1,2}),?[\s-](\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const [day, year] = [Number(match[2]), Number(match[3])];
    if (month && isRealCalendarDate(year, month, day)) return { value: iso(year, month, day) };
  }

  return { value: undefined, unnormalized: text, reason: 'unrecognized_date_format' };
}

/**
 * The ocr evidence schema constrains sex to M or F. An ICAO 'X' (unspecified) is a legitimate
 * reading that the column cannot hold, so it is preserved as an observation rather than dropped
 * silently or forced into one of the two values the column accepts.
 */
export function normalizeSex(value) {
  const text = normalizeText(value);
  if (!text) return { value: undefined };
  const lower = text.toLowerCase();
  if (lower === 'm' || lower === 'male') return { value: 'M' };
  if (lower === 'f' || lower === 'female') return { value: 'F' };
  if (lower === 'x' || lower === 'unspecified') {
    return { value: undefined, unnormalized: text, reason: 'sex_marker_not_representable' };
  }
  return { value: undefined, unnormalized: text, reason: 'unrecognized_sex_value' };
}

export function normalizeYear(value) {
  const text = normalizeText(value);
  if (!text) return { value: undefined };
  const match = /^(\d{4})$/.exec(text);
  if (!match) return { value: undefined, unnormalized: text, reason: 'unrecognized_year' };
  const year = Number(match[1]);
  const ceiling = new Date().getUTCFullYear() + 1;
  if (year < 1900 || year > ceiling) return { value: undefined, unnormalized: text, reason: 'year_out_of_range' };
  return { value: year };
}

/** A VIN is 17 characters and never contains I, O or Q. Anything else is not a VIN reading. */
export function normalizeVin(value) {
  const text = normalizeText(value);
  if (!text) return { value: undefined };
  const compact = text.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(compact)) {
    return { value: undefined, unnormalized: text, reason: 'not_a_17_character_vin' };
  }
  return { value: compact };
}

export function normalizeAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { value };
  const text = normalizeText(value);
  if (!text) return { value: undefined };
  const cleaned = text.replace(/[^\d.]/g, '');
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return { value: undefined, unnormalized: text, reason: 'unrecognized_amount' };
  return { value: Number(cleaned) };
}

function text(target) { return { target, normalize: (v) => ({ value: normalizeText(v) }) }; }
function date(target) { return { target, normalize: normalizeDate }; }

const NATIONAL_ID_FIELDS = {
  first_name: text('top'),
  last_name: text('top'),
  national_id_number: text('top'),
  date_of_birth: date('top'),
  country: text('top'),
  place_of_birth: text('additional'),
  sex: { target: 'additional', normalize: normalizeSex },
  date_of_issue: date('additional'),
};

const PASSPORT_FIELDS = {
  first_name: text('top'),
  last_name: text('top'),
  national_id_number: text('top'), // the passport number occupies the identity-number slot
  date_of_birth: date('top'),
  country: text('top'),
  passport_number: text('additional'),
  sex: { target: 'additional', normalize: normalizeSex },
  nationality: text('additional'),
  place_of_birth: text('additional'),
  date_of_issue: date('additional'),
  expiry: date('additional'),
  issuing_authority: text('additional'),
};

const DRIVERS_LICENCE_FIELDS = {
  first_name: text('top'),
  last_name: text('top'),
  national_id_number: text('top'), // the licence number occupies the identity-number slot
  date_of_birth: date('top'),
  country: text('top'),
  licence_number: text('additional'),
  licence_classes: text('additional'),
  date_of_issue: date('additional'),
  expiry: date('additional'),
  issuing_authority: text('additional'),
};

const REGISTRATION_BOOK_FIELDS = {
  country: text('top'),
  vin: { target: 'additional', normalize: normalizeVin },
  chassis_number: text('additional'),
  engine_number: text('additional'),
  make: text('additional'),
  model: text('additional'),
  year: { target: 'additional', normalize: normalizeYear },
  plate_number: text('additional'),
  registration_number: text('additional'),
  owner_name: text('additional'),
  date_of_registration: date('additional'),
};

const CUSTOMS_DECLARATION_FIELDS = {
  country: text('top'),
  vin: { target: 'additional', normalize: normalizeVin },
  bill_entry_number: text('additional'),
  duty_value_zig: { target: 'additional', normalize: normalizeAmount },
  currency: text('additional'),
  importer_name: text('additional'),
  stamp_date: date('additional'),
  entry_point: text('additional'),
};

const BUSINESS_DOCUMENT_FIELDS = {
  country: text('top'),
  legal_name: text('additional'),
  trading_name: text('additional'),
  company_name: text('additional'),
  registration_number: text('additional'),
  company_registration_number: text('additional'),
  tax_id: text('additional'),
  tax_number: text('additional'),
  tin: text('additional'),
  physical_address: text('additional'),
  address: text('additional'),
  date_of_issue: date('additional'),
  expiry: date('additional'),
  issuing_authority: text('additional'),
};

/**
 * Structured evidence rows are written ONLY when every NOT NULL column of the target table was
 * genuinely observed. The ocr_* tables were declared NOT NULL on the identity fields, which is
 * exactly what used to force placeholders ('Unknown', 'N/A', today's date) into the evidence
 * record. Absence of a row now means absence of a candidate.
 */
const NATIONAL_ID_STRUCTURED = {
  table: 'ocr_national_ids',
  build: (top, extra) => ({
    extracted_first_name: top.first_name,
    extracted_last_name: top.last_name,
    national_id_number: top.national_id_number,
    date_of_birth: top.date_of_birth,
    place_of_birth: extra.place_of_birth,
    sex: extra.sex,
    date_of_issue: extra.date_of_issue,
  }),
  requiredColumns: ['extracted_first_name', 'extracted_last_name', 'national_id_number', 'date_of_birth'],
};

const REGISTRATION_BOOK_STRUCTURED = {
  table: 'ocr_registration_books',
  build: (top, extra) => ({
    extracted_vin: extra.vin,
    extracted_engine_number: extra.engine_number,
    extracted_make: extra.make,
    extracted_model: extra.model,
    extracted_year: extra.year,
    extracted_plate_number: extra.plate_number,
    extracted_owner_name: extra.owner_name,
    extracted_chassis_number: extra.chassis_number,
  }),
  requiredColumns: ['extracted_vin', 'extracted_make', 'extracted_model', 'extracted_year', 'extracted_plate_number', 'extracted_owner_name'],
};

const CUSTOMS_DECLARATION_STRUCTURED = {
  table: 'ocr_customs_declarations',
  build: (top, extra) => ({
    extracted_vin: extra.vin,
    extracted_bill_entry_number: extra.bill_entry_number,
    extracted_duty_value_zig: extra.duty_value_zig,
    extracted_importer_name: extra.importer_name,
    extracted_stamp_date: extra.stamp_date,
  }),
  requiredColumns: ['extracted_vin', 'extracted_bill_entry_number', 'extracted_duty_value_zig', 'extracted_importer_name', 'extracted_stamp_date'],
};

export const DOCUMENT_SCHEMAS = {
  national_id: {
    documentClass: 'zimbabwe_national_id',
    label: 'Zimbabwe National Registration (identity) card',
    guidance: [
      'The national registration number is printed in the form 63-1234567-A-42 (registry district, serial, check letter, district of origin). Transcribe it exactly as printed, including the hyphens.',
      'Surname and given names are printed on separate lines; do not merge them.',
      'Sex is printed as a single letter, M or F.',
    ],
    fields: NATIONAL_ID_FIELDS,
    coreFields: ['first_name', 'last_name', 'national_id_number'],
    structured: NATIONAL_ID_STRUCTURED,
  },
  passport: {
    documentClass: 'passport',
    label: 'Passport biographical data page',
    guidance: [
      'Read the printed biographical fields. If a machine-readable zone (MRZ) is present, use it to confirm the printed values; do not report MRZ filler characters (<) as text.',
      'Report the passport number in both national_id_number and passport_number.',
    ],
    fields: PASSPORT_FIELDS,
    coreFields: ['first_name', 'last_name', 'national_id_number'],
    structured: null,
  },
  drivers_license: {
    documentClass: 'drivers_licence',
    label: "Driver's licence",
    guidance: [
      "Report the licence number in both national_id_number and licence_number.",
      'Vehicle classes are printed as a list of codes; report them as a comma-separated string exactly as printed.',
    ],
    fields: DRIVERS_LICENCE_FIELDS,
    coreFields: ['first_name', 'last_name', 'national_id_number'],
    structured: null,
  },
  registration_book: {
    documentClass: 'vehicle_registration_book',
    label: 'Vehicle registration book',
    guidance: [
      'A VIN / chassis number is 17 characters and never contains the letters I, O or Q.',
      'On this document the chassis number and the VIN are the SAME identifier — it is usually printed once under a combined label. Report that 17-character value in BOTH the vin and chassis_number fields.',
      'The registration (plate) number and the registration book number are different fields; do not substitute one for the other.',
      'Report the registered owner exactly as printed, whether a person or a company.',
    ],
    fields: REGISTRATION_BOOK_FIELDS,
    coreFields: ['vin', 'plate_number'],
    structured: REGISTRATION_BOOK_STRUCTURED,
  },
  customs_declaration: {
    documentClass: 'customs_declaration',
    label: 'Customs / ZIMRA import declaration (bill of entry)',
    guidance: [
      'The bill of entry number is the declaration reference; it is unrelated to any national identity number.',
      'Report the assessed duty as a number, and the currency it is denominated in separately.',
    ],
    fields: CUSTOMS_DECLARATION_FIELDS,
    coreFields: ['vin', 'bill_entry_number'],
    structured: CUSTOMS_DECLARATION_STRUCTURED,
  },
};

const BUSINESS_SCHEMA = {
  documentClass: 'business_document',
  label: 'Business registration / compliance document',
  guidance: [
    'Report the registered legal name exactly as printed, and the trading name separately if both appear.',
    'Company registration numbers and tax numbers are different identifiers; do not substitute one for the other.',
  ],
  fields: BUSINESS_DOCUMENT_FIELDS,
  coreFields: [],
  structured: null,
};

const ALIASES = {
  drivers_licence: 'drivers_license',
  driver_license: 'drivers_license',
  driver_licence: 'drivers_license',
  license: 'drivers_license',
  nationalid: 'national_id',
  national_identity: 'national_id',
  id_card: 'national_id',
  logbook: 'registration_book',
  registration: 'registration_book',
  vehicle_registration: 'registration_book',
  customs: 'customs_declaration',
  bill_of_entry: 'customs_declaration',
};

/**
 * Resolves the schema for a document type. Dealer compliance uploads arrive as `dealer_<type>`
 * and are business documents unless they name one of the identity/vehicle classes.
 */
export function resolveSchema(docType) {
  const raw = typeof docType === 'string' ? docType.trim().toLowerCase() : '';
  const stripped = raw.startsWith('dealer_') ? raw.slice('dealer_'.length) : raw;
  const key = ALIASES[stripped] || stripped;
  if (DOCUMENT_SCHEMAS[key]) return DOCUMENT_SCHEMAS[key];
  if (raw.startsWith('dealer_')) return BUSINESS_SCHEMA;
  return BUSINESS_SCHEMA;
}
