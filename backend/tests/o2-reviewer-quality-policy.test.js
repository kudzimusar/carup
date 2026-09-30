/**
 * O2 OCR convergence — reviewer image-quality policy (explicit, behavioral).
 *
 * CarUp does not measure image quality (the old blur/glare/tamper scores were hash-derived
 * fabrications). The reviewer-approval policy is therefore, explicitly:
 *   · measured & passed  → does not block; override records image_quality_check.status='measured_passed'
 *   · measured & FAILED  → blocks; NO approval/trust/status/Verified mutation is written
 *   · NOT measured       → does not block; override records image_quality_check.status='not_measured'
 *
 * An approval must never IMPLY an automated image-quality check passed when none was performed. This
 * suite executes the SHIPPED approveDocumentVerification for all three states, injecting only the
 * analyzeImageQuality reading (no production behavior is created to make the test possible).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../db/supabase.js');
const trustEngineMod = await import('../services/trust-service/trustEnforcementEngine.js');

const OCR_DOC = {
  id: 'ocr-doc-q1', document_type: 'national_id', file_path: 'inline_b64',
  confidence_score: 0.95,
  extracted_json: JSON.stringify({ first_name: 'Tinashe', last_name: 'Moyo', additional_fields: {} }),
  status: 'Pending_Verification',
};
const VEHICLE = { vin: 'VINQUALITY0001', trust_score: 60, status: 'Pending_Review' };

/**
 * Run the shipped approveDocumentVerification with a given analyzeImageQuality reading, capturing
 * every DB write. `quality` is what analyzeImageQuality returns for this case.
 */
async function approveWithQuality(t, quality) {
  const writes = [];
  t.mock.method(supabase, 'from', (table) => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: table === 'ocr_documents' ? OCR_DOC : table === 'vehicles' ? VEHICLE : null,
          error: null,
        }),
      }),
    }),
    insert: (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
    update: (row) => { writes.push({ table, op: 'update', row }); return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  }));
  t.mock.method(trustEngineMod.TrustEnforcementEngine, 'verifyDocumentDataMatch', async () => ({ match: true, penalties: [] }));
  t.mock.method(DocumentIntelligenceService, 'analyzeImageQuality', () => quality);

  let result; let error;
  try {
    result = await DocumentIntelligenceService.approveDocumentVerification('ocr-doc-q1', 'reviewer-admin-1', 'VINQUALITY0001');
  } catch (e) {
    error = e;
  }
  return { writes, result, error };
}

test('Case 1 — NOT measured: reviewer may proceed; override records not_measured', async (t) => {
  const { writes, result, error } = await approveWithQuality(t, {
    measured: false, qualityPassed: null, note: 'CarUp does not measure image quality.',
  });
  assert.ifError(error);
  assert.equal(result.success, true, 'not_measured must not block the reviewer');
  const override = writes.find((w) => w.table === 'administrative_overrides' && w.op === 'insert');
  assert.equal(override.row.new_state.image_quality_check.status, 'not_measured');
  assert.equal(override.row.new_state.image_quality_check.measured, false);
});

test('Case 2 — measured & PASSED: reviewer may proceed; override records measured_passed', async (t) => {
  const { writes, result, error } = await approveWithQuality(t, {
    measured: true, qualityPassed: true, note: null,
  });
  assert.ifError(error);
  assert.equal(result.success, true, 'a measured pass does not block');
  const override = writes.find((w) => w.table === 'administrative_overrides' && w.op === 'insert');
  assert.equal(override.row.new_state.image_quality_check.status, 'measured_passed');
  assert.equal(override.row.new_state.image_quality_check.measured, true);
});

test('Case 3 — measured & FAILED: reviewer is REFUSED; no approval/trust/status/Verified mutation is written', async (t) => {
  const { writes, result, error } = await approveWithQuality(t, {
    measured: true, qualityPassed: false, note: null,
  });
  assert.equal(result, undefined, 'a measured failure must not return a successful approval');
  assert.ok(error, 'a measured failure must throw');
  assert.match(error.message, /VERIFICATION_FAILED: Image quality/);
  // No side effects: no audit override, no vehicle trust/status write, no ocr_documents Verified,
  // no trust history. The block happens before any write.
  for (const forbidden of ['administrative_overrides', 'vehicles', 'ocr_documents', 'trust_score_history']) {
    assert.equal(writes.some((w) => w.table === forbidden), false, `measured_failed must write nothing to ${forbidden}`);
  }
  assert.equal(writes.length, 0, 'a blocked approval writes nothing at all');
});

test('SOURCE: the gate blocks only measured_failed, and the module comment is truthful', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('../services/document-intelligence/documentIntelligenceService.js', import.meta.url)), 'utf8');
  assert.match(src, /imageQualityStatus === 'measured_failed'/, 'only a measured failure may block');
  assert.match(src, /'not_measured'/, 'the not-measured state is explicit');
  assert.doesNotMatch(src, /This module may write ONLY the ocr evidence tables/,
    'the false extraction-only claim must be corrected for the Trade OS line');
  assert.match(src, /approveDocumentVerification\(\) is a DISTINCT, gated HUMAN REVIEWER decision/,
    'the module comment must state the preserved reviewer-decision boundary');
});
