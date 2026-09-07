/**
 * Cloudflare Workers AI as the OCR vision provider — permanent guards.
 *
 * These pin the provider boundary itself: that selection is explicit and never falls back, that
 * the real image bytes reach Cloudflare, that a refusal is reported as a refusal, and that adding
 * a provider changed nothing about what a reading MEANS — Document Intelligence still observes and
 * the domain authorities still decide.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { resolveVisionProvider, providerFromClient, DEFAULT_OCR_PROVIDER } = await import('../services/ai/ocrVisionProvider.js');
const { askCloudflareVision, CLOUDFLARE_VISION_MODEL, isCloudflareVisionConfigured, buildCloudflareRequestBody, readCloudflareContent, TRANSPORTS, transportFor } = await import('../services/ai/CloudflareVisionClient.js');
const { REJECTED_MODELS, resolveCloudflareModel } = await import('../services/ai/ocrVisionProvider.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

/** Captures the exact HTTP request the client builds, without contacting Cloudflare. */
function captureFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return responder(calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const okResponse = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
/** The OpenAI-shaped envelope Qwen and Gemma actually answer in. */
const okChoice = (content, usage) => okResponse({ choices: [{ message: { content }, finish_reason: 'stop' }], ...(usage ? { usage } : {}) });

// ---------------------------------------------------------------------------------------
// 1. Provider selection is explicit, and never falls back.
// ---------------------------------------------------------------------------------------


/*
 * PORTED, DELIBERATELY IN PART. This file comes from `fix/o2-live-ocr-operationalization`, where it
 * covers both the provider boundary AND Document Intelligence's use of it. Only the BOUNDARY tests
 * travel to the Garage & Mechanic Onboarding lane — that is the minimal, semantically required
 * surface here, because this lane converges GMO identity classification onto the same boundary and
 * does not carry the Document Intelligence schema layer (`documentSchemas.js` does not exist on this
 * branch, and X7-8 keeps the legacy Document-Intelligence router retired).
 *
 * Left with their own lane rather than deleted from it:
 *   - test('cloudflare: response_format is withheld from the models it demonstrably harms', () => {
 *   - test('cloudflare: there is no automatic provider fallback anywhere in the boundary', () => {
 *   - test('cloudflare: an unconfigured provider fails honestly and names what is missing', async () => {
 *   - test('cloudflare: the prompt names BOTH the schema field and the wording printed on the document', (
 *   - test('cloudflare: a synonym for the same printed field is accepted; a DIFFERENT field is never subst
 *   - test('cloudflare: the requested response schema is derived from CarUp\'s schema and requires no docu
 *   - test('cloudflare: a Cloudflare reading is still a CANDIDATE — confined writes, no verification', asy
 *   - test('cloudflare: missing still stays missing, and nothing is invented for the new provider', async 
 */

test('cloudflare: Cloudflare is the configured OCR provider, on the qualified model', () => {
  assert.equal(DEFAULT_OCR_PROVIDER, 'cloudflare');
  const provider = resolveVisionProvider({});
  assert.equal(provider.id, 'cloudflare');
  assert.equal(provider.model, '@cf/qwen/qwen3.8-27b');
  assert.equal(CLOUDFLARE_VISION_MODEL, '@cf/qwen/qwen3.8-27b');
});

test('cloudflare: the REJECTED Llama vision model cannot be selected by configuration', () => {
  // It reads clean documents well, which is precisely why it is named: good clean-document
  // performance must never be a route back in. Shown a landscape photograph it invented a
  // complete identity at confidence 1.
  assert.ok(REJECTED_MODELS['@cf/meta/llama-3.2-11b-vision-instruct']);
  assert.throws(
    () => resolveCloudflareModel({ CARUP_OCR_MODEL: '@cf/meta/llama-3.2-11b-vision-instruct' }),
    /Refusing to use .*fabricated 8 identity fields/,
  );
});

test('cloudflare: a model with no PROVEN transport is refused rather than guessed at', () => {
  assert.throws(() => resolveCloudflareModel({ CARUP_OCR_MODEL: '@cf/some/unprobed-model' }), /No verified Workers AI transport/);
  assert.throws(() => transportFor('@cf/some/unprobed-model'), /No verified Workers AI transport/);
});

test('cloudflare: each model uses the image form MEASURED to deliver its pixels', () => {
  // Qwen accepts a top-level `image` field with HTTP 200 and silently ignores it: prompt_tokens
  // was identical to a request with no image at all (106 vs 106), while the content-part form
  // raised it to 172 and the model then described the picture correctly. Binding the wrong form
  // would yield an "extraction" that never saw the document.
  assert.equal(TRANSPORTS['@cf/qwen/qwen3.8-27b'].form, 'contentPart');
  assert.equal(TRANSPORTS['@cf/google/gemma-4-26b-a4b-it'].form, 'contentPart');
  assert.equal(TRANSPORTS['@cf/meta/llama-3.2-11b-vision-instruct'].form, 'inlineImage');

  const qwen = buildCloudflareRequestBody({
    model: '@cf/qwen/qwen3.8-27b', systemPrompt: 'S', textPrompt: 'U',
    image: { mimeType: 'image/png', base64: 'QUJD' }, jsonSchema: null,
  });
  assert.equal(qwen.image, undefined, 'the silently-ignored top-level image field must not be used for Qwen');
  const parts = qwen.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, 'data:image/png;base64,QUJD', 'the complete bytes travel as the data URI');

  const llama = buildCloudflareRequestBody({
    model: '@cf/meta/llama-3.2-11b-vision-instruct', systemPrompt: 'S', textPrompt: 'U',
    image: { mimeType: 'image/png', base64: 'QUJD' }, jsonSchema: null,
  });
  assert.equal(llama.image, 'QUJD', 'Llama genuinely takes the top-level form');
  assert.equal(typeof llama.messages[1].content, 'string');
});

test('cloudflare: each model is read from the envelope it actually answers in', () => {
  // Qwen and Gemma are OpenAI-shaped (choices[]); Llama answers at result.response.
  assert.equal(readCloudflareContent('@cf/qwen/qwen3.8-27b', { choices: [{ message: { content: '{\"a\":1}' } }] }), '{\"a\":1}');
  assert.equal(readCloudflareContent('@cf/google/gemma-4-26b-a4b-it', { choices: [{ message: { content: 'X' } }] }), 'X');
  assert.equal(readCloudflareContent('@cf/meta/llama-3.2-11b-vision-instruct', { response: 'Y' }), 'Y');
  // Reading Qwen with Llama's envelope would silently yield nothing.
  assert.equal(readCloudflareContent('@cf/qwen/qwen3.8-27b', { response: 'Y' }), undefined);
});

test('cloudflare: Gemini remains implemented and selectable, but only by explicit configuration', () => {
  assert.equal(resolveVisionProvider({ CARUP_OCR_PROVIDER: 'gemini' }).id, 'gemini');
  assert.equal(resolveVisionProvider({ CARUP_OCR_PROVIDER: 'cloudflare' }).id, 'cloudflare');
});

test('cloudflare: an unknown provider name FAILS rather than silently defaulting', () => {
  assert.throws(() => resolveVisionProvider({ CARUP_OCR_PROVIDER: 'somethingelse' }), /Unknown OCR provider/);
});

test('cloudflare: the request carries the COMPLETE image bytes, the messages form and a schema', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct-test', CLOUDFLARE_API_TOKEN: 'token-test' }, async () => {
    const cap = captureFetch(() => okChoice({ document_class_observed: 'x', fields: {} }, { neurons: 1.5 }));
    try {
      await askCloudflareVision('SYSTEM', 'USER', [{ mimeType: 'image/png', base64: PNG_BYTES.toString('base64') }], { name: 's', schema: { type: 'object' } });
      const [call] = cap.calls;
      assert.match(call.url, /\/accounts\/acct-test\/ai\/run\/@cf\/qwen\/qwen3\.8-27b$/);
      assert.equal(call.init.headers.Authorization, 'Bearer token-test');
      const imagePart = call.body.messages[1].content.find((c) => c.type === 'image_url');
      assert.deepEqual(
        Buffer.from(imagePart.image_url.url.split(',')[1], 'base64'), PNG_BYTES,
        'the complete original bytes are sent',
      );
      assert.deepEqual(call.body.messages.map((m) => m.role), ['system', 'user']);
      assert.equal(call.body.messages[0].content, 'SYSTEM');
      assert.equal(call.body.prompt, undefined, 'the prose-producing bare prompt form is not used');
      assert.equal(call.body.temperature, 0);
      // Measured: sending response_format to this model SUPPRESSED fields it can plainly read.
      assert.equal(call.body.response_format, undefined,
        'response_format is not sent to a model measured to lose readable fields because of it');
    } finally { cap.restore(); }
  });
});

test('cloudflare: provider-reported usage is passed through, and never estimated', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => {
    const cap = captureFetch(() => okChoice({ ok: true }, { neurons: 43.29, prompt_tokens: 1622, completion_tokens: 33, total_tokens: 1655 }));
    try {
      const out = await askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]);
      assert.equal(out.usage.neurons, 43.29);
      assert.equal(out.usage.promptTokens, 1622);
      assert.equal(out.usage.completionTokens, 33);
      assert.equal(out.usage.totalTokens, 1655);
      // Execution evidence the accuracy gate needs to tell a real completion from a truncation.
      assert.equal(out.usage.finishReason, 'stop');
      assert.equal(out.usage.transportForm, 'contentPart');
      assert.ok(out.usage.imageBytesSent > 0);
    } finally { cap.restore(); }

    const noUsage = captureFetch(() => okChoice({ ok: true }));
    try {
      const out = await askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]);
      assert.equal(out.usage.neurons, null, 'no usage reported means null, never a guess');
      assert.equal(out.usage.promptTokens, null);
      assert.equal(out.usage.transportForm, 'contentPart', 'transport evidence is ours, not the provider\'s');
    } finally { noUsage.restore(); }
  });
});

test('cloudflare: a refusal names the provider error and NEVER returns a reading', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => {
    const cap = captureFetch(() => new Response(
      JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));
    try {
      await assert.rejects(
        () => askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]),
        /Cloudflare Workers AI refused the request — 10000: Authentication error/,
      );
    } finally { cap.restore(); }
  });
});

test('cloudflare: an empty or absent response body fails closed', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => {
    for (const result of [{ choices: [{ message: { content: '' } }] }, { choices: [{ message: { content: null } }] }, {}]) {
      const cap = captureFetch(() => okResponse(result));
      try {
        await assert.rejects(() => askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]), /returned no response content/);
      } finally { cap.restore(); }
    }
  });
});

test('cloudflare: the model takes one image, and a second is refused rather than dropped', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => {
    await assert.rejects(() => askCloudflareVision('s', 'u', []), /requires an image/);
    await assert.rejects(
      () => askCloudflareVision('s', 'u', [{ base64: 'AAAA' }, { base64: 'BBBB' }]),
      /accepts one image per request; 2 were supplied/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// 3. The two integration issues the manual provider test exposed.
// ---------------------------------------------------------------------------------------

test('cloudflare: no credential is written into the repository, and none is logged', () => {
  const client = read('../services/ai/CloudflareVisionClient.js');
  assert.doesNotMatch(client, /Bearer\s+[A-Za-z0-9_-]{20,}/, 'no token literal');
  assert.match(client, /process\.env\.CLOUDFLARE_API_TOKEN/, 'the token comes from the environment');
  assert.doesNotMatch(client, /console\.(log|warn|error)/, 'the client logs nothing at all');
  assert.doesNotMatch(client, /logger\.[a-z]+\([^)]*apiToken/, 'the token never reaches a log');
});
