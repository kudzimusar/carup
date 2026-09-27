/**
 * O2 OCR convergence — reviewer image-quality policy (explicit).
 *
 * CarUp does not measure image quality (the old blur/glare/tamper scores were hash-derived
 * fabrications). The reviewer-approval policy is therefore, explicitly:
 *   · measured & passed  → does not block
 *   · measured & failed  → blocks
 *   · NOT measured       → does NOT block the human reviewer on its own
 *
 * But an approval must never IMPLY an automated image-quality check passed when none was performed.
 * This suite proves, by executing the shipped approveDocumentVerification, that a not-measured
 * quality state (a) does not block the reviewer decision, and (b) is recorded truthfully on the
 * administrative_overrides audit row as image_quality_check.status = 'not_measured'.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../db/supabase.js');
const trustEngineMod = await import('../services/trust-service/trustEnforcementEngine.js');

test('a not-measured image quality does NOT block the reviewer, and is recorded truthfully on the override', async (t) => {
  const writes = [];
  const ocrDoc = {
    id: 'ocr-doc-q1', document_type: 'national_id', file_path: 'inline_b64',
    confidence_score: 0.95,
    extracted_json: JSON.stringify({ first_name: 'Tinashe', last_name: 'Moyo', additional_fields: {} }),
    status: 'Pending_Verification',
  };
  const vehicle = { vin: 'VINQUALITY0001', trust_score: 60, status: 'Pending_Review' };

  // Fake supabase: serve the two rows approveDocumentVerification reads; capture everything written.
  t.mock.method(supabase, 'from', (table) => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: table === 'ocr_documents' ? ocrDoc : table === 'vehicles' ? vehicle : null,
          error: null,
        }),
      }),
    }),
    insert: (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
    update: (row) => { writes.push({ table, op: 'update', row }); return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  }));
  // Keep the metadata match a pass so the flow reaches the override (the match layer is not under test here).
  t.mock.method(trustEngineMod.TrustEnforcementEngine, 'verifyDocumentDataMatch', async () => ({ match: true, penalties: [] }));

  const result = await DocumentIntelligenceService.approveDocumentVerification('ocr-doc-q1', 'reviewer-admin-1', 'VINQUALITY0001');

  // (a) not-measured did not block: the reviewer decision completed.
  assert.equal(result.success, true, 'a not-measured image quality must not block a human reviewer approval');

  // (b) the override truthfully records that image quality was NOT measured.
  const override = writes.find((w) => w.table === 'administrative_overrides' && w.op === 'insert');
  assert.ok(override, 'an administrative_overrides audit row is written');
  const iqc = override.row.new_state?.image_quality_check;
  assert.ok(iqc, 'the override records an image_quality_check');
  assert.equal(iqc.status, 'not_measured', 'the approval must state that automated image quality was NOT measured');
  assert.equal(iqc.measured, false, 'measured must be false — no automated quality check was performed');

  // T12.1 stays intact: no government registry row is forged by the reviewer decision.
  for (const w of writes) {
    assert.notEqual(w.table, 'cvr_ownership_records', 'no CVR row may be forged from an OCR approval');
    assert.notEqual(w.table, 'zimra_declarations', 'no ZIMRA row may be forged from an OCR approval');
  }
});

test('SOURCE: the reviewer quality gate blocks only a MEASURED failure, and the module comment is truthful', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('../services/document-intelligence/documentIntelligenceService.js', import.meta.url)), 'utf8');
  // The gate blocks only measured_failed, never not_measured.
  assert.match(src, /imageQualityStatus === 'measured_failed'/, 'only a measured failure may block');
  assert.match(src, /'not_measured'/, 'the not-measured state is explicit');
  // The header comment must NOT claim extraction is the only writer / the approval chain is retired.
  assert.doesNotMatch(src, /This module may write ONLY the ocr evidence tables/,
    'the false extraction-only claim must be corrected for the Trade OS line');
  assert.match(src, /approveDocumentVerification\(\) is a DISTINCT, gated HUMAN REVIEWER decision/,
    'the module comment must state the preserved reviewer-decision boundary');
});
