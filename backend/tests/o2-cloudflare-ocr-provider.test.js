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

const { supabase } = await import('../db/supabase.js');
const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { resolveVisionProvider, providerFromClient, DEFAULT_OCR_PROVIDER } = await import('../services/ai/ocrVisionProvider.js');
const { askCloudflareVision, CLOUDFLARE_VISION_MODEL, isCloudflareVisionConfigured } = await import('../services/ai/CloudflareVisionClient.js');
const { FIELD_ALIASES, resolveSchema } = await import('../services/document-intelligence/documentSchemas.js');

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

// ---------------------------------------------------------------------------------------
// 1. Provider selection is explicit, and never falls back.
// ---------------------------------------------------------------------------------------

test('cloudflare: Cloudflare is the configured OCR provider by default', () => {
  assert.equal(DEFAULT_OCR_PROVIDER, 'cloudflare');
  const provider = resolveVisionProvider({});
  assert.equal(provider.id, 'cloudflare');
  assert.equal(provider.model, '@cf/meta/llama-3.2-11b-vision-instruct');
});

test('cloudflare: Gemini remains implemented and selectable, but only by explicit configuration', () => {
  assert.equal(resolveVisionProvider({ CARUP_OCR_PROVIDER: 'gemini' }).id, 'gemini');
  assert.equal(resolveVisionProvider({ CARUP_OCR_PROVIDER: 'cloudflare' }).id, 'cloudflare');
});

test('cloudflare: an unknown provider name FAILS rather than silently defaulting', () => {
  assert.throws(() => resolveVisionProvider({ CARUP_OCR_PROVIDER: 'somethingelse' }), /Unknown OCR provider/);
});

test('cloudflare: there is no automatic provider fallback anywhere in the boundary', () => {
  const boundary = read('../services/ai/ocrVisionProvider.js');
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  for (const pattern of [/catch[\s\S]{0,120}resolveVisionProvider/, /fallbackProvider/, /\|\|\s*geminiProvider/, /\|\|\s*cloudflareProvider/]) {
    assert.doesNotMatch(boundary, pattern, 'a failed provider must not be swapped for another');
    assert.doesNotMatch(service, pattern);
  }
});

test('cloudflare: an unconfigured provider fails honestly and names what is missing', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined, ALLOW_OCR_MOCK: 'false' }, async (t) => {
    assert.equal(isCloudflareVisionConfigured({}), false);
    const writes = [];
    const original = supabase.from;
    supabase.from = (table) => ({
      insert: (row) => { writes.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    });
    try {
      const result = await DocumentIntelligenceService.extractDocumentData('national_id', PNG_DATA_URI, 'user-cf');
      assert.equal(result.success, false);
      assert.equal(result.extractedData, undefined, 'a failed extraction surfaces no identity fields');
      assert.equal(result.provider, 'cloudflare', 'the failure names the provider that was selected');
      assert.equal(result.executionStatus, 'provider_failed');
      assert.match(result.error, /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/);
      assert.equal(writes.find((w) => w.table === 'ocr_documents').row.status, 'OCR_Provider_Unavailable');
    } finally { supabase.from = original; }
  });
});

// ---------------------------------------------------------------------------------------
// 2. The request Cloudflare actually receives.
// ---------------------------------------------------------------------------------------

test('cloudflare: the request carries the COMPLETE image bytes, the messages form and a schema', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct-test', CLOUDFLARE_API_TOKEN: 'token-test' }, async () => {
    const cap = captureFetch(() => okResponse({ response: { document_class_observed: 'x', fields: {} }, usage: { neurons: 1.5 } }));
    try {
      await askCloudflareVision('SYSTEM', 'USER', [{ mimeType: 'image/png', base64: PNG_BYTES.toString('base64') }], { name: 's', schema: { type: 'object' } });
      const [call] = cap.calls;
      assert.match(call.url, /\/accounts\/acct-test\/ai\/run\/@cf\/meta\/llama-3\.2-11b-vision-instruct$/);
      assert.equal(call.init.headers.Authorization, 'Bearer token-test');
      assert.deepEqual(Buffer.from(call.body.image, 'base64'), PNG_BYTES, 'the complete original bytes are sent');
      // The bare `prompt` form makes this model answer in prose; the messages form returns JSON.
      assert.deepEqual(call.body.messages.map((m) => m.role), ['system', 'user']);
      assert.equal(call.body.messages[0].content, 'SYSTEM');
      assert.equal(call.body.prompt, undefined, 'the prose-producing bare prompt form is not used');
      assert.equal(call.body.response_format.type, 'json_schema');
      assert.equal(call.body.temperature, 0);
    } finally { cap.restore(); }
  });
});

test('cloudflare: provider-reported usage is passed through, and never estimated', async () => {
  await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => {
    const cap = captureFetch(() => okResponse({ response: { ok: true }, usage: { neurons: 43.29, prompt_tokens: 1622, completion_tokens: 33, total_tokens: 1655 } }));
    try {
      const out = await askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]);
      assert.deepEqual(out.usage, { neurons: 43.29, promptTokens: 1622, completionTokens: 33, totalTokens: 1655 });
    } finally { cap.restore(); }

    const noUsage = captureFetch(() => okResponse({ response: { ok: true } }));
    try {
      const out = await askCloudflareVision('s', 'u', [{ mimeType: 'image/png', base64: 'AAAA' }]);
      assert.equal(out.usage, null, 'no usage reported means null, never a guess');
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
    for (const result of [{ response: '' }, { response: null }, {}]) {
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

test('cloudflare: the prompt names BOTH the schema field and the wording printed on the document', () => {
  const service = read('../services/document-intelligence/documentIntelligenceService.js');
  assert.match(service, /printed on the document as/, 'the reader is told what the field is labelled');
  // The manual provider test read "UAT SYNTHETIC" correctly and reported it under a key CarUp
  // never asked for, which arrived as a false absence.
  assert.match(read('../services/document-intelligence/documentSchemas.js'), /Given names \/ First name \/ Forenames/);
});

test('cloudflare: a synonym for the same printed field is accepted; a DIFFERENT field is never substituted', async () => {
  const writes = [];
  const original = supabase.from;
  supabase.from = (table) => ({
    insert: (row) => { writes.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  });
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id', PNG_DATA_URI, 'user-cf',
      {
        visionProvider: providerFromClient(async () => ({
          document_class_observed: 'zimbabwe_national_id',
          confidence: 0.9,
          // The document prints "Surname" and "Given names"; CarUp's schema says last_name/first_name.
          fields: { surname: 'SPECIMEN', given_names: 'TESTCASE', id_number: '63-1234567-A-42' },
        }), { id: 'cloudflare', model: CLOUDFLARE_VISION_MODEL }),
      },
    );
    assert.equal(result.extractedData.last_name, 'SPECIMEN');
    assert.equal(result.extractedData.first_name, 'TESTCASE');
    assert.equal(result.extractedData.national_id_number, '63-1234567-A-42');
  } finally { supabase.from = original; }

  // Fields the schemas deliberately keep apart share no alias in either direction.
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      assert.equal(FIELD_ALIASES[alias], undefined, `${alias} is an alias, so it must not also be a field with its own aliases`);
      assert.notEqual(alias, 'plate_number');
      assert.notEqual(alias, 'vin');
      assert.notEqual(alias, 'tax_id');
    }
    assert.equal(resolveSchema('national_id').fields[field] !== undefined
      || resolveSchema('registration_book').fields[field] !== undefined
      || resolveSchema('customs_declaration').fields[field] !== undefined
      || resolveSchema('passport').fields[field] !== undefined
      || resolveSchema('drivers_license').fields[field] !== undefined
      || resolveSchema('dealer_x').fields[field] !== undefined, true,
    `${field} must be a real schema field`);
  }
});

test('cloudflare: the requested response schema is derived from CarUp\'s schema and requires no document field', async () => {
  let captured = null;
  const original = supabase.from;
  supabase.from = () => ({ insert: () => Promise.resolve({ data: null, error: null }), select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) });
  try {
    await DocumentIntelligenceService.extractDocumentData('registration_book', PNG_DATA_URI, 'user-cf', {
      visionProvider: {
        id: 'cloudflare', model: CLOUDFLARE_VISION_MODEL, isConfigured: () => true, requiredEnv: [],
        extract: async ({ jsonSchema }) => { captured = jsonSchema; return { content: { document_class_observed: 'x', fields: {} }, usage: null }; },
      },
    });
  } finally { supabase.from = original; }

  const properties = captured.schema.properties.fields.properties;
  assert.deepEqual(Object.keys(properties).sort(), Object.keys(resolveSchema('registration_book').fields).sort(),
    'the requested schema mirrors the document schema exactly — the two cannot drift');
  assert.equal(captured.schema.properties.fields.required, undefined, 'no document field is ever required');
  assert.equal(properties.first_name, undefined, 'a registration book is not given identity fields to fill');
});

// ---------------------------------------------------------------------------------------
// 4. Adding a provider changed nothing about what a reading means.
// ---------------------------------------------------------------------------------------

test('cloudflare: a Cloudflare reading is still a CANDIDATE — confined writes, no verification', async () => {
  const writes = [];
  const original = supabase.from;
  supabase.from = (table) => ({
    insert: (row) => { writes.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  });
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id', PNG_DATA_URI, 'user-cf',
      {
        visionProvider: providerFromClient(async () => ({
          document_class_observed: 'zimbabwe_national_id', confidence: 0.97,
          fields: { first_name: 'TESTCASE', last_name: 'SPECIMEN', national_id_number: '63-1234567-A-42', date_of_birth: '1990-01-01' },
        }), { id: 'cloudflare', model: CLOUDFLARE_VISION_MODEL }),
      },
    );
    const allowed = new Set(['ocr_documents', 'ocr_national_ids', 'ocr_registration_books', 'ocr_customs_declarations']);
    for (const write of writes) assert.ok(allowed.has(write.table), `Cloudflare extraction wrote to ${write.table}`);
    assert.equal(result.extractionStatus, 'Pending_Verification', 'a complete reading still only awaits verification');
    assert.equal(result.provider, 'cloudflare');
    assert.equal(result.model, CLOUDFLARE_VISION_MODEL);
  } finally { supabase.from = original; }
});

test('cloudflare: missing still stays missing, and nothing is invented for the new provider', async () => {
  const writes = [];
  const original = supabase.from;
  supabase.from = (table) => ({
    insert: (row) => { writes.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  });
  try {
    const result = await DocumentIntelligenceService.extractDocumentData(
      'national_id', PNG_DATA_URI, 'user-cf',
      {
        visionProvider: providerFromClient(async () => ({
          document_class_observed: 'zimbabwe_national_id',
          fields: { given_names: 'TESTCASE' },
        }), { id: 'cloudflare', model: CLOUDFLARE_VISION_MODEL }),
      },
    );
    assert.equal(result.extractedData.first_name, 'TESTCASE');
    assert.equal(result.extractedData.last_name, undefined);
    assert.equal(result.extractedData.confidenceScore, null, 'no confidence reported means null');
    assert.equal(writes.some((w) => w.table === 'ocr_national_ids'), false, 'no placeholder candidate row');
    const values = JSON.stringify({ ...result.extractedData.additional_fields, first_name: result.extractedData.first_name });
    for (const placeholder of ['Unknown', 'N/A', new Date().toISOString().split('T')[0]]) {
      assert.ok(!values.includes(placeholder), `Cloudflare readings must not contain ${placeholder}`);
    }
  } finally { supabase.from = original; }
});

test('cloudflare: no credential is written into the repository, and none is logged', () => {
  const client = read('../services/ai/CloudflareVisionClient.js');
  assert.doesNotMatch(client, /Bearer\s+[A-Za-z0-9_-]{20,}/, 'no token literal');
  assert.match(client, /process\.env\.CLOUDFLARE_API_TOKEN/, 'the token comes from the environment');
  assert.doesNotMatch(client, /console\.(log|warn|error)/, 'the client logs nothing at all');
  assert.doesNotMatch(client, /logger\.[a-z]+\([^)]*apiToken/, 'the token never reaches a log');
});
