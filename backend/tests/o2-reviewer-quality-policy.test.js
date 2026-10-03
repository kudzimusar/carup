/**
 * O2 OCR convergence — image-quality truth handed to reviewers, CONVERGED by OC-2A.
 *
 * CarUp does not measure image quality (the old blur/glare/tamper scores were hash-derived
 * fabrications). The governing rule is unchanged: nothing downstream of extraction may be told,
 * or may imply, that an automated image-quality check passed when none was performed.
 *
 * WHAT WAS DROPPED, AND WHY. Three cases ran the shipped approveDocumentVerification under each
 * quality reading (not measured → proceed and record `not_measured`; measured & passed → proceed
 * and record `measured_passed`; measured & FAILED → refuse with no writes), plus a SOURCE case
 * pinning that method's `measured_failed` gate and its "preserved reviewer decision" comment.
 * OC-2A (converging on O2-X1) RETIRED approveDocumentVerification and the /api/verification
 * router that exposed it; there is no Document Intelligence approval left to gate, so those cases
 * have nothing to execute. The comment pin is FLIPPED: the module now really does write only the
 * ocr evidence tables, so the boundary statement it once had to retract is true again and is
 * required here.
 *
 * WHAT IS KEPT. The quality envelope every surviving reviewer (identity review, garage and vehicle
 * evidence review, diaspora document review) receives with an extraction candidate must say
 * "not measured" — never a pass — for readable and unreadable payloads alike.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { supabase } = await import('../db/supabase.js');
const { providerFromClient } = await import('../services/ai/ocrVisionProvider.js');

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function assertNotMeasured(quality, label) {
  assert.equal(quality.measured, false, `${label}: quality is reported as NOT measured`);
  assert.equal(quality.qualityPassed, null, `${label}: no pass/fail verdict is implied`);
  for (const key of ['blur', 'glare', 'tamperSuspicion']) {
    assert.equal(quality[key], 'not_measured', `${label}: ${key} is not measured`);
  }
  for (const key of ['blurScore', 'glareScore', 'tamperSuspicionScore']) {
    assert.equal(quality[key], null, `${label}: ${key} carries no fabricated number`);
  }
}

test('the extraction candidate carries a NOT-measured quality envelope — never an implied pass', async (t) => {
  t.mock.method(supabase, 'from', () => ({
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  }));
  const visionProvider = providerFromClient(async () => ({
    document_class_observed: 'zimbabwe_national_id', confidence: 0.97, fields: { first_name: 'Tinashe', last_name: 'Moyo' },
  }), { id: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' });

  const result = await DocumentIntelligenceService.extractDocumentData('national_id', PNG_DATA_URI, 'reviewer-q1', { visionProvider });
  assert.ok(result.qualityMetrics, 'quality diagnostics travel with the candidate');
  assertNotMeasured(result.qualityMetrics, 'extraction');
});

test('analyzeImageQuality reports not-measured for readable and unreadable payloads alike', () => {
  assertNotMeasured(DocumentIntelligenceService.analyzeImageQuality(PNG_DATA_URI), 'readable');
  assertNotMeasured(DocumentIntelligenceService.analyzeImageQuality('not-a-document'), 'unreadable');
});

test('SOURCE: no Document Intelligence approval gate remains, and the module comment states the extraction-only boundary', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../services/document-intelligence/documentIntelligenceService.js', import.meta.url)), 'utf8');
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined');
  assert.doesNotMatch(src, /measured_failed|measured_passed/, 'no approval-time quality gate remains in Document Intelligence');
  assert.match(src, /It may write ONLY the ocr evidence tables/, 'the module comment states the extraction-only boundary');
});
