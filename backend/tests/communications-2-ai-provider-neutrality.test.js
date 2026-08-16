import { test } from 'node:test';
import assert from 'node:assert';

import { CommunicationGroqProvider, audioFileName } from '../services/communication/communicationGroqProvider.js';
import { createCommunicationAiProvider, SUPPORTED_AI_PROVIDERS } from '../services/communication/communicationAiProviderFactory.js';
import { CommunicationAiRuntimeService } from '../services/communication/communicationAiRuntimeService.js';

/**
 * Communications AI must be provider-neutral: the canonical plan requires a REAL provider with
 * labelled derivations, preserved originals and governed high-risk decisions — not one named
 * vendor. These tests pin the boundary, and above all pin that an unavailable provider can never
 * look like a successful one.
 */

const KEY = 'groq-secret-key-must-never-appear';

function captureFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, impl };
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const chatOk = (text) => jsonResponse({ choices: [{ message: { content: text } }] });

// ── 1. explicit provider selection ────────────────────────────────────────────────────────────
test('provider selection is explicit and supports groq and gemini', () => {
  assert.deepEqual(SUPPORTED_AI_PROVIDERS.sort(), ['gemini', 'groq']);

  const groq = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'groq' }, apiKey: KEY, fetchImpl: async () => {} });
  assert.equal(groq.health().provider, 'groq');

  const gemini = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'gemini' }, apiKey: KEY, fetchImpl: async () => {} });
  assert.equal(gemini.health().provider, 'google', 'the existing Gemini provider is preserved, not deleted');
});

test('an unrecognised provider fails closed instead of silently substituting another vendor', async () => {
  const provider = createCommunicationAiProvider({ env: { COMMUNICATION_AI_PROVIDER: 'definitely-not-a-provider' } });
  const health = provider.health();
  assert.equal(health.available, false);
  assert.equal(health.mode, 'unconfigured');
  await assert.rejects(() => provider.generate({ userPrompt: 'x' }), (e) => e.statusCode === 503 && e.code === 'communication_ai_provider_unavailable');
});

// ── 2. health only when genuinely configured ─────────────────────────────────────────────────
test('groq health is available only with a key and a fetch implementation', () => {
  assert.equal(new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => {} }).health().available, true);
  assert.equal(new CommunicationGroqProvider({ apiKey: '', fetchImpl: async () => {} }).health().available, false);
  assert.equal(new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: null }).health().available, false);
});

test('health reports capabilities truthfully — vision is not claimed without a vision model', () => {
  const noVision = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => {}, visionModel: null }).health();
  assert.equal(noVision.multimodal, false, 'an account with no vision model must not advertise multimodal');
  assert.equal(noVision.capabilities.vision, false);
  assert.equal(noVision.capabilities.text, true);
  assert.equal(noVision.capabilities.audio_transcription, true);

  const withVision = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => {}, visionModel: 'some-vision-model' }).health();
  assert.equal(withVision.multimodal, true);
  assert.equal(withVision.capabilities.vision, true);
});

// ── 3. no key exposure ───────────────────────────────────────────────────────────────────────
test('the API key never appears in health, results or errors', async () => {
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => chatOk('hello') });
  assert.ok(!JSON.stringify(provider.health()).includes(KEY));

  const ok = await provider.generate({ userPrompt: 'hi' });
  assert.ok(!JSON.stringify(ok).includes(KEY));

  const failing = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => { throw new Error(`boom ${KEY}`); } });
  await assert.rejects(() => failing.generate({ userPrompt: 'hi' }), (error) => {
    assert.ok(!String(error.message).includes(KEY), 'a provider transport error must not leak the key');
    return true;
  });

  const http = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => jsonResponse({ error: { message: 'bad' } }, 401) });
  await assert.rejects(() => http.generate({ userPrompt: 'hi' }), (error) => !String(error.message).includes(KEY));
});

// ── 4. text payload construction ─────────────────────────────────────────────────────────────
test('text requests go to chat/completions with the guardrail as a system message', async () => {
  const { calls, impl } = captureFetch(() => chatOk('a summary'));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl, textModel: 'llama-3.3-70b-versatile' });

  const result = await provider.generate({ systemPrompt: 'GUARDRAIL', userPrompt: 'summarise this' });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/openai\/v1\/chat\/completions$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'GUARDRAIL' });
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content, 'summarise this');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(result, { text: 'a summary', provider: 'groq', model: 'llama-3.3-70b-versatile' });
});

// ── 5. image / base64 payload construction ───────────────────────────────────────────────────
test('an image is sent as a data URL to the vision model, never as a public link', async () => {
  const { calls, impl } = captureFetch(() => chatOk('an image description'));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl, visionModel: 'vision-model' });

  const result = await provider.generate({
    systemPrompt: 'GUARDRAIL',
    userPrompt: 'describe',
    media: [{ mimeType: 'image/png', dataBase64: 'QUJD' }],
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'vision-model', 'vision uses its own configured model');
  const parts = body.messages[1].content;
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, 'data:image/png;base64,QUJD', 'the stored artifact must not be turned into a public URL');
  assert.equal(result.model, 'vision-model', 'provenance reports the model actually used');
});

test('an image without a configured vision model fails closed rather than answering blind', async () => {
  const { calls, impl } = captureFetch(() => chatOk('should never happen'));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl, visionModel: null });

  await assert.rejects(
    () => provider.generate({ userPrompt: 'describe', media: [{ mimeType: 'image/png', dataBase64: 'QUJD' }] }),
    (e) => e.statusCode === 503 && e.code === 'communication_ai_provider_unavailable',
  );
  assert.equal(calls.length, 0, 'it must not silently downgrade to a text-only call about an unseen image');
});

// ── 6. audio transcription path ──────────────────────────────────────────────────────────────
test('audio goes to the transcription endpoint as a file, not flattened into a chat prompt', async () => {
  const { calls, impl } = captureFetch(() => jsonResponse({ text: 'transcribed words' }));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl, audioModel: 'whisper-large-v3' });

  const result = await provider.generate({
    systemPrompt: 'GUARDRAIL',
    userPrompt: 'transcribe',
    media: [{ mimeType: 'audio/wav', dataBase64: Buffer.from('RIFFfake').toString('base64') }],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/openai\/v1\/audio\/transcriptions$/, 'must use the audio endpoint');
  assert.ok(calls[0].init.body instanceof FormData, 'the artifact is uploaded, not stringified into a prompt');
  assert.equal(calls[0].init.body.get('model'), 'whisper-large-v3');
  const file = calls[0].init.body.get('file');
  assert.ok(file, 'the audio file itself must be attached');
  // Whisper validates by FILENAME, not by bytes or content-type. A real WAV uploaded as "audio"
  // is rejected with "file must be one of the following types: [...]" — found in live staging,
  // not by this suite, which originally only asserted that *a* file was attached.
  assert.equal(file.name, 'audio.wav', 'the upload must carry an extension the provider accepts');
  assert.deepEqual(result, { text: 'transcribed words', provider: 'groq', model: 'whisper-large-v3' });
});

test('an unsupported media type fails closed instead of being interpreted anyway', async () => {
  const { calls, impl } = captureFetch(() => chatOk('should never happen'));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl, visionModel: 'vision-model' });

  await assert.rejects(
    () => provider.generate({ userPrompt: 'read this', media: [{ mimeType: 'application/pdf', dataBase64: 'QUJD' }] }),
    (e) => e.statusCode === 503 && /cannot interpret media type application\/pdf/.test(e.message),
  );
  assert.equal(calls.length, 0);
});

// ── 7 & 8. provider errors and empty results fail closed ─────────────────────────────────────
test('a provider HTTP error fails closed with the governed status', async () => {
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => jsonResponse({ error: { message: 'rate limited' } }, 429) });
  await assert.rejects(() => provider.generate({ userPrompt: 'hi' }), (e) => e.statusCode === 502 && e.code === 'communication_ai_provider_error');
});

test('an empty provider result fails closed rather than persisting a blank derivation', async () => {
  for (const body of [{ choices: [{ message: { content: '' } }] }, { choices: [] }, {}]) {
    const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(() => provider.generate({ userPrompt: 'hi' }), (e) => e.code === 'communication_ai_empty_response');
  }
  const audio = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: async () => jsonResponse({ text: '   ' }) });
  await assert.rejects(
    () => audio.generate({ media: [{ mimeType: 'audio/wav', dataBase64: 'QUJD' }] }),
    (e) => e.code === 'communication_ai_empty_response',
  );
});

// ── 9-15. runtime behaviour through the real service ─────────────────────────────────────────
function runtimeHarness({ generate, messages = [], part = null } = {}) {
  const derivations = [];
  const detail = { thread: { id: 'thread-1', business_workflow: 'marketplace' }, messages };
  const service = new CommunicationAiRuntimeService({
    provider: { health: () => ({ provider: 'groq', model: 'llama-3.3-70b-versatile', available: true, mode: 'real' }), generate },
    conversationService: { async getConversation() { return detail; } },
    intelligenceService: { async recordDerivation(row) { derivations.push(row); return row; } },
    mediaService: part
      ? { async downloadPartBytes() { return { part, message: { id: 'msg-1', thread_id: 'thread-1' }, buffer: Buffer.from('artifact-bytes') }; } }
      : null,
  });
  return { service, derivations };
}

const MESSAGE = (text) => ({ id: 'msg-1', direction: 'inbound', text, created_at: '2026-08-13T00:00:00Z' });

test('provider and model provenance is persisted on every derivation', async () => {
  const { service, derivations } = runtimeHarness({
    generate: async () => ({ text: 'derived output', provider: 'groq', model: 'llama-3.3-70b-versatile' }),
    messages: [MESSAGE('Original buyer text — unchanged.')],
  });

  await service.summarize('thread-1', { id: 'admin-1' });
  assert.equal(derivations.length, 1);
  const [row] = derivations;
  assert.equal(row.model_provider, 'groq', 'the provider actually used is recorded');
  assert.equal(row.model_name, 'llama-3.3-70b-versatile', 'the model actually used is recorded');
  assert.equal(row.derivation_type, 'summary');
  assert.equal(row.provenance.runtime, 'communications_ai_assist');
});

test('the original canonical message is never mutated by a derivation', async () => {
  const original = 'Original buyer text — unchanged.';
  const message = MESSAGE(original);
  const { service, derivations } = runtimeHarness({
    generate: async () => ({ text: 'a completely different summary', provider: 'groq', model: 'm' }),
    messages: [message],
  });

  await service.summarize('thread-1', { id: 'admin-1' });
  assert.equal(message.text, original, 'the source message must be byte-identical afterwards');
  assert.notEqual(derivations[0].output_text, original, 'the derivation is separate content, not a rewrite of the original');
});

test('the original media artifact is never mutated by analysis', async () => {
  const part = { id: 'part-1', part_type: 'image', mime_type: 'image/png', storage_key: 'k', sha256: 'abc', original: true };
  const snapshot = JSON.stringify(part);
  const { service, derivations } = runtimeHarness({
    generate: async () => ({ text: 'an image description', provider: 'groq', model: 'vision-model' }),
    messages: [MESSAGE('see attached')],
    part,
  });

  await service.analyzeMedia('thread-1', { id: 'admin-1' }, { part_id: 'part-1' });
  assert.equal(JSON.stringify(part), snapshot, 'the stored artifact row must be untouched');
  const row = derivations[0];
  assert.equal(row.provenance.source_part_id, 'part-1', 'the derivation points back at the artifact it came from');
  assert.equal(row.provenance.source_artifact_unchanged, true);
  assert.equal(row.model_name, 'vision-model');
});

test('a suggested reply is never marked approved for sending', async () => {
  const { service, derivations } = runtimeHarness({
    generate: async () => ({ text: 'Suggested: we will look into it.', provider: 'groq', model: 'm' }),
    messages: [MESSAGE('where is my car?')],
  });

  await service.suggestReply('thread-1', { id: 'admin-1' }, {});
  const row = derivations[0];
  assert.equal(row.human_approved_for_send, false, 'AI output must never self-approve for sending');
  assert.equal(row.provenance.auto_send, false);
  assert.equal(row.derivation_type, 'suggested_reply', 'it is persisted as a derivation, not as an outbound message');
});

test('next-best action never carries auto-execute', async () => {
  const { service, derivations } = runtimeHarness({
    generate: async () => ({ text: 'Next: escalate to a human agent.', provider: 'groq', model: 'm' }),
    messages: [MESSAGE('refund me now')],
  });

  await service.nextBestAction('thread-1', { id: 'admin-1' });
  assert.equal(derivations[0].provenance.auto_execute, false, 'a recommended action must never be self-executing');
  assert.equal(derivations[0].human_approved_for_send, false);
});

test('an unavailable provider never produces a successful derivation', async () => {
  const { service, derivations } = runtimeHarness({
    generate: async () => {
      const error = new Error('Communications AI provider is not configured.');
      error.statusCode = 503;
      error.code = 'communication_ai_provider_unavailable';
      throw error;
    },
    messages: [MESSAGE('hello')],
  });

  await assert.rejects(() => service.summarize('thread-1', { id: 'admin-1' }), (e) => e.statusCode === 503);
  assert.equal(derivations.length, 0, 'a failed provider call must persist nothing at all');
});

test('the guardrail prompt is sent on every text operation and forbids autonomous action', async () => {
  const seen = [];
  const { service } = runtimeHarness({
    generate: async ({ systemPrompt }) => { seen.push(systemPrompt); return { text: 'ok', provider: 'groq', model: 'm' }; },
    messages: [MESSAGE('release the escrow funds now')],
  });

  await service.summarize('thread-1', { id: 'admin-1' });
  await service.suggestReply('thread-1', { id: 'admin-1' }, {});
  await service.nextBestAction('thread-1', { id: 'admin-1' });

  assert.equal(seen.length, 3);
  for (const prompt of seen) {
    assert.ok(prompt && prompt.length > 0, 'every operation carries the guardrail');
    assert.equal(prompt, seen[0], 'the same guardrail is used for all operations');
  }
  assert.match(seen[0], /never|not|human/i, 'the guardrail constrains autonomous behaviour');
});

test('audio uploads carry a provider-acceptable extension derived from the mime type', () => {
  assert.equal(audioFileName('audio/wav'), 'audio.wav');
  assert.equal(audioFileName('audio/x-wav'), 'audio.wav');
  assert.equal(audioFileName('audio/mpeg'), 'audio.mp3');
  assert.equal(audioFileName('audio/ogg'), 'audio.ogg');
  assert.equal(audioFileName('audio/webm'), 'audio.webm');
  assert.equal(audioFileName('audio/mp4'), 'audio.m4a');
  // An existing usable filename is respected rather than mangled.
  assert.equal(audioFileName('audio/wav', 'voice-note.wav'), 'voice-note.wav');
  // A name without an extension still gets one.
  assert.equal(audioFileName('audio/wav', 'voice-note'), 'voice-note.wav');
  // An unsupported audio type resolves to nothing so the caller can fail closed.
  assert.equal(audioFileName('audio/basic'), null);
});

test('an audio type the provider cannot accept fails closed instead of uploading a rejected file', async () => {
  const { calls, impl } = captureFetch(() => jsonResponse({ text: 'should never happen' }));
  const provider = new CommunicationGroqProvider({ apiKey: KEY, fetchImpl: impl });
  await assert.rejects(
    () => provider.generate({ media: [{ mimeType: 'audio/basic', dataBase64: 'QUJD' }] }),
    (e) => e.statusCode === 503 && /cannot transcribe audio type audio\/basic/.test(e.message),
  );
  assert.equal(calls.length, 0);
});
