/**
 * OC-5R-PROV-01 D2 — the governed live-provider smoke harness and its workflow.
 *
 * The workflow must stay: workflow_dispatch only, never in or against an `environment:` (so never
 * production), exact-SHA asserted, credentials injected per selected provider and never echoed.
 * The harness must: classify a missing credential as NOT_CONFIGURED (never a simulated success),
 * refuse production markers, never let a credential reach its evidence, write nothing, and emit
 * the fields a LIVE-PROVIDER receipt is built from. No test here touches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const smoke = await import('./tools/liveProviderSmoke.mjs');

const WORKFLOW = readFileSync(new URL('../../.github/workflows/oc5r-live-provider-smoke.yml', import.meta.url), 'utf8');

/** The `on:` block only — so a `push:` inside a step or a comment cannot fool the guard. */
function onBlock(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^on:/.test(l));
  assert.ok(start > -1, 'the workflow must declare an on: block');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^[A-Za-z_]/.test(l));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n');
}

const ECB_XML = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-10-06'>
  <Cube currency='USD' rate='1.1622'/><Cube currency='JPY' rate='181.59'/></Cube></Cube></gesmes:Envelope>`;

// ── the workflow ────────────────────────────────────────────────────────────────────────────────

test('D2 workflow: workflow_dispatch ONLY — no automatic live-provider execution', () => {
  const on = onBlock(WORKFLOW);
  assert.match(on, /^\s{2}workflow_dispatch:/m);
  for (const [pattern, name] of [[/^\s{2}push:/m, 'push'], [/^\s{2}pull_request(_target)?:/m, 'pull_request'],
    [/^\s{2}schedule:/m, 'schedule'], [/^\s{2}workflow_run:/m, 'workflow_run'], [/^\s{2}repository_dispatch:/m, 'repository_dispatch']]) {
    assert.doesNotMatch(on, pattern, `the smoke workflow must not trigger on ${name}`);
  }
});

test('D2 workflow: never runs in a deployment environment (so never production)', () => {
  assert.doesNotMatch(WORKFLOW, /^\s+environment:/m, 'no job may target an environment');
  assert.doesNotMatch(WORKFLOW, /PRODUCTION_/, 'no production-scoped secret may be referenced');
});

test('D2 workflow: the exact candidate SHA is checked out and asserted', () => {
  assert.match(WORKFLOW, /EXPECTED_HEAD_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(WORKFLOW, /ref: \$\{\{ env\.EXPECTED_HEAD_SHA \}\}/);
  assert.match(WORKFLOW, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_HEAD_SHA"/);
});

test('D2 workflow: each credential is injected only for its own provider and never echoed', () => {
  const owners = {
    CLOUDFLARE_ACCOUNT_ID: 'gemma', CLOUDFLARE_API_TOKEN: 'gemma', RESEND_API_KEY: 'resend',
    CARUP_TELEGRAM_BOT_TOKEN: 'telegram', CARUP_META_ACCESS_TOKEN: 'meta_whatsapp', CARUP_META_PHONE_NUMBER_ID: 'meta_whatsapp', CARUP_META_WABA_ID: 'meta_whatsapp',
  };
  const refs = [...WORKFLOW.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, 'the workflow reaches real provider credentials');
  for (const name of refs) {
    const line = WORKFLOW.split('\n').find((l) => l.includes(`secrets.${name}`));
    if (owners[name]) assert.match(line, new RegExp(`github\\.event\\.inputs\\.provider == '${owners[name]}' && secrets\\.${name} \\|\\| ''`), name);
    assert.doesNotMatch(line, /\brun:|echo/, `${name} must never reach a run/echo line`);
  }
  // No step prints an environment credential.
  for (const name of Object.keys(owners)) {
    assert.doesNotMatch(WORKFLOW, new RegExp(`echo[^\\n]*\\$\\{?${name}`), `${name} must never be echoed`);
  }
});

// ── the harness ─────────────────────────────────────────────────────────────────────────────────

test('D2 harness: a missing credential is NOT_CONFIGURED (exit 2), never a simulated success', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); throw new Error('must not be called'); };
  for (const provider of ['gemma', 'resend', 'telegram', 'meta_whatsapp']) {
    const ev = await smoke.runSmoke(provider, { env: {}, fetchImpl, gateway: async () => { throw new Error('must not be called'); } });
    assert.equal(ev.status, 'NOT_CONFIGURED', provider);
    assert.equal(smoke.exitCodeFor(ev), 2, provider);
    assert.ok(Array.isArray(ev.missing) && ev.missing.length > 0, provider);
  }
  assert.deepEqual(calls, []);
});

test('D2 harness: a production marker refuses the run before any request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, text: async () => ECB_XML }; };
  for (const env of [{ CARUP_ENV: 'production' }, { VERCEL_ENV: 'Production' }]) {
    const ev = await smoke.runSmoke('ecb', { env, fetchImpl });
    assert.equal(ev.status, 'REFUSED', JSON.stringify(env));
    assert.equal(smoke.exitCodeFor(ev), 1);
  }
  assert.equal(called, false);
});

test('D2 harness: a credential never reaches the evidence, even when the provider error quotes the URL', async () => {
  const token = '123456789:AAHsecret-telegram-token-value';
  const fetchImpl = async (url) => { throw new Error(`request to ${url} failed`); };
  const ev = await smoke.runSmoke('telegram', { env: { CARUP_TELEGRAM_BOT_TOKEN: token }, fetchImpl });
  assert.equal(ev.status, 'FAILED');
  assert.equal(JSON.stringify(ev).includes(token), false, 'the token leaked into the evidence');
  assert.equal(JSON.stringify(ev).includes(encodeURIComponent(token)), false, 'the encoded token leaked into the evidence');
  assert.match(ev.result, /\[redacted\]/);
});

test('D2 harness: a success carries every field a LIVE-PROVIDER receipt needs, and writes nothing', async () => {
  const from = supabase.from;
  let dbCalls = 0;
  supabase.from = (...a) => { dbCalls += 1; return from.apply(supabase, a); };
  try {
    const ev = await smoke.runSmoke('ecb', {
      env: {}, sha: 'c'.repeat(40), run: { id: '1', workflow: 'w' },
      fetchImpl: async () => ({ ok: true, text: async () => ECB_XML }),
      now: () => new Date('2026-10-07T12:00:00.000Z'),
    });
    assert.equal(ev.status, 'SUCCEEDED');
    assert.equal(ev.schema, smoke.SMOKE_SCHEMA);
    for (const field of ['request_class', 'execution_evidence', 'result', 'executed_at', 'not_claimed']) {
      assert.ok(ev[field], `missing ${field}`);
    }
    assert.ok(ev.provider.name && ev.provider.model);
    assert.deepEqual(ev.mocked_components, []);
    assert.equal(ev.executed_at, '2026-10-07T12:00:00.000Z');
    assert.equal(ev.execution_evidence.zwg_published, false);
    assert.equal(ev.execution_evidence.jpy_usd_triangulated, true);
  } finally {
    supabase.from = from;
  }
  assert.equal(dbCalls, 0, 'a smoke must not touch the database');
});

test('D2 harness: messaging providers call READ endpoints only', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url).replace(/bot[^/]+\//, 'bot<token>/'), method: init.method || 'GET', body: init.body });
    if (String(url).includes('telegram')) return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'carup_bot', is_bot: true } }) };
    if (String(url).includes('resend')) return { ok: true, status: 200, json: async () => ({ data: [{ name: 'carup.dev', status: 'verified' }] }) };
    return { ok: true, status: 200, json: async () => ({ verified_name: 'CarUp', quality_rating: 'GREEN', data: [{ name: 'otp', status: 'APPROVED', language: 'en' }] }) };
  };
  const env = { RESEND_API_KEY: 're_x_secret_value', CARUP_TELEGRAM_BOT_TOKEN: '1:secret_token_value', CARUP_META_ACCESS_TOKEN: 'EAA_secret_value', CARUP_META_PHONE_NUMBER_ID: '111', CARUP_META_WABA_ID: '222' };
  for (const provider of ['resend', 'telegram', 'meta_whatsapp']) {
    const ev = await smoke.runSmoke(provider, { env, fetchImpl });
    assert.equal(ev.status, 'SUCCEEDED', provider);
    for (const v of Object.values(env)) if (v.length > 5) assert.equal(JSON.stringify(ev).includes(v), false, `${provider} leaked a credential`);
  }
  for (const r of seen) {
    assert.equal(r.method, 'GET', `${r.url} must be a read`);
    assert.equal(r.body, undefined);
    assert.doesNotMatch(r.url, /sendMessage|\/messages|\/emails/, `${r.url} would message someone`);
  }
});

test('D2 harness: an unknown provider is refused', async () => {
  const ev = await smoke.runSmoke('twitter', { env: {} });
  assert.equal(ev.status, 'REFUSED');
});

test('D2 harness: the Gemma leg goes through CarUp\'s own advisory gateway and records what it executed', async () => {
  const { gemmaGatewaySmoke } = await import('./tools/liveProviderSmokeGemma.mjs');
  const prompts = [];
  const gateway = {
    inspect: () => ({ ok: true, authority: 'advisory', runtime: { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', configured: true } }),
    async generateJson(input) {
      prompts.push(input);
      return { ok: true, machine_output: true, authority: 'advisory', value: { ok: true }, usage: { prompt_tokens: 20, completion_tokens: 5 },
        provenance: { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', execution: 'provider_executed', authority: 'advisory' } };
    },
  };
  const out = await gemmaGatewaySmoke({}, { gateway });
  assert.equal(out.status, 'SUCCEEDED');
  assert.equal(out.provider.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(out.execution_evidence.execution, 'provider_executed');
  assert.equal(out.execution_evidence.runtime.authority, 'advisory');
  assert.equal(prompts.length, 1, 'exactly one provider call');
  assert.doesNotMatch(JSON.stringify(prompts), /vin|email|phone|@carup/i, 'the prompt carries no customer data');

  // Through runSmoke: credentials gate the call, the evidence is receipt-shaped.
  const ev = await smoke.runSmoke('gemma', {
    env: { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf-token-secret-value' },
    gateway: () => gemmaGatewaySmoke({}, { gateway }),
  });
  assert.equal(ev.status, 'SUCCEEDED');
  assert.equal(ev.provider.name, 'Cloudflare Workers AI');
  assert.equal(JSON.stringify(ev).includes('cf-token-secret-value'), false);
});
