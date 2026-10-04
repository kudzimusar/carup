/**
 * OC-3B — simulated AI must say it is simulated, and must never speak to the public.
 *
 * THE DEFECTS (base 72c01eda).
 *   1. `aiVisionProvider.analyzeEvidenceImage` is a SIMULATOR (no provider is called — "Decoupled
 *      from live API providers"), yet by default it answered `ai_status: 'ai_passed'`,
 *      `recommended_action: 'approve'`, echoed the UPLOADER's own metadata back as the VIN/plate/
 *      odometer it had "seen", invented a dent on every damage photo, and produced the
 *      public-facing string "AI analysis: image verified clean." — which the public evidence routes
 *      republished on every human-verified evidence row.
 *   2. Its `metadata.mock_ai_scenario` steering key is read from `req.body.metadata` on upload, so
 *      any uploader could choose the simulator's verdict in any environment.
 *   3. `analysisProvider.liveAnalysisProvider` ran that simulator and persisted the result to
 *      `ai_analysis_jobs` labelled `provider: 'gemini'`, `model: 'gemini-2.5-flash'` — a provider
 *      that never executed.
 *
 * THE INVARIANT: the provider field names the executor. A simulation is `provider: 'simulated'`,
 * `execution: 'simulated'`, advisory, non-verifying, and produces no public summary; the public
 * projection publishes a summary only from a real provider-executed analysis — and since no such
 * producer exists for evidence images, it publishes nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeEvidenceImage } = await import('../services/ai/aiVisionProvider.js');
const { liveAnalysisProvider, mockAnalysisProvider } = await import('../services/ai/analysisProvider.js');
const { runAnalysisJob } = await import('../services/ai/analysisJobService.js');
const { publicAiSummary } = await import('../utils/publicVehicleProjection.js');

const FAVORABLE_WORDING = /\b(verified|clean|approved?|official|fraud[- ]?free|genuine|authentic|certified|passed)\b/i;
const SCENARIOS = [null, 'flagged_vin_mismatch', 'flagged_manipulation', 'flagged_odometer_rollback', 'low_confidence', 'manual_review_required'];
const UPLOADER_METADATA = { vin: 'UPLOADER-ASSERTED-VIN', plate_number: 'UPLOADER-PLATE', odometer_reading: 1234 };

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

async function withNodeEnv(env, fn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try { return await fn(); } finally { process.env.NODE_ENV = previous; }
}

// ── 1. The simulator labels itself and claims nothing ─────────────────────────────────────────

test('OC-3B sim: the default simulated analysis is labelled simulated, advisory and non-verifying', async () => {
  for (const evidenceType of ['damage_photo', 'odometer_photo', 'exterior_photo']) {
    const r = await analyzeEvidenceImage(Buffer.from('x'), 'image/png', evidenceType, { ...UPLOADER_METADATA });
    assert.equal(r.provider, 'simulated', `${evidenceType}: provider names the executor`);
    assert.equal(r.execution, 'simulated');
    assert.equal(r.advisory, true);
    assert.equal(r.verifying, false);
    assert.doesNotMatch(String(r.model || ''), /gemini|gpt|claude|qwen|llama/i, 'no real model name on a simulation');
    assert.notEqual(r.ai_status, 'ai_passed', 'a simulation cannot pass evidence');
    assert.notEqual(r.recommended_action, 'approve', 'a simulation cannot recommend approval');
    assert.equal(r.public_safe_summary, null, 'a simulation produces no public summary');
  }
});

test('OC-3B sim: the simulator does not present the uploader\'s own metadata as something it saw, nor invent findings', async () => {
  const r = await analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', { ...UPLOADER_METADATA });
  assert.equal(r.visible_vin, null);
  assert.equal(r.visible_plate, null);
  assert.equal(r.visible_odometer, null);
  assert.deepEqual(r.damage_indicators, [], 'no invented dent');
  assert.deepEqual(r.detected_objects, [], 'nothing was detected — nothing looked');
});

test('OC-3B sim: no scenario produces favorable wording or a public summary', async () => {
  for (const scenario of SCENARIOS) {
    const r = await analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: scenario });
    assert.equal(r.provider, 'simulated', `${scenario}: labelled simulated`);
    assert.equal(r.public_safe_summary, null, `${scenario}: no public summary`);
    for (const s of strings({ ...r, provider: undefined, execution: undefined })) {
      assert.doesNotMatch(s, FAVORABLE_WORDING, `${scenario}: favorable wording "${s}"`);
    }
  }
});

// ── 2. Uploader steering is a test-only fixture ──────────────────────────────────────────────

test('OC-3B sim: metadata.mock_ai_scenario is ignored outside NODE_ENV=test (no uploader-chosen verdict)', async () => {
  for (const env of ['production', 'development', undefined]) {
    await withNodeEnv(env, async () => {
      // 'provider_error' would make the simulator throw — proof it was honoured.
      const r = await analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: 'provider_error' });
      assert.equal(r.provider, 'simulated');
      const flagged = await analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: 'flagged_vin_mismatch' });
      assert.notEqual(flagged.ai_status, 'ai_flagged', `NODE_ENV=${env}: scenario must not steer the result`);
      assert.equal(flagged.visible_vin, null);
      const mock = await mockAnalysisProvider.analyze('manipulation', { metadata: { mock_ai_scenario: 'manipulated' } });
      assert.equal(mock.result.manipulated, false, `NODE_ENV=${env}: mock provider scenario must not steer the result`);
    });
  }
  // ...and IS honoured under NODE_ENV=test, so the suites that rely on it keep their fixture.
  await assert.rejects(() => analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: 'provider_error' }));
});

// ── 3. Provenance: provider == executor, persisted that way ──────────────────────────────────

test('OC-3B provenance: the "live" analysis provider that runs the simulator is labelled simulated, never gemini', async () => {
  assert.notEqual(liveAnalysisProvider.id, 'gemini', 'the provider id names the executor');
  for (const task of ['damage_detection', 'manipulation', 'vin_ocr', 'plate_ocr', 'odometer_ocr', 'document_extraction']) {
    const out = await liveAnalysisProvider.analyze(task, { buffer: Buffer.from('x'), mimeType: 'image/png', evidenceType: 'damage_photo', metadata: { ...UPLOADER_METADATA } });
    assert.equal(out.provider, 'simulated', `${task}: provider`);
    assert.equal(out.execution, 'simulated', `${task}: execution`);
    assert.doesNotMatch(String(out.model || ''), /gemini/i, `${task}: no Gemini model on a simulated run`);
    assert.equal(out.safe_summary, null, `${task}: no public-safe summary from a simulation`);
  }
  // A task with no simulated vision path falls back to the mock — labelled mock, not gemini.
  const fallback = await liveAnalysisProvider.analyze('viewpoint', { metadata: {} });
  assert.equal(fallback.provider, 'mock');
  assert.equal(fallback.execution, 'mock');
});

test('OC-3B provenance: mock provider output is labelled mock', async () => {
  const out = await mockAnalysisProvider.analyze('image_quality', { metadata: {} });
  assert.equal(out.provider, 'mock');
  assert.equal(out.execution, 'mock');
});

test('OC-3B provenance: a job run through the live seam is PERSISTED as simulated, never gemini', async () => {
  const writes = [];
  const sb = {
    from(table) {
      const q = {
        update(payload) { writes.push({ table, payload }); return q; },
        eq() { return q; },
        select() { return Promise.resolve({ data: [{ id: 'job-1', ...writes.at(-1).payload }], error: null }); },
        insert(payload) { writes.push({ table, payload }); return Promise.resolve({ data: null, error: null }); },
        then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return q;
    },
  };
  const job = await runAnalysisJob(sb, { id: 'job-1', task_type: 'damage_detection', attempts: 0, evidence_id: 'ev-1' },
    { buffer: Buffer.from('x'), mimeType: 'image/png', evidenceType: 'damage_photo', metadata: {} }, { provider: liveAnalysisProvider });
  const providerWrites = writes.filter((w) => w.table === 'ai_analysis_jobs' && 'provider' in w.payload);
  assert.ok(providerWrites.length >= 2, 'processing + completion both record a provider');
  for (const w of providerWrites) assert.equal(w.payload.provider, 'simulated', `persisted provider ${JSON.stringify(w.payload)}`);
  const completion = providerWrites.at(-1).payload;
  assert.doesNotMatch(String(completion.model || ''), /gemini/i);
  assert.equal(completion.safe_summary, null);
  assert.equal(job.provider, 'simulated');
});

// ── 4. The public projection publishes no simulated summary ──────────────────────────────────

test('OC-3B public: publicAiSummary emits nothing for a legacy "verified clean" row, a simulated row, or a caller-forged real-provider claim', () => {
  const rows = [
    { metadata: { ai_analysis: { public_safe_summary: 'AI analysis: image verified clean.' } } },
    { metadata: { ai_analysis: { provider: 'simulated', execution: 'simulated', public_safe_summary: 'Looks fine.' } } },
    // metadata is caller-writable on upload: a self-asserted provider label is not provenance.
    { metadata: { ai_analysis: { provider: 'gemini', execution: 'provider_executed', public_safe_summary: 'Image consistent with listing.' } } },
    { metadata: { ai_public_summary: 'caller supplied' } },
  ];
  for (const row of rows) assert.equal(publicAiSummary(row), null, JSON.stringify(row));
});

test('OC-3B public: every republishing surface in vehiclesRoutes.js reads the summary through publicAiSummary only', () => {
  const src = readFileSync(resolve(here, '../routes/vehiclesRoutes.js'), 'utf8');
  assert.doesNotMatch(src, /ai_analysis\.public_safe_summary/, 'no direct read of the raw analysis summary');
  assert.ok((src.match(/publicAiSummary\(item\)/g) || []).length >= 3, 'anti-vacuity: the helper is still the source');
});
