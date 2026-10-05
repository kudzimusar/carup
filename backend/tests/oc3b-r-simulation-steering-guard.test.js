/**
 * OC-3B-R — simulated-AI steering is a TEST FIXTURE, and a deployed runtime cannot turn it on.
 *
 * THE DEFECT (base 24b66ccc). Seven paths can answer with scripted or caller-shaped "AI" output
 * instead of a provider reading, and they were gated by six hand-copied rules that disagreed:
 *   - `aiVisionProvider.honouredMockScenario` honoured `metadata.mock_ai_scenario` (reachable from an
 *     upload body) on NODE_ENV=test ALONE — no ALLOW_OCR_MOCK opt-in at all;
 *   - `mockAnalysisProvider` echoed the caller's own `metadata.vin` / `plate_number` /
 *     `odometer_reading` back as an OCR reading at confidence 0.8, and reported every image
 *     "usable" at 0.95 — with NO gate: it is the runtime fallback whenever no Gemini key is set,
 *     and `runAnalysisJob` persists its output as a `succeeded` job;
 *   - `documentClassifier` returned VALID_IDENTITY_DOCUMENT / extractionAllowed on NODE_ENV=test +
 *     ALLOW_OCR_MOCK, as did the Gemini text reply (a "Low" fraud verdict) and vision reply;
 *   - and none of them refused a runtime that DECLARES itself deployed. CarUp has already run
 *     NODE_ENV=test inside a Vercel production environment (authMiddleware.js) — a single mis-set
 *     variable was enough to make fixtures live.
 *
 * THE CONTRACT PROVEN HERE. One guard — the OCR mock guard, extracted to
 * `backend/config/testFixtureGuard.js` — decides every path:
 *   allowed  ⇔  NODE_ENV === 'test'  AND  ALLOW_OCR_MOCK === 'true'
 *              AND NOT VERCEL_ENV ∈ {production, preview}  AND NOT CARUP_ENV ∈ {production, staging}
 * Refused, every path tells the truth instead: OCR / classifier / Gemini fail closed, scripted
 * scenarios do not exist, and an analysis job FAILS (terminally) instead of persisting an echo.
 *
 * Positive controls: under the allowed environment every path still uses its fixture, so a guard
 * that simply returned `false` everywhere would fail this suite. Source contract scope: the five
 * modules that own a simulated-AI / OCR fixture (listed in SCOPED_FILES). Out of scope, recorded
 * in the OC-3 debt inventory: the Seller automation `fixture_scope` (non-AI, preview-allowed by
 * design) and the government-source SANDBOX adapters (non-AI, governed by their own activation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const ROOT = new URL('../', import.meta.url);
const GUARD_PATH = new URL('config/testFixtureGuard.js', ROOT);

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
// OC-4B: GeminiClient is vision-only — its text path and scripted text reply are retired.
const { askGeminiVision, isGeminiTestMockAllowed } = await import('../services/ai/GeminiClient.js');
const { honouredMockScenario, analyzeEvidenceImage } = await import('../services/ai/aiVisionProvider.js');
const { mockAnalysisProvider, resolveAnalysisProvider } = await import('../services/ai/analysisProvider.js');
const { runAnalysisJob } = await import('../services/ai/analysisJobService.js');
const { DocumentClassifier, EVIDENCE_CLASSIFICATION } = await import('../services/identity/documentClassifier.js');
// The guard module is the subject of this phase; at the base SHA it does not exist yet, and the
// suite must still report every behavioural failure rather than one import error.
const guard = existsSync(GUARD_PATH) ? await import(GUARD_PATH.href) : null;

const ENV_KEYS = ['NODE_ENV', 'ALLOW_OCR_MOCK', 'VERCEL_ENV', 'CARUP_ENV', 'GEMINI_API_KEY',
  'CARUP_OCR_PROVIDER', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];

/** Run fn with exactly these env values (undefined deletes), restoring every key afterwards. */
async function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const apply = (values) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  // Start every case from the same clean slate: no key, no provider, no deployment marker.
  apply({ VERCEL_ENV: undefined, CARUP_ENV: undefined, GEMINI_API_KEY: undefined,
    CARUP_OCR_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined });
  apply(overrides);
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

const FIXTURE_ON = { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'true' };

/** A deployed runtime that ALSO carries the test flags — the misconfiguration that already happened. */
const DEPLOYED_MISCONFIGURED = [
  { label: 'VERCEL_ENV=production', env: { ...FIXTURE_ON, VERCEL_ENV: 'production' } },
  { label: 'VERCEL_ENV=preview', env: { ...FIXTURE_ON, VERCEL_ENV: 'preview' } },
  { label: 'CARUP_ENV=production', env: { ...FIXTURE_ON, CARUP_ENV: 'production' } },
  { label: 'CARUP_ENV=staging', env: { ...FIXTURE_ON, CARUP_ENV: 'staging' } },
  { label: 'VERCEL_ENV=" Production " (case/space)', env: { ...FIXTURE_ON, VERCEL_ENV: ' Production ' } },
  { label: 'CARUP_ENV=STAGING (case)', env: { ...FIXTURE_ON, CARUP_ENV: 'STAGING' } },
];

/** Test runtime without the explicit opt-in, and non-test runtimes with it. */
const NOT_OPTED_IN = [
  { label: 'NODE_ENV=test, ALLOW_OCR_MOCK unset', env: { NODE_ENV: 'test', ALLOW_OCR_MOCK: undefined } },
  { label: 'NODE_ENV=test, ALLOW_OCR_MOCK=false', env: { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'false' } },
  { label: 'NODE_ENV=test, ALLOW_OCR_MOCK=TRUE (not the literal)', env: { NODE_ENV: 'test', ALLOW_OCR_MOCK: 'TRUE' } },
  { label: 'NODE_ENV=production + flag', env: { NODE_ENV: 'production', ALLOW_OCR_MOCK: 'true' } },
  { label: 'NODE_ENV=development + flag', env: { NODE_ENV: 'development', ALLOW_OCR_MOCK: 'true' } },
];

const REFUSED = [...DEPLOYED_MISCONFIGURED, ...NOT_OPTED_IN];

/** Runtimes that are NOT deployed by the guard's definition, so the fixture stays available. */
const ALLOWED = [
  { label: 'NODE_ENV=test + flag', env: FIXTURE_ON },
  { label: 'NODE_ENV=test + flag, VERCEL_ENV=development', env: { ...FIXTURE_ON, VERCEL_ENV: 'development' } },
  { label: 'NODE_ENV=test + flag, CARUP_ENV=local', env: { ...FIXTURE_ON, CARUP_ENV: 'local' } },
];

const CALLER_VIN = 'CALLER_CHOSEN_VIN_0001';
const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

let jpegSeq = 0;
function jpegFixture(size = 3000) {
  const buf = Buffer.alloc(size, (jpegSeq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

/** Minimal Supabase double for ai_analysis_jobs: records every update payload. */
function jobsDouble() {
  const updates = [];
  return {
    updates,
    from() {
      return {
        update(payload) {
          updates.push(payload);
          const chain = { eq() { return chain; }, select: async () => ({ data: [{ id: 'job-1', ...payload }], error: null }) };
          chain.then = (resolve) => resolve({ data: null, error: null });
          return chain;
        },
        insert: async () => ({ data: null, error: null }),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------------------------

test('OC-3B-R guard: backend/config/testFixtureGuard.js exists and exports the one rule', () => {
  assert.ok(guard, 'backend/config/testFixtureGuard.js must exist (the OCR mock guard, extracted)');
  assert.equal(typeof guard.isTestFixtureAllowed, 'function');
  assert.equal(typeof guard.isDeployedRuntime, 'function');
});

test('OC-3B-R guard: truth table — refused for every deployed marker and every missing opt-in', () => {
  assert.ok(guard, 'guard module missing');
  for (const { label, env } of REFUSED) {
    assert.equal(guard.isTestFixtureAllowed({ ...env }), false, `${label} must refuse fixtures`);
  }
  for (const { label, env } of DEPLOYED_MISCONFIGURED) {
    assert.equal(guard.isDeployedRuntime({ ...env }), true, `${label} is a deployed runtime`);
  }
});

test('OC-3B-R guard: positive control — the test suite runtime still gets its fixtures', () => {
  assert.ok(guard, 'guard module missing');
  for (const { label, env } of ALLOWED) {
    assert.equal(guard.isTestFixtureAllowed({ ...env }), true, `${label} must allow fixtures`);
    assert.equal(guard.isDeployedRuntime({ ...env }), false, `${label} is not a deployed runtime`);
  }
});

test('OC-3B-R guard: isTestRuntime — NODE_ENV=test without the opt-in, but never a declared deployment', () => {
  assert.ok(guard, 'guard module missing');
  for (const { label, env } of DEPLOYED_MISCONFIGURED) {
    assert.equal(guard.isTestRuntime({ ...env }), false, `${label}: a declared deployment is not the test runtime`);
  }
  assert.equal(guard.isTestRuntime({ NODE_ENV: 'production' }), false);
  assert.equal(guard.isTestRuntime({ NODE_ENV: 'development', ALLOW_OCR_MOCK: 'true' }), false);
  // Positive control: the suite's runtime, with or without the fixture opt-in.
  assert.equal(guard.isTestRuntime({ NODE_ENV: 'test' }), true);
  assert.equal(guard.isTestRuntime({ NODE_ENV: 'test', ALLOW_OCR_MOCK: 'false', VERCEL_ENV: 'development' }), true);
});

for (const { label, env } of DEPLOYED_MISCONFIGURED) {
  test(`OC-3B-R refused (${label}): Document Intelligence does not attribute an extraction to the test user`, async () => {
    await withEnv(env, async () => {
      await assert.rejects(() => DocumentIntelligenceService.extractDocumentData('zimbabwe_national_id', 'data:image/png;base64,AAAA', undefined),
        /requires the authenticated user id/, 'a deployed runtime must not pin evidence on the phantom test user');
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Every path, refused
// ---------------------------------------------------------------------------------------------

for (const { label, env } of REFUSED) {
  test(`OC-3B-R refused (${label}): the OCR, Gemini and scenario guards all say no`, async () => {
    await withEnv(env, async () => {
      assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false, 'OCR sample reader');
      assert.equal(isGeminiTestMockAllowed(), false, 'Gemini scripted reply');
      assert.equal(honouredMockScenario({ mock_ai_scenario: 'flagged_vin_mismatch' }), null, 'scripted scenario');
    });
  });

  test(`OC-3B-R refused (${label}): Gemini vision fails closed — and the scripted text "Low" verdict no longer exists`, async () => {
    await withEnv(env, async () => {
      await assert.rejects(() => askGeminiVision('system', 'classify', [], true),
        (err) => err?.code === 'AI_PROVIDER_UNCONFIGURED' && /unavailable/i.test(err.message), 'vision path must throw AI_PROVIDER_UNCONFIGURED');
    });
  });

  test(`OC-3B-R refused (${label}): an uploader cannot script the evidence verdict or a provider error`, async () => {
    await withEnv(env, async () => {
      // OC-5B (stronger): outside the fixture runtime the simulator does not run at all — there is no
      // verdict to script, no simulated outage to trigger, and no default simulated result either.
      for (const scenario of ['flagged_vin_mismatch', 'provider_error', undefined]) {
        await assert.rejects(() => analyzeEvidenceImage(IMAGE, 'image/jpeg', 'photo', { mock_ai_scenario: scenario }),
          (e) => e?.code === 'EVIDENCE_VISION_UNAVAILABLE' && e?.retryable === false, `scenario ${scenario}: the simulator must not run`);
      }
    });
  });

  test(`OC-3B-R refused (${label}): the mock analysis provider produces nothing — no echo, no "usable"`, async () => {
    await withEnv(env, async () => {
      const metadata = { vin: CALLER_VIN, plate_number: CALLER_VIN, odometer_reading: 1, viewpoint: CALLER_VIN, components: [CALLER_VIN] };
      for (const task of ['vin_ocr', 'plate_ocr', 'odometer_ocr', 'image_quality', 'viewpoint', 'component_detection']) {
        let outcome;
        try { outcome = { value: await mockAnalysisProvider.analyze(task, { metadata }) }; } catch (error) { outcome = { error }; }
        assert.ok(outcome.error, `${task}: the mock answered outside the fixture runtime: ${JSON.stringify(outcome.value)}`);
        assert.equal(outcome.error.code, 'AI_ANALYSIS_UNAVAILABLE', `${task}: ${outcome.error.message}`);
        assert.equal(outcome.error.retryable, false, `${task}: no provider exists — not retryable`);
      }
    });
  });

  test(`OC-3B-R refused (${label}): an analysis job FAILS terminally instead of persisting an echo`, async () => {
    await withEnv(env, async () => {
      const db = jobsDouble();
      const job = await runAnalysisJob(db, { id: 'job-1', task_type: 'vin_ocr', attempts: 0 }, { metadata: { vin: CALLER_VIN } });
      const persisted = JSON.stringify(db.updates);
      assert.ok(!persisted.includes(CALLER_VIN), `the caller's VIN was persisted as a reading: ${persisted}`);
      assert.ok(!db.updates.some((u) => u.status === 'succeeded' || u.status === 'manual_review_required'),
        `no analysis ran, so no job may complete: ${persisted}`);
      assert.equal(job.status, 'failed_terminal', 'retrying cannot create a provider: the failure is terminal');
    });
  });

  test(`OC-3B-R refused (${label}): the identity classifier does not mock-approve a document`, async () => {
    await withEnv(env, async () => {
      const result = await DocumentClassifier.classify({ front: jpegFixture(), selfie: jpegFixture() }, 'passport');
      assert.notEqual(result.provider, 'mock', 'the mock classifier answered outside the fixture runtime');
      assert.notEqual(result.classification, EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT);
      assert.equal(result.extractionAllowed, false);
    });
  });
}

// A production runtime WITH a Gemini key used to route analysis to a "live" seam that ran the
// simulator. OC-5B removed that seam: a key selects nothing, and every task is refused honestly.
test('OC-3B-R refused (production + GEMINI_API_KEY): a key selects nothing — no simulator, no mock, every task refused', async () => {
  await withEnv({ NODE_ENV: 'production', ALLOW_OCR_MOCK: undefined, VERCEL_ENV: 'production', GEMINI_API_KEY: 'present' }, async () => {
    const provider = resolveAnalysisProvider();
    assert.equal(provider.id, 'unavailable');
    for (const task of ['image_quality', 'viewpoint', 'damage_detection', 'manipulation', 'vin_ocr']) {
      await assert.rejects(() => provider.analyze(task, { metadata: { viewpoint: CALLER_VIN, vin: CALLER_VIN } }), (e) => e?.code === 'AI_ANALYSIS_UNAVAILABLE');
    }
    await assert.rejects(() => analyzeEvidenceImage(IMAGE, 'image/jpeg', 'photo', {}), (e) => e?.code === 'EVIDENCE_VISION_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------------------------
// Positive controls: the fixture runtime keeps every fixture
// ---------------------------------------------------------------------------------------------

for (const { label, env } of ALLOWED) {
  test(`OC-3B-R positive control (${label}): every path still uses its fixture`, async () => {
    await withEnv(env, async () => {
      assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), true);
      assert.equal(isGeminiTestMockAllowed(), true);
      assert.equal(honouredMockScenario({ mock_ai_scenario: 'flagged_vin_mismatch' }), 'flagged_vin_mismatch');
      const flagged = await analyzeEvidenceImage(IMAGE, 'image/jpeg', 'photo', { mock_ai_scenario: 'flagged_vin_mismatch' });
      assert.equal(flagged.ai_status, 'ai_flagged');
      await assert.rejects(() => analyzeEvidenceImage(IMAGE, 'image/jpeg', 'photo', { mock_ai_scenario: 'provider_error' }), /Simulated API error/);
      const reply = JSON.parse(await askGeminiVision('system', 'classify', [], true));
      assert.equal(reply.simulated, true, 'the vision fixture labels itself simulated');
      const ocr = await mockAnalysisProvider.analyze('vin_ocr', { metadata: { vin: CALLER_VIN } });
      assert.equal(ocr.provider, 'mock');
      const classified = await DocumentClassifier.classify({ front: jpegFixture(), selfie: jpegFixture() }, 'passport');
      assert.equal(classified.provider, 'mock');
      const db = jobsDouble();
      const job = await runAnalysisJob(db, { id: 'job-1', task_type: 'image_quality', attempts: 0 }, { metadata: {} });
      assert.equal(job.status, 'succeeded');
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Source contract: one rule, no hand-copied gates
// ---------------------------------------------------------------------------------------------

const SCOPED_FILES = [
  ['services/ai/GeminiClient.js', /export async function askGeminiVision/],
  ['services/ai/aiVisionProvider.js', /export async function analyzeEvidenceImage/],
  ['services/ai/analysisProvider.js', /export const mockAnalysisProvider/],
  ['services/identity/documentClassifier.js', /static async classify\(/],
  ['services/document-intelligence/documentIntelligenceService.js', /static isOcrMockAllowed\(/],
];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const INLINE_GATE = /NODE_ENV\s*[!=]==?\s*['"]test['"]|ALLOW_OCR_MOCK\s*===?\s*['"]true['"]/;

test('OC-3B-R source: no simulated-AI module hand-copies the fixture gate; each imports the one guard', async () => {
  for (const [rel, landmark] of SCOPED_FILES) {
    const src = await readFile(new URL(rel, ROOT), 'utf8');
    // Anti-vacuity: the scan read the real module, not an empty or moved file.
    assert.match(src, landmark, `${rel}: landmark not found — the scan is not reading the module it claims to`);
    const code = stripComments(src);
    assert.doesNotMatch(code, INLINE_GATE, `${rel} still carries its own copy of the fixture gate`);
    assert.match(code, /import \{[^}]*\bisTestFixtureAllowed\b[^}]*\} from '[./]+config\/testFixtureGuard\.js'/,
      `${rel} must import isTestFixtureAllowed from config/testFixtureGuard.js`);
  }
});

test('OC-3B-R source: positive control — the guard module holds the rule the scan forbids elsewhere', async () => {
  assert.ok(existsSync(GUARD_PATH), 'guard module missing');
  const code = stripComments(await readFile(GUARD_PATH, 'utf8'));
  assert.match(code, INLINE_GATE, 'the INLINE_GATE pattern must match the real rule, or the scan above proves nothing');
  assert.match(code, /production/);
  assert.match(code, /preview/);
  assert.match(code, /staging/);
});
