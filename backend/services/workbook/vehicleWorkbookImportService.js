/**
 * O2-X5A — Seller/Dealer vehicle workbook import chain.
 *
 * file → inspect (version gate, per-sheet headers, mapping proposals)
 *      → human mapping confirmation (checksum-bound; X5 discipline, user-scoped)
 *      → validation + dry run (registry vocab label/alias→canonical; fail-closed)
 *      → persisted batch/rows in the EXISTING workbook store
 *      → explicit confirmation → EXECUTION that replays each accepted vehicle
 *        through the canonical POST /api/vehicles/add contract AS THE USER
 *        (loopback dispatch; injectable for tests) → receipts.
 *
 * LAWS: the certified create route stays the ONLY listing writer (no parallel
 * insert path); imported vehicles are DRAFTS; forbidden/authority columns are
 * refused BY NAME before validation; a changed file (new checksum) voids its
 * mapping confirmation; nothing writes without the reviewed dry run + explicit
 * confirm; per-vehicle client_submission_id is minted at dry-run time so a
 * retry replays idempotently instead of duplicating.
 */
import http from 'http';
import https from 'https';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { resolveBuildProvenance } from '../../config/buildProvenance.js';
// F1/F2 — the workbook must apply the SAME canonical contracts the evidence route applies, by
// CALLING them. A second copy of classification or role rules would drift, and the drift is the
// defect: the dry run said "importable" for rows the canonical route always refused.
import {
  validateEvidenceUploadPayload,
  canUploadEvidenceRecord,
} from '../evidence/evidenceService.js';
import {
  sha256Checksum,
  assertAllowedSpreadsheet,
  DEFAULT_LIMITS,
} from '../diaspora/workbook/diasporaWorkbookUploadSecurity.js';
import { parseWorkbook } from '../diaspora/workbook/diasporaWorkbookXlsxService.js';
import {
  proposeSemanticMapping,
  confirmSemanticMapping,
  requireLiveMappingConfirmation,
  applyConfirmedMapping,
} from '../dealer/workbookSemanticMappingService.js';
import { isFallbackMarker } from '../registration/registrationJourneyService.js';
import {
  VEHICLE_TEMPLATE_KEYS,
  VEHICLE_TEMPLATE_SHEETS,
  VEHICLE_WORKBOOK_SHEETS,
  VEHICLE_WORKBOOK_SCHEMA_VERSION,
  FORBIDDEN_WORKBOOK_COLUMNS,
  buildVehicleWorkbookTemplate,
  isVehicleWorkbookTemplateKey,
  getSheetDefinition,
  resolveVocabularyValue,
} from '../../constants/workbook/workbookFieldRegistry.js';

export const VEHICLE_IMPORT_BATCH_STATUSES = Object.freeze({
  VALIDATED: 'VALIDATED',
  BLOCKED: 'BLOCKED',
  IMPORTED: 'IMPORTED',
  PARTIALLY_IMPORTED: 'PARTIALLY_IMPORTED',
});

const MAX_ACCIDENT_EVENTS = 10;
const MAX_MEDIA_ROWS_PER_VIN = 15;

function requireVehicleTemplateKey(templateKey) {
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError(`'${templateKey}' is not a vehicle workbook template.`);
  }
  return templateKey;
}

function decodeWorkbookFile(file) {
  if (Buffer.isBuffer(file)) return file;
  const raw = String(file || '');
  const base64 = raw.includes('base64,') ? raw.slice(raw.indexOf('base64,') + 7) : raw;
  if (!base64.trim()) throw new ValidationError('A workbook file is required.');
  return Buffer.from(base64, 'base64');
}

/**
 * B16 — template version gate. Reads the Instructions sheet the generator wrote.
 * A user-authored file with NO version stamp is accepted (mapping handles it);
 * a file stamped with a DIFFERENT vehicle-workbook version is refused by name
 * with the upgrade path. Old columns are never silently reinterpreted.
 */
export async function readWorkbookSchemaVersion(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ValidationError('Workbook could not be read as a valid .xlsx file.', { code: 'UNREADABLE_WORKBOOK' });
  }
  const instructions = workbook.getWorksheet('Instructions');
  if (!instructions) return { schemaVersion: null, templateType: null };
  let schemaVersion = null;
  let templateType = null;
  instructions.eachRow((row) => {
    const key = String(row.getCell(1).value ?? '').trim();
    if (key === 'schemaVersion') schemaVersion = String(row.getCell(2).value ?? '').trim() || null;
    if (key === 'templateType') templateType = String(row.getCell(2).value ?? '').trim() || null;
  });
  return { schemaVersion, templateType };
}

function assertSupportedVersion(stamp, templateKey) {
  if (!stamp.schemaVersion) return; // user-authored file — mapping decides
  if (stamp.schemaVersion === VEHICLE_WORKBOOK_SCHEMA_VERSION) return;
  throw new ValidationError(
    `TEMPLATE_VERSION_UNSUPPORTED: this workbook was generated from template version '${stamp.schemaVersion}', `
    + `which is no longer supported. Download the current '${templateKey}' template `
    + `(version ${VEHICLE_WORKBOOK_SCHEMA_VERSION}) from Workbook tools and copy your rows across.`,
    { code: 'TEMPLATE_VERSION_UNSUPPORTED', found: stamp.schemaVersion, supported: VEHICLE_WORKBOOK_SCHEMA_VERSION },
  );
}

/* ------------------------------------------------------------------ *
 * INSPECT — headers + proposals per data sheet.
 * ------------------------------------------------------------------ */

export async function inspectVehicleWorkbook({ file, templateKey } = {}, actor = {}, options = {}) {
  requireVehicleTemplateKey(templateKey);
  const buffer = decodeWorkbookFile(file);
  assertAllowedSpreadsheet({
    filename: options.sourceFilename || 'workbook.xlsx',
    sizeBytes: buffer.length,
    limits: DEFAULT_LIMITS,
  });
  const checksum = sha256Checksum(buffer);
  const stamp = await readWorkbookSchemaVersion(buffer);
  assertSupportedVersion(stamp, templateKey);

  const template = buildVehicleWorkbookTemplate(templateKey);
  const parsed = await parseWorkbook(buffer, { templateType: template });

  const sheets = [];
  for (const sheetName of VEHICLE_TEMPLATE_SHEETS[templateKey]) {
    const rows = parsed.sheets[sheetName] || [];
    if (!rows.length) {
      sheets.push({ sheet_name: sheetName, row_count: 0, headers: [], proposals: [], canonical_columns: [] });
      continue;
    }
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const proposal = await proposeSemanticMapping({ headers, templateType: templateKey, sheetName }, options);
    sheets.push({
      sheet_name: sheetName,
      row_count: rows.length,
      headers,
      proposals: proposal.proposals,
      canonical_columns: proposal.canonical_columns,
    });
  }

  return {
    template_key: templateKey,
    checksum,
    schema_version: stamp.schemaVersion,
    supported_schema_version: VEHICLE_WORKBOOK_SCHEMA_VERSION,
    ignored_sheets: parsed.meta?.ignoredSheets || [],
    sheets,
  };
}

/* ------------------------------------------------------------------ *
 * CONFIRM MAPPINGS — one human confirmation per data sheet, checksum-bound.
 * ------------------------------------------------------------------ */

export async function confirmVehicleWorkbookMappings(client = supabase, actor = {}, {
  templateKey,
  workbookChecksum,
  sheets,
} = {}, options = {}) {
  requireVehicleTemplateKey(templateKey);
  if (!Array.isArray(sheets) || !sheets.length) {
    throw new ValidationError('sheets must be a non-empty array of {sheet_name, mappings}.');
  }
  const confirmations = [];
  for (const entry of sheets) {
    const sheetName = String(entry?.sheet_name || '').trim();
    if (!VEHICLE_TEMPLATE_SHEETS[templateKey].includes(sheetName)) {
      throw new ValidationError(`'${sheetName}' is not a sheet of the ${templateKey} template.`);
    }
    for (const mapping of entry?.mappings || []) {
      const target = String(mapping?.target ?? '').trim();
      if (FORBIDDEN_WORKBOOK_COLUMNS.includes(target)) {
        throw new ForbiddenError(
          `'${target}' is a protected field and can never be a workbook import target.`,
        );
      }
    }
    confirmations.push(await confirmSemanticMapping(client, actor, {
      dealerId: options.dealerId || null,
      templateType: templateKey,
      sheetName,
      workbookChecksum,
      mappings: entry.mappings,
    }, options));
  }
  return { confirmed: confirmations.length, confirmations };
}

/* ------------------------------------------------------------------ *
 * VALIDATE + DRY RUN.
 * ------------------------------------------------------------------ */

function finding(sheetName, rowIndex, field, code, message) {
  return { sheetName, rowIndex, field, code, message };
}

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function resolveRowValues(sheetName, row, rowIndex, errors, warnings) {
  const sheetDef = getSheetDefinition(sheetName);
  const out = {};
  for (const field of sheetDef.fields) {
    const raw = cellText(row[field.key]);
    if (!raw) continue;
    if (isFallbackMarker(raw)) {
      warnings.push(finding(sheetName, rowIndex, field.key, 'FALLBACK_MARKER_IGNORED',
        `'${raw}' is a placeholder, not a value — the cell is treated as blank.`));
      continue;
    }
    if (field.vocabulary) {
      const resolved = resolveVocabularyValue(field, raw);
      if (resolved.method === null) {
        const target = field.vocabularyMode === 'advisory' ? warnings : errors;
        target.push(finding(sheetName, rowIndex, field.key, 'VOCABULARY_MISMATCH',
          `'${raw}' is not a recognized value for "${field.header}".`));
        if (field.vocabularyMode === 'advisory') out[field.key] = raw;
        continue;
      }
      out[field.key] = resolved.value;
      if (resolved.method === 'alias') {
        warnings.push(finding(sheetName, rowIndex, field.key, 'VALUE_NORMALIZED',
          `'${raw}' was recognized as '${field.vocabulary.find((v) => v.value === resolved.value)?.label ?? resolved.value}'.`));
      }
      continue;
    }
    if (field.type === 'number') {
      const num = Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(num)) {
        errors.push(finding(sheetName, rowIndex, field.key, 'NOT_A_NUMBER', `"${field.header}" must be a number.`));
        continue;
      }
      if (field.validation?.integer && !Number.isInteger(num)) {
        errors.push(finding(sheetName, rowIndex, field.key, 'NOT_AN_INTEGER', `"${field.header}" must be a whole number.`));
        continue;
      }
      if (field.validation?.min !== undefined && num < field.validation.min) {
        errors.push(finding(sheetName, rowIndex, field.key, 'BELOW_MINIMUM', `"${field.header}" must be at least ${field.validation.min}.`));
        continue;
      }
      out[field.key] = num;
      continue;
    }
    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(raw)) {
      errors.push(finding(sheetName, rowIndex, field.key, 'FORMAT_INVALID', `"${field.header}" has an invalid format.`));
      continue;
    }
    if (field.validation?.maxLength && raw.length > field.validation.maxLength) {
      errors.push(finding(sheetName, rowIndex, field.key, 'TOO_LONG', `"${field.header}" is longer than ${field.validation.maxLength} characters.`));
      continue;
    }
    if (field.validation?.minLength && raw.length < field.validation.minLength) {
      errors.push(finding(sheetName, rowIndex, field.key, 'TOO_SHORT', `"${field.header}" must be at least ${field.validation.minLength} characters.`));
      continue;
    }
    out[field.key] = field.type === 'list'
      ? raw.split(',').map((item) => item.trim()).filter(Boolean)
      : raw;
  }
  // Required fields.
  for (const field of sheetDef.fields) {
    if (field.required && (out[field.key] === undefined || out[field.key] === null || out[field.key] === '')) {
      errors.push(finding(sheetName, rowIndex, field.key, 'REQUIRED_MISSING', `"${field.header}" is required.`));
    }
  }
  return out;
}

/**
 * Validate a parsed+mapped payload into per-VIN vehicle groups.
 * Pure — no I/O except the optional existing-VIN lookup collaborator.
 */
export async function validateVehicleWorkbookPayload({ templateKey, sheetRows }, { lookupExistingVins, actorRole = null } = {}) {
  requireVehicleTemplateKey(templateKey);
  const errors = [];
  const warnings = [];

  const rowsOf = (name) => sheetRows[name] || [];

  // Per-sheet field-level resolution (rowIndex = position within the sheet, 1-based data row).
  const resolved = {};
  for (const sheetName of VEHICLE_TEMPLATE_SHEETS[templateKey]) {
    resolved[sheetName] = rowsOf(sheetName).map((row, index) =>
      resolveRowValues(sheetName, row, index + 1, errors, warnings));
  }

  // O2 post-Ready review C6 — the dealer template ACCEPTS and validates BUSINESS and BRANCHES,
  // but this chain persists vehicles only. Every data row on such a sheet is named here, in the
  // dry run the user reads BEFORE confirming, so a dealer is never told their business and
  // branch claims were imported when nothing read them. They are not errors: the vehicles in
  // the same file are still importable, and the correct destination is stated in the message.
  const notImported = [];
  for (const sheetName of nonPersistentSheetsFor(templateKey)) {
    const sheetRowCount = rowsOf(sheetName).length;
    if (!sheetRowCount) continue;
    notImported.push({ sheet_name: sheetName, row_count: sheetRowCount, reason: NON_PERSISTENT_SHEETS[sheetName] });
    for (let index = 0; index < sheetRowCount; index += 1) {
      warnings.push(finding(sheetName, index + 1, null, 'SHEET_NOT_IMPORTED', NON_PERSISTENT_SHEETS[sheetName]));
    }
  }

  // VIN grouping.
  const vehicles = new Map();
  const duplicateVins = new Set();
  (resolved.VEHICLES || []).forEach((row, index) => {
    const vin = cellText(row.vin).toUpperCase();
    if (!vin) return; // REQUIRED_MISSING already recorded
    if (vehicles.has(vin)) {
      duplicateVins.add(vin);
      errors.push(finding('VEHICLES', index + 1, 'vin', 'DUPLICATE_VIN_IN_FILE',
        `VIN ${vin} appears more than once in this workbook.`));
      return;
    }
    vehicles.set(vin, { vin, rowIndex: index + 1, vehicle: { ...row, vin }, listing: null, accident: [], accidentState: null, disclosures: null, media: [], evidence: [] });
  });

  const attach = (sheetName, key, assign) => {
    (resolved[sheetName] || []).forEach((row, index) => {
      const vin = cellText(row.vin).toUpperCase();
      if (!vin) return;
      const group = vehicles.get(vin);
      if (!group) {
        errors.push(finding(sheetName, index + 1, 'vin', 'VIN_NOT_IN_VEHICLES',
          `VIN ${vin} on ${sheetName} has no row on the VEHICLES sheet.`));
        return;
      }
      assign(group, row, index + 1);
    });
  };

  attach('LISTINGS', 'listing', (group, row, rowIndex) => {
    if (group.listing) {
      errors.push(finding('LISTINGS', rowIndex, 'vin', 'DUPLICATE_LISTING_ROW', `VIN ${group.vin} has more than one LISTINGS row.`));
      return;
    }
    group.listing = row;
  });
  attach('ACCIDENT_HISTORY', 'accident', (group, row, rowIndex) => {
    if (row.accident_state) {
      if (group.accidentState && group.accidentState !== row.accident_state) {
        errors.push(finding('ACCIDENT_HISTORY', rowIndex, 'accident_state', 'CONFLICTING_ACCIDENT_STATE',
          `VIN ${group.vin} answers the accident question twice with different answers.`));
      }
      group.accidentState = group.accidentState || row.accident_state;
    }
    const event = {};
    for (const key of ['approx_date', 'event_mileage', 'damage_area', 'severity', 'insurer_involved', 'police_report_state', 'repair_state', 'repairer']) {
      if (row[key]) event[key === 'event_mileage' ? 'mileage' : key] = row[key];
    }
    if (Object.keys(event).length) {
      group.accident.push(event);
      if (group.accident.length > MAX_ACCIDENT_EVENTS) {
        errors.push(finding('ACCIDENT_HISTORY', rowIndex, null, 'TOO_MANY_ACCIDENT_EVENTS',
          `VIN ${group.vin} has more than ${MAX_ACCIDENT_EVENTS} accident events.`));
      }
    }
  });
  attach('DISCLOSURES', 'disclosures', (group, row, rowIndex) => {
    if (group.disclosures) {
      errors.push(finding('DISCLOSURES', rowIndex, 'vin', 'DUPLICATE_DISCLOSURE_ROW', `VIN ${group.vin} has more than one DISCLOSURES row.`));
      return;
    }
    group.disclosures = row;
  });
  attach('MEDIA', 'media', (group, row, rowIndex) => {
    group.media.push({ row, rowIndex });
    if (group.media.length > MAX_MEDIA_ROWS_PER_VIN) {
      errors.push(finding('MEDIA', rowIndex, null, 'TOO_MANY_PHOTOS', `VIN ${group.vin} has more than ${MAX_MEDIA_ROWS_PER_VIN} photos.`));
    }
  });
  attach('EVIDENCE_NOTES', 'evidence', (group, row, rowIndex) => {
    // F1 — CANONICAL CLASSIFICATION, checked here rather than discovered at upload time.
    //
    // `validateEvidenceUploadPayload` treats an upload as canonical-first only when BOTH class
    // and subtype are present (`explicitCanonical = Boolean(class && subtype)`), and refuses
    // otherwise because there is no legacy `evidence_type` — which the workbook deliberately does
    // not offer, and must not start offering just to slip past this requirement. It then rejects a
    // subtype that does not belong to the class. The workbook previously accepted a blank subtype
    // and a subtype borrowed from another class, so both shapes reached the route and failed
    // there, after the vehicle had already been created.
    //
    // F2 — CANONICAL UPLOAD AUTHORITY, evaluated with the SERVER-DERIVED actor role. The route
    // runs `canUploadEvidenceRecord(normalized, activeRole)` after validation; a role that may
    // not file this class/subtype is a deterministic refusal, not a transient fault, so the user
    // must learn it BEFORE confirming rather than as a failed import afterwards.
    //
    // Both checks CALL the owning module. Nothing is reimplemented here and no workbook-specific
    // permission matrix exists.
    let normalized = null;
    try {
      normalized = validateEvidenceUploadPayload({
        vehicle_id: group.vin,
        evidence_class: cellText(row.evidence_class) || null,
        evidence_subtype: cellText(row.evidence_subtype) || null,
        file_url: cellText(row.file_url) || null,
        mime_type: cellText(row.file_mime_type) || null,
      }, { requireVehicleId: true });
    } catch (error) {
      errors.push(finding('EVIDENCE_NOTES', rowIndex, 'evidence_subtype', 'EVIDENCE_CLASSIFICATION_INVALID',
        `VIN ${group.vin}: ${String(error.message || error)}`));
      return;
    }
    if (actorRole && !canUploadEvidenceRecord(normalized, String(actorRole).toLowerCase())) {
      const label = normalized.explicitCanonical
        ? `${normalized.evidenceClass}/${normalized.evidenceSubtype}`
        : normalized.evidenceType;
      errors.push(finding('EVIDENCE_NOTES', rowIndex, 'evidence_class', 'EVIDENCE_ROLE_FORBIDDEN',
        `VIN ${group.vin}: your account may not file '${label}' evidence. This is a permission rule, not a file problem — importing again will not change it.`));
      return;
    }
    group.evidence.push(row);
  });

  // Group-level rules.
  for (const group of vehicles.values()) {
    if (!group.listing) {
      errors.push(finding('LISTINGS', group.rowIndex, 'vin', 'LISTING_ROW_MISSING',
        `VIN ${group.vin} has no LISTINGS row — price, currency, city and description are required.`));
    }
    const primaries = group.media.filter((m) => m.row.is_primary === true);
    if (primaries.length > 1) {
      errors.push(finding('MEDIA', primaries[1].rowIndex, 'is_primary', 'MULTIPLE_COVER_PHOTOS',
        `VIN ${group.vin} marks more than one cover photo.`));
    }
    if (group.accidentState === 'yes' && group.accident.length === 0) {
      warnings.push(finding('ACCIDENT_HISTORY', group.rowIndex, 'accident_state', 'ACCIDENT_EVENTS_EMPTY',
        `VIN ${group.vin} answers "yes" to the accident question with no event details — the answer imports, details can follow on the site.`));
    }
    if (group.accident.length > 0 && group.accidentState !== 'yes') {
      errors.push(finding('ACCIDENT_HISTORY', group.rowIndex, 'accident_state', 'ACCIDENT_STATE_REQUIRED',
        `VIN ${group.vin} lists accident events but the accident question is not answered "yes".`));
    }
  }

  // Existing-Passport conflicts (server truth).
  if (typeof lookupExistingVins === 'function' && vehicles.size) {
    const existing = await lookupExistingVins([...vehicles.keys()]);
    for (const vin of existing || []) {
      const group = vehicles.get(String(vin).toUpperCase());
      if (group) {
        errors.push(finding('VEHICLES', group.rowIndex, 'vin', 'VEHICLE_ALREADY_EXISTS',
          `VIN ${group.vin} already exists on CarUp. Review the existing vehicle on the site — a bulk import never overrides an existing Passport.`));
      }
    }
  }

  const errorKeys = new Set(errors.map((e) => `VEHICLES:${e.sheetName}:${e.rowIndex}`));
  const groups = [...vehicles.values()];
  const vinErrorSet = new Set();
  for (const error of errors) {
    // Any error touching a VIN group blocks that vehicle.
    for (const group of groups) {
      if (error.message.includes(group.vin)
        || (error.sheetName === 'VEHICLES' && error.rowIndex === group.rowIndex)) {
        vinErrorSet.add(group.vin);
      }
    }
  }

  const acceptedGroups = groups.filter((group) => !vinErrorSet.has(group.vin));
  return {
    vehicles: groups,
    acceptedGroups,
    duplicateVins: [...duplicateVins],
    errors,
    warnings,
    notImported,
    totals: {
      vehicleCount: groups.length,
      acceptedVehicles: acceptedGroups.length,
      blockedVehicles: groups.length - acceptedGroups.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      // Rows the user supplied that this import will not persist — a count that cannot be
      // mistaken for a successful import.
      notImportedRows: notImported.reduce((sum, entry) => sum + entry.row_count, 0),
    },
    canImport: acceptedGroups.length > 0 && groups.length > 0,
    _errorKeys: errorKeys,
  };
}

/** Build the canonical POST /api/vehicles/add payload for one accepted group. */
export function buildCreatePayload(group, clientSubmissionId) {
  const vehicle = group.vehicle;
  const listing = group.listing || {};
  const disclosures = group.disclosures || {};
  const media = [...group.media]
    .sort((a, b) => (a.row.display_order ?? a.rowIndex) - (b.row.display_order ?? b.rowIndex));

  const payload = {
    vin: group.vin,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    color: vehicle.color,
    mileage: vehicle.mileage,
    body_style: vehicle.body_style,
    seller_stated_condition: vehicle.seller_stated_condition,
    fuel_type: vehicle.fuel_type,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    engine_number: vehicle.engine_number,
    chassis_number: vehicle.chassis_number,
    generation: vehicle.generation,
    trim: vehicle.trim,
    registration_status: vehicle.registration_status,
    plate_number: vehicle.plate_number,
    temp_plate_id: vehicle.temp_plate_id,
    registration_country: vehicle.registration_country,
    price: listing.price,
    currency: listing.currency,
    location: listing.listing_city,
    province: listing.listing_province,
    listing_country: listing.listing_country,
    description: listing.seller_description,
    features: listing.seller_features,
    location_visibility: listing.location_visibility,
    public_seller_display_enabled: listing.public_seller_display_enabled === true,
    images: media.map((m, index) => ({
      url: m.row.image_url,
      photo_label: m.row.photo_label,
      ...(m.row.is_primary === true ? { is_primary: true } : {}),
      display_order: index,
    })),
    client_submission_id: clientSubmissionId,
  };
  if (group.accidentState) {
    payload.accident_disclosure = {
      state: group.accidentState,
      ...(group.accidentState === 'yes' && group.accident.length ? { events: group.accident } : {}),
    };
  }
  if (disclosures.insurance_state) {
    payload.insurance_disclosure = {
      state: disclosures.insurance_state,
      ...(disclosures.insurance_state === 'insured' && disclosures.insurer_name
        ? { insurer_name: disclosures.insurer_name } : {}),
    };
  }
  if (disclosures.finance_state) {
    payload.finance_disclosure = {
      state: disclosures.finance_state,
      ...(disclosures.finance_type ? { finance_type: disclosures.finance_type } : {}),
      ...(disclosures.lender_name ? { lender_name: disclosures.lender_name } : {}),
    };
  }
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') delete payload[key];
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * DRY RUN (persisted into the EXISTING batch/rows store).
 * ------------------------------------------------------------------ */

async function defaultLookupExistingVins(client, vins) {
  const { data, error } = await client.from('vehicles').select('vin').in('vin', vins);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.vin);
}

export async function runVehicleWorkbookDryRun({ file, templateKey } = {}, actor = {}, options = {}) {
  requireVehicleTemplateKey(templateKey);
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  const client = options.supabaseClient || supabase;

  const buffer = decodeWorkbookFile(file);
  const checksum = sha256Checksum(buffer);
  const stamp = await readWorkbookSchemaVersion(buffer);
  assertSupportedVersion(stamp, templateKey);

  const template = buildVehicleWorkbookTemplate(templateKey);
  const parsed = await parseWorkbook(buffer, { templateType: template });

  // Every data sheet needs a LIVE, checksum-bound human confirmation; mapped headers → keys.
  const sheetRows = {};
  const confirmationIds = {};
  for (const sheetName of VEHICLE_TEMPLATE_SHEETS[templateKey]) {
    const rows = parsed.sheets[sheetName] || [];
    if (!rows.length) { sheetRows[sheetName] = []; continue; }
    const confirmation = await requireLiveMappingConfirmation(client, {
      userId, workbookChecksum: checksum, templateType: templateKey, sheetName,
    });
    confirmationIds[sheetName] = confirmation.id;
    // Refuse a confirmation that maps onto forbidden targets (defense-in-depth).
    for (const entry of confirmation.mapping || []) {
      if (FORBIDDEN_WORKBOOK_COLUMNS.includes(entry.target)) {
        throw new ForbiddenError(`'${entry.target}' is a protected field and can never be imported.`);
      }
    }
    sheetRows[sheetName] = applyConfirmedMapping(rows, confirmation);
  }

  const validation = await validateVehicleWorkbookPayload({ templateKey, sheetRows }, {
    lookupExistingVins: options.lookupExistingVins || ((vins) => defaultLookupExistingVins(client, vins)),
    // Server-derived, from the authenticated workbook route — never a client-supplied role.
    actorRole: actor.role || actor.effectiveRole || actor.platformRole || null,
  });

  const dryRunId = randomUUID();
  // Mint the idempotency id per accepted vehicle NOW, so retries replay identically.
  const submissionIds = {};
  for (const group of validation.acceptedGroups) submissionIds[group.vin] = randomUUID();

  const batchRow = {
    tenant_id: null,
    uploaded_by: userId,
    template_type: templateKey,
    source_filename: options.sourceFilename || null,
    source_mime_type: options.sourceMimeType || null,
    source_file_size_bytes: buffer.length,
    checksum_sha256: checksum,
    idempotency_key: dryRunId,
    dry_run_result: {
      dryRunId,
      dryRunOnly: true,
      wroteToDatabase: false,
      canImport: validation.canImport,
      totals: validation.totals,
      errors: validation.errors,
      warnings: validation.warnings,
      schemaVersion: stamp.schemaVersion,
      mappingConfirmations: confirmationIds,
      notImported: validation.notImported,
    },
    total_rows: validation.vehicles.length,
    accepted_rows: validation.acceptedGroups.length,
    rejected_rows: validation.vehicles.length - validation.acceptedGroups.length,
    warning_count: validation.totals.warningCount,
    error_count: validation.totals.errorCount,
    import_status: validation.canImport ? VEHICLE_IMPORT_BATCH_STATUSES.VALIDATED : VEHICLE_IMPORT_BATCH_STATUSES.BLOCKED,
    rollback_status: 'NOT_REQUIRED',
    metadata: { phase: 'X5A', persistedFrom: 'vehicle_workbook_dry_run', dryRunId },
    created_by: userId,
    updated_by: userId,
  };
  const { data: batch, error: batchError } = await client
    .from('diaspora_workbook_import_batches')
    .insert(batchRow)
    .select()
    .single();
  if (batchError) throw new Error(batchError.message);

  const rowPayloads = validation.vehicles.map((group) => {
    const accepted = validation.acceptedGroups.includes(group);
    return {
      tenant_id: null,
      batch_id: batch.id,
      sheet_name: 'VEHICLES',
      workbook_row_number: group.rowIndex,
      workbook_record_id: group.vin,
      target_table: 'vehicles',
      target_record_id: null,
      action_type: accepted ? 'CREATE_DRAFT_VEHICLE' : 'ERROR',
      row_payload: { vin: group.vin },
      normalized_payload: accepted ? buildCreatePayload(group, submissionIds[group.vin]) : null,
      validation_status: accepted ? 'ACCEPTED' : 'REJECTED',
      validation_errors: validation.errors.filter((e) => e.message.includes(group.vin)
        || (e.sheetName === 'VEHICLES' && e.rowIndex === group.rowIndex)),
      validation_warnings: validation.warnings.filter((w) => w.message.includes(group.vin)
        || (w.sheetName === 'VEHICLES' && w.rowIndex === group.rowIndex)),
      // Evidence rows ride along for execution (references only; server forces pending).
      metadata: accepted && group.evidence.length ? { evidence: group.evidence } : null,
    };
  });
  if (rowPayloads.length) {
    const { error: rowsError } = await client.from('diaspora_workbook_import_rows').insert(rowPayloads);
    if (rowsError) throw new Error(rowsError.message);
  }

  return {
    dryRunId,
    batchId: batch.id,
    templateKey,
    checksum,
    canImport: validation.canImport,
    totals: validation.totals,
    errors: validation.errors,
    warnings: validation.warnings,
    // Stated before the user confirms, not discovered afterwards.
    notImported: validation.notImported,
    persistence: { batchId: batch.id, importStatus: batchRow.import_status },
  };
}

/* ------------------------------------------------------------------ *
 * EXECUTE — replay accepted vehicles through the canonical create route.
 * ------------------------------------------------------------------ */

/**
 * Where the canonical routes can be reached, AS THIS EXACT CANDIDATE.
 *
 * `backend/server.js` skips `app.listen` when `process.env.VERCEL` is set, so on a deployed
 * backend there is no listener on 127.0.0.1 and a loopback dispatch reaches nothing. But
 * reachability alone is the wrong bar for a MUTATION target:
 *
 *   `CARUP_PUBLIC_API_URL` is the canonical PUBLIC origin — on staging it is documented as
 *   `https://api-staging.carup.dev` (see CARUP_DOMAIN_CANONICALIZATION_RECEIPT). That is a
 *   STABLE alias. It says nothing about which deployment or which Git SHA answers it, so a
 *   branch-preview import could have created vehicles and evidence on stable staging — a
 *   different candidate entirely. It is therefore no longer accepted here at all.
 *
 * What is accepted:
 *   - `CARUP_INTERNAL_API_BASE_URL` — an operator-set, deployment-specific internal base;
 *   - `VERCEL_URL` — Vercel's own immutable per-DEPLOYMENT host, which is by construction this
 *     same runtime (unlike `VERCEL_BRANCH_URL`, an alias that moves between deployments);
 *   - a loopback URL only where `app.listen` really ran.
 *
 * Whatever is chosen is still PROVEN against the caller's own build provenance before any
 * mutation — see assertDispatchTargetProvenance. Returns null when nothing qualifies.
 */
export function resolveDispatchBaseUrl(env = process.env) {
  const configured = env.CARUP_INTERNAL_API_BASE_URL;
  if (configured) return String(configured).replace(/\/+$/, '');
  // Vercel's per-deployment host: same deployment, same build, by definition.
  if (env.VERCEL_URL) return `https://${String(env.VERCEL_URL).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  // A loopback listener exists only where server.js actually called app.listen.
  if (env.VERCEL) return null;
  return `http://127.0.0.1:${Number(env.PORT || 3001)}`;
}

/**
 * Prove the mutation target is the candidate the caller believes it is — BEFORE mutating.
 *
 * Reuses the existing governed mechanism (`backend/config/buildProvenance.js`), which exists
 * because this programme already proved two CarUp runtimes can silently diverge. The rule it
 * encodes is the one that matters here: unknown provenance is a FAILURE, not a pass. A runtime
 * that cannot state its revision is exactly the case this guard exists to catch.
 *
 * Loopback to our own process is exempt by identity, not by leniency: it IS this runtime.
 */
export async function assertDispatchTargetProvenance(baseUrl, options = {}) {
  const env = options.env || process.env;
  const expected = options.expected || resolveBuildProvenance(env);
  const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(baseUrl);
  if (isLoopback) return { verified: true, reason: 'loopback: the target is this process' };

  if (!expected.provenance_available || !expected.commit_sha) {
    throw new ValidationError(
      'Workbook import refused: this runtime cannot state its own build revision, so it cannot '
      + 'prove that the import target is the same candidate. Nothing was imported.',
    );
  }

  const fetchHealth = options.fetchHealth || (async (url) => {
    const response = await fetch(`${url}/api/health`, { method: 'GET' });
    return response.json();
  });

  let health = null;
  try {
    health = await fetchHealth(baseUrl);
  } catch (error) {
    throw new ValidationError(
      `Workbook import refused: the import target could not be reached to prove which candidate it '
      + 'is serving (${String(error?.message || error).slice(0, 160)}). Nothing was imported.`,
    );
  }

  const target = health?.build || null;
  if (!target || !target.commit_sha) {
    throw new ValidationError(
      'Workbook import refused: the import target does not report its build revision, so it cannot '
      + 'be proven to be this candidate. Nothing was imported.',
    );
  }
  if (String(target.commit_sha) !== String(expected.commit_sha)) {
    throw new ValidationError(
      `Workbook import refused: the import target is serving a different candidate `
      + `(${String(target.commit_sha).slice(0, 8)}) than the one executing this import `
      + `(${String(expected.commit_sha).slice(0, 8)}). Nothing was imported.`,
    );
  }
  // A matching SHA on a different branch alias would be a coincidence worth refusing too.
  if (expected.branch && target.branch && String(target.branch) !== String(expected.branch)) {
    throw new ValidationError(
      `Workbook import refused: the import target is serving branch '${target.branch}' while this `
      + `import is running on '${expected.branch}'. Nothing was imported.`,
    );
  }
  return { verified: true, targetSha: target.commit_sha, targetBranch: target.branch ?? null };
}

/**
 * The workbook replays each accepted vehicle through the canonical create route AS THE USER —
 * that single-writer law is not negotiable, so this dispatcher exists to carry a real request,
 * not to bypass one.
 *
 * Two things it must get right and previously did not:
 *   - CSRF. `csrfMiddleware` is mounted globally (server.js), so an unsafe request without a
 *     matching `x-csrf-token` + cookie pair is refused before routing. The reviewer's own token
 *     is minted here exactly as the browser client mints it.
 *   - Reachability. See resolveDispatchBaseUrl: on Vercel there is no local listener at all.
 *     The caller checks that BEFORE mutating anything, so an unreachable environment is a
 *     refusal up front rather than every row landing as DISPATCH_FAILED.
 */
function httpDispatch(req, baseUrl) {
  const base = new URL(baseUrl);
  const isHttps = base.protocol === 'https:';
  const transport = isHttps ? https : http;
  const forwarded = {};
  for (const name of ['authorization', 'x-session-token', 'cookie']) {
    if (req?.headers?.[name]) forwarded[name] = req.headers[name];
  }

  // The organisational scope arrives per call from `trustedActorHeaders`, built at the execution
  // boundary so an injected dispatcher sees exactly what the HTTP one sends.

  const send = (path, method, body, extraHeaders = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { ...forwarded, ...extraHeaders };
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const request = transport.request({
      protocol: base.protocol,
      host: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path,
      method,
      headers,
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { raw }; }
        resolve({ status: response.statusCode, body: parsed, headers: response.headers });
      });
    });
    request.on('error', reject);
    request.end(payload === null ? undefined : payload);
  });

  // Mint one CSRF pair for this execution and reuse it. This is the double-submit pair the
  // server requires — token header plus matching cookie — but it is NOT identical to the browser
  // client's flow: the browser binds its token to the identity headers it sends and re-mints on a
  // 403, while this mints once for the batch and forwards the caller's own cookie alongside.
  let csrf = null;
  const ensureCsrf = async () => {
    if (csrf) return csrf;
    const token = await send('/api/security/csrf-token', 'GET', undefined);
    const setCookie = token.headers?.['set-cookie'] || [];
    const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((entry) => String(entry).split(';')[0]).filter(Boolean).join('; ');
    csrf = { token: token.body?.csrfToken || null, cookie };
    return csrf;
  };

  return async (path, method, body, callerHeaders = {}) => {
    const headers = { ...callerHeaders };
    // Never let an asserted identity ride a writing request.
    delete headers['x-user-id'];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) {
      const pair = await ensureCsrf();
      if (pair.token) headers['x-csrf-token'] = pair.token;
      if (pair.cookie) {
        headers.cookie = forwarded.cookie ? `${forwarded.cookie}; ${pair.cookie}` : pair.cookie;
      }
    }
    return send(path, method, body, headers);
  };
}

function sanitizeErrorMessage(body) {
  const message = body?.error || body?.message || 'The vehicle could not be created.';
  return String(message).slice(0, 400);
}

/**
 * A stable identity for one evidence reference within one workbook batch.
 *
 * Stable across retries (so a replay dedupes) and distinct between items (so two references on
 * the same row do not collapse into one).
 */
/**
 * The organisational scope the outer authenticated route already established, expressed as the
 * headers the canonical routes read.
 *
 * Built HERE, at the execution boundary, rather than inside one transport — because the previous
 * shape put it inside the HTTP dispatcher, where an injected test dispatcher never saw it. That
 * is precisely how a dealer losing its tenant survived a green suite.
 *
 * Values come from the ALREADY-VALIDATED actor context (`authorizeRole` verified the
 * `tenant_users` membership before putting `tenantId` on it), never from raw client headers, and
 * the inner canonical route re-verifies both independently. `x-user-id` is deliberately absent:
 * the identity-assertion fallback must never stand in for a proven session on a writing route.
 */
export function trustedActorHeaders(actor = {}) {
  const headers = {};
  const tenantId = actor.tenantId ?? actor.tenant_id ?? null;
  const requestedRole = actor.requestedRole ?? actor.requested_role ?? null;
  if (tenantId) headers['x-tenant-id'] = String(tenantId);
  if (requestedRole) headers['x-stakeholder-role'] = String(requestedRole);
  return headers;
}

export function evidenceIdempotencyKey(batchId, rowNumber, index) {
  return `workbook-evidence:${batchId}:${rowNumber}:${index}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

/**
 * Allocate the receipt `attempt` for each workbook row of this execution pass.
 *
 * `attempt` means "which pass over this row produced this receipt" — the same meaning the
 * diaspora confirmed-import service already gives it (its compensation pass writes attempt 2).
 * Reading the batch's existing receipts once keeps a retry deterministic and additive: the
 * first pass writes 1, a retry of a PARTIALLY_IMPORTED batch writes 2, and every earlier
 * receipt is retained rather than overwritten.
 */
async function buildAttemptAllocator(client, batchId) {
  const { data, error } = await client
    .from('diaspora_workbook_import_receipts')
    .select('row_number, attempt')
    .eq('batch_id', batchId);
  // A read failure must not silently restart numbering at 1 — that is the collision this
  // allocator exists to prevent. Fail loudly BEFORE any mutation runs.
  if (error) throw new Error(`Could not read existing import receipts: ${error.message}`);
  const highest = new Map();
  for (const receipt of data || []) {
    const row = Number(receipt.row_number);
    const attempt = Number(receipt.attempt) || 0;
    if (!highest.has(row) || attempt > highest.get(row)) highest.set(row, attempt);
  }
  const issued = new Map();
  return function nextAttempt(rowNumber) {
    const row = Number(rowNumber);
    if (!issued.has(row)) issued.set(row, (highest.get(row) || 0) + 1);
    return issued.get(row);
  };
}

/**
 * Sheets a template accepts and validates but this import chain does NOT persist.
 *
 * BUSINESS and BRANCHES describe the DEALER, not a vehicle. Writing them here would let a
 * spreadsheet edit a dealer's own application, which is the governed dealer-onboarding
 * authority's job and nobody else's (X5: workbook claims never create authority). They are
 * therefore declared non-persistent and SAID SO — before the user confirms, in the dry run,
 * and again in the execution result. What is not allowed to happen must not look like it did.
 */
const NON_PERSISTENT_SHEETS = Object.freeze({
  BUSINESS: 'Business details are part of your dealer application — submit them through dealer onboarding, not a workbook.',
  BRANCHES: 'Branch details are part of your dealer application — submit them through dealer onboarding, not a workbook.',
});

function nonPersistentSheetsFor(templateKey) {
  return (VEHICLE_TEMPLATE_SHEETS[templateKey] || []).filter((sheet) => sheet in NON_PERSISTENT_SHEETS);
}

function notImportedSheetSummary(templateKey) {
  return nonPersistentSheetsFor(templateKey).map((sheet) => ({
    sheet_name: sheet,
    persisted: false,
    reason: NON_PERSISTENT_SHEETS[sheet],
  }));
}

export async function executeVehicleWorkbookImport({ batchId, confirm } = {}, actor = {}, options = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  if (confirm !== true) {
    throw new ValidationError('CONFIRMATION_REQUIRED: pass confirm=true after reviewing the dry run.');
  }
  const client = options.supabaseClient || supabase;

  const { data: batches, error: batchError } = await client
    .from('diaspora_workbook_import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('uploaded_by', userId);
  if (batchError) throw new Error(batchError.message);
  const batch = (batches || [])[0];
  if (!batch) throw new NotFoundError('Import batch not found for this account.');
  if (!isVehicleWorkbookTemplateKey(batch.template_type)) {
    throw new ValidationError('This batch is not a vehicle workbook batch.');
  }
  if (batch.import_status === VEHICLE_IMPORT_BATCH_STATUSES.IMPORTED) {
    return { batchId, importStatus: batch.import_status, alreadyImported: true };
  }
  if (batch.import_status !== VEHICLE_IMPORT_BATCH_STATUSES.VALIDATED
      && batch.import_status !== VEHICLE_IMPORT_BATCH_STATUSES.PARTIALLY_IMPORTED) {
    throw new ValidationError(`Batch is ${batch.import_status} — only a VALIDATED dry run can be imported.`);
  }

  const { data: rows, error: rowsError } = await client
    .from('diaspora_workbook_import_rows')
    .select('*')
    .eq('batch_id', batch.id)
    .eq('validation_status', 'ACCEPTED');
  if (rowsError) throw new Error(rowsError.message);

  // D3 — decide reachability BEFORE the first mutation. An unreachable environment used to
  // present as "every vehicle rejected (DISPATCH_FAILED)" and then finalise the batch, which
  // reads as "your file was bad" when the truth is "this deployment cannot run imports".
  let dispatch = options.dispatch;
  if (!dispatch) {
    const baseUrl = resolveDispatchBaseUrl();
    if (!baseUrl) {
      throw new ValidationError(
        'Workbook import cannot run in this deployment: the canonical vehicle routes are not '
        + 'reachable from this runtime, and no same-deployment internal base is configured. Set '
        + 'CARUP_INTERNAL_API_BASE_URL to THIS backend deployment\'s own base URL and retry. '
        + 'Nothing was imported.',
      );
    }
    // E2 — prove the target is this exact candidate BEFORE the first vehicle or evidence
    // mutation. Not "try it and see": a wrong target would already have written by then.
    await assertDispatchTargetProvenance(baseUrl, { fetchHealth: options.fetchHealth });
    dispatch = httpDispatch(options.req, baseUrl);
  }
  // E3 — the same trusted scope on every inner call, transport-independent.
  const actorHeaders = trustedActorHeaders(actor);
  const dispatchEvidence = (path, body) => dispatch(path, 'POST', body, actorHeaders);
  const receipts = [];
  const evidenceOutcomes = [];
  let accepted = 0;
  let rejected = 0;

  // O2 post-Ready review C5 — every execution pass over a row gets its OWN attempt number.
  // `uq_diaspora_workbook_receipt_row` is (batch_id, row_number, attempt), so a retry of a
  // PARTIALLY_IMPORTED batch that wrote `attempt: 1` again collided with its own first pass:
  // the receipt insert failed AFTER the mutations had run and the batch could never leave the
  // partial state. Attempts are allocated from what the batch already recorded, so the history
  // grows (pass 1, pass 2, …) instead of fighting itself.
  const nextAttemptByRow = await buildAttemptAllocator(client, batch.id);

  for (const row of rows || []) {
    const payload = row.normalized_payload;
    if (!payload) continue;
    let outcome = 'rejected';
    let entityRef = null;
    let errorCode = null;
    let errorMessage = null;
    const rowEvidence = [];
    try {
      const response = await dispatch('/api/vehicles/add', 'POST', payload, actorHeaders);
      if (response.status >= 200 && response.status < 300) {
        outcome = 'accepted';
        // O2 post-Ready review C7 — the REAL POST /api/vehicles/add returns a top-level `vin`
        // and no `vehicle` object (`vehicles.vin` is the primary key; a vehicle has no uuid at
        // all). The previous expression therefore always fell through to the VIN, which was
        // then written into the uuid column `diaspora_workbook_import_rows.target_record_id`
        // and refused by PostgreSQL with 22P02 — an error nothing checked. The row's link to
        // its vehicle is, and always was, `workbook_record_id` (text VIN).
        entityRef = response.body?.vehicle?.vin || response.body?.vin || row.workbook_record_id;
        accepted += 1;
        // Evidence references replay through the canonical evidence endpoint; a failure never
        // voids the created draft. O2 post-Ready review C4 — evidence no longer claims a
        // receipt of its own: the unique key is (batch, row, attempt) and excludes sheet_name,
        // so an evidence receipt and its vehicle receipt were the SAME key. The workbook row is
        // the receipt grain (evidence is carried in that row's metadata, and is not an import
        // row), so the evidence outcome is recorded ON the row's receipt and returned in full.
        const rowEvidenceItems = row.metadata?.evidence || [];
        for (let evidenceIndex = 0; evidenceIndex < rowEvidenceItems.length; evidenceIndex += 1) {
          const evidence = rowEvidenceItems[evidenceIndex];
          const evidenceResponse = await dispatchEvidence(
            `/api/vehicles/${encodeURIComponent(row.workbook_record_id)}/evidence/upload`, {
              evidence_class: evidence.evidence_class,
              evidence_subtype: evidence.evidence_subtype,
              file_url: evidence.file_url,
              event_date: evidence.event_date,
              event_date_precision: evidence.event_date_precision,
              // E1 — the canonical evidence route refuses a remote file whose declared content
              // type it does not support, so the workbook must state it. The value comes from the
              // uploader through a required, vocabulary-bound column; it is never guessed from the
              // URL and the URL is never fetched to sniff it.
              mime_type: evidence.file_mime_type ?? null,
              metadata: evidence.evidence_label ? { workbook_label: evidence.evidence_label } : undefined,
              // D6 — retrying a partial batch replays EVERY accepted row, including rows whose
              // evidence already landed. `withUploadIdempotency` fails open without a key, so
              // those rows duplicated their evidence on every retry. This key is derived from
              // the batch, the workbook row and the item's position, so it is identical across
              // retries and distinct between items — the same discipline the vehicle create
              // already had through its stable client_submission_id.
              idempotency_key: evidenceIdempotencyKey(batch.id, row.workbook_row_number, evidenceIndex),
            });
          const evidenceOk = evidenceResponse.status >= 200 && evidenceResponse.status < 300;
          rowEvidence.push({
            row_number: row.workbook_row_number,
            vin: row.workbook_record_id,
            evidence_class: evidence.evidence_class ?? null,
            evidence_subtype: evidence.evidence_subtype ?? null,
            outcome: evidenceOk ? 'accepted' : 'rejected',
            error_code: evidenceOk ? null : `HTTP_${evidenceResponse.status}`,
            error_message: evidenceOk ? null : sanitizeErrorMessage(evidenceResponse.body),
          });
        }
      } else {
        rejected += 1;
        errorCode = response.body?.code || `HTTP_${response.status}`;
        errorMessage = sanitizeErrorMessage(response.body);
      }
    } catch (dispatchError) {
      rejected += 1;
      errorCode = 'DISPATCH_FAILED';
      errorMessage = String(dispatchError.message || dispatchError).slice(0, 400);
    }
    evidenceOutcomes.push(...rowEvidence);
    const evidenceFailed = rowEvidence.filter((e) => e.outcome === 'rejected');
    if (outcome === 'accepted' && evidenceFailed.length) {
      // The draft stands; say plainly that part of its evidence did not.
      errorCode = 'EVIDENCE_PARTIAL';
      errorMessage = `${evidenceFailed.length} of ${rowEvidence.length} evidence references were not recorded for this vehicle.`;
    }
    receipts.push({
      tenant_id: null,
      batch_id: batch.id,
      row_number: row.workbook_row_number,
      sheet_name: 'VEHICLES',
      outcome,
      entity_type: 'vehicle',
      entity_ref: entityRef,
      error_code: errorCode,
      error_message: errorMessage,
      attempt: nextAttemptByRow(row.workbook_row_number),
    });
    if (outcome === 'accepted') {
      // Only a real uuid may be written to a uuid column. A VIN is not one, and the row is
      // already linked to its vehicle by workbook_record_id, so the link stays null rather
      // than becoming a swallowed 22P02.
      const targetRecordId = isUuid(entityRef) ? entityRef : null;
      if (targetRecordId) {
        const { error: linkError } = await client.from('diaspora_workbook_import_rows')
          .update({ target_record_id: targetRecordId })
          .eq('id', row.id);
        // Never ignored: an unlinkable row is reported, not silently left dangling.
        if (linkError) {
          const last = receipts[receipts.length - 1];
          last.error_code = last.error_code || 'TARGET_LINK_FAILED';
          last.error_message = last.error_message || sanitizeErrorMessage({ error: linkError.message });
        }
      }
    }
  }

  // The mutations above have already happened. A receipt-write failure must therefore never
  // leave the batch claiming a status that is no longer true — it is reported, not thrown.
  let receiptsRecorded = true;
  let receiptError = null;
  if (receipts.length) {
    const { error } = await client.from('diaspora_workbook_import_receipts').insert(receipts);
    if (error) {
      receiptsRecorded = false;
      receiptError = error.message;
    }
  }

  // IMPORTED is a TERMINAL claim: `alreadyImported` short-circuits every later execution, so it
  // may only be written when the whole requested import actually happened and was recorded.
  //   D4 — an evidence upload that failed means the reviewer's requested evidence is NOT on the
  //        vehicle. Marking the batch IMPORTED reported zero failures and removed the only
  //        retry path, so a partial result became permanent and invisible.
  //   D5 — receipts that never reached the store leave the per-row audit trail missing, and a
  //        terminal status makes it unrepairable. The batch stays retryable so it can be.
  // Both keep the batch PARTIALLY_IMPORTED, which IS accepted for retry, and the evidence
  // idempotency key above stops a retry duplicating what already succeeded.
  const evidenceFailures = evidenceOutcomes.filter((entry) => entry.outcome === 'rejected').length;
  const complete = rejected === 0 && evidenceFailures === 0 && receiptsRecorded;
  const importStatus = complete
    ? VEHICLE_IMPORT_BATCH_STATUSES.IMPORTED
    : VEHICLE_IMPORT_BATCH_STATUSES.PARTIALLY_IMPORTED;
  const { error: updateError } = await client
    .from('diaspora_workbook_import_batches')
    .update({ import_status: importStatus, updated_by: userId })
    .eq('id', batch.id);
  if (updateError) throw new Error(updateError.message);

  // O2-X6 — announce the finished import (async-valuable: receipts + drafts to review).
  await emitDomainEvent(null, 'workbook.import.completed', {
    batchId: batch.id,
    templateKey: batch.template_type,
    recipientUserId: userId,
    outcome: importStatus,
    created: accepted,
    failed: rejected,
    whoMustAct: 'none',
    occurredAt: new Date().toISOString(),
    schemaVersion: 'o2_event.v1',
  }, null).catch((err) => {
    console.warn('workbook.import.completed outbox emit failed:', err.message);
  });

  return {
    batchId: batch.id,
    importStatus,
    created: accepted,
    failed: rejected,
    receipts: receipts.filter((r) => r.sheet_name === 'VEHICLES').map((r) => ({
      row_number: r.row_number, outcome: r.outcome, entity_ref: r.entity_ref,
      error_code: r.error_code, error_message: r.error_message, attempt: r.attempt,
    })),
    // Per-evidence detail is no longer discarded just because it cannot own a receipt row.
    evidence: evidenceOutcomes,
    evidence_failed: evidenceFailures,
    // Whether the audit trail for THIS pass actually reached the store.
    receipts_recorded: receiptsRecorded,
    receipts_error: receiptError,
    // Why the batch is still retryable, in words the workspace can show verbatim.
    incomplete_reason: complete ? null : [
      rejected ? `${rejected} vehicle${rejected === 1 ? '' : 's'} could not be created` : null,
      evidenceFailures ? `${evidenceFailures} evidence reference${evidenceFailures === 1 ? '' : 's'} were not recorded` : null,
      receiptsRecorded ? null : 'the import receipts for this pass were not saved',
    ].filter(Boolean).join('; '),
    retryable: !complete,
    // C6 — sheets this template accepts but this import does not persist, stated as a fact.
    not_imported_sheets: notImportedSheetSummary(batch.template_type),
  };
}

/* ------------------------------------------------------------------ *
 * RECENT IMPORTS — caller-scoped view over the EXISTING store.
 * ------------------------------------------------------------------ */

export async function listRecentVehicleImports(actor = {}, options = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  const client = options.supabaseClient || supabase;
  const { data, error } = await client
    .from('diaspora_workbook_import_batches')
    .select('*')
    .eq('uploaded_by', userId)
    .in('template_type', Object.values(VEHICLE_TEMPLATE_KEYS))
    .order('created_at', { ascending: false })
    .limit(options.limit || 20);
  if (error) throw new Error(error.message);
  return (data || []).map((batch) => ({
    batch_id: batch.id,
    template_key: batch.template_type,
    source_filename: batch.source_filename,
    uploaded_at: batch.created_at,
    total_rows: batch.total_rows,
    accepted_rows: batch.accepted_rows,
    rejected_rows: batch.rejected_rows,
    warning_count: batch.warning_count,
    error_count: batch.error_count,
    import_status: batch.import_status,
    can_execute: batch.import_status === VEHICLE_IMPORT_BATCH_STATUSES.VALIDATED,
  }));
}
