/**
 * AI-01-B — the canonical CarUp AI gateway (Gemma on Cloudflare Workers AI).
 *
 * Ported from PR #217 (head 6c8ff6f7) by OC-3C, which converged #217's gateway, capabilities,
 * runtime config and Gemma provider onto the One CarUp lineage and onto the ONE shared Cloudflare
 * transport (cloudflareAiTransport.js). 34 of #217's 36 cases ran unmodified against the converged
 * code; the two adapted cases are marked "OC-3C" and change only where the convergence moved a
 * responsibility: provenance now also states `execution` (and every result carries
 * machine_output / authority: 'advisory'), and the Cloudflare credential names are owned by the
 * transport, whose source is read alongside the runtime config.
 *
 * OC-5R-REL-02 E: the Gemma request body is no longer #217's byte for byte — it carries ONE intentional
 * extra field, `chat_template_kwargs: { enable_thinking: false }`, so interactive advisory calls have
 * bounded latency (Gemma 4 reasons by default). The cases below assert the parts of the body they
 * always asserted and still pass unmodified; the byte-level golden lives in
 * oc3c-cloudflare-ai-transport.test.js and the full contract in oc5r-rel02-gemma-latency-convergence.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CARUP_AI_MODEL,
  CARUP_AI_PROVIDER,
  inspectAiRuntimeConfig,
  resolveAiRuntimeConfig,
} from '../services/ai/aiRuntimeConfig.js';
import {
  AI_GATEWAY_CAPABILITIES,
  inspectAiCapabilities,
} from '../services/ai/aiCapabilities.js';
import {
  buildGemmaRequestBody,
  classifyCloudflareFailure,
  createCloudflareGemmaProvider,
} from '../services/ai/cloudflareGemmaProvider.js';
import {
  createCarUpAiGateway,
} from '../services/ai/carUpAiGateway.js';

const CONFIGURED_ENV = Object.freeze({
  CARUP_AI_PROVIDER: 'cloudflare',
  CARUP_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it',
  CLOUDFLARE_ACCOUNT_ID: 'acct-test-123',
  CLOUDFLARE_API_TOKEN: 'token-test-456',
});

const IMAGE = Object.freeze({
  mimeType: 'image/png',
  base64: 'QUJDRA==',
});

function okResponse(content, usage = null) {
  return new Response(JSON.stringify({
    success: true,
    errors: [],
    result: {
      choices: [{ message: { content }, finish_reason: 'stop' }],
      ...(usage ? { usage } : {}),
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function providerErrorResponse(status, errors) {
  return new Response(JSON.stringify({
    success: false,
    errors,
    result: null,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureFetch(responseFactory = () => okResponse('ok')) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init,
        body: JSON.parse(init.body),
      });
      return responseFactory(calls.length);
    },
  };
}

test('AI-01-B config pins the canonical provider and exact Gemma model', () => {
  const config = resolveAiRuntimeConfig(CONFIGURED_ENV);
  assert.equal(config.provider, CARUP_AI_PROVIDER);
  assert.equal(config.provider, 'cloudflare');
  assert.equal(config.model, CARUP_AI_MODEL);
  assert.equal(config.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(config.configured, true);
});

test('AI-01-B rejects alternate providers and models instead of hiding fallback', () => {
  assert.throws(
    () => resolveAiRuntimeConfig({ ...CONFIGURED_ENV, CARUP_AI_PROVIDER: 'gemini' }),
    /permits only "cloudflare"/,
  );
  assert.throws(
    () => resolveAiRuntimeConfig({ ...CONFIGURED_ENV, CARUP_AI_MODEL: '@cf\/qwen\/qwen3.8-27b' }),
    /pinned to "@cf\/google\/gemma-4-26b-a4b-it"/,
  );
});

test('runtime inspection reports credential presence but never credential values', () => {
  const inspected = inspectAiRuntimeConfig(CONFIGURED_ENV);
  const serialized = JSON.stringify(inspected);
  assert.equal(inspected.configured, true);
  assert.deepEqual(inspected.requiredEnv.sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
  assert.equal(serialized.includes(CONFIGURED_ENV.CLOUDFLARE_ACCOUNT_ID), false);
  assert.equal(serialized.includes(CONFIGURED_ENV.CLOUDFLARE_API_TOKEN), false);
});

test('text request construction uses explicit system/user messages', () => {
  const body = buildGemmaRequestBody({
    systemPrompt: 'SYSTEM',
    userPrompt: 'USER',
  });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'SYSTEM' },
    { role: 'user', content: 'USER' },
  ]);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 4096);
});

test('JSON request construction asks for JSON without inventing response_format support', () => {
  const body = buildGemmaRequestBody({
    systemPrompt: 'SYSTEM',
    userPrompt: 'USER',
    expectJson: true,
  });
  assert.match(body.messages[1].content, /Return only one valid JSON value/);
  assert.equal(body.response_format, undefined);
});

test('image request construction uses the proven Gemma image_url content-part transport', () => {
  const body = buildGemmaRequestBody({
    systemPrompt: 'SYSTEM',
    userPrompt: 'Describe',
    image: IMAGE,
  });
  assert.equal(body.messages[1].content[0].type, 'text');
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.equal(
    body.messages[1].content[1].image_url.url,
    'data:image/png;base64,QUJDRA==',
  );
  assert.equal(body.image, undefined);
});

test('generateText returns content with truthful provider/model provenance', async () => {
  const capture = captureFetch(() => okResponse('hello', { prompt_tokens: 3 }));
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: capture.fetchImpl,
  });
  const out = await gateway.generateText({
    systemPrompt: 'S',
    userPrompt: 'U',
  });
  assert.equal(out.ok, true);
  assert.equal(out.value, 'hello');
  // OC-3C: provenance also states that the provider executed, and the answer says what it is.
  assert.deepEqual(out.provenance, {
    provider: 'cloudflare',
    model: '@cf/google/gemma-4-26b-a4b-it',
    execution: 'provider_executed',
  });
  assert.equal(out.machine_output, true);
  assert.equal(out.authority, 'advisory');
  assert.equal(out.usage.prompt_tokens, 3);
  assert.equal(capture.calls.length, 1);
  assert.match(
    capture.calls[0].url,
    /\/accounts\/acct-test-123\/ai\/run\/@cf\/google\/gemma-4-26b-a4b-it$/,
  );
});

test('generateJson accepts only valid JSON content', async () => {
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => okResponse('{"answer":42}'),
  });
  const out = await gateway.generateJson({ userPrompt: 'return data' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { answer: 42 });
});

test('extractStructuredData supports generic text-plus-image structured extraction', async () => {
  const capture = captureFetch(() => okResponse('{"fields":{"make":"Toyota"}}'));
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: capture.fetchImpl,
  });
  const out = await gateway.extractStructuredData({
    systemPrompt: 'Extract visible facts only.',
    userPrompt: 'Return the requested structure.',
    image: IMAGE,
  });
  assert.equal(out.ok, true);
  assert.equal(out.value.fields.make, 'Toyota');
  assert.equal(capture.calls[0].body.messages[1].content[1].type, 'image_url');
});

test('missing credentials fail explicitly and do not spend provider capacity', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: {
      CARUP_AI_PROVIDER: 'cloudflare',
      CARUP_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it',
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('should not run');
    },
  });
  const out = await gateway.generateText({ userPrompt: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.match(out.error.message, /CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/);
  assert.equal(fetchCalls, 0);
});

test('provider HTTP 429 is classified as retryable rate limiting', async () => {
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => providerErrorResponse(429, [{ code: 1015, message: 'rate limited' }]),
  });
  const out = await gateway.generateText({ userPrompt: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_RATE_LIMITED');
  assert.equal(out.error.retryable, true);
  assert.equal(out.error.status, 429);
});

test('provider HTTP 529 is classified as retryable capacity unavailability', () => {
  assert.deepEqual(classifyCloudflareFailure(529), {
    code: 'AI_CAPACITY_UNAVAILABLE',
    retryable: true,
  });
});

test('provider errors redact account and token values', async () => {
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => providerErrorResponse(403, [{
      code: 10000,
      message: 'bad token token-test-456 for account acct-test-123',
    }]),
  });
  const out = await gateway.generateText({ userPrompt: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_PROVIDER_AUTH_FAILED');
  assert.equal(out.error.message.includes('token-test-456'), false);
  assert.equal(out.error.message.includes('acct-test-123'), false);
  assert.match(out.error.message, /\[REDACTED\]/);
});

test('empty and malformed provider responses fail closed', async () => {
  const emptyGateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => okResponse(''),
  });
  const empty = await emptyGateway.generateText({ userPrompt: 'hello' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'AI_MALFORMED_RESPONSE');

  const malformedJsonGateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => okResponse('not-json'),
  });
  const malformed = await malformedJsonGateway.generateJson({ userPrompt: 'json' });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'AI_MALFORMED_RESPONSE');
});

test('provider timeout aborts the request and returns an explicit timeout result', async () => {
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }),
  });
  const out = await gateway.generateText({
    userPrompt: 'hello',
    timeoutMs: 5,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_TIMEOUT');
  assert.equal(out.error.retryable, true);
});

test('caller AbortController cancellation returns an explicit aborted result', async () => {
  const controller = new AbortController();
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }),
  });
  const pending = gateway.generateText({
    userPrompt: 'hello',
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  controller.abort();
  const out = await pending;
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_ABORTED');
  assert.equal(out.error.retryable, false);
});

test('audio and video fail closed at the gateway boundary', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const audio = await gateway.generateText({ userPrompt: 'x', audio: Buffer.from('x') });
  const video = await gateway.generateText({ userPrompt: 'x', video: Buffer.from('x') });
  assert.equal(audio.ok, false);
  assert.equal(audio.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(video.ok, false);
  assert.equal(video.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('generateText rejects image rather than silently dropping it', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.generateText({
    userPrompt: 'describe this',
    image: IMAGE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('generateJson rejects image rather than silently dropping it', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('{"unexpected":true}');
    },
  });
  const out = await gateway.generateJson({
    userPrompt: 'classify this',
    image: IMAGE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('generateText rejects non-empty media container rather than silently dropping it', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.generateText({
    userPrompt: 'inspect media',
    media: [{ mimeType: 'image/png', base64: 'QUJDRA==' }],
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('generateJson rejects non-empty media container rather than silently dropping it', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('{"unexpected":true}');
    },
  });
  const out = await gateway.generateJson({
    userPrompt: 'inspect media',
    media: [{ mimeType: 'image/png', base64: 'QUJDRA==' }],
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('generateText rejects non-empty images alias rather than silently dropping it', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.generateText({
    userPrompt: 'inspect images',
    images: [IMAGE],
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('analyzeImage rejects video/mp4 disguised through the image field', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.analyzeImage({
    userPrompt: 'analyze',
    image: { mimeType: 'video/mp4', base64: 'QUJDRA==' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('analyzeImage rejects audio MIME through the image field', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.analyzeImage({
    userPrompt: 'analyze',
    image: { mimeType: 'audio/mpeg', base64: 'QUJDRA==' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('analyzeImage rejects application/pdf through the image field', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const out = await gateway.analyzeImage({
    userPrompt: 'analyze',
    image: { mimeType: 'application/pdf', base64: 'JVBERi0xLjQ=' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('classifyImage rejects non-image MIME', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('{"class":"unexpected"}');
    },
  });
  const out = await gateway.classifyImage({
    userPrompt: 'classify',
    image: { mimeType: 'text/plain', base64: 'aGVsbG8=' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('analyzeImage still transmits a supported image', async () => {
  const capture = captureFetch(() => okResponse('visible vehicle'));
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: capture.fetchImpl,
  });
  const out = await gateway.analyzeImage({
    userPrompt: 'analyze',
    image: { mimeType: 'image/jpeg', base64: 'QUJDRA==' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.value, 'visible vehicle');
  assert.equal(capture.calls.length, 1);
  assert.equal(
    capture.calls[0].body.messages[0].content[1].image_url.url,
    'data:image/jpeg;base64,QUJDRA==',
  );
});

test('extractStructuredData accepts one genuine supported image', async () => {
  const capture = captureFetch(() => okResponse('{"ok":true}'));
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: capture.fetchImpl,
  });
  const out = await gateway.extractStructuredData({
    userPrompt: 'extract',
    image: { mimeType: 'image/webp', base64: 'QUJDRA==' },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { ok: true });
  assert.equal(capture.calls.length, 1);
  assert.equal(
    capture.calls[0].body.messages[0].content[1].image_url.url,
    'data:image/webp;base64,QUJDRA==',
  );
});

test('extractStructuredData rejects non-image MIME', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('{"unexpected":true}');
    },
  });
  const out = await gateway.extractStructuredData({
    userPrompt: 'extract',
    image: { mimeType: 'application/octet-stream', base64: 'QUJDRA==' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('unsupported media aliases perform zero provider fetch calls across image operations', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });

  const analyze = await gateway.analyzeImage({
    userPrompt: 'analyze',
    image: IMAGE,
    media: [{ mimeType: 'video/webm', base64: 'QUJDRA==' }],
  });
  const classify = await gateway.classifyImage({
    userPrompt: 'classify',
    image: IMAGE,
    images: [IMAGE],
  });
  const extract = await gateway.extractStructuredData({
    userPrompt: 'extract',
    image: IMAGE,
    video: Buffer.from('x'),
  });

  assert.equal(analyze.ok, false);
  assert.equal(analyze.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(classify.ok, false);
  assert.equal(classify.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(extract.ok, false);
  assert.equal(extract.error.code, 'AI_UNSUPPORTED_MODALITY');
  assert.equal(fetchCalls, 0);
});

test('image-specific operations fail closed when no image is supplied', async () => {
  let fetchCalls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse('unexpected');
    },
  });
  const analysis = await gateway.analyzeImage({ userPrompt: 'analyze' });
  const classification = await gateway.classifyImage({ userPrompt: 'classify' });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.error.code, 'AI_IMAGE_REQUIRED');
  assert.equal(classification.ok, false);
  assert.equal(classification.error.code, 'AI_IMAGE_REQUIRED');
  assert.equal(fetchCalls, 0);
});

test('canonical provider performs exactly one Cloudflare attempt and no vendor fallback', async () => {
  let calls = 0;
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => {
      calls += 1;
      return providerErrorResponse(503, [{ code: 1001, message: 'unavailable' }]);
    },
  });
  const out = await gateway.generateText({ userPrompt: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(calls, 1);

  const providerSource = readFileSync(
    new URL('../services/ai/cloudflareGemmaProvider.js', import.meta.url),
    'utf8',
  );
  for (const vendor of ['GeminiClient', 'Groq', 'OpenRouter', 'Moonshot', 'qwen3.8-27b']) {
    assert.equal(providerSource.includes(vendor), false, 'no fallback dependency on ' + vendor);
  }
});

test('server-only environment contract has no browser/mobile public secret prefix', () => {
  // OC-3C: the credential names are owned by the shared transport; the runtime config imports them.
  for (const rel of ['../services/ai/aiRuntimeConfig.js', '../services/ai/cloudflareAiTransport.js']) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(source.includes('VITE_CLOUDFLARE'), false, rel);
    assert.equal(source.includes('EXPO_PUBLIC_CLOUDFLARE'), false, rel);
    assert.equal(source.includes('NEXT_PUBLIC_CLOUDFLARE'), false, rel);
  }
  const transportSource = readFileSync(new URL('../services/ai/cloudflareAiTransport.js', import.meta.url), 'utf8');
  assert.match(transportSource, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(transportSource, /CLOUDFLARE_API_TOKEN/);
  const configSource = readFileSync(new URL('../services/ai/aiRuntimeConfig.js', import.meta.url), 'utf8');
  assert.match(configSource, /CLOUDFLARE_REQUIRED_ENV/, 'the runtime config takes its credential names from the transport');
});

test('gateway exposes inference operations only and no domain decision convenience methods', () => {
  const gateway = createCarUpAiGateway({
    env: CONFIGURED_ENV,
    fetchImpl: async () => okResponse('ok'),
  });
  assert.deepEqual(Object.keys(AI_GATEWAY_CAPABILITIES), [
    'generateText',
    'generateJson',
    'analyzeImage',
    'classifyImage',
    'extractStructuredData',
  ]);
  for (const forbidden of [
    'approveIdentity',
    'calculateTrust',
    'approveSeller',
    'approvePayment',
    'verifyOwnership',
  ]) {
    assert.equal(typeof gateway[forbidden], 'undefined');
  }
});

test('capability inspection truthfully reports unsupported audio/video', () => {
  const inspected = inspectAiCapabilities();
  assert.deepEqual(inspected.unsupportedModalities, ['audio', 'video']);
  assert.match(inspected.authority, /Domain authorities decide/);
});

test('provider inspection seam remains bounded and secret-free', () => {
  const provider = createCloudflareGemmaProvider({
    env: CONFIGURED_ENV,
    fetchImpl: async () => okResponse('ok'),
  });
  const inspected = provider.inspect();
  const serialized = JSON.stringify(inspected);
  assert.equal(inspected.provider, 'cloudflare');
  assert.equal(inspected.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(serialized.includes('token-test-456'), false);
  assert.equal(serialized.includes('acct-test-123'), false);
});
