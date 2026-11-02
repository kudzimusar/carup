/**
 * OC-5R-REL-01 — OCR custody, and the runtime identity a deployed preview must be able to prove.
 *
 * OCR custody: `CARUP_OCR_MODEL` could select any model with a probed transport — Gemma included — in
 * any runtime, and `CARUP_OCR_PROVIDER=gemini` was honoured in production. Every reading would then
 * have been attributed to whatever the variable said. Now, in a deployed runtime, OCR is Cloudflare +
 * Qwen or it fails closed; the governed evaluation workflows keep an explicit seam that a declared
 * deployment can never open; local/test experimentation is unchanged; Gemma's advisory role is not
 * touched.
 *
 * Runtime identity (/api/health): which Supabase project the runtime reaches (refs only — never a
 * URL or a credential), the OCR custody state, and whether the outbound kill switch is active.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const OCR = await import('../services/ai/ocrVisionProvider.js');
const { CLOUDFLARE_VISION_MODEL } = await import('../services/ai/CloudflareVisionClient.js');
const { CARUP_AI_MODEL } = await import('../services/ai/aiRuntimeConfig.js');
const DB = await import('../config/databaseTarget.js');

const QWEN = '@cf/qwen/qwen3.8-27b';
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const LLAMA = '@cf/meta/llama-3.2-11b-vision-instruct';
const DECLARED = [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }, { CARUP_ENV: 'staging' }, { CARUP_ENV: 'production' }];

// ── OCR custody ───────────────────────────────────────────────────────────────────────────────
test('custody: the canonical OCR model is Qwen, and Gemma is still the general advisory model', () => {
  assert.equal(OCR.CANONICAL_OCR_MODEL, QWEN);
  assert.equal(CLOUDFLARE_VISION_MODEL, QWEN);
  assert.equal(OCR.CANONICAL_OCR_PROVIDER, 'cloudflare');
  assert.equal(CARUP_AI_MODEL, GEMMA, 'REL-01 does not touch Gemma\'s advisory role');
});

for (const deployment of [...DECLARED, { NODE_ENV: 'production' }]) {
  test(`custody: a deployed runtime ${JSON.stringify(deployment)} refuses a non-canonical OCR model — Gemma or anything else`, () => {
    for (const model of [GEMMA, 'some/unknown-model']) {
      assert.throws(() => OCR.resolveCloudflareModel({ ...deployment, CARUP_OCR_MODEL: model }),
        (e) => e instanceof OCR.OcrCustodyError && e.code === 'OCR_CUSTODY_REFUSED', `${model} accepted`);
    }
    assert.equal(OCR.resolveCloudflareModel({ ...deployment }), QWEN, 'no override → Qwen');
    assert.equal(OCR.resolveCloudflareModel({ ...deployment, CARUP_OCR_MODEL: QWEN }), QWEN, 'override equal to canonical is fine');
    assert.equal(OCR.resolveCloudflareModel({ ...deployment, CARUP_OCR_MODEL: '   ' }), QWEN, 'a blank override is no override');
  });

  test(`custody: a deployed runtime ${JSON.stringify(deployment)} refuses a non-canonical OCR provider`, () => {
    assert.throws(() => OCR.resolveVisionProvider({ ...deployment, CARUP_OCR_PROVIDER: 'gemini' }),
      (e) => e instanceof OCR.OcrCustodyError && e.code === 'OCR_CUSTODY_REFUSED');
    assert.equal(OCR.resolveVisionProvider({ ...deployment }).id, 'cloudflare');
    assert.equal(OCR.resolveVisionProvider({ ...deployment, CARUP_OCR_PROVIDER: 'cloudflare' }).id, 'cloudflare');
  });
}

test('custody: a declared deployment can never open the evaluation seam', () => {
  for (const deployment of DECLARED) {
    const env = { ...deployment, NODE_ENV: 'production', [OCR.OCR_EVALUATION_SEAM]: 'governed' };
    assert.equal(OCR.ocrOverrideSeamOpen(env), false, JSON.stringify(deployment));
    assert.throws(() => OCR.resolveCloudflareModel({ ...env, CARUP_OCR_MODEL: GEMMA }), OCR.OcrCustodyError);
    assert.throws(() => OCR.resolveVisionProvider({ ...env, CARUP_OCR_PROVIDER: 'gemini' }), OCR.OcrCustodyError);
  }
});

test('custody: the governed evaluation (NODE_ENV=production, explicit seam) may qualify another model', () => {
  const env = { NODE_ENV: 'production', [OCR.OCR_EVALUATION_SEAM]: 'governed' };
  assert.equal(OCR.resolveCloudflareModel({ ...env, CARUP_OCR_MODEL: GEMMA }), GEMMA);
  assert.throws(() => OCR.resolveCloudflareModel({ NODE_ENV: 'production', [OCR.OCR_EVALUATION_SEAM]: 'yes', CARUP_OCR_MODEL: GEMMA }), OCR.OcrCustodyError,
    'only the exact seam value opens it');
  assert.throws(() => OCR.resolveCloudflareModel({ ...env, CARUP_OCR_MODEL: LLAMA }), /Refusing to use/, 'a REJECTED model stays rejected inside the seam');
});

test('custody: local / test experimentation keeps its controlled seam unchanged', () => {
  assert.equal(OCR.resolveCloudflareModel({ NODE_ENV: 'test', CARUP_OCR_MODEL: GEMMA }), GEMMA);
  assert.equal(OCR.resolveVisionProvider({ NODE_ENV: 'test', CARUP_OCR_PROVIDER: 'gemini' }).id, 'gemini');
  assert.throws(() => OCR.resolveCloudflareModel({ NODE_ENV: 'test', CARUP_OCR_MODEL: LLAMA }), /Refusing to use/);
});

test('custody: both governed evaluation workflows open the seam explicitly, and only manual dispatch runs them', () => {
  for (const file of ['o2-live-ocr-accuracy.yml', 'o2-ocr-schema-probe.yml']) {
    const src = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(src, /\n {6}NODE_ENV: production\n/, file);
    assert.match(src, /\n {6}CARUP_OCR_MODEL_EVALUATION: governed\n/, file);
    assert.match(src, /\non:\n {2}workflow_dispatch:/, `${file} must stay manual-only`);
    assert.doesNotMatch(src, /\n {2}(push|pull_request|schedule|workflow_run):/, file);
  }
});

// ── Database target ───────────────────────────────────────────────────────────────────────────
const REF = 'abcdefghijklmnopqrst';
const OTHER = 'zyxwvutsrqponmlkjihg';
// Fake passwords are interpolated, never written inline: CR-1 forbids a credential-bearing URI literal.
const PW = 'pw-secret';
const PW_VALUE = 'pw-secret-value';
// A real-world password shape the WHATWG URL parser rejects: unencoded '#', '/', '?' and '@'.
const HARD = 'p#a/s?s@w0rd';

test('database target: refs are read by shape from every endpoint form, and nothing else is returned', () => {
  assert.equal(DB.refFromSupabaseUrl(`https://${REF}.supabase.co`), REF);
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres.${REF}:${PW}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`), REF);
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres:${PW}@db.${REF}.supabase.co:5432/postgres`), REF);
  assert.equal(DB.refFromPostgresUrl(`ppostgresql://postgres.${REF}:pw@host.invalid:6543/postgres`), REF, 'a scheme typo does not hide the ref');
  for (const junk of ['', 'not a url', 'postgresql://user:pw@localhost:5432/db', 'http://localhost:54321']) {
    assert.equal(DB.refFromPostgresUrl(junk), null, junk);
  }
  const target = DB.resolveDatabaseTarget({
    SUPABASE_URL: `https://${REF}.supabase.co`,
    DATABASE_URL: `postgresql://postgres.${REF}:${PW}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres:${PW}@db.${REF}.supabase.co:5432/postgres`,
  });
  assert.deepEqual(target, { supabase_project_ref: REF, postgres_project_refs: [REF], unrecognised_endpoints: 0, unrecognised_endpoint_names: [], consistent: true });
  assert.ok(!JSON.stringify(target).includes('pw-secret') && !JSON.stringify(target).includes('pooler'));
});

test('database target: a password the URL parser rejects is still read — and never returned', () => {
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres.${REF}:${HARD}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`), REF);
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres:${HARD}@db.${REF}.supabase.co:5432/postgres`), REF);
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres.${REF}:${PW}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?application_name=a@b`), REF,
    'an @ in the query string does not move the host');
  const target = DB.resolveDatabaseTarget({ SUPABASE_URL: `https://${REF}.supabase.co`, DATABASE_URL: `postgresql://postgres:${HARD}@db.${REF}.supabase.co:5432/postgres` });
  assert.equal(target.consistent, true);
  assert.ok(!JSON.stringify(target).includes(HARD));
});

test('database target: readings that disagree are ambiguous, not guessed', () => {
  const sneaky = `pw@db.${OTHER}.supabase.co:5432`;
  assert.equal(DB.refFromPostgresUrl(`postgresql://postgres:${sneaky}@db.${REF}.supabase.co:5432/postgres`), null);
});

test('database target: an unreadable endpoint is named and makes the target inconsistent', () => {
  const target = DB.resolveDatabaseTarget({ SUPABASE_URL: `https://${REF}.supabase.co`, DATABASE_URL: 'not a connection string', DIRECT_URL: `postgresql://postgres:${PW}@db.${REF}.supabase.co:5432/postgres` });
  assert.deepEqual(target.unrecognised_endpoint_names, ['DATABASE_URL']);
  assert.equal(target.unrecognised_endpoints, 1);
  assert.equal(target.consistent, false, 'one endpoint cannot be shown to agree');
  assert.ok(!JSON.stringify(target).includes('not a connection string'), 'names, never values');
});

test('database target: two projects behind one runtime are reported as inconsistent', () => {
  const target = DB.resolveDatabaseTarget({
    SUPABASE_URL: `https://${REF}.supabase.co`,
    DATABASE_URL: `postgresql://postgres.${OTHER}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  });
  assert.equal(target.consistent, false);
  assert.deepEqual(target.postgres_project_refs, [OTHER]);
  assert.equal(DB.resolveDatabaseTarget({}).consistent, false, 'nothing configured is not "consistent"');
});

// ── /api/health ───────────────────────────────────────────────────────────────────────────────
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
let server; let baseUrl; const realFrom = supabase.from;
before(async () => {
  supabase.from = () => {
    const q = { select() { return q; }, eq() { return q; }, is() { return q; }, in() { return q; }, not() { return q; }, limit() { return q; },
      then(res) { return Promise.resolve({ data: [], count: 0, error: null }).then(res); } };
    return q;
  };
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function healthWith(env) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    const res = await fetch(`${baseUrl}/api/health`, { headers: { 'x-bypass-rate-limit': 'true' } });
    return { text: await res.clone().text(), body: await res.json() };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('health: OCR custody is reported — canonical by default, refused for a deployed override', async () => {
  const canonical = await healthWith({ CARUP_OCR_MODEL: undefined, CARUP_OCR_PROVIDER: undefined });
  assert.deepEqual(canonical.body.ocr.custody, { canonical_provider: 'cloudflare', canonical_model: QWEN, status: 'canonical' });
  assert.equal(canonical.body.ocr.selectedModel, QWEN);

  const refused = await healthWith({ VERCEL_ENV: 'preview', CARUP_OCR_MODEL: GEMMA });
  assert.equal(refused.body.ocr.custody.status, 'refused');
  assert.equal(refused.body.ocr.selectedModel, null, 'a refused override is never reported as the running model');
  assert.match(refused.body.ocr.error, /OCR custody is/);

  const provider = await healthWith({ VERCEL_ENV: 'preview', CARUP_OCR_PROVIDER: 'gemini' });
  assert.equal(provider.body.ocr.custody.status, 'refused');
  assert.equal(provider.body.ocr.selectedProvider, null);
});

test('health: the outbound kill switch state is reported', async () => {
  const on = await healthWith({ COMMUNICATION_OUTBOUND_DISABLED: 'true' });
  assert.deepEqual(on.body.communications.outbound, { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled', control: 'COMMUNICATION_OUTBOUND_DISABLED' });
  const off = await healthWith({ COMMUNICATION_OUTBOUND_DISABLED: undefined });
  assert.equal(off.body.communications.outbound.kill_switch, 'inactive');
});

test('health: the database target is reported as refs only — never a URL or a credential', async () => {
  const { body, text } = await healthWith({
    SUPABASE_URL: `https://${REF}.supabase.co`,
    DATABASE_URL: `postgresql://postgres.${REF}:${PW_VALUE}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  });
  assert.equal(body.database.supabase_project_ref, REF);
  assert.deepEqual(body.database.postgres_project_refs, [REF]);
  assert.equal(body.database.consistent, true);
  assert.deepEqual(body.database.unrecognised_endpoint_names, []);
  for (const leak of ['pw-secret-value', 'pooler.supabase.com', 'postgresql://']) assert.ok(!text.includes(leak), `health leaked ${leak}`);
});
