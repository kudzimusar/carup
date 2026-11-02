/**
 * OC-4F Phase 8 — the provider smoke harness is safe by construction.
 *
 * PLAN is the default and touches no network; LIVE is refused unless explicitly authorized,
 * exact-head, and aimed at an allow-listed staging/local host — production is refused whatever else
 * is set. No configuration VALUE is ever printed. Live behaviour is proven against a local fake
 * backend, including the failures it exists to catch (wrong commit, OCR moved to Gemma, a mock
 * reachable, a visitor costing inference, an ungated ledger route).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { runProviderSmoke, refusalForBaseUrl, OCR_MODEL, AI_MODEL, FAKE_VIN } = await import('../scripts/one-carup-provider-smoke.mjs');

const SHA = 'b2493285806de3c260de8f55d3e82e49b766dcd8';
const SECRETS = {
  CLOUDFLARE_ACCOUNT_ID: 'acct-SENTINEL-VALUE-1', CLOUDFLARE_API_TOKEN: 'tok-SENTINEL-VALUE-2',
  SUPABASE_URL: 'https://sentinel.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk-SENTINEL-VALUE-3',
  JWT_SECRET: 'jwt-SENTINEL-VALUE-4', CARUP_SMOKE_SESSION_TOKEN: 'sess-SENTINEL-VALUE-5',
};
const noNetwork = async () => { throw new Error('the harness made a network call it must not make'); };

async function run(argv, { env = {}, fetchImpl = noNetwork } = {}) {
  let text = '';
  const { exitCode, report } = await runProviderSmoke({ argv, env, fetchImpl, write: (s) => { text += s; } });
  return { exitCode, report, text };
}

test('PLAN is the default: no network call, every check listed, configuration by NAME only', async () => {
  const r = await run(['--env', 'staging'], { env: { ...SECRETS, CARUP_SMOKE_AUTHORIZED: 'yes' } });
  assert.equal(r.exitCode, 0);
  assert.equal(r.report.mode, 'plan');
  assert.deepEqual(r.report.checks.map((c) => c.id), ['provenance', 'ocr', 'ai', 'anonymous-ai', 'ledger-gate', 'advisory-call']);
  assert.deepEqual(r.report.checks.filter((c) => c.spendsProviderCapacity).map((c) => c.id), ['advisory-call'], 'exactly one check can spend provider capacity');
  const statuses = r.report.configuration.flatMap((a) => a.variables.map((v) => v.status));
  assert.ok(statuses.includes('set') && statuses.includes('missing'), 'set and missing are both reported');
  for (const value of Object.values(SECRETS)) assert.equal(r.text.includes(value), false, 'no configuration value is ever printed');
});

test('production is refused outright — by --env and by host, whatever else is authorized', async () => {
  const byEnv = await run(['--env', 'production', '--live', '--base-url', 'https://api.carup.dev', '--expected-sha', SHA], { env: { ...SECRETS, CARUP_SMOKE_AUTHORIZED: 'yes' } });
  assert.equal(byEnv.exitCode, 2);
  assert.match(byEnv.report.reason, /production/);
  for (const host of ['https://api.carup.dev', 'https://carup.dev', 'https://www.carup.dev']) {
    const byHost = await run(['--env', 'staging', '--live', '--base-url', host, '--expected-sha', SHA], { env: { ...SECRETS, CARUP_SMOKE_AUTHORIZED: 'yes' } });
    assert.equal(byHost.exitCode, 2, host);
    assert.match(byHost.report.reason, /PRODUCTION/, host);
  }
});

test('LIVE is refused without per-run authorization, an allow-listed host, or the exact commit', async () => {
  const unauthorized = await run(['--env', 'staging', '--live', '--base-url', 'https://carup-backend-staging.vercel.app', '--expected-sha', SHA], { env: SECRETS });
  assert.equal(unauthorized.exitCode, 2);
  assert.match(unauthorized.report.reason, /CARUP_SMOKE_AUTHORIZED/);
  const env = { ...SECRETS, CARUP_SMOKE_AUTHORIZED: 'yes' };
  const unknownHost = await run(['--env', 'staging', '--live', '--base-url', 'https://carup-backend.vercel.app', '--expected-sha', SHA], { env });
  assert.equal(unknownHost.exitCode, 2, 'fail closed: an unlisted host is refused');
  const noSha = await run(['--env', 'staging', '--live', '--base-url', 'https://carup-backend-staging.vercel.app'], { env });
  assert.equal(noSha.exitCode, 2);
  assert.match(noSha.report.reason, /expected-sha/);
  const shortSha = await run(['--env', 'staging', '--live', '--base-url', 'https://carup-backend-staging.vercel.app', '--expected-sha', 'b2493285'], { env });
  assert.equal(shortSha.exitCode, 2, 'a short sha is not an exact-head pairing');
});

test('the host allow-list is exact', () => {
  assert.equal(refusalForBaseUrl('https://carup-backend-staging.vercel.app'), null);
  assert.equal(refusalForBaseUrl('https://api-staging.carup.dev'), null);
  assert.equal(refusalForBaseUrl('https://carup-backend-staging-git-rc1-team.vercel.app'), null, 'a staging-backend preview');
  assert.equal(refusalForBaseUrl('http://localhost:4000'), null);
  assert.notEqual(refusalForBaseUrl('http://carup-backend-staging.vercel.app'), null, 'remote targets must use https');
  assert.notEqual(refusalForBaseUrl('https://carup-backend-staging.vercel.app.evil.example'), null, 'no look-alikes');
  assert.notEqual(refusalForBaseUrl('https://carup-staging.vercel.app'), null, 'the staging FRONTEND is not the backend');
});

/** A local fake CarUp backend whose answers each test can bend. */
async function fakeBackend(overrides = {}) {
  const calls = [];
  const healthy = {
    status: 'UP', build: { commit_sha: SHA, environment: 'staging' },
    ocr: { selectedProvider: 'cloudflare', selectedModel: OCR_MODEL, configured: true, mockRuntimeAllowed: false },
    ai: { provider: 'cloudflare', model: AI_MODEL, configured: true, authority: 'advisory' },
  };
  const server = http.createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, session: req.headers['x-session-token'] || null });
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/health') return send(200, { ...healthy, ...(overrides.health || {}) });
    if (req.url === '/api/marketplace/ai/buyer-assistant') return send(200, overrides.guest || { guidance: ['Use the verified inquiry flow.'], ai_available: false, ai_reason: 'sign_in_required' });
    if (req.url === `/api/vehicles/${FAKE_VIN}/verify-ledger`) return send(overrides.ledgerStatus || 401, { error: 'Unauthorized' });
    if (req.url === '/api/ai/fraud-scan') return send(200, { advisory: true, provider: 'cloudflare', model: AI_MODEL });
    return send(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

const liveArgs = (base, extra = []) => ['--env', 'local', '--live', '--base-url', base, '--expected-sha', SHA, ...extra];
const authorized = { ...SECRETS, CARUP_SMOKE_AUTHORIZED: 'yes' };

test('LIVE against a correct deployment: every check passes, and no provider capacity is spent by default', async () => {
  const fake = await fakeBackend();
  try {
    const r = await run(liveArgs(fake.base), { env: authorized, fetchImpl: fetch });
    assert.equal(r.exitCode, 0, r.text);
    assert.equal(r.report.verdict, 'PASS');
    assert.equal(r.report.results.find((x) => x.id === 'advisory-call').status, 'SKIPPED');
    assert.equal(fake.calls.some((c) => c.url === '/api/ai/fraud-scan'), false, 'no paid call unless asked');
    assert.ok(fake.calls.filter((c) => c.method === 'POST').every((c) => !/verif/i.test(c.url)), 'never a POST to a verification endpoint');
    for (const value of Object.values(SECRETS)) assert.equal(r.text.includes(value), false);
  } finally { await fake.close(); }
});

test('LIVE fails on exactly the defects it exists to catch', async () => {
  const cases = [
    ['a different commit is deployed', { health: { build: { commit_sha: 'f'.repeat(40) } } }, 'provenance'],
    ['OCR was moved to Gemma', { health: { ocr: { selectedProvider: 'cloudflare', selectedModel: AI_MODEL, configured: true, mockRuntimeAllowed: false } } }, 'ocr'],
    ['an OCR mock is reachable', { health: { ocr: { selectedProvider: 'cloudflare', selectedModel: OCR_MODEL, configured: true, mockRuntimeAllowed: true } } }, 'ocr'],
    ['general AI is not the pinned gateway', { health: { ai: { provider: 'gemini', model: 'gemini-1.5', configured: true, authority: 'advisory' } } }, 'ai'],
    ['a visitor got paid inference', { guest: { guidance: ['AI says buy'], ai_available: true, ai_reason: null } }, 'anonymous-ai'],
    ['the ledger route is ungated', { ledgerStatus: 200 }, 'ledger-gate'],
  ];
  for (const [label, overrides, failingId] of cases) {
    const fake = await fakeBackend(overrides);
    try {
      const r = await run(liveArgs(fake.base), { env: authorized, fetchImpl: fetch });
      assert.equal(r.exitCode, 1, `${label}: must fail`);
      assert.deepEqual(r.report.results.filter((x) => x.status === 'FAIL').map((x) => x.id), [failingId], label);
    } finally { await fake.close(); }
  }
});

test('the one paid check needs both --provider-calls and a session, and then makes exactly one call', async () => {
  const fake = await fakeBackend();
  try {
    const { CARUP_SMOKE_SESSION_TOKEN, ...noSession } = authorized;
    const without = await run(liveArgs(fake.base, ['--provider-calls']), { env: noSession, fetchImpl: fetch });
    assert.equal(without.report.results.find((x) => x.id === 'advisory-call').status, 'SKIPPED');
    assert.equal(fake.calls.filter((c) => c.url === '/api/ai/fraud-scan').length, 0, 'never an anonymous paid call');

    const withSession = await run(liveArgs(fake.base, ['--provider-calls']), { env: authorized, fetchImpl: fetch });
    assert.equal(withSession.report.results.find((x) => x.id === 'advisory-call').status, 'PASS');
    const scans = fake.calls.filter((c) => c.url === '/api/ai/fraud-scan');
    assert.equal(scans.length, 1, 'exactly one provider-spending call');
    assert.equal(scans[0].session, CARUP_SMOKE_SESSION_TOKEN, 'sent as a header, never printed');
    assert.equal(withSession.text.includes(CARUP_SMOKE_SESSION_TOKEN), false);
  } finally { await fake.close(); }
});
