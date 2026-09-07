/**
 * GMO identity classification runs through the GOVERNED OCR PROVIDER BOUNDARY.
 *
 * GMO carried a direct `askGeminiVision` import — stale convergence drift from before CarUp
 * selected its OCR provider. A governed identity decision must not depend on a vendor the owner
 * did not choose, and the live consequence was concrete: a Gemini billing state stopped garage
 * onboarding entirely.
 *
 * These pin the properties that make the convergence real rather than nominal:
 *   the classifier asks the boundary, never a vendor;
 *   the configured default reaches Cloudflare running Qwen;
 *   the image is actually delivered in the transport form measured to deliver pixels;
 *   provenance is the provider's, not the caller's claim;
 *   an outage fails CLOSED and never falls back to another vendor;
 *   and classification stays an observation that cannot mint an approval.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const { DocumentClassifier, EVIDENCE_CLASSIFICATION } = await import('../services/identity/documentClassifier.js');
const { resolveVisionProvider, DEFAULT_OCR_PROVIDER, REJECTED_MODELS } = await import('../services/ai/ocrVisionProvider.js');
const { CLOUDFLARE_VISION_MODEL, TRANSPORTS } = await import('../services/ai/CloudflareVisionClient.js');

/** A PNG large enough to clear the deterministic evidence floor, and different per side. */
const png = (seed) => {
  const b = Buffer.alloc(4096, seed);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47;
  b[4] = 0x0d; b[5] = 0x0a; b[6] = 0x1a; b[7] = 0x0a;
  return b;
};
const FRONT = png(11); const BACK = png(22); const SELFIE = png(33);

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const cfReply = (content) => async (url, init) => {
  cfReply.calls.push({ url: String(url), body: JSON.parse(init.body) });
  return {
    ok: true, status: 200,
    json: async () => ({
      success: true,
      result: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 172, completion_tokens: 30, neurons: 5 } },
    }),
  };
};
const CLOUDFLARE_ENV = {
  CARUP_OCR_PROVIDER: 'cloudflare',
  CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  CLOUDFLARE_API_TOKEN: 'token-test',
  ALLOW_OCR_MOCK: 'false',
  NODE_ENV: 'test',
};

/* ── the boundary itself ───────────────────────────────────────────────────── */

test('GMO-QWEN-1: the classifier imports the provider BOUNDARY and no vendor client', () => {
  const source = read('backend/services/identity/documentClassifier.js');
  assert.match(source, /from '\.\.\/ai\/ocrVisionProvider\.js'/, 'must ask the boundary');
  assert.doesNotMatch(source, /GeminiClient/, 'must not import a vendor client directly');
  assert.doesNotMatch(source, /askGeminiVision|askGemini\(/, 'must not call a vendor directly');
});

test('GMO-QWEN-2: the configured default is Cloudflare running Qwen, and Llama stays rejected', () => {
  assert.equal(DEFAULT_OCR_PROVIDER, 'cloudflare');
  assert.equal(CLOUDFLARE_VISION_MODEL, '@cf/qwen/qwen3.8-27b');
  const provider = resolveVisionProvider({});
  assert.equal(provider.id, 'cloudflare');
  assert.equal(provider.model, '@cf/qwen/qwen3.8-27b');
  assert.ok(REJECTED_MODELS['@cf/meta/llama-3.2-11b-vision-instruct'], 'Llama must stay in the rejected registry');
});

test('GMO-QWEN-3: Qwen receives the ACTUAL image bytes, in the transport measured to deliver them', async () => {
  cfReply.calls = [];
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply(JSON.stringify({ classification: 'valid_identity_document', classification_confidence: 0.9, reason: 'ID card visible' })),
    async () => {
      const result = await DocumentClassifier.classifyDocument(FRONT, BACK, SELFIE, 'national_id');
      assert.equal(result.classification, EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT);
    },
  ));

  assert.equal(cfReply.calls.length, 2, 'front and back are each classified — neither is dropped');
  for (const call of cfReply.calls) {
    assert.match(call.url, /@cf\/qwen\/qwen3\.8-27b/, 'the request goes to the selected model');
    // Qwen is OpenAI-shaped: the image is a content PART. The top-level `image` field returns 200
    // with the image silently ignored, which is the exact failure this asserts against.
    assert.equal(call.body.image, undefined, 'must NOT use the inlineImage form for Qwen');
    const parts = call.body.messages.at(-1).content;
    assert.ok(Array.isArray(parts), 'the user message must carry content parts');
    const image = parts.find((p) => p.type === 'image_url');
    assert.ok(image, 'an image_url part must be present');
    const b64 = image.image_url.url.split(',')[1];
    assert.ok(b64 && b64.length > 100, 'real image bytes, not a truncated stub');
    assert.ok([FRONT.toString('base64'), BACK.toString('base64')].includes(b64), 'the bytes must be the actual side buffer');
  }
  assert.equal(TRANSPORTS['@cf/qwen/qwen3.8-27b'].form, 'contentPart');
});

test('GMO-QWEN-4: provenance is the PROVIDER\'s, with execution evidence, not a hard-coded string', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply(JSON.stringify({ classification: 'valid_identity_document', classification_confidence: 0.87, reason: 'ok' })),
    async () => {
      const result = await DocumentClassifier.classifyDocument(FRONT, BACK, null, 'national_id');
      assert.equal(result.provider, 'cloudflare');
      assert.equal(result.model, '@cf/qwen/qwen3.8-27b');
      assert.ok(result.execution, 'execution evidence must be recorded');
      const front = result.execution.sides.find((s) => s.side === 'front');
      assert.equal(front.usage.transportForm, 'contentPart');
      assert.equal(front.usage.promptTokens, 172, "the provider's own accounting is carried through");
      assert.ok(front.usage.imageBytesSent > 100, 'image delivery evidence must be present');
    },
  ));
});

/* ── failure is honest, and never someone else's model ─────────────────────── */

test('GMO-QWEN-5: an unconfigured provider fails CLOSED and never falls back to Gemini', async () => {
  let anyFetch = false;
  await withEnv({ ...CLOUDFLARE_ENV, CLOUDFLARE_API_TOKEN: undefined, GEMINI_API_KEY: 'a-key-that-must-not-be-used' },
    () => withFetch(async () => { anyFetch = true; throw new Error('no call expected'); }, async () => {
      const result = await DocumentClassifier.classifyDocument(FRONT, BACK, null, 'national_id');
      assert.equal(result.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN, 'fails closed');
      assert.equal(result.provider, 'cloudflare', 'attributed to the CONFIGURED provider');
      assert.match(result.reason, /not configured/i);
      assert.match(result.reason, /CLOUDFLARE_API_TOKEN/, 'says what is missing');
    }));
  assert.equal(anyFetch, false, 'a Gemini key present must not cause any provider call');
});

test('GMO-QWEN-6: a provider outage is an UNCERTAIN reading attributed to that provider', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    async () => ({ ok: false, status: 429, json: async () => ({ success: false, errors: [{ code: 1000, message: 'rate limited' }] }) }),
    async () => {
      const result = await DocumentClassifier.classifyDocument(FRONT, null, null, 'national_id');
      assert.equal(result.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN);
      assert.equal(result.provider, 'cloudflare');
      assert.match(result.reason, /rate limited/, "the provider's own words survive");
      assert.doesNotMatch(result.reason, /gemini/i, 'no vendor substitution');
    },
  ));
});

test('GMO-QWEN-7: prose around the JSON is recovered; junk falls closed to uncertain', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply('Sure! Here is the result:\n```json\n{"classification":"likely_identity_document","classification_confidence":0.7,"reason":"card"}\n```'),
    async () => {
      const r = await DocumentClassifier.classifyDocument(FRONT, null, null, 'national_id');
      assert.equal(r.classification, EVIDENCE_CLASSIFICATION.LIKELY_IDENTITY_DOCUMENT);
    },
  ));
  await withEnv(CLOUDFLARE_ENV, () => withFetch(cfReply('I cannot help with that.'), async () => {
    const r = await DocumentClassifier.classifyDocument(FRONT, null, null, 'national_id');
    assert.equal(r.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN, 'unparseable never becomes positive');
  }));
});

test('GMO-QWEN-8: an unknown classification value can never become a positive class', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply(JSON.stringify({ classification: 'definitely_a_real_id_trust_me', classification_confidence: 1 })),
    async () => {
      const r = await DocumentClassifier.classifyDocument(FRONT, null, null, 'national_id');
      assert.equal(r.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN);
    },
  ));
});

test('GMO-QWEN-9: a non-document BACK downgrades the pair instead of riding on a good front', async () => {
  const answers = [
    JSON.stringify({ classification: 'valid_identity_document', classification_confidence: 0.95, reason: 'front is a card' }),
    JSON.stringify({ classification: 'non_document', classification_confidence: 0.9, reason: 'a landscape photograph' }),
  ];
  let i = 0;
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { choices: [{ message: { content: answers[i++] }, finish_reason: 'stop' }] } }) }),
    async () => {
      const r = await DocumentClassifier.classifyDocument(FRONT, BACK, null, 'national_id');
      assert.equal(r.classification, EVIDENCE_CLASSIFICATION.UNCERTAIN, 'the back is genuinely read and can weaken the pair');
      assert.match(r.reason, /back is not a document/i);
    },
  ));
});

/* ── classification is not verification ────────────────────────────────────── */

test('GMO-QWEN-10: extraction does not run once classification rejects the evidence', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply(JSON.stringify({ classification: 'non_document', classification_confidence: 0.99, reason: 'a mug' })),
    async () => {
      const r = await DocumentClassifier.classify({ front: FRONT, back: BACK, selfie: SELFIE }, 'national_id');
      assert.equal(r.extractionAllowed, false);
      assert.equal(r.extractionTrust, 'not_run');
      assert.equal(r.reasonCode, 'NON_DOCUMENT');
    },
  ));
});

test('GMO-QWEN-11: a positive classification is an OBSERVATION — it mints no approval', async () => {
  await withEnv(CLOUDFLARE_ENV, () => withFetch(
    cfReply(JSON.stringify({ classification: 'valid_identity_document', classification_confidence: 1, reason: 'ok' })),
    async () => {
      const r = await DocumentClassifier.classify({ front: FRONT, back: BACK, selfie: SELFIE }, 'national_id');
      // Everything the classifier can say, and nothing that resembles a decision.
      for (const forbidden of ['approved', 'verified', 'decision', 'identity_state', 'lifecycle']) {
        assert.equal(Object.keys(r).includes(forbidden), false, `classification must not carry "${forbidden}"`);
      }
      assert.equal(r.extractionAllowed, true, 'it may only permit the NEXT observation');
    },
  ));
  // And the authority that does decide never consults a classification directly.
  const policy = read('backend/services/identity/decisionPolicy.js');
  assert.doesNotMatch(policy, /DocumentClassifier|classifyDocument/, 'the decision policy must not call the classifier');
  const lifecycle = read('backend/services/identity/identityLifecycleService.js');
  // Anchored on the DECLARATION, not the substring: renaming the constant used to leave this green.
  assert.match(lifecycle, /const APPROVAL_ONLY_STATES = new Set\(/, 'verified stays mintable only by governed approval');
  assert.match(lifecycle, /APPROVAL_ONLY_STATES\.has\(nextState\)/, 'and the guard must still consult it');
});

test('GMO-QWEN-12: the mock path is still sealed to NODE_ENV=test with an explicit flag', async () => {
  await withEnv({ ...CLOUDFLARE_ENV, NODE_ENV: 'production', ALLOW_OCR_MOCK: 'true' }, () => withFetch(
    cfReply(JSON.stringify({ classification: 'valid_identity_document', classification_confidence: 1, reason: 'ok' })),
    async () => {
      const r = await DocumentClassifier.classify({ front: FRONT, back: BACK, selfie: SELFIE }, 'national_id');
      assert.notEqual(r.provider, 'mock', 'production must never take the mock short-circuit');
      assert.equal(r.provider, 'cloudflare');
    },
  ));
});

test('GMO-QWEN-13: readiness describes the CONFIGURED provider, and the gate is EXECUTED not grepped', async () => {
  const server = read('backend/server.js');
  assert.match(server, /documentVision:/, 'health must report the configured document-vision provider');
  const harness = read('scripts/uat/gmo-8-acts-3-to-6.mjs');
  assert.match(harness, /assertDocumentVisionReady/, 'the UAT gate must use the shared rule');
  assert.doesNotMatch(harness, /GEMINI_API_KEY/, 'no hidden vendor condition may remain in the harness');

  // RUN the rule. The previous version of this test only grepped the harness for the word
  // "mockPermitted", and stayed green when the guard was disabled — the word was still there.
  const { assertDocumentVisionReady } = await import('../../scripts/uat/lib/documentVisionReadiness.mjs');
  const ready = { documentVision: { provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', configured: true, mockPermitted: false, requires: [] } };
  assert.deepEqual(assertDocumentVisionReady(ready), { id: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' });

  assert.throws(() => assertDocumentVisionReady({}), /does not report documentVision/);
  assert.throws(
    () => assertDocumentVisionReady({ documentVision: { ...ready.documentVision, mockPermitted: true } }),
    /permits MOCK OCR/,
  );
  assert.throws(
    () => assertDocumentVisionReady({ documentVision: { ...ready.documentVision, configured: false, requires: ['CLOUDFLARE_API_TOKEN'] } }),
    /NOT configured.*CLOUDFLARE_API_TOKEN/s,
  );
});

/* ── run-scoped fixture ownership ──────────────────────────────────────────
   Two certification runs shared this lane and this staging database at once. A cleanup written as
   a pattern sweep would have deleted the other run's live state mid-journey, and that run would
   have reported a product failure that was really the cleanup. */

test('GMO-QWEN-14: every persona a run creates carries the SAME run id', () => {
  const harness = read('scripts/uat/gmo-8-acts-3-to-6.mjs');
  for (const persona of ['owner', 'mech', 'cust']) {
    assert.match(
      harness,
      new RegExp(`gmo8\\.${persona}\\.\\$\\{stamp\\}@carup-uat\\.invalid`),
      `the ${persona} account must embed the run id`,
    );
  }
  assert.match(harness, /run_id: stamp/, 'the run id must reach report.json');
  assert.match(harness, /RUN ID \$\{stamp\}/, 'and be printed where an operator will see it');
});

test('GMO-QWEN-15: the cleanup owns what it deletes — no pattern sweep, and tenant_users is scoped', () => {
  const raw = read('scripts/uat/gmo-8-cleanup.sql');
  // Assert on the STATEMENTS, not the prose. The file quotes the dangerous pattern in a comment to
  // explain why it is forbidden — matching that would have failed the file for documenting itself.
  const sql = raw.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  // The failure this prevents: `LIKE 'gmo8.owner.%'` matches EVERY run, not this one.
  assert.doesNotMatch(sql, /LIKE\s+'gmo8[^']*%'/i, 'no wildcard match on the persona emails');
  assert.doesNotMatch(sql, /DELETE FROM public\.users\s+WHERE email/i, 'accounts are addressed by id, resolved from exact emails');

  // Every delete must be scoped to this run's users or this run's tenant.
  const deletes = [...sql.matchAll(/DELETE FROM ([\w.]+)([\s\S]*?);/g)];
  assert.ok(deletes.length >= 15, 'the cleanup must cover the consequential tables');
  for (const [, table, body] of deletes) {
    assert.ok(
      /gmo8_run_users|gmo8_run_tenants/.test(body),
      `DELETE FROM ${table} is not scoped to this run`,
    );
  }

  // tenant_users is the consequential membership table and is named explicitly.
  assert.match(sql, /DELETE FROM public\.tenant_users[\s\S]*?gmo8_run_tenants/, 'tenant_users must be covered and scoped');
  // A mistyped run id must not read as a successful cleanup of nothing.
  assert.match(raw, /refusing to run a cleanup that owns nothing/i);
  // And it must not try to defeat the storage protection.
  assert.doesNotMatch(sql, /storage\.objects/, 'storage deletion is debt, not something to force here');
});
