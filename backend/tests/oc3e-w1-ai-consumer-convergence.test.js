/**
 * OC-3E wave 1 — fraud, risk and the Marketplace AI assistant reach the model through the canonical
 * CarUp AI gateway, and nobody spends paid inference without a proven identity.
 *
 * Before (lineage @ 300010dc): aiServiceBus (fraud, risk) and marketplaceAiAssistantService called
 * GeminiClient directly; the four /api/marketplace/ai/* routes were PUBLIC with only a rate limiter,
 * so any anonymous caller could spend provider capacity; and the limiter's test bypass header was
 * honoured on NODE_ENV=test alone.
 *
 * Proven here, through the SHIPPED server.js (real routers, real session tokens against an in-memory
 * Supabase double; Workers AI intercepted at fetch — no network, no credential):
 *   1. provider cost — anonymous and merely-asserted callers trigger ZERO provider requests on every
 *      public AI route and still get the deterministic answer (ai_reason 'sign_in_required'); a
 *      session-proven caller triggers exactly ONE; fraud/risk refuse anonymous callers before any;
 *   2. the domain adapter accepts only executed, advisory machine output and carries the gateway's
 *      failure fields; OC-3B's failure semantics hold on the gateway path;
 *   3. source contract — the wave-1 consumers import no direct provider; the REMAINING direct-provider
 *      modules are pinned exactly, so a new direct caller fails here;
 *   4. the limiter's bypass header is refused in a declared deployment.
 */
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
// The asserted-identity cases must measure the route, not an operator opt-in left in the environment.
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

const { requestAdvisoryJson, AiAdvisoryError } = await import('../services/ai/domainAdvisoryAdapter.js');
const { rateLimiter } = await import('../middleware/securityMiddleware.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';

// ── Workers AI interception ─────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const providerCalls = [];
let providerAnswer = null;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.startsWith('https://api.cloudflare.com/') || target.startsWith('https://generativelanguage.googleapis.com/')) {
    providerCalls.push({ url: target, body: JSON.parse(init.body) });
    return providerAnswer(target, init);
  }
  return realFetch(url, init);
};
const answer = (obj) => async () => new Response(JSON.stringify({ success: true, errors: [], result: { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });

// ── Supabase double ─────────────────────────────────────────────────────────────────────────
const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();
let db;
function resetDb() {
  db = {
    writes: [],
    data: {
      users: [
        { id: 'buyer-1', role: 'buyer', is_verified: true },
        { id: 'admin-1', role: 'admin', is_verified: true },
      ],
      user_sessions: [
        { token: 'oc3e-buyer-session', user_id: 'buyer-1', is_valid: true, expires_at: FUTURE },
        { token: 'oc3e-admin-session', user_id: 'admin-1', is_valid: true, expires_at: FUTURE },
      ],
    },
  };
}
function memoryFrom(table) {
  const filters = [];
  let op = 'select'; let payload = null;
  const q = {
    select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order() { return q; }, limit() { return q; },
    in() { return q; }, neq() { return q; }, is() { return q; }, gte() { return q; }, lte() { return q; },
    insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; },
    upsert(p) { op = 'upsert'; payload = p; return q; },
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

const ENV_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY', 'VERCEL_ENV', 'CARUP_ENV'];
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
  providerAnswer = answer({});
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // A configured gateway — so a zero call count below is the guard, not a missing credential.
  process.env.CLOUDFLARE_ACCOUNT_ID = 'oc3e-test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'oc3e-test-token';
  process.env.GEMINI_API_KEY = 'present-and-must-not-be-used';
  delete process.env.VERCEL_ENV;
  delete process.env.CARUP_ENV;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

async function post(route, body, headers = {}) {
  const res = await realFetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

const BUYER = { 'x-session-token': 'oc3e-buyer-session' };
const ADMIN = { 'x-session-token': 'oc3e-admin-session' };
const ASSERTED = { 'x-user-id': 'buyer-1' };

// Each public route, a request it accepts, and a valid advisory answer for it.
const PUBLIC_AI_ROUTES = [
  ['/api/marketplace/ai/listing-draft', { make: 'Toyota', model: 'Hilux', year: 2020, price: 21000 }, { title: 'AI Hilux', short_description: 's', detailed_description: 'd' }],
  ['/api/marketplace/ai/buyer-assistant', { budget: 15000, use_case: 'farm' }, { guidance: ['AI: shortlist two diesel pickups.'] }],
  ['/api/marketplace/ai/price-estimate', { listingSummary: { make: 'Toyota', model: 'Hilux', year: 2020, mileage: 90000, price: 21000 } }, { price_confidence: 'medium', notes: ['AI note'] }],
  ['/api/marketplace/ai/share-copy', { make: 'Toyota', model: 'Hilux', year: 2020, price: 21000 }, { whatsapp: 'w', telegram: 't', facebook: 'f', short: 's' }],
];

// ── 1. Provider cost ─────────────────────────────────────────────────────────────────────────

for (const [route, body, aiReply] of PUBLIC_AI_ROUTES) {
  test(`OC-3E-W1 cost ${route}: an anonymous caller spends NOTHING and still gets the deterministic answer`, async () => {
    providerAnswer = answer(aiReply);
    const res = await post(route, body);
    assert.equal(res.status, 200, res.text);
    assert.equal(providerCalls.length, 0, `anonymous call reached a provider: ${JSON.stringify(providerCalls)}`);
    assert.equal(res.body.ai_status, 'ai_unavailable');
    assert.equal(res.body.ai_available, false);
    assert.equal(res.body.ai_reason, 'sign_in_required');
    assert.ok(!res.text.includes('AI Hilux') && !res.text.includes('AI note') && !res.text.includes('AI: shortlist'), 'no AI content');
  });

  test(`OC-3E-W1 cost ${route}: an ASSERTED identity (x-user-id, no session) is not proven — it spends nothing`, async () => {
    providerAnswer = answer(aiReply);
    const res = await post(route, body, ASSERTED);
    assert.equal(res.status, 200, res.text);
    assert.equal(providerCalls.length, 0);
    assert.equal(res.body.ai_reason, 'sign_in_required');
  });

  test(`OC-3E-W1 cost ${route}: a session-proven caller gets advisory AI through the gateway — exactly one request`, async () => {
    providerAnswer = answer(aiReply);
    const res = await post(route, body, BUYER);
    assert.equal(res.status, 200, res.text);
    assert.equal(providerCalls.length, 1, 'one gateway request, no retry or fallback');
    assert.match(providerCalls[0].url, new RegExp(`/ai/run/${GEMMA.replace(/[/@.-]/g, '\\$&')}$`), 'the canonical gateway model');
    assert.equal(res.body.ai_status, 'ai_assisted');
    assert.equal(res.body.ai_available, true);
    assert.equal('ai_reason' in res.body, false);
  });
}

test('OC-3E-W1 cost: admin moderation summary (admin session) reaches the gateway once; anonymous is refused before any', async () => {
  providerAnswer = answer({ summary: 'AI summary', suggested_action: 'review' });
  const res = await post('/api/admin/marketplace/ai/moderation-summary', { listingSummary: { vin: 'VIN1' }, trustSummary: { risk_status: 'clear' } }, ADMIN);
  assert.equal(res.status, 200, res.text);
  assert.equal(providerCalls.length, 1);
  assert.equal(res.body.ai_status, 'ai_assisted');
  providerCalls.length = 0;
  const anon = await post('/api/admin/marketplace/ai/moderation-summary', { listingSummary: { vin: 'VIN1' } });
  assert.equal(anon.status, 401, anon.text);
  assert.equal(providerCalls.length, 0);
});

for (const [route, body] of [
  ['/api/ai/fraud-scan', { vin: 'VIN1', price: 20000, listingTitle: 'Listing' }],
  ['/api/ai/risk-assessment', { vin: 'VIN1', mileage: 50000, basePrice: 20000 }],
]) {
  test(`OC-3E-W1 cost ${route}: anonymous is refused 401 before any provider request; a session spends exactly one`, async () => {
    providerAnswer = answer({ isFraudulent: false, riskRating: 'Medium', reasons: [], confidence: 0.5, riskScore: 40, factors: [] });
    const anon = await post(route, body);
    assert.equal(anon.status, 401, anon.text);
    assert.equal(providerCalls.length, 0);
    const res = await post(route, body, BUYER);
    assert.equal(res.status, 200, res.text);
    assert.equal(providerCalls.length, 1);
    assert.equal(res.body.provider, 'cloudflare');
    assert.equal(res.body.model, GEMMA);
    assert.equal(res.body.execution, 'provider_executed');
    assert.equal(res.body.advisory, true);
  });
}

test('OC-3E-W1 cost: a fraud verdict through the gateway is persisted under the model that produced it', async () => {
  providerAnswer = answer({ isFraudulent: true, riskRating: 'High', riskScore: 77, reasons: ['price far below market'], confidence: 0.8 });
  const res = await post('/api/ai/fraud-scan', { vin: 'VIN1', price: 900, listingTitle: 'Too cheap' }, BUYER);
  assert.equal(res.status, 200, res.text);
  const scan = db.writes.find((w) => w.table === 'ai_fraud_scans');
  assert.ok(scan, 'persisted');
  assert.equal(scan.payload.model_version, GEMMA);
  assert.equal(scan.payload.risk_score, 77);
  assert.equal(JSON.parse(scan.payload.reasons_json).advisory, true);
  assert.equal(res.body.persisted, true);
});

// ── 1b. Bounded input: rejected or answered deterministically BEFORE any provider request ─────

for (const [route, body, why] of [
  ['/api/ai/fraud-scan', { vin: 'VIN1', price: 20000, listingTitle: 'x'.repeat(301) }, 'listingTitle over 300 characters'],
  ['/api/ai/fraud-scan', { vin: 'V'.repeat(65), price: 20000, listingTitle: 'Listing' }, 'vin over 64 characters'],
  ['/api/ai/fraud-scan', { price: 20000, listingTitle: 'Listing' }, 'missing vin'],
  ['/api/ai/fraud-scan', { vin: 'VIN1', price: 'cheap', listingTitle: 'Listing' }, 'non-numeric price'],
  ['/api/ai/risk-assessment', { vin: 'VIN1', mileage: true, basePrice: 20000 }, 'boolean mileage'],
  ['/api/ai/risk-assessment', { vin: 'VIN1', mileage: -5, basePrice: 20000 }, 'negative mileage'],
]) {
  test(`OC-3E-W1 input ${route}: ${why} is refused 400 with no provider request`, async () => {
    providerAnswer = answer({ isFraudulent: false, riskRating: 'Low', riskScore: 5, reasons: [], confidence: 0.5, factors: [] });
    const res = await post(route, body, BUYER);
    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error.code, 'AI_INPUT_REJECTED', 'the standard error envelope names the refusal');
    assert.equal(providerCalls.length, 0);
  });
}

test('OC-3E-W1 input: an oversized Marketplace AI request is answered deterministically with no provider request', async () => {
  providerAnswer = answer({ title: 'AI Hilux' });
  const res = await post('/api/marketplace/ai/listing-draft', { make: 'Toyota', model: 'Hilux', notes: 'n'.repeat(5000) }, BUYER);
  assert.equal(res.status, 200, res.text);
  assert.equal(providerCalls.length, 0);
  assert.equal(res.body.ai_status, 'ai_unavailable');
  assert.equal(res.body.ai_reason, 'input_too_large');
  assert.equal(res.body.title, '2020 Toyota Hilux'.replace('2020 ', ''), 'the deterministic draft');
});

// ── 2. The domain adapter contract ────────────────────────────────────────────────────────────

const fakeGateway = (out) => ({ generateJson: async () => out });
const OK = { ok: true, value: { a: 1 }, machine_output: true, authority: 'advisory', provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' }, usage: { prompt_tokens: 3 } };

test('OC-3E-W1 adapter: returns an executed, advisory answer with its provenance', async () => {
  const out = await requestAdvisoryJson({ systemPrompt: 's', userPrompt: 'u', purpose: 'test' }, { gateway: fakeGateway(OK) });
  assert.deepEqual(out, { value: { a: 1 }, provider: 'cloudflare', model: GEMMA, execution: 'provider_executed', usage: { prompt_tokens: 3 } });
});

test('OC-3E-W1 adapter: anything but an executed advisory machine output is refused', async () => {
  const violations = [
    { ...OK, machine_output: false },
    { ...OK, authority: 'authoritative' },
    { ...OK, provenance: { ...OK.provenance, execution: 'simulated' } },
    { ...OK, provenance: { ...OK.provenance, execution: undefined } },
  ];
  for (const out of violations) {
    await assert.rejects(() => requestAdvisoryJson({ purpose: 'test' }, { gateway: fakeGateway(out) }),
      (e) => e instanceof AiAdvisoryError && e.code === 'AI_GATEWAY_CONTRACT_VIOLATION', JSON.stringify(out));
  }
});

test('OC-3E-W1 adapter: a gateway failure becomes a typed AiAdvisoryError carrying its fields', async () => {
  const failure = { ok: false, machine_output: false, authority: 'advisory', error: { code: 'AI_RATE_LIMITED', message: 'capacity', retryable: true, status: 429 }, provenance: { provider: 'cloudflare', model: GEMMA, execution: 'failed' } };
  const error = await assert.rejects(() => requestAdvisoryJson({ purpose: 'fraud analysis' }, { gateway: fakeGateway(failure) }), (e) => {
    assert.ok(e instanceof AiAdvisoryError);
    assert.equal(e.code, 'AI_RATE_LIMITED');
    assert.equal(e.retryable, true);
    assert.equal(e.status, 429);
    assert.equal(e.provider, 'cloudflare');
    assert.equal(e.model, GEMMA);
    assert.equal(e.message, 'fraud analysis: capacity');
    return true;
  });
  return error;
});

// ── 3. Source contract and the remaining direct-provider ledger ──────────────────────────────

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// A vendor CLIENT or ENDPOINT — not a configuration flag (health/metrics still report a legacy
// MOONSHOT_API_KEY presence flag; there is no Moonshot client, and that flag is recorded as debt).
const DIRECT_PROVIDER = /GeminiClient\.js|askGemini|generativelanguage\.googleapis\.com|api\.groq\.com|api\.openai\.com|openrouter\.ai|api\.anthropic\.com|api\.moonshot\./i;
const WAVE_1 = [
  ['../services/ai/aiServiceBus.js', /export async function runFraudAnalysis/],
  ['../services/marketplace/marketplaceAiAssistantService.js', /export async function listingDraft/],
];

test('OC-3E-W1 source: the wave-1 consumers reach a model ONLY through the domain adapter', () => {
  for (const [rel, landmark] of WAVE_1) {
    const src = read(rel);
    assert.match(src, landmark, `${rel}: anti-vacuity landmark`);
    const code = stripComments(src);
    assert.doesNotMatch(code, DIRECT_PROVIDER, `${rel} still reaches a model vendor directly`);
    assert.match(code, /import \{[^}]*\brequestAdvisoryJson\b[^}]*\} from '[./]+(ai\/)?domainAdvisoryAdapter\.js'/, `${rel} must use the domain adapter`);
  }
  // Positive control: the same pattern finds a module that still is a direct consumer.
  assert.match(stripComments(read('../services/ai/ocrVisionProvider.js')), DIRECT_PROVIDER);
});

function runtimeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) out.push(full);
    }
  };
  for (const root of ['../services', '../routes', '../middleware', '../config']) walk(path.join(here, root));
  out.push(path.join(here, '../server.js'));
  return out;
}

test('OC-3E-W1 ledger: the remaining DIRECT model-vendor modules are exactly the ones recorded', () => {
  // Every runtime module that imports GeminiClient or names a model vendor's endpoint. New consumers
  // go through carUpAiGateway (via a domain adapter); this list only shrinks. Recorded owners:
  //   GeminiClient.js                — the legacy client itself (no wave-1 consumer left)
  //   ocrVisionProvider.js           — the selectable, NON-default Gemini OCR provider (OCR authority: Qwen)
  //   communicationGroqProvider.js   — Communications MEDIA only (MULTIMODAL DEFERRED). OC-4B converged
  //                                    Communications general text on the gateway and RETIRED
  //                                    communicationGeminiProvider.js — the list shrank, as it only may.
  const files = runtimeFiles();
  assert.ok(files.length > 150, `anti-vacuity: scanned ${files.length} runtime files`);
  const direct = files
    .filter((f) => DIRECT_PROVIDER.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => path.relative(path.join(here, '..'), f))
    .sort();
  assert.deepEqual(direct, [
    'services/ai/GeminiClient.js',
    'services/ai/ocrVisionProvider.js',
    'services/communication/communicationGroqProvider.js',
  ]);
});

// ── 4. The limiter's test bypass is refused in a declared deployment ─────────────────────────

test('OC-3E-W1 limiter: the bypass header works in the test runtime but NOT in a declared deployment', async () => {
  const limiter = rateLimiter({ max: 1, windowMs: 60_000, isSensitive: true });
  // The limiter keys on the client address; fixed documentation-range addresses keep each scenario
  // on its own counter.
  const run = (ip, headers) => new Promise((resolve) => {
    const req = { headers, ip, method: 'POST', originalUrl: '/api/marketplace/ai/listing-draft', url: '/api/marketplace/ai/listing-draft', socket: {} };
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json() { resolve(this.statusCode); return this; } };
    limiter(req, res, () => resolve('next'));
  });
  const bypass = { 'x-bypass-rate-limit': 'true' };
  // Test runtime: the header skips the limiter entirely (the suites rely on it), so max=1 never bites.
  assert.deepEqual([await run('198.51.100.201', bypass), await run('198.51.100.201', bypass), await run('198.51.100.201', bypass)], ['next', 'next', 'next']);
  // Declared deployment (even with NODE_ENV=test leaked in): the header is ignored and the limit holds.
  process.env.VERCEL_ENV = 'production';
  assert.deepEqual([await run('198.51.100.202', bypass), await run('198.51.100.202', bypass), await run('198.51.100.202', bypass)], ['next', 429, 429]);
  process.env.VERCEL_ENV = 'preview';
  assert.deepEqual([await run('198.51.100.203', bypass), await run('198.51.100.203', bypass)], ['next', 429]);
});
