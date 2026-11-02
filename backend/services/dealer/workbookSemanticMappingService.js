import ExcelJS from 'exceljs';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { requestAdvisoryJson } from '../ai/domainAdvisoryAdapter.js';
import { getXlsxTemplate, isSupportedXlsxTemplateType } from '../../constants/diaspora/diasporaWorkbookTemplates.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

/**
 * O2-X5 — semantic column mapping for dealer workbook migration (ported by OC-5C from PR #208 d8c11885).
 *
 * AI maps workbook fields; humans confirm the mapping; the EXISTING dry-run remains the truth gate.
 * This service only PROPOSES and RECORDS: deterministic normalization + alias matching first, an
 * advisory AI proposal (HEADERS ONLY — never row values, never customer PII) for the leftovers, then
 * a human-confirmed mapping persisted BOUND to the exact workbook bytes (checksum), template/sheet,
 * user, dealer and mapping version. Targets are validated against the canonical template's own
 * columns — the engine's allowlist, not the client's. Nothing here writes imported records, and
 * nothing here can bypass runAndPersistDiasporaWorkbookDryRun or the confirm/execute token chain.
 *
 * OC-5C: the AI leg goes through the ONE governed path — domainAdvisoryAdapter → CarUp AI gateway —
 * instead of #208's direct askGemini (retired on this lineage: GeminiClient no longer exports it, and
 * no new module may call a model vendor directly). An answer the gateway did not mark as an executed
 * advisory output is no answer: the header stays unmapped and the response says why. Every AI-proposed
 * target carries the provider/model that produced it.
 */

export const MAPPING_VERSION = 'dealer_workbook_mapping.v1';
export const IGNORED_TARGET = 'ignore';

const HEADER_LIMIT = 80;
const MAPPABLE_ROW_LIMIT = 2000;

export function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Deterministic aliases: common dealer-spreadsheet header variants → canonical template columns.
 * Applied ONLY when the target exists on the selected sheet; extend deliberately.
 */
const DETERMINISTIC_ALIASES = Object.freeze({
  reg_no: 'VIN', registration: 'VIN', vehicle_reg: 'VIN', reg_number: 'VIN',
  chassis: 'CHASSIS_NUMBER', chassis_no: 'CHASSIS_NUMBER', chassis_number: 'CHASSIS_NUMBER',
  vin: 'VIN', vin_number: 'VIN',
  cust_tel: 'RECEIVER_PHONE', customer_phone: 'RECEIVER_PHONE', phone: 'RECEIVER_PHONE', tel: 'RECEIVER_PHONE',
  customer_name: 'RECEIVER_NAME', client_name: 'RECEIVER_NAME',
  stock: 'NOTES', stock_no: 'NOTES', inventory_reference: 'NOTES',
  make: 'REQUESTED_MAKE', model: 'REQUESTED_MODEL',
  year: 'REQUESTED_YEAR_MIN',
  amount: 'QUOTE_AMOUNT', price: 'QUOTE_AMOUNT', quote: 'QUOTE_AMOUNT',
  currency: 'QUOTE_CURRENCY',
  notes: 'NOTES', comments: 'NOTES', remarks: 'NOTES',
  country: 'COUNTRY', city: 'CITY',
  document_type: 'DOCUMENT_TYPE', doc_type: 'DOCUMENT_TYPE',
});

export function canonicalColumnsFor(templateType, sheetName) {
  if (!isSupportedXlsxTemplateType(templateType)) {
    throw new ValidationError(`Unsupported workbook template type: ${templateType || '(missing)'}.`);
  }
  const template = getXlsxTemplate(templateType);
  const sheet = template.sheets.find((s) => s.name === sheetName || s.sheetName === sheetName);
  if (!sheet) {
    const names = template.sheets.map((s) => s.name || s.sheetName);
    throw new ValidationError(`Sheet '${sheetName}' is not part of the ${templateType} template. Sheets: ${names.join(', ')}.`);
  }
  const keys = (sheet.columns || []).map((c) => c.key || c.header).filter(Boolean);
  if (!keys.length) throw new ValidationError(`Template sheet '${sheetName}' defines no columns.`);
  return keys;
}

async function loadFirstSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ValidationError('The file could not be read as an .xlsx workbook.');
  }
  const worksheet = workbook.worksheets.find((ws) => ws.rowCount > 0);
  if (!worksheet) throw new ValidationError('The workbook contains no readable sheet.');
  return worksheet;
}

const cellText = (cell) => {
  const value = cell.value && typeof cell.value === 'object' && 'result' in cell.value ? cell.value.result : cell.value;
  return value === null || value === undefined ? '' : String(value).trim();
};

function headersOf(worksheet) {
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell);
    if (text) headers.push(text);
  });
  if (!headers.length) throw new ValidationError('Row 1 of the workbook has no column headers.');
  if (headers.length > HEADER_LIMIT) throw new ValidationError(`Too many columns (${headers.length}); the limit is ${HEADER_LIMIT}.`);
  if (new Set(headers).size !== headers.length) throw new ValidationError('Two columns share the same header — rename one so every column can be mapped.');
  return headers;
}

/** Parse ONLY the header row (+ row count) of an arbitrary uploaded spreadsheet. */
export async function parseRawWorkbookHeaders(buffer) {
  const worksheet = await loadFirstSheet(buffer);
  return { sheetName: worksheet.name, headers: headersOf(worksheet), rowCount: Math.max(0, worksheet.rowCount - 1) };
}

/** Parse data rows as header→value objects (strings), capped. */
export async function parseRawWorkbookRows(buffer) {
  const worksheet = await loadFirstSheet(buffer);
  const headers = headersOf(worksheet);
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAPPABLE_ROW_LIMIT) return;
    const record = {};
    headers.forEach((header, index) => {
      const text = cellText(row.getCell(index + 1));
      if (text) record[header] = text;
    });
    if (Object.keys(record).length) rows.push(record);
  });
  return rows;
}

function deterministicTargetFor(header, canonicalColumns) {
  const normalized = normalizeHeader(header);
  const canonicalByNormalized = new Map(canonicalColumns.map((c) => [normalizeHeader(c), c]));
  if (canonicalByNormalized.has(normalized)) {
    return { target: canonicalByNormalized.get(normalized), reason: 'exact_canonical_match' };
  }
  const alias = DETERMINISTIC_ALIASES[normalized];
  if (alias && canonicalColumns.includes(alias)) {
    return { target: alias, reason: `alias:${normalized}` };
  }
  return null;
}

/**
 * Advisory AI proposal for the headers deterministic matching could not resolve. HEADERS ONLY leave
 * CarUp — no row values, no samples: customer PII is never prompt material. The answer is validated
 * against the allowlist; anything else is dropped to unmapped. A failure degrades to unmapped with its
 * reason, never to a guess.
 */
async function aiProposalsFor(headers, canonicalColumns, options = {}) {
  if (!headers.length) return { proposals: {}, ai: { state: 'not_needed' } };
  try {
    const answer = await requestAdvisoryJson({
      systemPrompt: 'You map spreadsheet column HEADERS to a fixed allowlist of canonical field keys for a vehicle-trade workbook. '
        + 'Reply with JSON only: {"mappings":[{"source":"<header>","target":"<allowlisted key or null>","confidence":0..1}]}. '
        + 'Use null when unsure. Never invent keys outside the allowlist.',
      userPrompt: `Allowlisted canonical keys: ${canonicalColumns.join(', ')}\nHeaders to map: ${headers.join(' | ')}`,
      purpose: 'dealer workbook header mapping',
    }, { gateway: options.gateway });
    const out = {};
    for (const entry of answer.value?.mappings || []) {
      const source = String(entry?.source ?? '');
      const target = entry?.target === null || entry?.target === undefined ? null : String(entry.target);
      if (!headers.includes(source)) continue;
      if (target !== null && !canonicalColumns.includes(target)) continue;
      const confidence = Number(entry?.confidence);
      out[source] = { target, confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null };
    }
    return { proposals: out, ai: { state: 'provider_executed', provider: answer.provider, model: answer.model } };
  } catch (err) {
    const code = err?.code || 'AI_GATEWAY_ERROR';
    return { proposals: {}, ai: { state: 'unavailable', code, provider: err?.provider ?? null, model: err?.model ?? null } };
  }
}

/** The full proposal: deterministic first, advisory AI only for the leftovers. Proposals never execute. */
export async function proposeSemanticMapping({ headers, templateType, sheetName }, options = {}) {
  const canonicalColumns = canonicalColumnsFor(templateType, sheetName);
  const proposals = [];
  const unresolved = [];

  for (const header of headers) {
    const deterministic = deterministicTargetFor(header, canonicalColumns);
    if (deterministic) {
      proposals.push({ source: header, proposed_target: deterministic.target, confidence: 1, provider: 'deterministic', reason: deterministic.reason });
    } else {
      unresolved.push(header);
    }
  }

  const { proposals: aiResults, ai } = await aiProposalsFor(unresolved, canonicalColumns, options);
  for (const header of unresolved) {
    const proposal = aiResults[header];
    if (proposal && proposal.target !== null) {
      proposals.push({ source: header, proposed_target: proposal.target, confidence: proposal.confidence, provider: 'ai', model: ai.model, reason: 'ai_semantic' });
    } else {
      proposals.push({
        source: header,
        proposed_target: null,
        confidence: null,
        provider: 'unmapped',
        reason: ai.state === 'unavailable' ? `ai_unavailable:${ai.code}` : 'no_match',
      });
    }
  }

  return { canonical_columns: canonicalColumns, proposals, mapping_version: MAPPING_VERSION, ai };
}

/** Persist the HUMAN-confirmed mapping, bound to user + dealer + checksum + template/sheet. */
export async function confirmSemanticMapping(client = supabase, actor = {}, {
  dealerId,
  templateType,
  sheetName,
  workbookChecksum,
  mappings,
} = {}, options = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  if (!dealerId) throw new ValidationError('dealerId is required.');
  const checksum = String(workbookChecksum || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum)) throw new ValidationError('A sha-256 workbook checksum is required.');
  if (!Array.isArray(mappings) || !mappings.length) throw new ValidationError('mappings must be a non-empty array.');
  if (mappings.length > HEADER_LIMIT) throw new ValidationError(`At most ${HEADER_LIMIT} columns can be mapped.`);

  const canonicalColumns = canonicalColumnsFor(templateType, sheetName);
  const confirmed = [];
  const seenSources = new Set();
  for (const entry of mappings) {
    const source = String(entry?.source ?? '').trim().slice(0, 200);
    const target = String(entry?.target ?? '').trim();
    if (!source) throw new ValidationError('Every mapping entry needs a source column.');
    if (seenSources.has(source)) throw new ValidationError(`Duplicate mapping for source column '${source}'.`);
    seenSources.add(source);
    if (target !== IGNORED_TARGET && !canonicalColumns.includes(target)) {
      throw new ForbiddenError(`'${target}' is not an allowlisted canonical column for ${templateType}/${sheetName}.`);
    }
    confirmed.push({ source, target });
  }
  const chosenTargets = confirmed.filter((m) => m.target !== IGNORED_TARGET).map((m) => m.target);
  if (!chosenTargets.length) throw new ValidationError('Map at least one column — every column is ignored.');
  if (new Set(chosenTargets).size !== chosenTargets.length) {
    throw new ValidationError('Two source columns map to the same canonical column — resolve the conflict.');
  }

  const { data: inserted, error } = await client
    .from('dealer_workbook_mapping_confirmations')
    .insert({
      user_id: userId,
      dealer_id: dealerId,
      template_type: templateType,
      sheet_name: sheetName,
      workbook_checksum: checksum,
      mapping: confirmed,
      mapping_version: MAPPING_VERSION,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // The confirmation is the record; its audit follows the durable write and is reported.
  const audit = await logAuditEvent(client, {
    req: options.req,
    event_type: 'DEALER_WORKBOOK_MAPPING_CONFIRMED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/workbook/mapping/confirm',
    targetType: 'dealer_workbook_mapping_confirmation',
    targetId: inserted.id,
    new_value: {
      workbook_checksum: checksum,
      template_type: templateType,
      sheet_name: sheetName,
      mapped: chosenTargets.length,
      ignored: confirmed.length - chosenTargets.length,
      mapping_version: MAPPING_VERSION,
    },
  });
  return { ...inserted, audit_recorded: audit?.success === true };
}

/** The live confirmation for these exact bytes, or a stale/absent refusal by name. */
export async function requireLiveMappingConfirmation(client = supabase, { userId, workbookChecksum, templateType, sheetName } = {}) {
  const checksum = String(workbookChecksum || '').trim().toLowerCase();
  const { data, error } = await client
    .from('dealer_workbook_mapping_confirmations')
    .select('*')
    .eq('user_id', userId)
    .eq('workbook_checksum', checksum)
    .eq('template_type', templateType)
    .eq('sheet_name', sheetName);
  if (error) throw new Error(error.message);
  const rows = (data || []).slice().sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  if (!rows[0]) {
    throw new NotFoundError(
      'MAPPING_CONFIRMATION_REQUIRED: no confirmed mapping exists for this exact workbook. '
      + 'If you edited the file, its checksum changed and the previous confirmation is stale — review and confirm the mapping again.',
    );
  }
  return rows[0];
}

/** Apply a confirmed mapping: rename mapped columns, drop ignored/unmapped ones. */
export function applyConfirmedMapping(rows, confirmation) {
  const mapping = new Map(
    (confirmation.mapping || [])
      .filter((m) => m.target !== IGNORED_TARGET)
      .map((m) => [m.source, m.target]),
  );
  return (rows || []).map((row) => {
    const mapped = {};
    for (const [source, value] of Object.entries(row)) {
      const target = mapping.get(source);
      if (target) mapped[target] = value;
    }
    return mapped;
  }).filter((row) => Object.keys(row).length > 0);
}

export default {
  MAPPING_VERSION,
  IGNORED_TARGET,
  normalizeHeader,
  canonicalColumnsFor,
  parseRawWorkbookHeaders,
  parseRawWorkbookRows,
  proposeSemanticMapping,
  confirmSemanticMapping,
  requireLiveMappingConfirmation,
  applyConfirmedMapping,
};
