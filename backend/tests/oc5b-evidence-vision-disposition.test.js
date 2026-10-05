/**
 * OC-5B — no production-selectable simulator for evidence-image analysis.
 *
 * RC1 selected a "live" analysis seam whenever GEMINI_API_KEY existed, and that seam — like every
 * evidence upload — ran the evidence-vision SIMULATOR (no provider call). The disposition now:
 *   - ONE selector (evidenceVisionProvider.resolveEvidenceVision); it never reads a credential;
 *   - the labelled simulator exists only in the test-fixture runtime, and refuses everywhere else;
 *   - no evidence-vision adapter is certified, so outside the test runtime the state is honest —
 *     'not_configured', or 'provider_not_certified' when one is named — and nothing is simulated;
 *   - an upload records "not run — no provider configured": no score, no confidence, inspection;
 *   - /api/health states it; an analysis job fails terminally with AI_ANALYSIS_UNAVAILABLE.
 * SOURCE-CERTIFIED only: no provider exists to call, and none is claimed.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const vision = await import('../services/ai/evidenceVisionProvider.js');
const { analyzeEvidenceImage } = await import('../services/ai/aiVisionProvider.js');
const { resolveAnalysisProvider } = await import('../services/ai/analysisProvider.js');
const { runAiAnalysis } = await import('../services/evidence/evidenceService.js');
const { supabase } = await import('../db/supabase.js');

const KEYS = ['NODE_ENV', 'ALLOW_OCR_MOCK', 'VERCEL_ENV', 'CARUP_ENV', 'GEMINI_API_KEY', 'CARUP_EVIDENCE_VISION_PROVIDER', 'GROQ_API_KEY'];
async function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const FIXTURE = { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'true' };
const PRODUCTION_WITH_KEYS = { NODE_ENV: 'production', VERCEL_ENV: 'production', GEMINI_API_KEY: 'present', GROQ_API_KEY: 'present' };

test('the selector: fixture runtime → the labelled simulator; anywhere else → honestly unavailable, whatever keys exist', async () => {
  await withEnv(FIXTURE, () => {
    const v = vision.resolveEvidenceVision();
    assert.deepEqual([v.available, v.state, v.provider], [true, 'test_fixture', 'simulated']);
  });
  for (const env of [PRODUCTION_WITH_KEYS, { NODE_ENV: 'development', GEMINI_API_KEY: 'present' },
    { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'true', VERCEL_ENV: 'production', GEMINI_API_KEY: 'present' }, { NODE_ENV: 'test' }]) {
    await withEnv(env, () => {
      const v = vision.resolveEvidenceVision();
      assert.equal(v.available, false, JSON.stringify(env));
      assert.equal(v.state, 'not_configured', `a credential selects nothing: ${JSON.stringify(env)}`);
      assert.equal(v.provider, null);
    });
  }
  for (const named of ['gemini', 'cloudflare', 'simulator', 'simulated', 'mock']) {
    await withEnv({ ...PRODUCTION_WITH_KEYS, CARUP_EVIDENCE_VISION_PROVIDER: named }, () => {
      const v = vision.resolveEvidenceVision();
      assert.deepEqual([v.available, v.state, v.provider], [false, 'provider_not_certified', named], `'${named}' has no certified adapter`);
    });
  }
  assert.deepEqual(Object.keys(vision.CERTIFIED_EVIDENCE_VISION_ADAPTERS), [], 'no adapter is certified on this lineage');
});

test('source: the selector and the analysis seam read no credential, and the "live" seam is gone', () => {
  for (const rel of ['services/ai/evidenceVisionProvider.js', 'services/ai/analysisProvider.js']) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /GEMINI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN/, `${rel} must not select on a credential`);
  }
  const seam = read('services/ai/analysisProvider.js');
  assert.doesNotMatch(seam, /liveAnalysisProvider|isLiveConfigured|analyzeEvidenceImage/);
  assert.doesNotMatch(read('services/evidence/evidenceService.js'), /analyzeEvidenceImage/, 'uploads reach the simulator only through the selector');
});

test('the simulator refuses outside the fixture runtime (and still runs inside it)', async () => {
  for (const env of [PRODUCTION_WITH_KEYS, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'true', CARUP_ENV: 'staging' }]) {
    await withEnv(env, () => assert.rejects(() => analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', {}),
      (e) => e.code === 'EVIDENCE_VISION_UNAVAILABLE' && e.retryable === false, JSON.stringify(env)));
  }
  const ran = await withEnv(FIXTURE, () => analyzeEvidenceImage(Buffer.from('x'), 'image/png', 'damage_photo', {}));
  assert.equal(ran.provider, 'simulated');
});

test('analysis jobs: outside the fixture runtime the provider is "unavailable" and every task is refused terminally', async () => {
  await withEnv(PRODUCTION_WITH_KEYS, async () => {
    const provider = resolveAnalysisProvider();
    assert.equal(provider.id, 'unavailable');
    await assert.rejects(() => provider.analyze('damage_detection', {}), (e) => e.code === 'AI_ANALYSIS_UNAVAILABLE' && /No AI analysis provider can run 'damage_detection'/.test(e.message));
  });
});

// ── the upload path, end to end over a recording client ─────────────────────────────────────────

function evidenceWorld(rows) {
  const writes = [];
  const realFrom = supabase.from;
  supabase.from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(k, v) { filters.push(['eq', k, v]); return q; },
      neq(k, v) { filters.push(['neq', k, v]); return q; },
      limit() { return q; },
      single() { return Promise.resolve({ data: rows.find((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : r[k] !== v))) || null, error: null }); },
      update(payload) { writes.push({ table, payload }); return { eq: () => Promise.resolve({ data: null, error: null }) }; },
      then(resolve) {
        return Promise.resolve({ data: rows.filter((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : r[k] !== v))), error: null }).then(resolve);
      },
    };
    return q;
  };
  return { writes, restore: () => { supabase.from = realFrom; } };
}
after(() => {});

test('an upload with no provider records "not run": no score, no confidence, no executor, inspection — and the simulator is never called', async () => {
  const world = evidenceWorld([{ id: 'ev-1', vin: 'VIN1', checksum: 'sha256:unique', metadata: { note: 'kept' } }]);
  try {
    await withEnv(PRODUCTION_WITH_KEYS, () => runAiAnalysis('ev-1', Buffer.from('x'), 'image/png', 'damage_photo', { mock_ai_scenario: 'flagged_vin_mismatch' }));
    assert.equal(world.writes.length, 1, 'one write: the honest record (no "pending" that never resolves)');
    const analysis = world.writes[0].payload.metadata.ai_analysis;
    assert.equal(world.writes[0].payload.metadata.note, 'kept', 'the rest of the metadata is preserved');
    assert.deepEqual(
      { status: analysis.ai_status, execution: analysis.execution, provider: analysis.provider, model: analysis.model, risk: analysis.risk_score, confidence: analysis.confidence, action: analysis.recommended_action, state: analysis.analysis_state, summary: analysis.public_safe_summary },
      { status: 'ai_not_configured', execution: 'not_run', provider: null, model: null, risk: null, confidence: null, action: 'inspect', state: 'not_configured', summary: null },
    );
    assert.equal(analysis.visible_vin, undefined, 'nothing claimed to be seen');
    assert.match(analysis.reviewer_summary, /nothing examined this image/);
  } finally { world.restore(); }
});

test('the checksum duplicate check is not AI and still runs without a provider — and says so', async () => {
  const world = evidenceWorld([
    { id: 'ev-2', vin: 'VIN2', checksum: 'sha256:same', metadata: {} },
    { id: 'ev-old', vin: 'VINX', checksum: 'sha256:same', verification_status: 'verified', metadata: {} },
  ]);
  try {
    await withEnv(PRODUCTION_WITH_KEYS, () => runAiAnalysis('ev-2', Buffer.from('x'), 'image/png', 'photo', {}));
    const analysis = world.writes.at(-1).payload.metadata.ai_analysis;
    assert.equal(analysis.ai_status, 'ai_not_configured');
    assert.equal(analysis.duplicate_match.original_evidence_id, 'ev-old');
    assert.equal(analysis.recommended_action, 'reject');
    assert.match(analysis.reviewer_summary, /deterministic check, not AI/);
  } finally { world.restore(); }
});

test('in the fixture runtime the queued record carries no fabricated confidence (it was 1.0 for nothing)', async () => {
  const world = evidenceWorld([{ id: 'ev-3', vin: 'VIN3', checksum: null, metadata: {} }]);
  try {
    await withEnv(FIXTURE, () => runAiAnalysis('ev-3', Buffer.from('x'), 'image/png', 'photo', {}));
    const pending = world.writes[0].payload.metadata.ai_analysis;
    assert.deepEqual([pending.ai_status, pending.confidence, pending.risk_score], ['ai_pending', null, null]);
    assert.equal(world.writes.at(-1).payload.metadata.ai_analysis.provider, 'simulated', 'the fixture result is labelled simulated');
  } finally { world.restore(); }
});

test('/api/health states evidence vision truthfully — a state and a name, never a credential', async () => {
  const { app } = await import('../server.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = await withEnv({ ...PRODUCTION_WITH_KEYS, NODE_ENV: 'test', VERCEL_ENV: undefined, CARUP_EVIDENCE_VISION_PROVIDER: 'gemini' }, async () => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { headers: { 'x-bypass-rate-limit': 'true' } });
      return res.json();
    });
    assert.deepEqual(body.evidenceVision, { state: 'provider_not_certified', provider: 'gemini', available: false, authority: 'advisory' });
    assert.doesNotMatch(JSON.stringify(body), /present/, 'no credential value in the health payload');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
