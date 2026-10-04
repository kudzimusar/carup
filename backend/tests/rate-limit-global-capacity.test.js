/**
 * Global rate limiter: client-IP ordering, truthful headers, and a staging-only capacity.
 *
 * Adversarial by design. Production must ignore every override, a lookalike of the staging host
 * must not qualify, an override can never disable or undercut the limiter, sensitive-route limits
 * are untouched, and the headers must tell the same story as the refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  rateLimiter,
  rateLimitHeaders,
  resolveGlobalRateLimitMax,
  isStagingDeployment,
  GLOBAL_RATE_LIMIT_DEFAULT_MAX,
  STAGING_GLOBAL_RATE_LIMIT_DEFAULT_MAX,
  STAGING_GLOBAL_RATE_LIMIT_BOUNDS,
} = await import('../middleware/securityMiddleware.js');

const STAGING_URL = 'https://eoyenigwevnxwwhyhaer.supabase.co';
const PROD_URL = 'https://someproductionref.supabase.co';

// ── staging identity ──────────────────────────────────────────────────────────

test('staging is proven by the database, not by a label', () => {
  assert.equal(isStagingDeployment({ SUPABASE_URL: STAGING_URL }), true);
  assert.equal(isStagingDeployment({ SUPABASE_URL: STAGING_URL, VERCEL_ENV: 'preview' }), true);
  // Positive control above; everything below must refuse.
  assert.equal(isStagingDeployment({ SUPABASE_URL: PROD_URL, CARUP_ENV: 'staging' }), false, 'a staging label on the production database is not staging');
  assert.equal(isStagingDeployment({ SUPABASE_URL: PROD_URL, VERCEL_ENV: 'preview' }), false, 'a production-project preview is not staging');
});

test('any production signal wins over the staging database', () => {
  assert.equal(isStagingDeployment({ SUPABASE_URL: STAGING_URL, CARUP_ENV: 'production' }), false);
  assert.equal(isStagingDeployment({ SUPABASE_URL: STAGING_URL, VERCEL_ENV: 'production' }), false);
});

test('lookalike and malformed hosts do not qualify', () => {
  for (const url of [
    'https://eoyenigwevnxwwhyhaer.supabase.co.attacker.example',
    'https://evil-eoyenigwevnxwwhyhaer.supabase.co',
    'https://attacker.example/eoyenigwevnxwwhyhaer.supabase.co',
    'eoyenigwevnxwwhyhaer.supabase.co',
    '',
    undefined,
  ]) {
    assert.equal(isStagingDeployment({ SUPABASE_URL: url }), false, `must refuse ${url}`);
  }
});

// ── capacity resolution ──────────────────────────────────────────────────────

test('production keeps the default and ignores the override variable', () => {
  for (const env of [
    { SUPABASE_URL: PROD_URL, CARUP_ENV: 'production', CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: '2000' },
    { SUPABASE_URL: STAGING_URL, VERCEL_ENV: 'production', CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: '2000' },
    { SUPABASE_URL: PROD_URL, CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: '2000' },
  ]) {
    assert.deepEqual(resolveGlobalRateLimitMax(env), { max: GLOBAL_RATE_LIMIT_DEFAULT_MAX, source: 'default' });
  }
  assert.equal(GLOBAL_RATE_LIMIT_DEFAULT_MAX, 100);
});

test('staging uses its default, or an override inside the bounds', () => {
  assert.deepEqual(resolveGlobalRateLimitMax({ SUPABASE_URL: STAGING_URL }), { max: STAGING_GLOBAL_RATE_LIMIT_DEFAULT_MAX, source: 'staging-default' });
  assert.deepEqual(resolveGlobalRateLimitMax({ SUPABASE_URL: STAGING_URL, CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: '1000' }), { max: 1000, source: 'staging-override' });
  assert.equal(resolveGlobalRateLimitMax({ SUPABASE_URL: STAGING_URL, CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: String(STAGING_GLOBAL_RATE_LIMIT_BOUNDS.min) }).max, STAGING_GLOBAL_RATE_LIMIT_BOUNDS.min);
  assert.equal(resolveGlobalRateLimitMax({ SUPABASE_URL: STAGING_URL, CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: String(STAGING_GLOBAL_RATE_LIMIT_BOUNDS.max) }).max, STAGING_GLOBAL_RATE_LIMIT_BOUNDS.max);
});

test('an override can neither disable nor undercut the limiter', () => {
  for (const raw of ['0', '-1', '5', '99', '2001', '1e9', 'Infinity', 'NaN', 'abc', '150.5', ' ']) {
    const r = resolveGlobalRateLimitMax({ SUPABASE_URL: STAGING_URL, CARUP_STAGING_GLOBAL_RATE_LIMIT_MAX: raw });
    assert.equal(r.max, STAGING_GLOBAL_RATE_LIMIT_DEFAULT_MAX, `override ${JSON.stringify(raw)} must fall back`);
    assert.equal(r.source, 'staging-default-invalid-override');
  }
});

// ── headers ──────────────────────────────────────────────────────────────────

test('headers are derived from the enforcing counter; Retry-After only on refusal', () => {
  const now = 1_000_000;
  const ok = rateLimitHeaders({ max: 5, windowMs: 60_000, count: 2, windowStart: now - 20_000, now });
  assert.deepEqual(ok, { 'RateLimit-Limit': '5', 'RateLimit-Remaining': '3', 'RateLimit-Reset': '40' });
  const refused = rateLimitHeaders({ max: 5, windowMs: 60_000, count: 6, windowStart: now - 59_500, now });
  assert.equal(refused['RateLimit-Remaining'], '0');
  assert.equal(refused['Retry-After'], '1', 'never 0: a client told to retry in 0s would hammer the limiter');
});

function fakeRes() {
  const headers = {};
  return {
    headers, statusCode: 200, body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function run(mw, req) {
  return new Promise((resolve) => {
    const res = fakeRes();
    const origJson = res.json.bind(res);
    res.json = (b) => { origJson(b); resolve({ res, passed: false }); return res; };
    mw(req, res, () => resolve({ res, passed: true }));
  });
}

let seq = 0;
function uniqueIp() { seq += 1; return `203.0.113.${seq}`; }

test('the limiter refuses past max with a truthful Retry-After and remaining count', async () => {
  const mw = rateLimiter({ max: 2, windowMs: 60_000 });
  const ip = uniqueIp();
  const req = () => ({ headers: {}, method: 'GET', originalUrl: '/api/x', carupClientIp: ip, ip: '10.0.0.1', socket: {} });
  const a = await run(mw, req());
  const b = await run(mw, req());
  const c = await run(mw, req());
  assert.equal(a.passed, true); assert.equal(a.res.headers['ratelimit-remaining'], '1');
  assert.equal(b.passed, true); assert.equal(b.res.headers['ratelimit-remaining'], '0');
  assert.equal(c.passed, false); assert.equal(c.res.statusCode, 429);
  const retry = Number(c.res.headers['retry-after']);
  assert.ok(retry >= 1 && retry <= 60, `Retry-After ${retry} must lie inside the window`);
  assert.equal(c.res.body.retryAfterSeconds, retry, 'body and header must agree');
  assert.equal(c.res.headers['ratelimit-limit'], '2');
});

test('buckets key on the resolved client IP, not on req.ip', async () => {
  const mw = rateLimiter({ max: 1, windowMs: 60_000 });
  const sharedEdge = '172.64.0.1';
  const first = await run(mw, { headers: {}, method: 'GET', originalUrl: '/api/x', carupClientIp: uniqueIp(), ip: sharedEdge, socket: {} });
  const second = await run(mw, { headers: {}, method: 'GET', originalUrl: '/api/x', carupClientIp: uniqueIp(), ip: sharedEdge, socket: {} });
  assert.equal(first.passed, true);
  assert.equal(second.passed, true, 'two clients behind one edge address must not share a bucket');
});

test('the most restrictive limiter\'s headers are the ones reported', async () => {
  const loose = rateLimiter({ max: 100, windowMs: 60_000 });
  const tight = rateLimiter({ max: 5, windowMs: 60_000, isSensitive: true });
  const ip = uniqueIp();
  const req = { headers: {}, method: 'POST', originalUrl: '/api/media/upload', carupClientIp: ip, ip, socket: {} };
  const res = fakeRes();
  await new Promise((r) => loose(req, res, r));
  await new Promise((r) => tight(req, res, r));
  assert.equal(res.headers['ratelimit-limit'], '5');
  assert.equal(res.headers['ratelimit-remaining'], '4');
});

// ── mounting (server.js) ─────────────────────────────────────────────────────

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('client-IP resolution is mounted before every rate limiter', () => {
  const edge = serverSrc.indexOf('app.use(edgeClientIpMiddleware())');
  const firstLimiter = serverSrc.search(/app\.use\((['"][^'"]+['"],\s*)?rateLimiter\(/);
  assert.ok(edge > 0, 'edgeClientIpMiddleware must be mounted');
  assert.ok(firstLimiter > 0, 'a rate limiter must be mounted');
  assert.ok(edge < firstLimiter, 'edgeClientIpMiddleware must precede the first rateLimiter');
});

test('only the global limiter reads the staging capacity; sensitive limits are unchanged', () => {
  assert.match(serverSrc, /app\.use\(rateLimiter\(\{ max: GLOBAL_RATE_LIMIT\.max, windowMs: 60 \* 1000, isSensitive: false \}\)\)/);
  assert.equal((serverSrc.match(/GLOBAL_RATE_LIMIT\.max/g) || []).length, 2, 'used once for the log line and once for the global limiter');
  for (const route of ['/api/auth/switch-role', '/api/media/upload', '/api/safepay/create']) {
    const line = new RegExp(`app\\.use\\('${route.replace(/\//g, '\\/')}', rateLimiter\\(\\{ max: 5, windowMs: 60 \\* 1000, isSensitive: true \\}\\)\\)`);
    assert.match(serverSrc, line, `${route} must keep max 5/min`);
  }
});

test('OC-2A: there is NO /api/verification prefix limiter — the review routes there are governed by the global limiter', () => {
  // The 5/min prefix limiter existed for the retired document-intelligence router and throttled the
  // Trust Fact and PartSentry review routes that own the prefix. It must not come back, in any
  // spelling (behaviour: oc2a-verification-route-convergence.test.js, test (iv)).
  assert.doesNotMatch(serverSrc, /app\.use\(\s*\[?\s*['"`]\/api\/verification\b[^)]*rateLimiter/);
  assert.doesNotMatch(serverSrc, /app\.use\(\s*\[?\s*['"`]\/api\/verification\b/);
});
