/**
 * OC-5R-REL-02 E — Gemma latency convergence.
 *
 * What the REL-01 deployed proof found: the real Marketplace buyer-assistant path answered
 * `ai_unavailable` after 13.35 s against its 12 s bound. Gemma 4 reasons by default; for the
 * assistant's own request that is ~16 s of hidden reasoning, versus ~2.7 s with
 * `chat_template_kwargs.enable_thinking: false` (measured against the account API, outside the governed
 * path — a diagnostic, not evidence).
 *
 * The fix is to the Gemma POLICY, and only to it:
 *
 *   · the Gemma request body gains ONE field, intentionally: `chat_template_kwargs: { enable_thinking:
 *     false }`. This is the only change from PR #217's body. Interactive CarUp advisory calls need
 *     bounded latency, and hidden model reasoning is not itself a CarUp product output or authority;
 *   · the shared transport (cloudflareAiTransport.js) still sends every policy's body VERBATIM and
 *     knows nothing about this field; the OCR/Qwen body is byte-identical to before and does not inherit
 *     it;
 *   · model and provider stay pinned; exactly ONE attempt; no fallback vendor; provenance unchanged;
 *   · the Marketplace's 12 s bound is NOT lengthened;
 *   · a degraded Marketplace answer whose AI call TIMED OUT now says so — `ai_reason: 'ai_timeout'` —
 *     and ONLY a timeout does: sign-in required, oversized input, valuation, withheld output and every
 *     other failure keep their existing vocabulary.
 *
 * The golden strings below were captured at the commit BEFORE this change (6fb12461), so "byte-identical"
 * is measured against a real baseline rather than asserted from the new code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

const { CARUP_AI_MODEL, CARUP_AI_PROVIDER, resolveAiRuntimeConfig } = await import('../services/ai/aiRuntimeConfig.js');
const { buildGemmaRequestBody, createCloudflareGemmaProvider } = await import('../services/ai/cloudflareGemmaProvider.js');
const { createCarUpAiGateway } = await import('../services/ai/carUpAiGateway.js');
const { invokeCloudflareModel } = await import('../services/ai/cloudflareAiTransport.js');
const { buildCloudflareRequestBody } = await import('../services/ai/CloudflareVisionClient.js');
const { requestAdvisoryJson, AiAdvisoryError } = await import('../services/ai/domainAdvisoryAdapter.js');
const assistant = await import('../services/marketplace/marketplaceAiAssistantService.js');

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const QWEN = '@cf/qwen/qwen3.8-27b';
const ENV = Object.freeze({
  CARUP_AI_PROVIDER: 'cloudflare', CARUP_AI_MODEL: GEMMA,
  CLOUDFLARE_ACCOUNT_ID: 'acct-test-123', CLOUDFLARE_API_TOKEN: 'token-test-456',
});
const IMAGE = Object.freeze({ mimeType: 'image/png', base64: 'QUJDRA==' });

// ── Golden bodies, captured BEFORE the change (commit 6fb12461) ─────────────────────────────────
const GOLDEN_217_TEXT = '{"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":"USER"}],"temperature":0,"max_tokens":4096}';
const GOLDEN_217_JSON = '{"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":"USER\\n\\nReturn only one valid JSON value. Do not use Markdown fences or prose outside the JSON."}],"temperature":0,"max_tokens":4096}';
const GOLDEN_217_IMAGE = '{"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":[{"type":"text","text":"Describe"},{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJDRA=="}}]}],"temperature":0,"max_tokens":4096}';
const GOLDEN_QWEN = '{"max_tokens":2048,"temperature":0,"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":[{"type":"text","text":"TEXT"},{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJDRA=="}}]}]}';
const GOLDEN_QWEN_1500 = '{"max_tokens":1500,"temperature":0,"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":[{"type":"text","text":"TEXT"},{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJDRA=="}}]}]}';
const GOLDEN_GEMMA_VIA_VISION_CLIENT = '{"max_tokens":4096,"temperature":0,"messages":[{"role":"system","content":"SYSTEM"},{"role":"user","content":[{"type":"text","text":"TEXT"},{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJDRA=="}}]}]}';

const NO_REASONING = { enable_thinking: false };
const withoutField = (body) => { const { chat_template_kwargs, ...rest } = body; return rest; };

/** A fetch that records each call and answers with `answer`. */
function recorder(answer) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return answer(url, init); } };
}
const ok = (content, usage = null) => new Response(JSON.stringify({ success: true, errors: [], result: { choices: [{ message: { content }, finish_reason: 'stop' }], ...(usage ? { usage } : {}) } }), { status: 200, headers: { 'content-type': 'application/json' } });

// ── The golden request contract: #217's body plus exactly ONE intentional field ──────────────────
test('E — Gemma text body: #217\'s body plus chat_template_kwargs.enable_thinking=false, nothing else', () => {
  const body = buildGemmaRequestBody({ systemPrompt: 'SYSTEM', userPrompt: 'USER' });
  assert.deepEqual(body, { ...JSON.parse(GOLDEN_217_TEXT), chat_template_kwargs: NO_REASONING });
  assert.equal(JSON.stringify(withoutField(body)), GOLDEN_217_TEXT, 'removing the one intentional field restores #217\'s body byte for byte');
});

test('E — Gemma JSON body: the same single intentional field, #217\'s JSON instruction unchanged', () => {
  const body = buildGemmaRequestBody({ systemPrompt: 'SYSTEM', userPrompt: 'USER', expectJson: true });
  assert.deepEqual(body.chat_template_kwargs, NO_REASONING);
  assert.equal(JSON.stringify(withoutField(body)), GOLDEN_217_JSON);
  assert.equal(body.response_format, undefined, 'no response_format was invented');
});

test('E — Gemma image body: the policy is uniform across text, JSON and image', () => {
  const body = buildGemmaRequestBody({ systemPrompt: 'SYSTEM', userPrompt: 'Describe', image: IMAGE });
  assert.deepEqual(body.chat_template_kwargs, NO_REASONING);
  assert.equal(JSON.stringify(withoutField(body)), GOLDEN_217_IMAGE);
});

test('E — the switch is the provider-documented property, set to boolean false (not "false", not omitted)', () => {
  for (const request of [{ userPrompt: 'U' }, { userPrompt: 'U', expectJson: true }, { userPrompt: 'U', image: IMAGE }]) {
    const { chat_template_kwargs: kwargs } = buildGemmaRequestBody(request);
    assert.deepEqual(Object.keys(kwargs), ['enable_thinking']);
    assert.strictEqual(kwargs.enable_thinking, false);
  }
});

// ── Thinking is disabled on what is actually SENT: through the real gateway, provider and transport ─
test('E — advisory TEXT through the gateway sends enable_thinking=false to the Gemma model URL', async () => {
  const rec = recorder(() => ok('hello'));
  const out = await createCarUpAiGateway({ env: ENV, fetchImpl: rec.fetchImpl }).generateText({ systemPrompt: 'S', userPrompt: 'U' });
  assert.equal(out.ok, true);
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].url, `https://api.cloudflare.com/client/v4/accounts/acct-test-123/ai/run/${GEMMA}`);
  assert.deepEqual(rec.calls[0].body.chat_template_kwargs, NO_REASONING);
});

test('E — advisory JSON through the gateway sends enable_thinking=false, and still returns the parsed value', async () => {
  const rec = recorder(() => ok('{"guidance":["a"]}'));
  const out = await createCarUpAiGateway({ env: ENV, fetchImpl: rec.fetchImpl }).generateJson({ systemPrompt: 'S', userPrompt: 'U' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { guidance: ['a'] });
  assert.deepEqual(rec.calls[0].body.chat_template_kwargs, NO_REASONING);
  assert.match(rec.calls[0].body.messages[1].content, /Return only one valid JSON value/);
});

test('E — the provider path sends the same body whatever the caller passes (no caller can re-enable reasoning)', async () => {
  const rec = recorder(() => ok('hello'));
  const provider = createCloudflareGemmaProvider({ env: ENV, fetchImpl: rec.fetchImpl });
  await provider.generate({ userPrompt: 'U', chat_template_kwargs: { enable_thinking: true }, enable_thinking: true });
  assert.deepEqual(rec.calls[0].body.chat_template_kwargs, NO_REASONING, 'the policy owns the field');
  assert.equal(rec.calls[0].body.enable_thinking, undefined);
});

// ── The transport stays generic ───────────────────────────────────────────────────────────────────
test('E — the transport sends a policy body VERBATIM: it neither adds nor strips chat_template_kwargs', async () => {
  const bare = { messages: [{ role: 'user', content: 'x' }], temperature: 0, max_tokens: 5 };
  const withField = { ...bare, chat_template_kwargs: { enable_thinking: true } };
  for (const body of [bare, withField]) {
    const rec = recorder(() => ok('ok'));
    await invokeCloudflareModel({ model: GEMMA, body, env: ENV, fetchImpl: rec.fetchImpl });
    assert.equal(rec.calls[0].init.body, JSON.stringify(body), 'byte for byte');
  }
});

test('E — the transport and the OCR vision client contain no reasoning policy at all', () => {
  for (const file of ['../services/ai/cloudflareAiTransport.js', '../services/ai/CloudflareVisionClient.js']) {
    const source = read(file);
    assert.ok(!/chat_template_kwargs|enable_thinking/.test(source), `${file} must not know about Gemma's reasoning switch`);
  }
  assert.match(read('../services/ai/cloudflareGemmaProvider.js'), /chat_template_kwargs: \{ enable_thinking: false \}/);
});

// ── OCR / Qwen: byte-identical, and never inherits the field ──────────────────────────────────────
test('E — the OCR/Qwen request body is byte-identical to the pre-change baseline', () => {
  const body = (extra = {}) => JSON.stringify(buildCloudflareRequestBody({ model: QWEN, systemPrompt: 'SYSTEM', textPrompt: 'TEXT', image: IMAGE, ...extra }));
  assert.equal(body(), GOLDEN_QWEN);
  assert.equal(body({ maxTokens: 1500 }), GOLDEN_QWEN_1500);
  assert.equal(body({ jsonSchema: { name: 's', schema: { type: 'object' } } }), GOLDEN_QWEN, 'Qwen takes no response_format, as before');
  for (const text of [GOLDEN_QWEN, body()]) assert.ok(!text.includes('chat_template_kwargs') && !text.includes('enable_thinking'));
});

test('E — the vision client\'s own Gemma-model body (the OCR policy path) is unchanged too', () => {
  const body = JSON.stringify(buildCloudflareRequestBody({ model: GEMMA, systemPrompt: 'SYSTEM', textPrompt: 'TEXT', image: IMAGE }));
  assert.equal(body, GOLDEN_GEMMA_VIA_VISION_CLIENT);
});

// ── Pinned model and provider, one attempt, no fallback, provenance unchanged ─────────────────────
test('E — model and provider stay pinned', () => {
  assert.equal(CARUP_AI_MODEL, GEMMA);
  assert.equal(CARUP_AI_PROVIDER, 'cloudflare');
  assert.throws(() => resolveAiRuntimeConfig({ ...ENV, CARUP_AI_MODEL: QWEN }), /pinned to "@cf\/google\/gemma-4-26b-a4b-it"/);
  assert.throws(() => resolveAiRuntimeConfig({ ...ENV, CARUP_AI_PROVIDER: 'gemini' }), /cloudflare/i);
});

test('E — exactly ONE attempt and no fallback: a failing Gemma call is never retried or sent elsewhere', async () => {
  for (const answer of [
    () => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: 'boom' }] }), { status: 500, headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('socket hang up'); },
  ]) {
    const rec = recorder(answer);
    const out = await createCarUpAiGateway({ env: ENV, fetchImpl: rec.fetchImpl }).generateText({ systemPrompt: 'S', userPrompt: 'U' });
    assert.equal(out.ok, false);
    assert.equal(rec.calls.length, 1, 'one attempt, no retry');
    assert.ok(rec.calls.every((c) => c.url.endsWith(`/ai/run/${GEMMA}`)), 'no other model or vendor was tried');
  }
});

test('E — provenance is unchanged: cloudflare / Gemma / provider_executed, advisory machine output', async () => {
  const rec = recorder(() => ok('hello', { prompt_tokens: 3 }));
  const out = await createCarUpAiGateway({ env: ENV, fetchImpl: rec.fetchImpl }).generateText({ systemPrompt: 'S', userPrompt: 'U' });
  assert.deepEqual(out.provenance, { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' });
  assert.equal(out.machine_output, true);
  assert.equal(out.authority, 'advisory');
  assert.equal(out.usage.prompt_tokens, 3);
});

// ── The Marketplace bound is NOT lengthened ───────────────────────────────────────────────────────
test('E — the buyer-assistant bound is still 12 seconds (latency was fixed in the policy, not by waiting longer)', () => {
  const source = read('../services/marketplace/marketplaceAiAssistantService.js');
  assert.match(source, /const AI_TIMEOUT_MS = 12000;/);
  assert.ok(!/timeoutMs:\s*\d{5,}/.test(source), 'no longer literal timeout was introduced');
});

// ── ai_timeout: named when, and ONLY when, the AI call timed out ──────────────────────────────────
const failingGateway = (code, extra = {}) => ({
  async generateJson() {
    return { ok: false, error: { code, message: `simulated ${code}`, retryable: code === 'AI_TIMEOUT', ...extra }, provenance: { provider: 'cloudflare', model: GEMMA, execution: 'failed' } };
  },
});
const BUYER = { use_case: 'a used diesel pickup for a farm', question: 'What should I check before paying?' };
const LISTING = { make: 'toyota', model: 'hilux', year: 2020, price: 26500 };
const MODERATION = { listingSummary: { vin: 'JTHLCCHR030628462' }, trustSummary: { risk_status: 'clear' } };
const FUNCTIONS = {
  buyerAssistant: (gateway) => assistant.buyerAssistant(BUYER, { gateway }),
  listingDraft: (gateway) => assistant.listingDraft(LISTING, { gateway }),
  shareCopy: (gateway) => assistant.shareCopy(LISTING, { gateway }),
  moderationSummary: (gateway) => assistant.moderationSummary(MODERATION, { gateway }),
};

test('E — the real chain maps a genuine transport timeout to AI_TIMEOUT (nothing is faked above the fetch)', async () => {
  const neverUntilAborted = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const gateway = createCarUpAiGateway({ env: ENV, fetchImpl: neverUntilAborted });
  await assert.rejects(
    requestAdvisoryJson({ systemPrompt: 'S', userPrompt: 'U', timeoutMs: 25, purpose: 'marketplace assistant' }, { gateway }),
    (error) => error instanceof AiAdvisoryError && error.code === 'AI_TIMEOUT' && error.retryable === true,
  );
});

for (const [name, run] of Object.entries(FUNCTIONS)) {
  test(`E — ${name}: an AI_TIMEOUT degrades to the deterministic answer with ai_reason 'ai_timeout'`, async () => {
    const out = await run(failingGateway('AI_TIMEOUT'));
    assert.equal(out.ai_status, 'ai_unavailable');
    assert.equal(out.ai_available, false);
    assert.equal(out.ai_reason, 'ai_timeout');
    assert.equal(out.ai_provenance, undefined, 'no provenance is claimed for an answer the model did not give');
    assert.ok(Object.keys(out).length > 3, 'the deterministic answer is still there');
  });

  test(`E — ${name}: every OTHER failure keeps the deterministic answer with NO reason (a timeout is not an outage)`, async () => {
    for (const code of ['AI_PROVIDER_UNAVAILABLE', 'AI_TRANSPORT_ERROR', 'AI_MALFORMED_RESPONSE', 'AI_GATEWAY_ERROR', 'AI_ABORTED', 'AI_RATE_LIMITED', 'AI_AUTH_FAILED', 'AI_PROVIDER_ERROR']) {
      const out = await run(failingGateway(code));
      assert.equal(out.ai_status, 'ai_unavailable', code);
      assert.equal(out.ai_available, false, code);
      assert.ok(!('ai_reason' in out), `${code} must not be reported as a timeout or anything else`);
    }
  });
}

test('E — the reason vocabulary is preserved: sign-in, oversized input, valuation and withheld output', async () => {
  // anonymous / merely-asserted callers: no provider call, 'sign_in_required' — and never relabelled
  const timingOut = failingGateway('AI_TIMEOUT');
  const anonymous = await assistant.buyerAssistant(BUYER, { ...assistant.NO_PAID_INFERENCE, gateway: timingOut });
  assert.equal(anonymous.ai_reason, 'sign_in_required');
  // oversized input: no provider call, 'input_too_large'
  const oversized = await assistant.buyerAssistant({ question: 'x'.repeat(assistant.MAX_AI_INPUT_CHARS + 1) }, { gateway: timingOut });
  assert.equal(oversized.ai_reason, 'input_too_large');
  // the price estimate makes no provider call at all
  assert.equal((await assistant.priceEstimate({ listingSummary: { price: 20000 } })).ai_reason, 'valuation_not_configured');
  // every guidance line makes a valuation claim -> withheld, and said so
  const withheld = await assistant.buyerAssistant(BUYER, { aiCall: async () => ({ guidance: ['This truck is worth US$18,000.'] }) });
  assert.equal(withheld.ai_reason, 'ai_output_withheld');
  assert.equal(assistant.AI_TIMEOUT_REASON, 'ai_timeout');
});

test('E — a caller that never reached the model is never relabelled a timeout, even if a call reported one', async () => {
  // A policy that already carries its own reason keeps it: the reason it never spent capacity is the truer one.
  const reportsTimeout = async (_system, _user, { outcome }) => { outcome.reason = 'ai_timeout'; return null; };
  const out = await assistant.buyerAssistant(BUYER, { aiCall: reportsTimeout, aiReason: 'input_too_large' });
  assert.equal(out.ai_reason, 'input_too_large');
  // …while an ordinary policy adopts it
  const adopted = await assistant.buyerAssistant(BUYER, { aiCall: reportsTimeout });
  assert.equal(adopted.ai_reason, 'ai_timeout');
});

test('E — a successful answer is untouched: ai_assisted, available, with provenance, and no reason', async () => {
  const gateway = {
    async generateJson() {
      return { ok: true, value: { guidance: ['Check the service book.', 'Inspect the engine bay for leaks.'] }, provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' }, machine_output: true, authority: 'advisory', usage: null };
    },
  };
  const out = await assistant.buyerAssistant(BUYER, { gateway });
  assert.equal(out.ai_status, 'ai_assisted');
  assert.equal(out.ai_available, true);
  assert.deepEqual(out.ai_provenance, { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' });
  assert.ok(!('ai_reason' in out));
});
