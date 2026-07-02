/**
 * Evidence set service — Milestone 1 (master plan §4.4 / §4.7).
 *
 * Evidence sets group related assets for one event (e.g. before/during/after a repair,
 * or an auction lot) so they render together on the timeline and feed the M3 temporal
 * comparison engine. Sets do not change evidence visibility or verification state.
 */
import { isValidClass } from './evidenceTaxonomy.js';

const TABLE = 'evidence_sets';
const EVIDENCE_TABLE = 'vehicle_evidence';

const DATE_PRECISIONS = ['day', 'month', 'year', 'unknown'];

export function validateEvidenceSetPayload(payload = {}) {
  const errors = [];
  if (!payload.vin) errors.push('vin is required');
  if (payload.evidence_class && !isValidClass(payload.evidence_class)) {
    errors.push(`unknown evidence_class '${payload.evidence_class}'`);
  }
  if (payload.event_date_precision && !DATE_PRECISIONS.includes(payload.event_date_precision)) {
    errors.push(`invalid event_date_precision '${payload.event_date_precision}'`);
  }
  return { ok: errors.length === 0, errors };
}

export async function createEvidenceSet(supabase, payload, actor = {}) {
  const { ok, errors } = validateEvidenceSetPayload(payload);
  if (!ok) {
    const err = new Error(`invalid evidence set: ${errors.join('; ')}`);
    err.statusCode = 400;
    err.validationErrors = errors;
    throw err;
  }
  const row = {
    vin: payload.vin,
    evidence_class: payload.evidence_class || null,
    set_type: payload.set_type || null,
    label: payload.label || null,
    event_date: payload.event_date || null,
    event_date_precision: payload.event_date_precision || 'day',
    source_id: payload.source_id || null,
    created_by: actor.id || null,
    metadata: payload.metadata || {},
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select();
  if (error) throw new Error(`evidence set create failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export async function listEvidenceSetsForVin(supabase, vin) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('vin', vin)
    .order('event_date', { ascending: true });
  if (error) throw new Error(`evidence set list failed: ${error.message}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

/** Attach an existing evidence record to a set (sets evidence_set_id). */
export async function attachEvidenceToSet(supabase, evidenceId, setId) {
  const { data, error } = await supabase
    .from(EVIDENCE_TABLE)
    .update({ evidence_set_id: setId })
    .eq('id', evidenceId)
    .select();
  if (error) throw new Error(`attach to set failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export default {
  validateEvidenceSetPayload,
  createEvidenceSet,
  listEvidenceSetsForVin,
  attachEvidenceToSet,
};
