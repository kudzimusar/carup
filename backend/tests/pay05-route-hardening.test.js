/**
 * CARUP-PAY-05-LR01 — route hardening for the Paynow routes.
 *
 *  - Every PAY-05 route that calls Paynow, or accepts Paynow's POST, sits behind the shared sensitive-tier limiter with the
 *    payment routes' 60-second window, mounted BEFORE the PAY-05 router (the PAY-03B R12 / PAY-04 convention).
 *  - Exactly ONE PAY-05 path is exempt from CSRF: Paynow's resulturl (/api/pay05/paynow/webhook/<collection uuid>),
 *    authenticated in-service by the integration-key hash; its raw body is captured for that verification.
 *  - Each route group carries the authority it needs: Paynow's webhook none (the hash is the authority), the customer's
 *    OTP a session, the garage connection the garage administrator, everything operator-only the platform admin role;
 *    everything 404s unless PAY-05 is enabled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const routesSrc = readFileSync(new URL('../routes/pay05ZimbabweCollectionRoutes.js', import.meta.url), 'utf8');
const securitySrc = readFileSync(new URL('../middleware/securityMiddleware.js', import.meta.url), 'utf8');

test('every Paynow-calling or Paynow-facing PAY-05 route is behind a 60 s sensitive limiter mounted before the router', () => {
  const routerAt = serverSrc.indexOf('app.use(pay05ZimbabweCollectionRouter)');
  assert.ok(routerAt > 0, 'the PAY-05 router is mounted');
  for (const prefix of ['/api/pay05/garage-payments', '/api/pay05/garage/paynow', '/api/pay05/admin', '/api/pay05/paynow/webhook']) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const m = new RegExp(`app\\.use\\('${escaped}', rateLimiter\\(\\{ max: \\d+, windowMs: 60 \\* 1000, isSensitive: true \\}\\)\\)`).exec(serverSrc);
    assert.ok(m, `${prefix} has a sensitive-tier limiter with the shared 60 s window`);
    assert.ok(m.index < routerAt, `${prefix} limiter runs before the router`);
  }
  assert.ok(!/rateLimiter\(/.test(routesSrc), 'PAY-05 limiters live in server.js only');
});

test('exactly the Paynow resulturl is CSRF-exempt, and nothing else under /api/pay05', () => {
  const lines = securitySrc.split('\n').filter((l) => l.includes('pay05'));
  const regexLines = lines.filter((l) => /\/\^.*pay05.*\/\.test\(url\)/.test(l));
  assert.equal(regexLines.length, 1, 'one PAY-05 exemption');
  const source = /\/(\^.*)\/\.test\(url\)/.exec(regexLines[0])[1];
  const exempt = new RegExp(source);
  assert.ok(exempt.test('/api/pay05/paynow/webhook/11111111-2222-3333-4444-555555555555'));
  for (const url of ['/api/pay05/paynow/webhook/', '/api/pay05/paynow/webhook/x', '/api/pay05/garage/paynow/connect',
    '/api/pay05/admin/merchants/11111111-2222-3333-4444-555555555555/verify', '/api/pay05/garage-payments/11111111-2222-3333-4444-555555555555/otp',
    '/api/pay05/paynow/webhook/11111111-2222-3333-4444-555555555555/extra']) {
    assert.ok(!exempt.test(url), `${url} must carry a CSRF token`);
  }
  assert.ok(!securitySrc.includes("url.startsWith('/api/pay05"), 'no prefix-wide exemption');
  // the raw-body capture covers the resulturl (the '/webhook' substring rule)
  assert.match(serverSrc, /if \(u\.includes\('\/webhook'\)/);
});

test('each route group carries the authority it needs', () => {
  const routes = [...routesSrc.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)',([^\n]*)/g)].map(([, method, path, rest]) => ({ method, path, rest }));
  assert.ok(routes.length >= 14, 'all routes found');
  for (const r of routes) {
    if (r.path.startsWith('/api/pay05/paynow/webhook/')) {
      assert.ok(r.rest.includes('requirePay05') && !/Session|GARAGE_ADMIN/.test(r.rest), 'webhook: no session, the hash is the authority');
    } else if (r.path.startsWith('/api/pay05/admin/')) {
      assert.ok(r.rest.includes('requirePay05') && r.rest.includes('adminSession'), `${r.path} is operator-only`);
    } else if (r.path.startsWith('/api/pay05/garage/')) {
      assert.ok(r.rest.includes('GARAGE_ADMIN'), `${r.path} is garage-administrator-only`);
      // independent review S3/W11: even the connection view answers only while PAY-05 is enabled
      assert.ok(r.rest.includes('requirePay05'), `${r.path} answers only when enabled`);
    } else if (r.path.startsWith('/api/pay05/garage-payments/')) {
      assert.ok(r.rest.includes('requirePay05') && r.rest.includes('memberSession'), `${r.path} needs the customer's session`);
    } else {
      assert.fail(`unclassified route ${r.path}`);
    }
  }
});

test('the resulturl 404s while PAY-05 is disabled and never echoes internal detail', async () => {
  const { default: router } = await import('../routes/pay05ZimbabweCollectionRoutes.js');
  const app = express();
  app.locals.pay05Env = { NODE_ENV: 'test', CARUP_PAY05_ENABLED: 'false', CARUP_PAY04_ENABLED: 'true' };
  app.use(express.urlencoded({ extended: false }));
  app.use(router);
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/pay05/paynow/webhook/11111111-2222-3333-4444-555555555555`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'status=Paid' });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'PAY05_DISABLED', code: 'PAY05_DISABLED' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// independent review S5: Paynow's resulturl answers every refusal the same way — an unauthenticated caller cannot learn
// whether a collection exists or what CarUp thought of the message
test('the resulturl refuses unknown, malformed and unauthenticated messages with one identical answer', async () => {
  const { default: router } = await import('../routes/pay05ZimbabweCollectionRoutes.js');
  const app = express();
  const empty = () => {
    const b = { select: () => b, eq: () => b, limit: () => b, in: () => b, order: () => b, is: () => b, maybeSingle: () => b,
      then: (resolve) => resolve({ data: [], error: null }) };
    return b;
  };
  app.locals.pay05Env = { NODE_ENV: 'test', CARUP_PAY05_ENABLED: 'true', CARUP_PAY04_ENABLED: 'true' };
  app.locals.pay05Db = { from: () => empty(), rpc: async () => ({ data: null, error: null }) };
  app.use((req, _res, next) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { req.rawBody = raw; next(); }); });
  app.use(router);
  const server = await new Promise((resolve) => { const srv = http.createServer(app).listen(0, '127.0.0.1', () => resolve(srv)); });
  try {
    const { port } = server.address();
    const post = (id, body) => fetch(`http://127.0.0.1:${port}/api/pay05/paynow/webhook/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const answers = [];
    for (const [id, body] of [['11111111-2222-3333-4444-555555555555', 'status=Paid'], ['not-a-uuid', 'status=Paid'],
      ['11111111-2222-3333-4444-555555555555', '']]) {
      const res = await post(id, body);
      answers.push([res.status, await res.json()]);
    }
    for (const [status, json] of answers) {
      assert.equal(status, 400);
      assert.deepEqual(json, { error: 'PAY05_STATUS_UPDATE_REFUSED' });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// physical rehearsal, HTTP case R2: PAY-05's hunks inside accepted PAY-04 functions raise PAY05_ codes (a dispute Paynow
// still reports, a Paynow row sent down a simulator-only path, a request whose initiation is unresolved). PAY-04's routes
// map errors with pay04Failure, which knew no PAY05_ token: the operator read a generic 503 instead of the refusal.
test('PAY-04 routes state the PAY-05 refusals raised inside the functions PAY-05 extends', async () => {
  const { pay04Failure } = await import('../services/payment/pay04Contract.js');
  for (const [message, code, status] of [
    ['PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER', 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER', 409],
    ['PAY05_USE_PAYNOW_PATH', 'PAY05_USE_PAYNOW_PATH', 409],
    ['PAY05_INITIATION_UNRESOLVED', 'PAY05_INITIATION_UNRESOLVED', 409],
    ['PAY05_COLLECTION_NOT_FOUND', 'PAY05_COLLECTION_NOT_FOUND', 404],
  ]) {
    const e = pay04Failure({ message: `ERROR: ${message}` });
    assert.deepEqual([e.code, e.status], [code, status], message);
  }
  assert.deepEqual([pay04Failure({ message: 'something unexpected' }).code, pay04Failure({ message: 'x' }).status], ['PAY04_OPERATION_UNAVAILABLE', 503]);
});
