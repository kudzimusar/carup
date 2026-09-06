/**
 * Trade OS Intake 2.0 — document READINESS (contract §36, Intake closure §3).
 *
 * This records what the customer says they have. It is not the document lifecycle, and the
 * distinction is the whole reason it is a separate, deliberately small authority:
 *
 *   - a row here is a STATEMENT ("I have the invoice"), never a file and never a verification;
 *   - nothing derived from it may claim verified, approved, complete, customs-ready or export-ready;
 *   - T8 owns uploads, classification, verification and everything that happens to an actual file.
 *
 * It exists so that T8 — and the customs and clearing phases after it — do not have to ask the same
 * question a second time.
 */
import { requireUserContext } from './diasporaAuthorization.js';
import { ValidationError } from '../../utils/errors.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { DOCUMENT_READINESS, DOCUMENT_TYPES } from './tradeIntakeContract.js';

const TABLE = 'diaspora_trade_document_readiness';
const SUBJECTS = new Set(['import_order', 'logistics_request']);
const KNOWN_TYPES = new Set(DOCUMENT_TYPES.map(([value]) => value));

/**
 * Record (or re-record) what the customer says about one document.
 *
 * Re-answering replaces the previous answer rather than appending: unlike a measurement, a
 * readiness answer has no evidential history worth preserving — "I will get it later" becoming
 * "I have it" is a corrected intention, not two competing observations of a fact.
 */
export async function setReadiness(subjectType, subjectId, entries = [], userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (!SUBJECTS.has(subjectType)) throw new ValidationError('Unknown readiness subject');
  if (!subjectId) throw new ValidationError('A readiness answer needs a subject');
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return [];

  const rows = list.map((entry) => {
    const documentType = String(entry.document_type ?? entry.documentType ?? '').trim().toLowerCase();
    const readiness = String(entry.readiness ?? '').trim().toLowerCase();
    if (!KNOWN_TYPES.has(documentType)) throw new ValidationError(`Unknown document type "${documentType}"`);
    if (!DOCUMENT_READINESS.has(readiness)) throw new ValidationError(`Unknown readiness state "${readiness}"`);
    return {
      tenant_id: context.tenantId || null,
      subject_type: subjectType,
      subject_id: subjectId,
      document_type: documentType,
      readiness,
      notes: entry.notes ? String(entry.notes).slice(0, 500) : null,
      stated_by: context.id,
      stated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const { data: existing } = await client.from(TABLE).select('id, document_type')
    .eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null);
  const byType = new Map((existing || []).map((row) => [row.document_type, row.id]));

  const written = [];
  for (const row of rows) {
    const priorId = byType.get(row.document_type);
    if (priorId) {
      const { data, error } = await client.from(TABLE).update(row).eq('id', priorId).select().single();
      if (error) throw new ValidationError(`Could not record document readiness: ${error.message}`);
      written.push(data);
    } else {
      const { data, error } = await client.from(TABLE).insert(row).select().single();
      if (error) throw new ValidationError(`Could not record document readiness: ${error.message}`);
      written.push(data);
    }
  }
  return written;
}

/**
 * What the customer said, with the boundary stated in the payload itself.
 *
 * `verified` is hard-coded false on every row. A consumer reading this cannot accidentally treat a
 * customer's "have it" as a checked document, because the shape refuses to imply it.
 */
export async function listReadiness(subjectType, subjectId, options = {}) {
  const client = await resolveClient(options);
  if (!SUBJECTS.has(subjectType)) throw new ValidationError('Unknown readiness subject');
  const { data, error } = await client.from(TABLE).select('*')
    .eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null);
  if (error) throw new ValidationError(`Could not read document readiness: ${error.message}`);
  return (data || []).map((row) => ({
    document_type: row.document_type,
    label: DOCUMENT_TYPES.find(([value]) => value === row.document_type)?.[1] || row.document_type,
    readiness: row.readiness,
    notes: row.notes || null,
    stated_at: row.stated_at,
    // Stated, never verified. Presence of a customer answer is not evidence of a document.
    verified: false,
    source: 'CUSTOMER_STATED',
  }));
}

/** Readiness is a customer statement, so nothing here may ever be reported as complete. */
export function summarizeReadiness(rows = []) {
  const have = rows.filter((r) => r.readiness === 'have_it').length;
  return {
    answered: rows.length,
    customer_says_they_have: have,
    // Deliberately NOT a percentage and NOT "complete": we do not know which documents this
    // journey actually requires, and inventing a denominator would invent a completeness claim.
    completeness_known: false,
    note: 'These are the customer\'s own answers. CarUp has not seen or checked any document.',
  };
}

export const isKnownDocumentType = (value) => KNOWN_TYPES.has(String(value || '').toLowerCase());
