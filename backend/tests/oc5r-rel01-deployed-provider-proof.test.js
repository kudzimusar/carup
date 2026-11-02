/**
 * OC-5R-REL-01 Stage 5 — the deployed provider proof harness, pinned.
 *
 * The workflow proves Qwen OCR and Gemma advisory AI through the DEPLOYED exact-head preview. It is
 * the only workflow in this lineage that makes paid provider calls against staging, so its trigger,
 * its order (pairing proof first) and its verdicts are fixed here. No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const P = await import('../../scripts/ci/oc5r-deployed-provider-proof.mjs');
const WF = readFileSync(new URL('../../.github/workflows/oc5r-deployed-provider-proof.yml', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../../scripts/ci/oc5r-deployed-provider-proof.mjs', import.meta.url), 'utf8');
const REF = 'eoyenigwevnxwwhyhaer';
const SHA = 'a'.repeat(40);

// ── The workflow ──────────────────────────────────────────────────────────────────────────────
test('proof workflow: a person adding the label is the ONLY trigger', () => {
  assert.match(WF, /\non:\n {2}pull_request:\n {4}types: \[labeled\]\n/);
  assert.doesNotMatch(WF, /\n {2}(push|schedule|workflow_run|workflow_dispatch):/);
  assert.doesNotMatch(WF, /types: \[[^\]]*(opened|synchronize|reopened)/);
  assert.match(WF, /if: github\.event\.label\.name == 'oc5r-deployed-provider-proof' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test('proof workflow: no environment, the staging-preview concurrency group, and the exact head', () => {
  assert.doesNotMatch(WF, /\n\s+environment:/);
  assert.match(WF, /group: staging-preview-\$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(WF, /cancel-in-progress: false/);
  assert.match(WF, /EXPECTED_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(WF, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_HEAD_SHA"/);
  assert.match(WF, /EXPECTED_STAGING_PROJECT_REF: eoyenigwevnxwwhyhaer/);
});

test('proof workflow: the exact-head pairing proof comes before any database or provider contact', () => {
  const pair = WF.indexOf('resolve-governed-preview-pair.mjs');
  const capacity = WF.indexOf('assert-staging-capacity.mjs');
  const proof = WF.indexOf('node scripts/ci/oc5r-deployed-provider-proof.mjs');
  assert.ok(pair > 0 && capacity > pair && proof > capacity, 'order: pair → capacity → proof');
});

// ── Identity and fixtures ─────────────────────────────────────────────────────────────────────
test('proof identity: one per run, staging-only, owner', () => {
  const id = P.proofIdentity('proof-37700000123-2');
  assert.deepEqual(id, {
    id: 'u_oc5rproof_37700000123_2',
    email: 'oc5r.proof.37700000123-2@carup-staging.test',
    name: 'OC-5R deployed provider proof 37700000123-2 (staging automation)',
    role: 'owner',
  });
  assert.throws(() => P.proofIdentity('seller-1-1'), /proof-<run>-<attempt>/);
});

test('proof VIN: a valid 17-character ISO VIN with no I, O or Q', () => {
  const vin = P.proofVin('proof-37700000123-2');
  assert.equal(vin, 'JTREL770000012302');
  assert.equal(vin.length, 17);
  assert.doesNotMatch(vin, /[IOQ]/);
});

test('synthetic odometer: a well-formed PNG, drawn here, showing the expected digits', () => {
  const png = P.syntheticOdometerPng();
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = []; let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at); const type = png.subarray(at + 4, at + 8).toString('ascii');
    const data = png.subarray(at + 8, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), P.crc32(png.subarray(at + 4, at + 8 + len)), `${type} CRC`);
    chunks.push({ type, data }); at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(chunks[0].data.readUInt32BE(0), 680);
  assert.equal(chunks[0].data.readUInt32BE(4), 220);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, (680 * 3 + 1) * 220, 'every scanline is present');
  assert.ok(raw.includes(0xee), 'there is something drawn on the panel');
  assert.equal(P.PROOF_ODOMETER_DIGITS, '084213');
});

// ── Verdicts ──────────────────────────────────────────────────────────────────────────────────
const GOOD_HEALTH = {
  status: 'UP',
  build: { commit_sha: SHA },
  database: { supabase_project_ref: REF, postgres_project_refs: [REF], consistent: true },
  ocr: { selectedProvider: 'cloudflare', selectedModel: P.QWEN, configured: true, mockRuntimeAllowed: false, custody: { status: 'canonical' } },
  ai: { provider: 'cloudflare', model: P.GEMMA, configured: true },
  communications: { outbound: { kill_switch: 'active' } },
};
const clone = () => JSON.parse(JSON.stringify(GOOD_HEALTH));

test('preconditions: the governed candidate runtime passes', () => {
  assert.deepEqual(P.healthRefusals(GOOD_HEALTH, { expectedSha: SHA, expectedRef: REF }), []);
});

for (const [name, mutate, refusal] of [
  ['another build', (h) => { h.build.commit_sha = 'b'.repeat(40); }, 'BACKEND_NOT_EXACT_SHA'],
  ['another Supabase project', (h) => { h.database.supabase_project_ref = 'zyxwvutsrqponmlkjihg'; }, 'SUPABASE_PROJECT_NOT_STAGING'],
  ['another Postgres project', (h) => { h.database.postgres_project_refs = [REF, 'zyxwvutsrqponmlkjihg']; }, 'POSTGRES_PROJECT_NOT_STAGING'],
  ['an inconsistent target', (h) => { h.database.consistent = false; }, 'DATABASE_TARGET_INCONSISTENT'],
  ['OCR on Gemma', (h) => { h.ocr.selectedModel = P.GEMMA; }, 'OCR_NOT_CLOUDFLARE_QWEN'],
  ['OCR unconfigured', (h) => { h.ocr.configured = false; }, 'OCR_NOT_CLOUDFLARE_QWEN'],
  ['custody refused', (h) => { h.ocr.custody.status = 'refused'; }, 'OCR_CUSTODY_NOT_CANONICAL'],
  ['a reachable mock', (h) => { h.ocr.mockRuntimeAllowed = true; }, 'OCR_MOCK_REACHABLE'],
  ['general AI unconfigured', (h) => { h.ai.configured = false; }, 'AI_NOT_CLOUDFLARE_GEMMA'],
  ['sending enabled', (h) => { h.communications.outbound.kill_switch = 'inactive'; }, 'OUTBOUND_KILL_SWITCH_NOT_ACTIVE'],
  ['a down backend', (h) => { h.status = 'DOWN'; }, 'BACKEND_NOT_UP'],
]) {
  test(`preconditions: ${name} stops the proof (${refusal})`, () => {
    const h = clone(); mutate(h);
    assert.ok(P.healthRefusals(h, { expectedSha: SHA, expectedRef: REF }).includes(refusal));
  });
}

test('gemma verdict: only an executed answer that names Gemma succeeds', () => {
  const ok = { ai_status: 'ai_assisted', ai_available: true, ai_provenance: { provider: 'cloudflare', model: P.GEMMA, execution: 'provider_executed' } };
  assert.equal(P.gemmaVerdict(200, ok), 'SUCCEEDED');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_available: false }), 'FAILED', 'an answer that says the AI was not available is not AI-assisted');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_available: undefined }), 'FAILED');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_available: 'true' }), 'FAILED', 'availability is the boolean true, not a truthy string');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_available: 1 }), 'FAILED');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_provenance: { ...ok.ai_provenance, provider: 'gemini' } }), 'FAILED');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_provenance: { ...ok.ai_provenance, execution: 'deterministic' } }), 'FAILED');
  assert.equal(P.gemmaVerdict(200, { ...ok, ai_provenance: { ...ok.ai_provenance, model: P.QWEN } }), 'FAILED');
  assert.equal(P.gemmaVerdict(200, { ai_status: 'ai_assisted' }), 'FAILED', 'no provenance, no proof');
  assert.equal(P.gemmaVerdict(200, { ai_status: 'ai_unavailable' }), 'PROVIDER_UNAVAILABLE');
  assert.equal(P.gemmaVerdict(500, ok), 'FAILED');
});

test('gemma verdict (REL-02 H): the 12-second product bound is part of success, and a timeout is classified as one', () => {
  const ok = { ai_status: 'ai_assisted', ai_available: true, ai_provenance: { provider: 'cloudflare', model: P.GEMMA, execution: 'provider_executed' } };
  assert.equal(P.GEMMA_PRODUCT_BOUND_MS, 12_000);
  assert.equal(P.gemmaVerdict(200, ok, 2700), 'SUCCEEDED');
  assert.equal(P.gemmaVerdict(200, ok, 11_999), 'SUCCEEDED');
  assert.equal(P.gemmaVerdict(200, ok, 12_000), 'TOO_SLOW', 'the bound is exclusive: 12 s is not "within" it');
  assert.equal(P.gemmaVerdict(200, ok, 16_300), 'TOO_SLOW');
  assert.equal(P.gemmaVerdict(200, ok, NaN), 'TOO_SLOW', 'an unmeasurable latency is not proof of being within the bound');
  // a degraded answer: the model being slow is named as such; anything else stays plain unavailability
  assert.equal(P.gemmaVerdict(200, { ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'ai_timeout' }, 13_346), 'PROVIDER_TIMEOUT');
  assert.equal(P.gemmaVerdict(200, { ai_status: 'ai_unavailable', ai_available: false }, 900), 'PROVIDER_UNAVAILABLE');
  assert.equal(P.gemmaVerdict(200, { ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'sign_in_required' }, 900), 'PROVIDER_UNAVAILABLE');
  // the run record states the bound and whether the answer met it
  assert.match(SRC, /within_product_bound: gemma\.latency_ms < GEMMA_PRODUCT_BOUND_MS/);
  assert.match(SRC, /verdict: gemmaVerdict\(gemma\.status, gemma\.body \|\| \{\}, gemma\.latency_ms\)/);
});

test('qwen verdict: a Qwen candidate with no authority effect succeeds; anything else fails', () => {
  const ok = { provider: 'cloudflare', model: P.QWEN, reading: { status: 'candidate_pending_review' }, authority_effects: { mileage_recorded: false, trust_changed: false } };
  assert.equal(P.qwenVerdict(201, ok), 'SUCCEEDED');
  assert.equal(P.qwenVerdict(200, { ...ok, reading: { status: 'not_read' } }), 'SUCCEEDED', 'an unread photo still proves the provider path');
  assert.equal(P.qwenVerdict(201, { ...ok, model: P.GEMMA }), 'FAILED');
  assert.equal(P.qwenVerdict(201, { ...ok, authority_effects: { mileage_recorded: true } }), 'FAILED');
  assert.equal(P.qwenVerdict(201, { ...ok, authority_effects: {} }), 'FAILED', 'an absent authority statement is not "none"');
  assert.equal(P.qwenVerdict(201, { ...ok, reading: { status: 'recorded' } }), 'FAILED');
});

test('the proof record carries no credential: the session token and the connection string never enter it', () => {
  assert.doesNotMatch(SRC, /record\.[a-z_.]+\s*=\s*[^;\n]*\btoken\b/i);
  assert.doesNotMatch(SRC, /record\.[a-z_.]+\s*=\s*[^;\n]*(DIASPORA_STAGING_DATABASE_URL|STAGING_UAT_PASSWORD)/);
  assert.match(SRC, /record\.identity = \{ id: identity\.id, role: /);
});
