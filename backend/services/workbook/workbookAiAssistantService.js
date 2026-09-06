/**
 * O2-X5A — CarUp AI Workbook Assistant (backend).
 *
 * AI AUTHORITY MATRIX (enforced here, pinned by tests): the assistant maps,
 * explains, checks, finds and summarizes; it NEVER invents a value, fills a
 * missing fact, marks anything verified/approved, or bypasses the human
 * mapping confirmation. Deterministic answers come first — the registry's
 * vocabulary aliases ARE the deterministic normalizer; AI only proposes for
 * what determinism could not resolve, sees only the minimal safe context
 * (enum cell text + the allowed labels — never rows of personal data), and
 * every AI output is a PROPOSAL requiring the user's explicit acceptance.
 * AI failure degrades to manual work, never to silence or a guess.
 */
import { askGemini } from '../ai/GeminiClient.js';
import { ValidationError } from '../../utils/errors.js';
import {
  VEHICLE_TEMPLATE_SHEETS,
  getSheetDefinition,
  resolveVocabularyValue,
  isVehicleWorkbookTemplateKey,
} from '../../constants/workbook/workbookFieldRegistry.js';

/* ------------------------------------------------------------------ *
 * Explain this field — registry-served, deterministic.
 * ------------------------------------------------------------------ */

export function explainField({ templateKey, sheetName, field } = {}) {
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError(`'${templateKey}' is not a vehicle workbook template.`);
  }
  const sheets = sheetName ? [sheetName] : VEHICLE_TEMPLATE_SHEETS[templateKey];
  for (const name of sheets) {
    const sheetDef = getSheetDefinition(name);
    if (!sheetDef) continue;
    const token = String(field || '').trim().toLowerCase();
    const match = sheetDef.fields.find(
      (candidate) => candidate.key.toLowerCase() === token || candidate.header.toLowerCase() === token,
    );
    if (match) {
      return {
        sheet_name: name,
        key: match.key,
        header: match.header,
        explanation: match.help || match.header,
        required: Boolean(match.required),
        authority: match.authority,
        privacy: match.privacy,
        allowed_values: match.vocabulary
          ? match.vocabulary.map((entry) => ({ value: entry.value, label: entry.label }))
          : null,
        source: 'field_registry',
      };
    }
  }
  throw new ValidationError(`No field '${field}' exists on the ${templateKey} template.`);
}

/* ------------------------------------------------------------------ *
 * Explain this error — curated, plain English.
 * ------------------------------------------------------------------ */

const ERROR_EXPLANATIONS = Object.freeze({
  REQUIRED_MISSING: 'This column must have a value on every row. Fill it in, then re-run the check.',
  VOCABULARY_MISMATCH: 'The cell text is not one of the allowed values for this column. Pick a value from the dropdown (or see "allowed values" for this field).',
  VALUE_NORMALIZED: 'The value was recognized under a common alternative spelling and converted to the canonical form — nothing to fix.',
  FALLBACK_MARKER_IGNORED: 'Placeholders like "N/A" or "Unknown" are not data — the cell was treated as empty. Enter a real value or leave it blank.',
  NOT_A_NUMBER: 'This column needs a plain number (no currency symbols or units).',
  NOT_AN_INTEGER: 'This column needs a whole number.',
  BELOW_MINIMUM: 'The number is below the allowed minimum for this column.',
  FORMAT_INVALID: 'The value does not match the expected format for this column.',
  TOO_LONG: 'The text is longer than this column allows.',
  TOO_SHORT: 'The text is shorter than this column requires.',
  DUPLICATE_VIN_IN_FILE: 'The same VIN appears on more than one VEHICLES row. Keep exactly one row per vehicle.',
  VIN_NOT_IN_VEHICLES: 'This row references a VIN that has no row on the VEHICLES sheet. Add the vehicle there first.',
  DUPLICATE_LISTING_ROW: 'A vehicle can have only one LISTINGS row. Merge or remove the extra row.',
  DUPLICATE_DISCLOSURE_ROW: 'A vehicle can have only one DISCLOSURES row. Merge or remove the extra row.',
  CONFLICTING_ACCIDENT_STATE: 'The accident question is answered differently on two rows for the same vehicle. Keep one answer.',
  TOO_MANY_ACCIDENT_EVENTS: 'A vehicle can carry at most 10 accident events. Combine or trim the oldest entries.',
  ACCIDENT_EVENTS_EMPTY: 'You answered "yes" to the accident question without event details — the answer will import, and you can add details on the site.',
  ACCIDENT_STATE_REQUIRED: 'There are accident event rows, but the accident question is not answered "yes" for this vehicle.',
  TOO_MANY_PHOTOS: 'A vehicle can carry at most 15 photo references.',
  MULTIPLE_COVER_PHOTOS: 'Only one photo per vehicle can be the cover. Set "Cover photo?" to Yes on exactly one row.',
  LISTING_ROW_MISSING: 'Every vehicle needs a LISTINGS row with price, currency, city and description.',
  VEHICLE_ALREADY_EXISTS: 'This VIN already exists on CarUp. Open the existing vehicle on the site instead — a bulk import never overrides an existing record.',
  MAPPING_CONFIRMATION_REQUIRED: 'The workbook changed since its column mapping was confirmed (or was never confirmed). Review and confirm the mapping for this exact file, then retry.',
  TEMPLATE_VERSION_UNSUPPORTED: 'This file was generated from an old template version. Download the current template and copy your rows across — old columns are never silently reinterpreted.',
  CONFIRMATION_REQUIRED: 'Nothing imports until you review the dry run and explicitly confirm the import.',
  WORKBOOK_TEMPLATE_NOT_AVAILABLE: 'This template is not available to your account — the catalogue shows what is, and why anything else is not.',
});

export function explainError({ code } = {}) {
  const normalized = String(code || '').trim().toUpperCase();
  return {
    code: normalized || null,
    explanation: ERROR_EXPLANATIONS[normalized]
      || 'Something about this row needs your attention. Open the row in the issues list for the specific message.',
    source: ERROR_EXPLANATIONS[normalized] ? 'curated' : 'generic',
  };
}

/* ------------------------------------------------------------------ *
 * Suggest correction — deterministic (registry aliases) first, AI proposal
 * second (enum columns only; minimal context), unknowable → ask the human.
 * ------------------------------------------------------------------ */

export async function suggestCorrections({ templateKey, issues } = {}, options = {}) {
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError(`'${templateKey}' is not a vehicle workbook template.`);
  }
  const askAi = options.ai || (async (system, user) => askGemini(system, user, true));
  const suggestions = [];

  for (const issue of issues || []) {
    const base = {
      sheet_name: issue.sheetName,
      row: issue.rowIndex,
      field: issue.field,
      code: issue.code,
    };
    if (issue.code === 'REQUIRED_MISSING' || issue.code === 'NOT_A_NUMBER' || issue.code === 'FALLBACK_MARKER_IGNORED') {
      // The correct value is UNKNOWN to CarUp — never fabricated.
      suggestions.push({ ...base, action: 'needs_user_value', suggested_value: null, provider: 'none',
        note: 'No value can be safely inferred — enter the real value.' });
      continue;
    }
    if (issue.code !== 'VOCABULARY_MISMATCH' || !issue.field) {
      suggestions.push({ ...base, action: 'review', suggested_value: null, provider: 'none' });
      continue;
    }
    const sheetDef = getSheetDefinition(issue.sheetName);
    const fieldDef = sheetDef?.fields.find((candidate) => candidate.key === issue.field);
    const cell = String(issue.cellText ?? issue.value ?? '').trim();
    if (!fieldDef?.vocabulary || !cell) {
      suggestions.push({ ...base, action: 'review', suggested_value: null, provider: 'none' });
      continue;
    }
    // Deterministic: registry aliases + case/space-insensitive matching.
    const resolved = resolveVocabularyValue(fieldDef, cell);
    if (resolved.method) {
      const label = fieldDef.vocabulary.find((entry) => entry.value === resolved.value)?.label ?? String(resolved.value);
      suggestions.push({ ...base, action: 'accept_or_change', suggested_value: resolved.value,
        suggested_label: label, provider: 'deterministic_normalization', requires_confirmation: true });
      continue;
    }
    // AI proposal — enum columns only; the model sees the single cell text and the
    // allowed labels, nothing else.
    try {
      const response = await askAi(
        'You match one spreadsheet cell to a fixed allowlist of labels for a vehicle-listing column. '
        + 'Reply JSON only: {"match":"<one allowlisted label or null>","confidence":0..1}. Use null when unsure. Never invent.',
        `Column: ${fieldDef.header}\nAllowed labels: ${fieldDef.vocabulary.map((entry) => entry.label).join(' | ')}\nCell text: ${cell}`,
      );
      const parsed = JSON.parse(response);
      const matchLabel = parsed?.match === null || parsed?.match === undefined ? null : String(parsed.match);
      const entry = matchLabel
        ? fieldDef.vocabulary.find((candidate) => candidate.label === matchLabel)
        : null;
      if (entry) {
        suggestions.push({ ...base, action: 'accept_or_change', suggested_value: entry.value,
          suggested_label: entry.label, provider: 'ai',
          confidence: Number.isFinite(Number(parsed?.confidence)) ? Math.min(1, Math.max(0, Number(parsed.confidence))) : null,
          requires_confirmation: true });
      } else {
        suggestions.push({ ...base, action: 'needs_user_value', suggested_value: null, provider: 'none',
          note: 'No safe match — choose a value from the allowed list.' });
      }
    } catch {
      suggestions.push({ ...base, action: 'needs_user_value', suggested_value: null, provider: 'none',
        note: 'Assistant unavailable — choose a value from the allowed list manually.' });
    }
  }
  return { suggestions };
}

/* ------------------------------------------------------------------ *
 * Summarize my import + what still needs attention.
 * ------------------------------------------------------------------ */

export function summarizeDryRun({ dryRun } = {}) {
  const totals = dryRun?.totals || {};
  const ready = totals.acceptedVehicles ?? 0;
  const blocked = totals.blockedVehicles ?? 0;
  const warned = totals.warningCount ?? 0;
  return {
    headline: `${ready} vehicle${ready === 1 ? '' : 's'} ready to import · `
      + `${warned} note${warned === 1 ? '' : 's'} for your attention · `
      + `${blocked} blocked`,
    lines: [
      `${ready} row group${ready === 1 ? ' is' : 's are'} valid and will be created as private DRAFT vehicles.`,
      warned ? `${warned} warning${warned === 1 ? '' : 's'} — nothing is blocked by a warning, but read them.` : 'No warnings.',
      blocked ? `${blocked} vehicle${blocked === 1 ? ' is' : 's are'} blocked until their errors are fixed.` : 'Nothing is blocked.',
      '0 authority decisions will be imported — verification, compliance, trust and publication are never part of a workbook.',
    ],
    structural_guarantee: 'ZERO_AUTHORITY_OUTCOMES_IMPORTED',
  };
}

export function attentionReport({ dryRun } = {}) {
  const rows = [];
  for (const issue of [...(dryRun?.errors || []), ...(dryRun?.warnings || [])]) {
    rows.push({
      sheet_name: issue.sheetName,
      row: issue.rowIndex,
      field: issue.field,
      severity: (dryRun?.errors || []).includes(issue) ? 'error' : 'warning',
      code: issue.code,
      message: issue.message,
      explanation: explainError({ code: issue.code }).explanation,
    });
  }
  rows.sort((a, b) => (a.severity === b.severity ? a.row - b.row : a.severity === 'error' ? -1 : 1));
  return { needs_attention: rows, count: rows.length };
}
