/**
 * OC-3C — ONE Cloudflare Workers AI transport, two policies.
 *
 * Before OC-3C, CarUp had two Workers AI clients: the certified OCR client (CloudflareVisionClient,
 * Qwen) and PR #217's Gemma provider. Each re-implemented credentials, URL, the POST, the timeout,
 * error parsing and secret handling — and they had drifted (one bounded with AbortSignal.timeout and
 * reported only the HTTP status; the other forwarded a caller's AbortSignal, classified 429/529/401/
 * 5xx and redacted secrets). cloudflareAiTransport.js is that machinery once; each policy keeps its
 * own model, request body and answer envelope.
 *
 * Proven here, with mocked HTTP only (no network, no credential):
 *   1. the transport contract — one attempt, URL/headers/body verbatim, classification, redaction,
 *      timeout vs caller abort, missing credentials spend nothing, fetch resolved at call time;
 *   2. both policies ride it, and send the requests they sent BEFORE the convergence — golden bodies
 *      captured from the pre-convergence implementations (OCR @ 44d283e2, Gemma @ PR #217 6c8ff6f7);
 *   3. the OCR policy keeps its wording and its model authority (Qwen; the gateway is not on the
 *      OCR path; Gemma is not selected for OCR);
 *   4. source contract: only the transport builds a Workers AI URL or reads the API token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

const transport = await import('../services/ai/cloudflareAiTransport.js');
const {
  CLOUDFLARE_AI_BASE, CLOUDFLARE_REQUIRED_ENV, CloudflareAiTransportError, classifyCloudflareFailure,
  cloudflareRunUrl, invokeCloudflareModel, isCloudflareConfigured, redactSecrets, resolveCloudflareCredentials,
} = transport;
const ocr = await import('../services/ai/CloudflareVisionClient.js');
const ocrProvider = await import('../services/ai/ocrVisionProvider.js');
const gemma = await import('../services/ai/cloudflareGemmaProvider.js');
const { createCarUpAiGateway } = await import('../services/ai/carUpAiGateway.js');

const ENV = Object.freeze({ CLOUDFLARE_ACCOUNT_ID: 'acct-test-123', CLOUDFLARE_API_TOKEN: 'token-test-456' });
const MODEL = '@cf/test/model';
const BODY = Object.freeze({ messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 });

const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (result = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) => json(200, { success: true, errors: [], result });

function recorder(responder = () => ok()) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responder(calls.length, init); };
  return { calls, fetchImpl };
}

/** A fetch that never answers until its signal aborts — a hung provider. */
const hangingFetch = (seen = {}) => async (_url, { signal }) => new Promise((_resolve, reject) => {
  seen.signal = signal;
  const onAbort = () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); };
  if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
});

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected a rejection');
}

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── 1. The transport contract ─────────────────────────────────────────────────────────────────

test('OC-3C transport: one POST to the model URL, Bearer from env, the policy body sent verbatim', async () => {
  const rec = recorder();
  const out = await invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: rec.fetchImpl });
  assert.equal(rec.calls.length, 1);
  const { url, init } = rec.calls[0];
  assert.equal(url, `${CLOUDFLARE_AI_BASE}/acct-test-123/ai/run/${MODEL}`);
  assert.equal(url, cloudflareRunUrl('acct-test-123', MODEL));
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer token-test-456' });
  assert.equal(init.body, JSON.stringify(BODY), 'the body is the policy\'s, byte for byte');
  assert.ok(init.signal instanceof AbortSignal, 'every call is abortable');
  assert.equal(out.status, 200);
  assert.deepEqual(out.result, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  assert.equal(out.payload.success, true);
  assert.equal(typeof out.durationMs, 'number');
});

test('OC-3C transport: the account id is URL-encoded and credentials are trimmed', async () => {
  const rec = recorder();
  await invokeCloudflareModel({ model: MODEL, body: BODY, env: { CLOUDFLARE_ACCOUNT_ID: ' acct 1/x ', CLOUDFLARE_API_TOKEN: ' tok \n' }, fetchImpl: rec.fetchImpl });
  assert.equal(rec.calls[0].url, `${CLOUDFLARE_AI_BASE}/acct%201%2Fx/ai/run/${MODEL}`);
  assert.equal(rec.calls[0].init.headers.Authorization, 'Bearer tok');
});

test('OC-3C transport: missing or blank credentials refuse BEFORE any request, naming what is missing', async () => {
  for (const env of [{}, { CLOUDFLARE_ACCOUNT_ID: 'a' }, { CLOUDFLARE_API_TOKEN: 't' }, { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: '   ' }]) {
    const rec = recorder();
    const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env, fetchImpl: rec.fetchImpl }));
    assert.ok(error instanceof CloudflareAiTransportError);
    assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
    assert.equal(error.retryable, false);
    assert.equal(rec.calls.length, 0, `${JSON.stringify(env)}: no provider capacity spent`);
    assert.deepEqual(error.missingEnv, CLOUDFLARE_REQUIRED_ENV.filter((name) => !String(env[name] ?? '').trim()));
    assert.match(error.message, /missing: CLOUDFLARE_/);
  }
  assert.equal(isCloudflareConfigured({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: ' ' }), false);
  assert.equal(isCloudflareConfigured(ENV), true);
  const creds = resolveCloudflareCredentials({ CLOUDFLARE_API_TOKEN: 'x' });
  assert.deepEqual(creds.missingEnv, ['CLOUDFLARE_ACCOUNT_ID']);
});

test('OC-3C transport: a model is required — no default model hides in the transport', async () => {
  const rec = recorder();
  const error = await rejection(invokeCloudflareModel({ body: BODY, env: ENV, fetchImpl: rec.fetchImpl }));
  assert.equal(error.code, 'AI_MODEL_REQUIRED');
  assert.equal(rec.calls.length, 0);
});

test('OC-3C transport: HTTP failures are classified, with Cloudflare\'s own error list, in ONE attempt', async () => {
  const table = [
    [400, 'AI_PROVIDER_REJECTED', false], [401, 'AI_PROVIDER_AUTH_FAILED', false], [403, 'AI_PROVIDER_AUTH_FAILED', false],
    [404, 'AI_PROVIDER_REJECTED', false], [429, 'AI_RATE_LIMITED', true], [500, 'AI_PROVIDER_UNAVAILABLE', true],
    [503, 'AI_PROVIDER_UNAVAILABLE', true], [529, 'AI_CAPACITY_UNAVAILABLE', true],
  ];
  for (const [status, code, retryable] of table) {
    const rec = recorder(() => json(status, { success: false, errors: [{ code: 7003, message: 'nope' }], result: null }));
    const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: rec.fetchImpl }));
    assert.equal(rec.calls.length, 1, `${status}: exactly one attempt — no retry`);
    assert.equal(error.code, code, `${status}`);
    assert.equal(error.retryable, retryable, `${status}`);
    assert.equal(error.status, status);
    assert.deepEqual(error.providerErrors, ['7003: nope']);
    assert.equal(error.message, '7003: nope');
    assert.deepEqual(classifyCloudflareFailure(status), { code, retryable });
  }
  // HTTP 200 that says success:false is still a failure.
  const rec = recorder(() => json(200, { success: false, errors: [{ code: 5006, message: 'bad input' }] }));
  const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: rec.fetchImpl }));
  assert.equal(error.code, 'AI_PROVIDER_ERROR');
  assert.equal(error.status, 200);
  // A failure with no parseable body names the status.
  const bare = recorder(() => new Response('<html>bad gateway</html>', { status: 502 }));
  const bareError = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: bare.fetchImpl }));
  assert.equal(bareError.message, 'Cloudflare Workers AI returned HTTP 502.');
  assert.deepEqual(bareError.providerErrors, []);
});

test('OC-3C transport: secrets are redacted from provider errors and transport failures', async () => {
  const leaky = recorder(() => json(403, { success: false, errors: [{ code: 10000, message: 'token token-test-456 is bad for acct-test-123' }] }));
  const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: leaky.fetchImpl }));
  const surface = JSON.stringify({ message: error.message, providerErrors: error.providerErrors, detail: error.detail });
  assert.ok(!surface.includes('token-test-456') && !surface.includes('acct-test-123'), surface);
  assert.match(error.message, /\[REDACTED\]/);

  const broken = async () => { throw new Error('connect ECONNRESET while sending Bearer token-test-456'); };
  const transportError = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: broken }));
  assert.equal(transportError.code, 'AI_TRANSPORT_ERROR');
  assert.equal(transportError.retryable, true);
  assert.ok(!transportError.message.includes('token-test-456'));
  assert.ok(!transportError.detail.includes('token-test-456'));
  // A real credential is redacted wherever it occurs, even inside a longer run of characters...
  assert.equal(redactSecrets('Bearer token-test-456 / xtoken-test-456x', ['token-test-456', '']), 'Bearer [REDACTED] / x[REDACTED]x');
  // ...while a short value is redacted only where it stands alone, so the message keeps its words.
  assert.equal(redactSecrets('Authentication error for t at /accounts/a/ai', ['t', 'a']),
    'Authentication error for [REDACTED] at /accounts/[REDACTED]/ai');
});

test('OC-3C transport: short fixture credentials do not corrupt Cloudflare\'s error text', async () => {
  const rec = recorder(() => json(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
  const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, fetchImpl: rec.fetchImpl }));
  assert.equal(error.message, '10000: Authentication error');
});

test('OC-3C transport: a hung provider is bounded — AI_TIMEOUT, retryable, and the request is aborted', async () => {
  const seen = {};
  const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: hangingFetch(seen), timeoutMs: 15 }));
  assert.equal(error.code, 'AI_TIMEOUT');
  assert.equal(error.retryable, true);
  assert.equal(error.timeoutMs, 15);
  assert.equal(error.message, 'Cloudflare Workers AI request timed out after 15ms.');
  assert.equal(seen.signal.aborted, true, 'the in-flight request was actually cancelled');
});

test('OC-3C transport: a caller abort is AI_ABORTED (not retryable), told apart from a timeout', async () => {
  const controller = new AbortController();
  const pending = invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: hangingFetch(), timeoutMs: 5_000, signal: controller.signal });
  controller.abort();
  const error = await rejection(pending);
  assert.equal(error.code, 'AI_ABORTED');
  assert.equal(error.retryable, false);
  const already = new AbortController(); already.abort();
  const early = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: hangingFetch(), signal: already.signal }));
  assert.equal(early.code, 'AI_ABORTED');
});

test('OC-3C transport: fetch is resolved at CALL time, so a runtime or test fetch is honoured', async () => {
  const rec = recorder();
  const saved = globalThis.fetch;
  globalThis.fetch = rec.fetchImpl;
  try {
    await invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV });
  } finally { globalThis.fetch = saved; }
  assert.equal(rec.calls.length, 1);
  const error = await rejection(invokeCloudflareModel({ model: MODEL, body: BODY, env: ENV, fetchImpl: { not: 'a function' } }));
  assert.equal(error.code, 'AI_TRANSPORT_UNAVAILABLE');
});

// ── 2. Both policies ride the transport, and send what they sent before ──────────────────────

// Captured from the PRE-convergence implementations (OCR CloudflareVisionClient @ 44d283e2; Gemma
// provider @ PR #217 6c8ff6f7) with the same inputs. A policy body that drifts fails here.
const GOLDEN_OCR_URL = 'https://api.cloudflare.com/client/v4/accounts/acct-golden/ai/run/@cf/qwen/qwen3.8-27b';
const GOLDEN_OCR_BODY = '{"max_tokens":2048,"temperature":0,"messages":[{"role":"system","content":"Read the document."},{"role":"user","content":[{"type":"text","text":"Return JSON."},{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD"}}]}]}';
const GOLDEN_GEMMA_URL = 'https://api.cloudflare.com/client/v4/accounts/acct-golden/ai/run/@cf/google/gemma-4-26b-a4b-it';
const GOLDEN_GEMMA_BODY = '{"messages":[{"role":"system","content":"Advise."},{"role":"user","content":"Summarise.\\n\\nReturn only one valid JSON value. Do not use Markdown fences or prose outside the JSON."}],"temperature":0,"max_tokens":4096}';
const GOLDEN_ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct-golden', CLOUDFLARE_API_TOKEN: 'tok-golden' };

test('OC-3C policy: the certified OCR request is byte-identical to the pre-convergence request', async () => {
  await withEnv(GOLDEN_ENV, async () => {
    const rec = recorder(() => ok({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9 } }));
    const saved = globalThis.fetch; globalThis.fetch = rec.fetchImpl;
    let out;
    try {
      out = await ocr.askCloudflareVision('Read the document.', 'Return JSON.', [{ mimeType: 'image/png', base64: 'QUJD' }], null, {});
    } finally { globalThis.fetch = saved; }
    assert.equal(rec.calls.length, 1);
    assert.equal(rec.calls[0].url, GOLDEN_OCR_URL);
    assert.equal(rec.calls[0].init.body, GOLDEN_OCR_BODY);
    assert.equal(rec.calls[0].init.headers.Authorization, 'Bearer tok-golden');
    // The OCR execution evidence is still the policy's own.
    assert.equal(out.content, '{"a":1}');
    assert.equal(out.usage.transportForm, 'contentPart');
    assert.equal(out.usage.promptTokens, 9);
    assert.equal(out.usage.finishReason, 'stop');
    assert.equal(out.usage.imageBytesSent, 4);
  });
});

test('OC-3C policy: the general Gemma request is byte-identical to PR #217\'s request', async () => {
  const rec = recorder();
  const out = await gemma.invokeCloudflareGemma({ systemPrompt: 'Advise.', userPrompt: 'Summarise.', expectJson: true, env: GOLDEN_ENV, fetchImpl: rec.fetchImpl });
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].url, GOLDEN_GEMMA_URL);
  assert.equal(rec.calls[0].init.body, GOLDEN_GEMMA_BODY);
  assert.deepEqual(out.provenance, { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' });
});

test('OC-3C policy: the OCR policy keeps its established failure wording on the shared transport', async () => {
  await withEnv(GOLDEN_ENV, async () => {
    const image = [{ mimeType: 'image/png', base64: 'QUJD' }];
    const saved = globalThis.fetch;
    try {
      globalThis.fetch = hangingFetch();
      const timeout = await rejection(ocr.askCloudflareVision('s', 'u', image, null, { timeoutMs: 20 }));
      assert.equal(timeout.message, 'Cloudflare Workers AI request timed out after 20ms');
      assert.equal(timeout.code, 'AI_TIMEOUT', 'and now says what kind of failure it was');
      assert.equal(timeout.retryable, true);

      globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
      const network = await rejection(ocr.askCloudflareVision('s', 'u', image));
      assert.equal(network.message, 'Cloudflare Workers AI request failed: getaddrinfo ENOTFOUND');

      globalThis.fetch = async () => json(429, { success: false, errors: [{ code: 3040, message: 'Capacity temporarily exceeded' }] });
      const refused = await rejection(ocr.askCloudflareVision('s', 'u', image));
      assert.equal(refused.message, 'Cloudflare Workers AI refused the request — 3040: Capacity temporarily exceeded');
      assert.equal(refused.code, 'AI_RATE_LIMITED');
      assert.equal(refused.status, 429);

      globalThis.fetch = async () => new Response('gateway down', { status: 502 });
      const bare = await rejection(ocr.askCloudflareVision('s', 'u', image));
      assert.equal(bare.message, 'Cloudflare Workers AI refused the request — HTTP 502');
    } finally { globalThis.fetch = saved; }
  });
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined }, async () => {
    const missing = await rejection(ocr.askCloudflareVision('s', 'u', [{ base64: 'QUJD' }]));
    assert.equal(missing.message, 'Cloudflare Workers AI unavailable: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are both required.');
  });
});

test('OC-3C policy: neither policy retries or falls back — one request on a 503, then a typed failure', async () => {
  await withEnv(GOLDEN_ENV, async () => {
    const rec = recorder(() => json(503, { success: false, errors: [{ code: 1001, message: 'unavailable' }] }));
    const saved = globalThis.fetch; globalThis.fetch = rec.fetchImpl;
    try { await rejection(ocr.askCloudflareVision('s', 'u', [{ base64: 'QUJD' }])); } finally { globalThis.fetch = saved; }
    assert.equal(rec.calls.length, 1, 'OCR: one attempt');
  });
  const rec = recorder(() => json(503, { success: false, errors: [{ code: 1001, message: 'unavailable' }] }));
  const out = await createCarUpAiGateway({ env: ENV, fetchImpl: rec.fetchImpl }).generateText({ userPrompt: 'x' });
  assert.equal(rec.calls.length, 1, 'gateway: one attempt');
  assert.equal(out.ok, false);
  assert.equal(out.machine_output, false);
  assert.equal(out.authority, 'advisory');
  assert.deepEqual(out.provenance, { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', execution: 'failed' });
});

// ── 3. OCR model authority is untouched ──────────────────────────────────────────────────────

test('OC-3C authority: certified OCR is still Cloudflare + Qwen, and the general gateway is not on the OCR path', () => {
  assert.equal(ocr.CLOUDFLARE_VISION_MODEL, '@cf/qwen/qwen3.8-27b');
  assert.equal(ocrProvider.DEFAULT_OCR_PROVIDER, 'cloudflare');
  assert.equal(ocrProvider.resolveCloudflareModel({}), '@cf/qwen/qwen3.8-27b', 'no OCR model override → Qwen');
  const provider = ocrProvider.resolveVisionProvider({ CARUP_OCR_PROVIDER: 'cloudflare', ...ENV });
  assert.equal(provider.id, 'cloudflare');
  assert.deepEqual(provider.requiredEnv, [...CLOUDFLARE_REQUIRED_ENV], 'the OCR policy names the transport\'s credentials');
  const ocrSource = read('../services/ai/ocrVisionProvider.js') + read('../services/ai/CloudflareVisionClient.js');
  assert.doesNotMatch(ocrSource, /carUpAiGateway|cloudflareGemmaProvider|aiRuntimeConfig/, 'OCR does not route through the general gateway');
  // ...and the general gateway is pinned to Gemma: it refuses the OCR model rather than borrowing it.
  assert.throws(() => gemma.createCloudflareGemmaProvider({ env: { ...ENV, CARUP_AI_MODEL: '@cf/qwen/qwen3.8-27b' } }).inspect(), (e) => e.code === 'AI_MODEL_UNSUPPORTED');
});

// ── 4. Source contract ────────────────────────────────────────────────────────────────────────

function servicesFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(here, '../services'));
  walk(path.join(here, '../routes'));
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('OC-3C source: only the transport builds a Workers AI run URL or reads the API token', () => {
  const runUrl = /\/ai\/run\//;
  const tokenRead = /\.CLOUDFLARE_API_TOKEN\b/;
  const files = servicesFiles();
  assert.ok(files.length > 100, `anti-vacuity: the scan walked ${files.length} runtime files`);
  const builders = files.filter((f) => runUrl.test(stripComments(readFileSync(f, 'utf8')))).map((f) => path.relative(path.join(here, '..'), f));
  const tokenReaders = files.filter((f) => tokenRead.test(stripComments(readFileSync(f, 'utf8')))).map((f) => path.relative(path.join(here, '..'), f));
  // Positive control: the transport itself is found by both patterns, so they match real code.
  assert.deepEqual(builders, ['services/ai/cloudflareAiTransport.js']);
  assert.deepEqual(tokenReaders, ['services/ai/cloudflareAiTransport.js']);
});

test('OC-3C source: both policies delegate the HTTP call; neither calls fetch itself', () => {
  for (const rel of ['../services/ai/CloudflareVisionClient.js', '../services/ai/cloudflareGemmaProvider.js']) {
    const code = stripComments(read(rel));
    assert.match(code, /invokeCloudflareModel\(/, `${rel} must call the shared transport`);
    assert.match(code, /from '\.\/cloudflareAiTransport\.js'/, `${rel} must import the shared transport`);
    assert.doesNotMatch(code, /\bfetch\(|fetchImpl\(|AbortSignal\.timeout|new AbortController/, `${rel} still carries its own HTTP machinery`);
  }
  const transportCode = stripComments(read('../services/ai/cloudflareAiTransport.js'));
  assert.match(transportCode, /doFetch\(cloudflareRunUrl/, 'positive control: the transport makes the call');
  assert.doesNotMatch(transportCode, /qwen|gemma|llama/i, 'the transport chooses no model');
  assert.doesNotMatch(transportCode, /console\.|logger\./, 'the transport logs nothing');
});

test('OC-3C provisioning: env.example documents both policies\' credentials and never enables the fixture switch', () => {
  // The certified OCR path has required CLOUDFLARE_API_TOKEN since OCR 1.0 while the template never
  // listed it — a server provisioned from it booted with OCR unconfigured.
  const template = read('../env.example');
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CARUP_OCR_PROVIDER', 'CARUP_OCR_MODEL', 'CARUP_AI_PROVIDER', 'CARUP_AI_MODEL']) {
    assert.match(template, new RegExp(`^${name}=`, 'm'), `env.example must document ${name}`);
  }
  assert.match(template, /^CARUP_AI_MODEL=@cf\/google\/gemma-4-26b-a4b-it$/m);
  assert.doesNotMatch(template, /^ALLOW_OCR_MOCK=true/m, 'the template must not switch on a test fixture');
  assert.doesNotMatch(template, /^OCR_(PRIMARY|FALLBACK)_PROVIDER=/m, 'retired OCR selectors are not live configuration');
  assert.doesNotMatch(template, /^(VITE|NEXT_PUBLIC|EXPO_PUBLIC)_CLOUDFLARE/m, 'no client-exposed Cloudflare credential');
});
