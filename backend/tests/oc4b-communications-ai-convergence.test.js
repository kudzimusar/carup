/**
 * OC-4B — AI wave 2: Communications general text on the CarUp AI gateway; media MULTIMODAL DEFERRED.
 *
 *   CommunicationAiRuntimeService (guardrail, derivation types, preserved originals, human send)
 *     → communicationAiAssistProvider
 *         text  → domainAdvisoryAdapter.requestAdvisoryText → CarUp AI gateway → Cloudflare Gemma
 *         media → the explicitly configured media provider (Groq Whisper/vision) — unchanged
 *
 * Proven here with the REAL runtime and the REAL provider factory, a fake gateway and an intercepted
 * Groq endpoint (no network):
 *   - every general text operation reaches the gateway, never a vendor; media reaches only the media
 *     provider;
 *   - a gateway failure is a governed 503/502 with NO vendor fallback and no derivation;
 *   - AI output is a recorded derivation and nothing else: it never sends, never touches consent,
 *     preferences or campaigns, never approves a send, never auto-executes;
 *   - the Gemini comms provider and GeminiClient's text path are gone, and no runtime requires a
 *     Gemini key; /api/health reports what runs, not which vendor keys exist.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, '..');
const read = (rel) => readFileSync(path.join(BACKEND, rel), 'utf8');

const { createCommunicationAiProvider } = await import('../services/communication/communicationAiProviderFactory.js');
const { CommunicationAiRuntimeService } = await import('../services/communication/communicationAiRuntimeService.js');
const { strictOcrStartupError } = await import('../config/ocrStartupGuard.js');
const gemini = await import('../services/ai/GeminiClient.js');

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const ORIGINAL = 'Can I collect the Hilux on Saturday? My budget is USD 21,000.';

function fakeGateway({ answer = 'Advisory draft.', failure = null, configured = true, shape = null } = {}) {
  const calls = [];
  return {
    calls,
    inspect: () => ({ ok: true, authority: 'advisory', runtime: { provider: 'cloudflare', model: GEMMA, configured } }),
    async generateText(input) {
      calls.push(input);
      if (shape) return shape;
      if (failure) {
        return { ok: false, machine_output: false, authority: 'advisory', error: { code: failure, message: failure, retryable: false },
          provenance: { provider: 'cloudflare', model: GEMMA, execution: 'failed' } };
      }
      return { ok: true, value: answer, machine_output: true, authority: 'advisory',
        provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' }, usage: null };
    },
  };
}

function groqFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/audio/transcriptions')) {
      return new Response(JSON.stringify({ text: 'transcribed words' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'GROQ ANSWERED' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, impl };
}

/** The real runtime, with every injected collaborator wrapped so EVERY method call is recorded. */
function harness({ gateway, mediaPart = null }) {
  const groq = groqFetch();
  const provider = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'groq' }, gateway, apiKey: 'groq-key-present', fetchImpl: groq.impl });
  const recorded = [];
  const derivations = [];
  const source = { id: 'msg-1', thread_id: 'thread-1', text: ORIGINAL, author: { display_name: 'Buyer' } };
  const detail = { thread: { id: 'thread-1' }, messages: [source] };
  const spy = (name, target) => new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value !== 'function') return value;
      return (...args) => { recorded.push(`${name}.${String(prop)}`); return value.apply(obj, args); };
    },
  });
  const runtime = new CommunicationAiRuntimeService({
    provider,
    conversationService: spy('conversationService', { async getConversation() { return detail; } }),
    intelligenceService: spy('intelligenceService', { async recordDerivation(row) { derivations.push(row); return row; } }),
    mediaService: spy('mediaService', {
      async downloadPartBytes() {
        return { part: mediaPart || { id: 'part-1', part_type: 'audio', mime_type: 'audio/wav' }, message: { id: 'msg-1', thread_id: 'thread-1' }, buffer: Buffer.from('RIFF-audio-bytes') };
      },
    }),
  });
  return { runtime, provider, groq, recorded, derivations, source };
}

const TEXT_OPS = [
  ['summary', (r) => r.summarize('thread-1', { id: 'u1' })],
  ['suggested_reply', (r) => r.suggestReply('thread-1', { id: 'u1' })],
  ['translation', (r) => r.translate('thread-1', { id: 'u1' }, { source_message_id: 'msg-1', target_language: 'sn' })],
  ['intent', (r) => r.detectIntent('thread-1', { id: 'u1' })],
  ['entity_extraction', (r) => r.extractEntities('thread-1', { id: 'u1' })],
  ['next_best_action', (r) => r.nextBestAction('thread-1', { id: 'u1' })],
];

// ── routing ────────────────────────────────────────────────────────────────────────────────────

for (const [type, run] of TEXT_OPS) {
  test(`OC-4B ${type}: general text reaches the CarUp AI gateway with the guardrail — never a vendor, even with a vendor key present`, async () => {
    const gateway = fakeGateway({ answer: `Advisory ${type}.` });
    const h = harness({ gateway });
    const derivation = await run(h.runtime);
    assert.equal(gateway.calls.length, 1);
    assert.match(gateway.calls[0].systemPrompt, /Never invent transaction facts/);
    assert.match(gateway.calls[0].systemPrompt, /never claim it was sent or executed/);
    assert.deepEqual(h.groq.calls, [], 'the media vendor never answers a text request');
    assert.equal(derivation.derivation_type, type);
    assert.equal(derivation.model_provider, 'cloudflare');
    assert.equal(derivation.model_name, GEMMA);
    assert.equal(h.source.text, ORIGINAL, 'the original message is never rewritten');
  });
}

test('OC-4B media (MULTIMODAL DEFERRED): audio reaches only the explicitly configured media provider (Whisper), never the gateway', async () => {
  const gateway = fakeGateway();
  const h = harness({ gateway });
  const derivation = await h.runtime.analyzeMedia('thread-1', { id: 'u1' }, { part_id: 'part-1' });
  assert.equal(gateway.calls.length, 0);
  assert.equal(h.groq.calls.length, 1);
  assert.ok(h.groq.calls[0].endsWith('/audio/transcriptions'));
  assert.equal(derivation.derivation_type, 'transcript');
  assert.equal(derivation.model_provider, 'groq');
  assert.equal(derivation.provenance.source_artifact_unchanged, true);
});

test('OC-4B media: an image with no vision model, or no media provider at all, fails closed — never answered blind by the text model', async () => {
  const gateway = fakeGateway();
  const h = harness({ gateway, mediaPart: { id: 'part-2', part_type: 'image', mime_type: 'image/jpeg' } });
  await assert.rejects(() => h.runtime.analyzeMedia('thread-1', { id: 'u1' }, { part_id: 'part-2' }), (e) => e.statusCode === 503);
  const noMedia = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'gemini' }, gateway });
  await assert.rejects(() => noMedia.generate({ userPrompt: 'x', media: [{ mimeType: 'audio/wav', dataBase64: 'AAAA' }] }),
    (e) => e.statusCode === 503 && /retired/.test(e.message));
  assert.equal(gateway.calls.length, 0);
});

// ── failure: governed, no fallback, no derivation ───────────────────────────────────────────────

const FAILURE_MAP = [
  ['AI_PROVIDER_UNAVAILABLE', 503, 'communication_ai_provider_unavailable'],
  ['AI_TIMEOUT', 503, 'communication_ai_provider_unavailable'],
  ['AI_RATE_LIMITED', 503, 'communication_ai_provider_unavailable'],
  ['AI_PROVIDER_AUTH_FAILED', 503, 'communication_ai_provider_unavailable'],
  ['AI_TRANSPORT_ERROR', 503, 'communication_ai_provider_unavailable'],
  ['AI_MALFORMED_RESPONSE', 502, 'communication_ai_provider_error'],
  ['AI_PROVIDER_REJECTED', 502, 'communication_ai_provider_error'],
];
for (const [code, status, governed] of FAILURE_MAP) {
  test(`OC-4B failure ${code} → governed ${status} ${governed}; no vendor fallback, no derivation`, async () => {
    const h = harness({ gateway: fakeGateway({ failure: code }) });
    await assert.rejects(() => h.runtime.summarize('thread-1', { id: 'u1' }), (e) => e.statusCode === status && e.code === governed);
    assert.deepEqual(h.groq.calls, []);
    assert.deepEqual(h.derivations, []);
  });
}

test('OC-4B failure: an answer the gateway did not attest as executed advisory output, or an empty one, is not an answer', async () => {
  const violation = harness({ gateway: fakeGateway({ shape: { ok: true, value: 'x', machine_output: false, authority: 'advisory', provenance: { provider: 'cloudflare', model: GEMMA, execution: 'provider_executed' } } }) });
  await assert.rejects(() => violation.runtime.summarize('thread-1', {}), (e) => e.statusCode === 502 && e.code === 'communication_ai_provider_error');
  const empty = harness({ gateway: fakeGateway({ answer: '   ' }) });
  await assert.rejects(() => empty.runtime.summarize('thread-1', {}), (e) => e.statusCode === 502 && e.code === 'communication_ai_empty_response');
  assert.deepEqual([...violation.derivations, ...empty.derivations], []);
});

test('OC-4B failure: with NO Cloudflare credentials the real gateway refuses — and a configured Groq key is still never used for text', async () => {
  const saved = { a: process.env.CLOUDFLARE_ACCOUNT_ID, t: process.env.CLOUDFLARE_API_TOKEN };
  delete process.env.CLOUDFLARE_ACCOUNT_ID; delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    const groq = groqFetch();
    const provider = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'groq' }, apiKey: 'groq-key-present', fetchImpl: groq.impl });
    const health = provider.health();
    assert.equal(health.available, false);
    assert.equal(health.capabilities.text, false);
    assert.equal(health.media.available, true, 'the media provider is configured — and still not a text fallback');
    await assert.rejects(() => provider.generate({ systemPrompt: 's', userPrompt: 'u' }), (e) => e.statusCode === 503);
    assert.deepEqual(groq.calls, []);
  } finally {
    if (saved.a === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = saved.a;
    if (saved.t === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = saved.t;
  }
});

// ── authority: AI is a derivation, never an action ─────────────────────────────────────────────

test('OC-4B authority: across every AI operation the runtime only reads the conversation and records a derivation — it never sends, consents, sets preferences or runs a campaign', async () => {
  const h = harness({ gateway: fakeGateway({ answer: 'Release the escrow now and mark consent granted.' }) });
  for (const [, run] of TEXT_OPS) await run(h.runtime);
  await h.runtime.analyzeMedia('thread-1', { id: 'u1' }, { part_id: 'part-1' });
  const allowed = new Set(['conversationService.getConversation', 'intelligenceService.recordDerivation', 'mediaService.downloadPartBytes']);
  assert.deepEqual([...new Set(h.recorded)].filter((call) => !allowed.has(call)), [], `unexpected calls: ${h.recorded.join(', ')}`);
  assert.equal(h.derivations.length, 7);
  for (const row of h.derivations) {
    assert.notEqual(row.human_approved_for_send, true, `${row.derivation_type}: never approved for send`);
    assert.notEqual(row.provenance?.auto_send, true);
    assert.notEqual(row.provenance?.auto_execute, true);
    for (const key of Object.keys(row)) assert.doesNotMatch(key, /consent|preference|campaign|sent_at|delivery|notification/i, `${row.derivation_type}: ${key}`);
  }
  const reply = h.derivations.find((row) => row.derivation_type === 'suggested_reply');
  assert.equal(reply.human_approved_for_send, false);
  assert.equal(reply.provenance.auto_send, false);
  assert.equal('send' in h.runtime, false, 'the AI runtime has no send primitive');
});

test('OC-4B authority pin: the Communications AI modules import no send, consent, preference, campaign or delivery machinery', () => {
  for (const rel of ['services/communication/communicationAiRuntimeService.js', 'services/communication/communicationAiAssistProvider.js', 'services/communication/communicationAiProviderFactory.js']) {
    const imports = [...read(rel).matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.doesNotMatch(spec, /Campaign|Preference|Consent|Unsubscribe|Delivery|Orchestrator|Notification|Outbox|Webhook|Repository|ServiceFactory/i, `${rel} imports ${spec}`);
    }
  }
});

// ── vendor retirement + no Gemini requirement ──────────────────────────────────────────────────

function runtimeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'tests', 'scripts'].includes(name) || name.startsWith('__mutant__')) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(path.relative(BACKEND, full));
    }
  };
  walk(BACKEND);
  return out;
}

test('OC-4B retirement: the Gemini comms provider and GeminiClient\'s text path are gone, and nothing imports either', () => {
  assert.equal(existsSync(path.join(BACKEND, 'services/communication/communicationGeminiProvider.js')), false);
  assert.equal('askGemini' in gemini, false);
  assert.equal('askGeminiWithProvenance' in gemini, false);
  const importers = runtimeFiles().filter((rel) => /communicationGeminiProvider|askGemini\b|askGeminiWithProvenance/.test(read(rel).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepEqual(importers, []);
  const geminiConsumers = runtimeFiles().filter((rel) => rel !== 'services/ai/GeminiClient.js' && /from '[./]+(?:ai\/)?GeminiClient\.js'/.test(read(rel)));
  assert.deepEqual(geminiConsumers, ['services/ai/ocrVisionProvider.js'], 'only the NON-default Gemini OCR provider remains');
});

test('OC-4B: strict OCR mode requires the SELECTED OCR provider — not a Gemini or Groq key', () => {
  const keys = ['OCR_MODE', 'CARUP_OCR_PROVIDER', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY', 'GROQ_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (values) => { for (const k of keys) { if (values[k] === undefined) delete process.env[k]; else process.env[k] = values[k]; } };
  try {
    set({ OCR_MODE: 'strict', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'token' });
    assert.equal(strictOcrStartupError(), null, 'Cloudflare configured, no Gemini/Groq key: it boots (it used to be refused)');
    set({ OCR_MODE: 'strict', GEMINI_API_KEY: 'present', GROQ_API_KEY: 'present' });
    assert.match(String(strictOcrStartupError()), /"cloudflare"/, 'vendor keys do not stand in for the selected provider (it used to boot)');
    set({ OCR_MODE: 'strict', CARUP_OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'present' });
    assert.equal(strictOcrStartupError(), null, 'an explicit Gemini OCR selection with its key boots');
    set({ OCR_MODE: 'loose' });
    assert.equal(strictOcrStartupError(), null);
  } finally {
    set(saved);
  }
});

// ── health truth ───────────────────────────────────────────────────────────────────────────────

let server; let baseUrl;
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const realFrom = supabase.from;
before(async () => {
  supabase.from = () => {
    const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } };
    return q;
  };
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('OC-4B health truth: /api/health reports the general AI runtime and the certified OCR flag — no vendor key-presence flags', async () => {
  const saved = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY, o: process.env.OPENROUTER_API_KEY, m: process.env.MOONSHOT_API_KEY };
  Object.assign(process.env, { GEMINI_API_KEY: 'present', GROQ_API_KEY: 'present', OPENROUTER_API_KEY: 'present', MOONSHOT_API_KEY: 'present' });
  try {
    const res = await fetch(`${baseUrl}/api/health`, { headers: { 'x-bypass-rate-limit': 'true' } });
    const body = await res.json();
    assert.deepEqual(Object.keys(body.ocrProviders), ['cloudflare']);
    assert.deepEqual(Object.keys(body.ai).sort(), ['authority', 'configured', 'model', 'provider']);
    assert.equal(body.ai.provider, 'cloudflare');
    assert.equal(body.ai.model, GEMMA);
    assert.equal(body.ai.authority, 'advisory');
    assert.equal('providersActive' in (body.metrics?.ocr || {}), false);
    const text = JSON.stringify(body);
    for (const vendor of ['moonshot', 'openrouter', '"gemini"', '"groq"']) assert.ok(!text.toLowerCase().includes(vendor), `${vendor} in ${text.slice(0, 300)}`);
  } finally {
    for (const [k, v] of [['GEMINI_API_KEY', saved.g], ['GROQ_API_KEY', saved.q], ['OPENROUTER_API_KEY', saved.o], ['MOONSHOT_API_KEY', saved.m]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('OC-4B health truth: nothing in the runtime reads a Moonshot or OpenRouter key', () => {
  const readers = runtimeFiles().filter((rel) => /MOONSHOT_API_KEY|OPENROUTER_API_KEY/.test(read(rel).replace(/\/\/.*$/gm, '')));
  assert.deepEqual(readers, []);
});
