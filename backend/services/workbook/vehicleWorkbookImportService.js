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
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
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
export async function validateVehicleWorkbookPayload({ templateKey, sheetRows }, { lookupExistingVins } = {}) {
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
  attach('EVIDENCE_NOTES', 'evidence', (group, row) => { group.evidence.push(row); });

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
    totals: {
      vehicleCount: groups.length,
      acceptedVehicles: acceptedGroups.length,
      blockedVehicles: groups.length - acceptedGroups.length,
      errorCount: errors.length,
      warningCount: warnings.length,
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
    persistence: { batchId: batch.id, importStatus: batchRow.import_status },
  };
}

/* ------------------------------------------------------------------ *
 * EXECUTE — replay accepted vehicles through the canonical create route.
 * ------------------------------------------------------------------ */

function loopbackDispatch(req) {
  const port = Number(process.env.PORT || 3001);
  return (path, method, body) => new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    for (const name of ['authorization', 'x-session-token', 'cookie']) {
      if (req?.headers?.[name]) headers[name] = req.headers[name];
    }
    const request = http.request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { raw }; }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

function sanitizeErrorMessage(body) {
  const message = body?.error || body?.message || 'The vehicle could not be created.';
  return String(message).slice(0, 400);
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

  const dispatch = options.dispatch || loopbackDispatch(options.req);
  const receipts = [];
  let accepted = 0;
  let rejected = 0;

  for (const row of rows || []) {
    const payload = row.normalized_payload;
    if (!payload) continue;
    let outcome = 'rejected';
    let entityRef = null;
    let errorCode = null;
    let errorMessage = null;
    try {
      const response = await dispatch('/api/vehicles/add', 'POST', payload);
      if (response.status >= 200 && response.status < 300) {
        outcome = 'accepted';
        entityRef = response.body?.vehicle?.id || response.body?.vehicle?.vin || row.workbook_record_id;
        accepted += 1;
        // Evidence references replay through the canonical evidence endpoint; a
        // failure never voids the created draft — it lands as its own receipt row.
        for (const evidence of row.metadata?.evidence || []) {
          const evidenceResponse = await dispatch(
            `/api/vehicles/${encodeURIComponent(row.workbook_record_id)}/evidence/upload`, 'POST', {
              evidence_class: evidence.evidence_class,
              evidence_subtype: evidence.evidence_subtype,
              file_url: evidence.file_url,
              event_date: evidence.event_date,
              event_date_precision: evidence.event_date_precision,
              metadata: evidence.evidence_label ? { workbook_label: evidence.evidence_label } : undefined,
            });
          receipts.push({
            tenant_id: null,
            batch_id: batch.id,
            row_number: row.workbook_row_number,
            sheet_name: 'EVIDENCE_NOTES',
            outcome: evidenceResponse.status >= 200 && evidenceResponse.status < 300 ? 'accepted' : 'rejected',
            entity_type: 'vehicle_evidence',
            entity_ref: null,
            error_code: evidenceResponse.status >= 300 ? `HTTP_${evidenceResponse.status}` : null,
            error_message: evidenceResponse.status >= 300 ? sanitizeErrorMessage(evidenceResponse.body) : null,
            attempt: 1,
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
      attempt: 1,
    });
    if (outcome === 'accepted') {
      await client.from('diaspora_workbook_import_rows')
        .update({ target_record_id: entityRef })
        .eq('id', row.id);
    }
  }

  if (receipts.length) {
    const { error: receiptError } = await client.from('diaspora_workbook_import_receipts').insert(receipts);
    if (receiptError) throw new Error(receiptError.message);
  }

  const importStatus = rejected === 0
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
      error_code: r.error_code, error_message: r.error_message,
    })),
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
