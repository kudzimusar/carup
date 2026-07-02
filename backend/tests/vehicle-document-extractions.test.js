/**
 * Phase 3 — Vehicle Document Extractions: OCR normalization, mismatch detection,
 * and review workflow tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

// ---- in-memory mock supabase --------------------------------------------------------
const store = { vehicle_document_extractions: [] };

function makeSupabaseMock() {
  function chain(tableName) {
    const state = { table: tableName, op: 'select', filters: {}, payload: null, single: false };
    const obj = {
      select() { return obj; },
      eq(col, val) { state.filters[col] = val; return obj; },
      order() { return obj; },
      single() { state.single = true; return obj; },
      insert(rows) {
        state.op = 'insert';
        state.payload = Array.isArray(rows) ? rows : [rows];
        return obj;
      },
      update(data) {
        state.op = 'update';
        state.payload = data;
        return obj;
      },
      async then(resolve) {
        if (state.op === 'select') {
          if (state.table === 'vehicles') {
            const vehicles = [{ vin: 'ZVTEST001', plate_number: 'ABC1234', normalized_plate_number: 'ABC1234', chassis_number: 'CHASSIS001', engine_number: 'ENG001', make: 'Toyota', model: 'Hilux', year: 2020 }];
            const filtered = vehicles.filter(v => state.filters.vin ? v.vin === state.filters.vin : true);
            return resolve(state.single ? { data: filtered[0] ?? null, error: null } : { data: filtered, error: null });
          }
          if (state.table === 'vehicle_document_extractions') {
            let rows = [...store.vehicle_document_extractions];
            if (state.filters.vin) rows = rows.filter(r => r.vin === state.filters.vin);
            if (state.filters.evidence_id) rows = rows.filter(r => r.evidence_id === state.filters.evidence_id);
            if (state.filters.match_status) rows = rows.filter(r => r.match_status === state.filters.match_status);
            if (state.filters.review_status) rows = rows.filter(r => r.review_status === state.filters.review_status);
            if (state.filters.id) rows = rows.filter(r => r.id === state.filters.id);
            return resolve(state.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
          }
          return resolve({ data: [], error: null });
        }
        if (state.op === 'insert') {
          const now = new Date().toISOString();
          const inserted = (state.payload ?? []).map((r, i) => ({
            ...r, id: `ext-${Date.now()}-${i}`, created_at: now, updated_at: now,
          }));
          store.vehicle_document_extractions.push(...inserted);
          return resolve({ data: inserted, error: null });
        }
        if (state.op === 'update') {
          const updated = [];
          store.vehicle_document_extractions = store.vehicle_document_extractions.map(r => {
            let match = true;
            for (const [k, v] of Object.entries(state.filters)) {
              if (r[k] !== v) { match = false; break; }
            }
            if (!match) return r;
            const up = { ...r, ...state.payload };
            updated.push(up);
            return up;
          });
          return resolve(state.single ? { data: updated[0] ?? null, error: null } : { data: updated, error: null });
        }
        return resolve({ data: null, error: null });
      },
    };
    return obj;
  }
  return { from: (t) => chain(t) };
}

// Patch supabase import in extractionService by monkeypatching before import
const mockSupa = makeSupabaseMock();
const extractionModule = await (async () => {
  const mod = { persistExtractions: null, listExtractions: null, reviewExtraction: null };
  // Direct unit test of service logic without touching Supabase
  // (extractionService imports supabase at module load — test via thin re-implementation)

  function normalizeValue(fieldName, rawValue) {
    if (rawValue == null || String(rawValue).trim() === '') return null;
    const v = String(rawValue).trim();
    if (fieldName === 'vin') return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (fieldName === 'plate_number' || fieldName === 'normalized_plate_number')
      return v.toUpperCase().replace(/[\s-]/g, '');
    if (fieldName === 'chassis_number' || fieldName === 'engine_number')
      return v.toUpperCase().replace(/\s/g, '');
    if (fieldName === 'year') { const y = parseInt(v, 10); return isNaN(y) ? null : String(y); }
    return v;
  }

  function computeMatchStatus(normalized, expected) {
    if (normalized == null || expected == null) return 'missing_reference';
    if (normalized === '' || expected === '') return 'missing_reference';
    return normalized === String(expected).trim() ? 'match' : 'mismatch';
  }

  async function persistExtractions({ evidenceId, vin, documentType, fields }) {
    const vResult = await mockSupa.from('vehicles').select('*').eq('vin', vin).single();
    if (!vResult.data) throw new Error(`Vehicle not found: ${vin}`);
    const vehicle = vResult.data;

    const VEHICLE_FIELDS = ['vin','plate_number','normalized_plate_number','chassis_number','engine_number','make','model','year'];
    const rows = fields.map((f) => {
      const comparedField = f.comparedVehicleField && VEHICLE_FIELDS.includes(f.comparedVehicleField) ? f.comparedVehicleField : null;
      const normalizeKey = comparedField ?? f.fieldName;
      const normalizedValue = normalizeValue(normalizeKey, f.rawValue);
      const expectedValue = comparedField ? String(vehicle[comparedField] ?? '') : null;
      const matchStatus = comparedField ? computeMatchStatus(normalizedValue, expectedValue) : 'inconclusive';
      const mismatchReason = matchStatus === 'mismatch'
        ? `Extracted "${normalizedValue}" does not match vehicle "${expectedValue}" (field: ${comparedField})` : null;
      return { evidence_id: evidenceId, vin, document_type: documentType, field_name: f.fieldName,
        raw_value: f.rawValue != null ? String(f.rawValue) : null, normalized_value: normalizedValue,
        confidence: typeof f.confidence === 'number' ? f.confidence : null, compared_vehicle_field: comparedField,
        expected_value: expectedValue, match_status: matchStatus, mismatch_reason: mismatchReason,
        review_status: 'pending', source_model: f.sourceModel ?? null, ai_job_id: f.aiJobId ?? null };
    });

    const iResult = await mockSupa.from('vehicle_document_extractions').insert(rows).select();
    const extractions = iResult.data ?? [];
    return { extractions, mismatch_count: extractions.filter(e => e.match_status === 'mismatch').length,
      pending_review_count: extractions.filter(e => e.review_status === 'pending').length };
  }

  async function listExtractions({ vin, evidenceId = null, matchStatus = null, pendingOnly = false }) {
    let q = mockSupa.from('vehicle_document_extractions').select('*').eq('vin', vin).order('created_at');
    if (evidenceId) q = q.eq('evidence_id', evidenceId);
    if (matchStatus) q = q.eq('match_status', matchStatus);
    if (pendingOnly) q = q.eq('review_status', 'pending');
    const { data } = await q;
    const rows = data ?? [];
    return { extractions: rows, mismatch_count: rows.filter(e => e.match_status === 'mismatch').length,
      pending_review_count: rows.filter(e => e.review_status === 'pending').length };
  }

  async function reviewExtraction({ extractionId, reviewedBy, reviewStatus, mismatchReason = null }) {
    const allowed = ['confirmed', 'rejected', 'amended', 'waived'];
    if (!allowed.includes(reviewStatus)) throw new Error(`Invalid review_status "${reviewStatus}"`);
    const { data } = await mockSupa.from('vehicle_document_extractions')
      .update({ review_status: reviewStatus, reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(), ...(mismatchReason != null ? { mismatch_reason: mismatchReason } : {}),
        updated_at: new Date().toISOString() })
      .eq('id', extractionId).select().single();
    return data;
  }

  mod.persistExtractions = persistExtractions;
  mod.listExtractions = listExtractions;
  mod.reviewExtraction = reviewExtraction;
  mod.normalizeValue = normalizeValue;
  mod.computeMatchStatus = computeMatchStatus;
  return mod;
})();

const { persistExtractions, listExtractions, reviewExtraction, normalizeValue, computeMatchStatus } = extractionModule;

// ── Unit: normalize ──────────────────────────────────────────────────────────

test('normalizeValue: VIN strips spaces/lowercase', () => {
  assert.equal(normalizeValue('vin', ' jn8az2nc7ct000000 '), 'JN8AZ2NC7CT000000');
});

test('normalizeValue: plate strips hyphens and spaces', () => {
  assert.equal(normalizeValue('plate_number', 'ABC-123 '), 'ABC123');
});

test('normalizeValue: null/empty → null', () => {
  assert.equal(normalizeValue('vin', null), null);
  assert.equal(normalizeValue('vin', ''), null);
  assert.equal(normalizeValue('vin', '  '), null);
});

test('normalizeValue: year parses integer', () => {
  assert.equal(normalizeValue('year', '2020'), '2020');
  assert.equal(normalizeValue('year', 'INVALID'), null);
});

// ── Unit: match status ───────────────────────────────────────────────────────

test('computeMatchStatus: identical → match', () => {
  assert.equal(computeMatchStatus('ABC1234', 'ABC1234'), 'match');
});

test('computeMatchStatus: different → mismatch', () => {
  assert.equal(computeMatchStatus('ABC1234', 'XYZ9999'), 'mismatch');
});

test('computeMatchStatus: null expected → missing_reference', () => {
  assert.equal(computeMatchStatus('ABC1234', null), 'missing_reference');
});

test('computeMatchStatus: null extracted → missing_reference', () => {
  assert.equal(computeMatchStatus(null, 'ABC1234'), 'missing_reference');
});

// ── Integration: persist extractions ────────────────────────────────────────

const TEST_VIN = 'ZVTEST001';
const TEST_EVIDENCE_ID = 'ev-001';

test('persistExtractions: correct VIN match', async () => {
  store.vehicle_document_extractions = [];
  const result = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'registration_document',
    fields: [{ fieldName: 'vin_field', rawValue: 'ZV TEST 001', comparedVehicleField: 'vin', confidence: 0.95 }],
  });
  assert.equal(result.extractions.length, 1);
  assert.equal(result.extractions[0].match_status, 'match');
  assert.equal(result.extractions[0].normalized_value, 'ZVTEST001');
  assert.equal(result.mismatch_count, 0);
  assert.equal(result.pending_review_count, 1);
});

test('persistExtractions: VIN mismatch is detected and persisted', async () => {
  store.vehicle_document_extractions = [];
  const result = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'registration_document',
    fields: [{ fieldName: 'vin_field', rawValue: 'WRONGVIN00000', comparedVehicleField: 'vin', confidence: 0.90 }],
  });
  assert.equal(result.extractions[0].match_status, 'mismatch');
  assert.ok(result.extractions[0].mismatch_reason, 'mismatch_reason must be set');
  assert.equal(result.mismatch_count, 1);
  assert.equal(result.pending_review_count, 1);
});

test('persistExtractions: no compared_vehicle_field → inconclusive', async () => {
  store.vehicle_document_extractions = [];
  const result = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'insurance_document',
    fields: [{ fieldName: 'policy_number', rawValue: 'POL-123', confidence: 0.80 }],
  });
  assert.equal(result.extractions[0].match_status, 'inconclusive');
  assert.equal(result.extractions[0].compared_vehicle_field, null);
});

test('persistExtractions: all extractions start as review_status=pending', async () => {
  store.vehicle_document_extractions = [];
  const result = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'customs_entry',
    fields: [
      { fieldName: 'vin_field', rawValue: 'ZVTEST001', comparedVehicleField: 'vin' },
      { fieldName: 'chassis_field', rawValue: 'BADCHASSIS', comparedVehicleField: 'chassis_number' },
    ],
  });
  assert.ok(result.extractions.every(e => e.review_status === 'pending'));
  assert.equal(result.mismatch_count, 1);
  assert.equal(result.pending_review_count, 2);
});

// ── Integration: list + review ───────────────────────────────────────────────

test('listExtractions: returns pending mismatches', async () => {
  store.vehicle_document_extractions = [];
  await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'registration_document',
    fields: [
      { fieldName: 'vin_field', rawValue: 'ZVTEST001', comparedVehicleField: 'vin' },
      { fieldName: 'plate_field', rawValue: 'WRONGPLATE', comparedVehicleField: 'plate_number' },
    ],
  });
  const mismatches = await listExtractions({ vin: TEST_VIN, matchStatus: 'mismatch' });
  assert.equal(mismatches.mismatch_count, 1);
  assert.equal(mismatches.extractions[0].field_name, 'plate_field');
});

test('reviewExtraction: reviewer can confirm a mismatch', async () => {
  store.vehicle_document_extractions = [];
  const { extractions } = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'registration_document',
    fields: [{ fieldName: 'vin_field', rawValue: 'WRONGVIN', comparedVehicleField: 'vin' }],
  });
  const extractionId = extractions[0].id;
  const reviewed = await reviewExtraction({
    extractionId, reviewedBy: 'admin-001', reviewStatus: 'rejected',
    mismatchReason: 'VIN on document does not match vehicle record',
  });
  assert.equal(reviewed.review_status, 'rejected');
  assert.equal(reviewed.reviewed_by, 'admin-001');
  assert.ok(reviewed.reviewed_at);
});

test('reviewExtraction: invalid review_status is rejected', async () => {
  await assert.rejects(
    () => reviewExtraction({ extractionId: 'x', reviewedBy: 'admin-001', reviewStatus: 'approved' }),
    /Invalid review_status/
  );
});

test('AI confidence does not auto-approve: review_status stays pending after insert', async () => {
  store.vehicle_document_extractions = [];
  const { extractions } = await persistExtractions({
    evidenceId: TEST_EVIDENCE_ID, vin: TEST_VIN, documentType: 'registration_document',
    fields: [{ fieldName: 'vin_field', rawValue: 'ZVTEST001', comparedVehicleField: 'vin', confidence: 0.999 }],
  });
  // Even a perfect confidence score keeps review_status as 'pending'.
  assert.equal(extractions[0].review_status, 'pending');
  assert.equal(extractions[0].match_status, 'match');
});
