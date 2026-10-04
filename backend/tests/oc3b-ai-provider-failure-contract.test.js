/**
 * OC-3B — a failed AI provider is a failure, never a verdict.
 *
 * THE DEFECTS (base 72c01eda).
 *   1. `askGemini` caught every HTTP/transport/parse failure and RETURNED
 *      `JSON.stringify({ error: true, message })` — a successful-looking string.
 *   2. `runFraudAnalysis` parsed that envelope as a model reply: `riskRating` was absent, so it
 *      defaulted to 'Low'; `isFraudulent` was absent, so `is_flagged` was false — and it PERSISTED
 *      that favorable row to `ai_fraud_scans` and answered 200. A provider outage became "low fraud
 *      risk". Any model reply without a recognised rating took the same path.
 *   3. `runRiskScoring` returned the envelope (or a generic LLM's `recommendedPremium`) as a 200.
 *   4. Provenance: inference logs said 'gemini-pro', the fraud row said 'gemini-pro-v1'; the request
 *      went to gemini-2.5-flash.
 *
 * THE CONTRACT. `askGemini` throws `AiProviderError { code, provider: 'gemini', model, status,
 * retryable }`. The fraud and risk routes answer 503 with `outcome: 'unavailable'`,
 * `verdict: 'unknown'`, `manual_review_required: true`, and persist nothing. A completed risk answer
 * carries no premium and is labelled advisory / non-binding / not an insurance quote. The test mock
 * is reachable only under NODE_ENV=test + ALLOW_OCR_MOCK=true and is labelled `simulated`.
 *
 * Provider calls are intercepted at `fetch`; no network and no live Supabase are involved.
 *
 * OC-3E-W1. Fraud, risk and the marketplace assistant no longer call Gemini: they reach the model
 * through the canonical CarUp AI gateway (domainAdvisoryAdapter → Gemma on Cloudflare Workers AI).
 * Their cases below therefore intercept CLOUDFLARE and expect the gateway's provenance and typed
 * AiAdvisoryError; the contract each case asserts is unchanged. The former "simulated fraud verdict"
 * case is replaced by a stronger one: on the gateway path a simulated verdict does not exist at all.
 *
 * OC-4B. GeminiClient's TEXT path (askGemini / askGeminiWithProvenance and its scripted reply) is
 * retired — it had no runtime caller left. The typed-failure contract it carried is now proven on the
 * path that remains, askGeminiVision (the non-default Gemini OCR provider's client).
 */
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const gemini = await import('../services/ai/GeminiClient.js');
const bus = await import('../services/ai/aiServiceBus.js');
const { listingDraft } = await import('../services/marketplace/marketplaceAiAssistantService.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

// ── provider interception ─────────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let providerBehaviour = null;
const providerCalls = [];
let gatewayBehaviour = null;
const gatewayCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    providerCalls.push(String(url));
    return providerBehaviour(url, init);
  }
  if (String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/')) {
    gatewayCalls.push(String(url));
    return gatewayBehaviour(url, init);
  }
  return realFetch(url, init);
};
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const modelSays = (obj) => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const FAILURES = {
  'HTTP 500': reply(500, { error: { status: 'INTERNAL', message: 'backend error' } }),
  'HTTP 429': reply(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }),
  'transport error': async () => { throw new TypeError('fetch failed'); },
  'non-JSON body': async () => new Response('<html>bad gateway</html>', { status: 502 }),
  'no candidate text': reply(200, { candidates: [{ finishReason: 'SAFETY' }] }),
};
// The same failure classes, as the CarUp AI gateway's provider (Workers AI) answers them.
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const gatewaySays = (obj) => reply(200, { success: true, errors: [], result: { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }] } });
const GATEWAY_FAILURES = {
  'HTTP 500': reply(500, { success: false, errors: [{ code: 1000, message: 'internal' }] }),
  'HTTP 429': reply(429, { success: false, errors: [{ code: 3040, message: 'capacity exceeded' }] }),
  'transport error': async () => { throw new TypeError('fetch failed'); },
  'non-JSON body': async () => new Response('<html>bad gateway</html>', { status: 502 }),
  'no content': reply(200, { success: true, errors: [], result: { choices: [{ message: { content: '' } }] } }),
  'malformed JSON': reply(200, { success: true, errors: [], result: { choices: [{ message: { content: 'not json at all' } }] } }),
};

// ── supabase double ───────────────────────────────────────────────────────────────────────────
const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();
let db;
function resetDb() {
  db = {
    writes: [],
    data: {
      users: [{ id: 'owner-1', role: 'owner', is_verified: true }],
      user_sessions: [{ token: 'oc3b-ai-session', user_id: 'owner-1', is_valid: true, expires_at: FUTURE }],
    },
  };
}
function memoryFrom(table) {
  const filters = [];
  let op = 'select'; let payload = null;
  const q = {
    select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order() { return q; }, limit() { return q; },
    insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; },
    maybeSingle() { return exec(true); }, single() { return exec(true); },
    then(res, rej) { return exec(false).then(res, rej); },
  };
  async function exec(single) {
    if (op !== 'select') { db.writes.push({ table, op, payload: JSON.parse(JSON.stringify(payload)) }); return { data: null, error: null }; }
    const rows = (db.data[table] || []).filter((r) => filters.every(([k, v]) => r[k] === v));
    if (single) return rows.length ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'none' } };
    return { data: rows, error: null };
  }
  return q;
}

const ENV_KEYS = ['GEMINI_API_KEY', 'NODE_ENV', 'ALLOW_OCR_MOCK', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
let savedEnv;
const realFrom = supabase.from;
let server; let baseUrl;
before(async () => {
  supabase.from = memoryFrom;
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  resetDb();
  providerCalls.length = 0;
  gatewayCalls.length = 0;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Default: configured live providers. Individual tests change them.
  process.env.GEMINI_API_KEY = 'oc3b-test-key';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'oc3e-test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'oc3e-test-token';
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_OCR_MOCK = 'false';
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

function assertProviderError(err, label) {
  assert.ok(err instanceof gemini.AiProviderError, `${label}: AiProviderError, got ${err?.constructor?.name}: ${err?.message}`);
  assert.equal(err.name, 'AiProviderError');
  assert.match(err.code, /^AI_PROVIDER_/);
  assert.equal(err.provider, 'gemini');
  assert.equal(err.model, 'gemini-2.5-flash');
  assert.equal(typeof err.retryable, 'boolean');
  return true;
}

// ── GeminiClient: vision only (OC-4B) ──────────────────────────────────────────────────────────

test('OC-4B GeminiClient: the text path and its scripted reply are retired — nothing can call them', async () => {
  assert.equal('askGemini' in gemini, false);
  assert.equal('askGeminiWithProvenance' in gemini, false);
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../services/ai/GeminiClient.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /function simulatedReply|Tendai Moyo|Owner verified through OTP|riskRating: 'Low'/, 'the canned verdict generator is gone');
});

for (const [label, behaviour] of Object.entries(FAILURES)) {
  test(`OC-3B askGeminiVision: ${label} THROWS a typed AiProviderError instead of returning an {error:true} envelope`, async () => {
    providerBehaviour = behaviour;
    await assert.rejects(() => gemini.askGeminiVision('system', 'read the document', [], true), (err) => assertProviderError(err, label));
  });
}

test('OC-3B askGeminiVision: retryability and HTTP status are carried on the error', async () => {
  providerBehaviour = FAILURES['HTTP 429'];
  await assert.rejects(() => gemini.askGeminiVision('s', 'u', [], true), (err) => err.status === 429 && err.retryable === true);
  providerBehaviour = FAILURES['transport error'];
  await assert.rejects(() => gemini.askGeminiVision('s', 'u', [], true), (err) => err.status === null && err.retryable === true);
});

test('OC-3B askGeminiVision: the request goes to the model the client names', async () => {
  providerBehaviour = modelSays({ ok: 1 });
  const text = await gemini.askGeminiVision('s', 'u', [], true);
  assert.deepEqual(JSON.parse(text), { ok: 1 });
  assert.ok(providerCalls[0].includes(`/models/${gemini.GEMINI_VISION_MODEL}:generateContent`), 'label == the model in the request URL');
});

test('OC-3B askGeminiVision: the test mock is reachable ONLY under NODE_ENV=test + ALLOW_OCR_MOCK=true, and is labelled simulated', async () => {
  delete process.env.GEMINI_API_KEY;
  process.env.ALLOW_OCR_MOCK = 'true';
  const out = JSON.parse(await gemini.askGeminiVision('s', 'classify', [], true));
  assert.equal(out.simulated, true, 'the mock payload itself says it is simulated');
  assert.equal(providerCalls.length, 0);
  for (const [env, allow] of [['production', 'true'], ['development', 'true'], ['test', 'false'], ['test', undefined]]) {
    process.env.NODE_ENV = env;
    if (allow === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = allow;
    await assert.rejects(() => gemini.askGeminiVision('s', 'classify', [], true), (err) => err instanceof gemini.AiProviderError && err.retryable === false,
      `NODE_ENV=${env} ALLOW_OCR_MOCK=${allow}: no key must fail closed`);
  }
});

// ── fraud ─────────────────────────────────────────────────────────────────────────────────────

const fraudRows = () => db.writes.filter((w) => w.table === 'ai_fraud_scans');

const isAdvisoryFailure = (err) => err instanceof bus.AiAdvisoryError && err.provider === 'cloudflare' && err.model === GEMMA
  && /^AI_/.test(err.code) && typeof err.retryable === 'boolean';

for (const [label, behaviour] of Object.entries(GATEWAY_FAILURES)) {
  test(`OC-3B fraud: provider ${label} is NOT a "Low" verdict and persists no fraud scan`, async () => {
    gatewayBehaviour = behaviour;
    await assert.rejects(() => bus.runFraudAnalysis('VIN1', 20000, 'Listing'), isAdvisoryFailure);
    assert.deepEqual(fraudRows(), [], 'no favorable ai_fraud_scans row');
    assert.equal(gatewayCalls.length, 1, 'one attempt, no retry or fallback');
    assert.equal(providerCalls.length, 0, 'fraud never calls Gemini');
  });
}

test('OC-3B fraud: a model reply without a recognised rating is unavailable, not "Low"', async () => {
  for (const body of [{ isFraudulent: false }, { riskRating: 'Safe', isFraudulent: false }, { riskRating: 'Low' }, []]) {
    resetDb();
    gatewayBehaviour = gatewaySays(body);
    await assert.rejects(() => bus.runFraudAnalysis('VIN1', 20000, 'Listing'),
      (err) => err instanceof bus.AiAdvisoryError && err.code === 'AI_PROVIDER_INVALID_OUTPUT', JSON.stringify(body));
    assert.deepEqual(fraudRows(), [], `${JSON.stringify(body)}: nothing persisted`);
  }
});

test('OC-3B fraud: a real verdict is persisted and logged under the model that produced it', async () => {
  gatewayBehaviour = gatewaySays({ isFraudulent: true, riskRating: 'High', riskScore: 82, reasons: ['price far below market'], confidence: 0.7 });
  const out = await bus.runFraudAnalysis('VIN1', 2000, 'Too cheap');
  assert.equal(out.outcome, 'completed');
  assert.equal(out.riskRating, 'High');
  assert.equal(out.provider, 'cloudflare');
  assert.equal(out.model, GEMMA);
  assert.equal(out.execution, 'provider_executed');
  assert.equal(out.advisory, true);
  const [row] = fraudRows();
  assert.ok(row, 'persisted');
  assert.equal(row.payload.model_version, GEMMA);
  assert.equal(row.payload.risk_rating, 'High');
  assert.equal(row.payload.risk_score, 82, 'the model\'s own index — never a filler');
  assert.equal(row.payload.is_flagged, true);
  // OC-3E-W1: persisted as what it is — advisory machine analysis.
  // OC-4A: the envelope also records who executed it, and whether the model stated a confidence.
  assert.deepEqual(JSON.parse(row.payload.reasons_json), {
    advisory: true, machine_output: true, binding: false, source: 'generic_llm',
    provider: 'cloudflare', model: GEMMA, execution: 'provider_executed', confidence_reported: true, reasons: ['price far below market'],
  });
  const log = db.writes.find((w) => w.table === 'ai_inference_logs');
  assert.equal(log.payload.model_name, GEMMA, 'logged under the model the request actually used');
});

test('OC-3E-W1 fraud: a verdict with no stated risk index is returned as advice but NOT persisted — no filler 0', async () => {
  for (const riskScore of [undefined, null, 'high', -1, 101, true]) {
    resetDb();
    gatewayBehaviour = gatewaySays({ isFraudulent: false, riskRating: 'Medium', reasons: [], confidence: 0.4, ...(riskScore === undefined ? {} : { riskScore }) });
    const out = await bus.runFraudAnalysis('VIN1', 20000, 'Listing');
    assert.equal(out.riskRating, 'Medium');
    assert.equal(out.persisted, false, `riskScore=${JSON.stringify(riskScore)}`);
    assert.deepEqual(fraudRows(), [], `riskScore=${JSON.stringify(riskScore)}: a row would need a fabricated risk_score`);
  }
});

test('OC-3E-W1 fraud: no simulated verdict exists — without credentials, even in the fixture runtime, it is unavailable', async () => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.GEMINI_API_KEY;
  process.env.ALLOW_OCR_MOCK = 'true'; // the test-fixture runtime: it must not conjure a verdict here
  await assert.rejects(() => bus.runFraudAnalysis('VIN1', 20000, 'Listing title'),
    (err) => err instanceof bus.AiAdvisoryError && err.code === 'AI_PROVIDER_UNAVAILABLE');
  assert.deepEqual(fraudRows(), []);
  assert.equal(gatewayCalls.length + providerCalls.length, 0, 'no provider capacity spent');
});

// ── risk / premium ────────────────────────────────────────────────────────────────────────────

test('OC-3B risk: provider failure throws; nothing favorable is returned', async () => {
  for (const behaviour of Object.values(GATEWAY_FAILURES)) {
    gatewayBehaviour = behaviour;
    await assert.rejects(() => bus.runRiskScoring('VIN1', 50000, 20000), isAdvisoryFailure);
  }
  assert.equal(providerCalls.length, 0, 'risk never calls Gemini');
});

test('OC-3B risk: a completed answer carries NO premium and is labelled advisory, non-binding, not an insurance quote', async () => {
  gatewayBehaviour = gatewaySays({ riskScore: 31, recommendedPremium: 145, currency: 'USD', factors: [{ name: 'mileage', impact: 'Negative' }] });
  const out = await bus.runRiskScoring('VIN1', 50000, 20000);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /recommendedPremium|premium|"currency"/i, `no premium figure: ${text}`);
  assert.ok(!text.includes('145'));
  assert.equal(out.advisory, true);
  assert.equal(out.binding, false);
  assert.equal(out.not_an_insurance_quote, true);
  assert.equal(out.source, 'generic_llm');
  assert.equal(out.riskScore, 31);
  assert.equal(out.model, GEMMA);
  assert.equal(out.execution, 'provider_executed');
});

// ── HTTP: the shipped routes ──────────────────────────────────────────────────────────────────

async function post(path, body) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': 'oc3b-ai-session', 'x-bypass-rate-limit': 'true' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

for (const [path, body] of [
  ['/api/ai/fraud-scan', { vin: 'VIN1', price: 20000, listingTitle: 'Listing' }],
  ['/api/ai/risk-assessment', { vin: 'VIN1', mileage: 50000, basePrice: 20000 }],
]) {
  test(`OC-3B HTTP ${path}: provider failure answers 503 unavailable / verdict unknown / manual review — never a favorable 200`, async () => {
    for (const [label, behaviour] of Object.entries(GATEWAY_FAILURES)) {
      resetDb();
      gatewayBehaviour = behaviour;
      const res = await post(path, body);
      assert.equal(res.status, 503, `${label}: ${res.status} ${res.text}`);
      assert.equal(res.body.outcome, 'unavailable');
      assert.equal(res.body.verdict, 'unknown');
      assert.equal(res.body.manual_review_required, true);
      assert.equal(res.body.persisted, false);
      assert.equal(res.body.provider, 'cloudflare');
      assert.equal(res.body.model, GEMMA);
      assert.match(res.body.code, /^AI_/, `${label}: a typed failure code`);
      assert.doesNotMatch(res.text, /"Low"|"isFraudulent":false|recommendedPremium|"error":true/, `${label}: ${res.text}`);
      assert.deepEqual(fraudRows(), [], `${label}: no fraud scan persisted`);
    }
  });
}

test('OC-3B HTTP /api/ai/risk-assessment: a completed answer has no premium', async () => {
  gatewayBehaviour = gatewaySays({ riskScore: 12, recommendedPremium: 99, currency: 'USD', factors: [] });
  const res = await post('/api/ai/risk-assessment', { vin: 'VIN1', mileage: 1, basePrice: 1 });
  assert.equal(res.status, 200, res.text);
  assert.doesNotMatch(res.text, /premium|currency/i);
  assert.equal(res.body.not_an_insurance_quote, true);
});

// ── marketplace assistant ─────────────────────────────────────────────────────────────────────

test('OC-3B marketplace: provider failure AND an unconfigured provider both report ai_unavailable, never ai_assisted', async () => {
  for (const behaviour of Object.values(GATEWAY_FAILURES)) {
    gatewayBehaviour = behaviour;
    const failed = await listingDraft({ make: 'Toyota', model: 'Hilux', year: 2020, price: 1 });
    assert.equal(failed.ai_status, 'ai_unavailable');
    assert.equal(failed.ai_available, false);
  }

  // OC-3E-W1: the fixture runtime has no AI either — there is no simulated reply on the gateway path.
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.ALLOW_OCR_MOCK = 'true';
  const unconfigured = await listingDraft({ make: 'Toyota', model: 'Hilux', year: 2020, price: 1 });
  assert.equal(unconfigured.ai_status, 'ai_unavailable', 'no provider, no AI assistance');
  assert.equal(unconfigured.ai_available, false);

  process.env.CLOUDFLARE_ACCOUNT_ID = 'oc3e-test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'oc3e-test-token';
  process.env.ALLOW_OCR_MOCK = 'false';
  gatewayBehaviour = gatewaySays({ title: 'Clean Hilux', short_description: 's', detailed_description: 'd' });
  const real = await listingDraft({ make: 'Toyota', model: 'Hilux', year: 2020, price: 1 });
  assert.equal(real.ai_status, 'ai_assisted', 'positive control: a real reply is still used');
  assert.equal(real.title, 'Clean Hilux');
  assert.equal(providerCalls.length, 0, 'the assistant never calls Gemini');
});
