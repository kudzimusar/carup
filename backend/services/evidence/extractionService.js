/**
 * Vehicle Document Extraction Service — Phase 3
 *
 * Persists OCR/AI field-level extractions and compares them with canonical
 * vehicle identity fields to produce a match_status for human review.
 *
 * AI confidence scores are advisory only: no extraction auto-approves or
 * auto-rejects. Every mismatch or inconclusive result is persisted for
 * human review.
 */
import { supabase } from '../../db/supabase.js';

/** Vehicle identity fields that extractions can be compared against. */
const VEHICLE_IDENTITY_FIELDS = [
  'vin',
  'plate_number',
  'normalized_plate_number',
  'chassis_number',
  'engine_number',
  'make',
  'model',
  'year',
];

/**
 * Normalize a raw extracted value to a canonical form suitable for comparison.
 * Returns null when the value is absent or un-normalizable.
 */
function normalizeValue(fieldName, rawValue) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const v = String(rawValue).trim();
  if (fieldName === 'vin') return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (fieldName === 'plate_number' || fieldName === 'normalized_plate_number')
    return v.toUpperCase().replace(/[\s-]/g, '');
  if (fieldName === 'chassis_number' || fieldName === 'engine_number')
    return v.toUpperCase().replace(/\s/g, '');
  if (fieldName === 'year') {
    const y = parseInt(v, 10);
    return isNaN(y) ? null : String(y);
  }
  return v;
}

/**
 * Determine match_status by comparing a normalized extracted value with the
 * expected vehicle field value.
 */
function computeMatchStatus(normalizedValue, expectedValue) {
  if (normalizedValue == null || expectedValue == null) return 'missing_reference';
  if (normalizedValue === '' || expectedValue === '') return 'missing_reference';
  return normalizedValue === String(expectedValue).trim() ? 'match' : 'mismatch';
}

/**
 * Persist an array of field-level OCR extraction records for a given evidence item.
 *
 * @param {Object} params
 * @param {string} params.evidenceId  — UUID of the vehicle_evidence row
 * @param {string} params.vin         — VIN of the vehicle
 * @param {string} params.documentType — e.g. 'registration_document', 'customs_entry'
 * @param {Array}  params.fields      — array of { fieldName, rawValue, comparedVehicleField?, confidence?, sourceModel?, aiJobId? }
 * @returns {Promise<{ extractions: Array, mismatch_count: number, pending_review_count: number }>}
 */
export async function persistExtractions({ evidenceId, vin, documentType, fields }) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { extractions: [], mismatch_count: 0, pending_review_count: 0 };
  }

  // Fetch canonical vehicle identity fields for comparison.
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .select('vin, plate_number, normalized_plate_number, chassis_number, engine_number, make, model, year')
    .eq('vin', vin)
    .single();

  if (vehicleErr || !vehicle) {
    throw new Error(`Vehicle not found for VIN ${vin}: ${vehicleErr?.message}`);
  }

  const rows = fields.map((f) => {
    const comparedField = f.comparedVehicleField && VEHICLE_IDENTITY_FIELDS.includes(f.comparedVehicleField)
      ? f.comparedVehicleField
      : null;
    // Normalize using the vehicle field type (comparedField) when available,
    // so normalization rules match the canonical vehicle value format.
    const normalizeKey = comparedField ?? f.fieldName;
    const normalizedValue = normalizeValue(normalizeKey, f.rawValue);
    const expectedValue = comparedField ? String(vehicle[comparedField] ?? '') : null;
    const matchStatus = comparedField
      ? computeMatchStatus(normalizedValue, expectedValue)
      : 'inconclusive';
    const mismatchReason = matchStatus === 'mismatch'
      ? `Extracted "${normalizedValue}" does not match vehicle "${expectedValue}" (field: ${comparedField})`
      : null;

    return {
      evidence_id: evidenceId,
      vin,
      document_type: documentType,
      field_name: f.fieldName,
      raw_value: f.rawValue != null ? String(f.rawValue) : null,
      normalized_value: normalizedValue,
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      compared_vehicle_field: comparedField,
      expected_value: expectedValue,
      match_status: matchStatus,
      mismatch_reason: mismatchReason,
      review_status: 'pending',
      source_model: f.sourceModel ?? null,
      ai_job_id: f.aiJobId ?? null,
    };
  });

  const { data: inserted, error: insertErr } = await supabase
    .from('vehicle_document_extractions')
    .insert(rows)
    .select();

  if (insertErr) throw new Error(`Failed to insert extractions: ${insertErr.message}`);

  const extractions = inserted ?? [];
  const mismatch_count = extractions.filter((e) => e.match_status === 'mismatch').length;
  const pending_review_count = extractions.filter((e) => e.review_status === 'pending').length;

  return { extractions, mismatch_count, pending_review_count };
}

/**
 * List extractions for a VIN, optionally filtered by evidence_id or match_status.
 */
export async function listExtractions({ vin, evidenceId = null, matchStatus = null, pendingOnly = false }) {
  let query = supabase
    .from('vehicle_document_extractions')
    .select('*')
    .eq('vin', vin)
    .order('created_at', { ascending: false });

  if (evidenceId) query = query.eq('evidence_id', evidenceId);
  if (matchStatus) query = query.eq('match_status', matchStatus);
  if (pendingOnly) query = query.eq('review_status', 'pending');

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list extractions: ${error.message}`);

  const rows = data ?? [];
  return {
    extractions: rows,
    mismatch_count: rows.filter((e) => e.match_status === 'mismatch').length,
    pending_review_count: rows.filter((e) => e.review_status === 'pending').length,
  };
}

/**
 * Submit a reviewer decision for an extraction.
 * Only review_status and mismatch_reason may be updated (content is immutable).
 */
export async function reviewExtraction({ extractionId, reviewedBy, reviewStatus, mismatchReason = null }) {
  const allowed = ['confirmed', 'rejected', 'amended', 'waived'];
  if (!allowed.includes(reviewStatus)) {
    throw new Error(`Invalid review_status "${reviewStatus}". Allowed: ${allowed.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('vehicle_document_extractions')
    .update({
      review_status: reviewStatus,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      ...(mismatchReason != null ? { mismatch_reason: mismatchReason } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', extractionId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update extraction review: ${error.message}`);
  return data;
}
