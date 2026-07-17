/**
 * Full Activation — webhook security wiring (CSRF bypass + raw-body capture).
 *
 * Regression guards for two findings:
 *   - csrfMiddleware blocked all 5 new signed provider webhooks in non-test environments
 *     (they would 403 before HMAC verification ran);
 *   - the global express.json consumed the body first, so the route-level `verify` that captures
 *     req.rawBody never fired and signature verification fell back to a re-serialized body.
 *
 * The first is verified against the real csrfMiddleware; the second against the exact
 * verify-callback logic wired into server.js's global JSON parser (asserted via a live request).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
const { csrfMiddleware } = await import('../middleware/securityMiddleware.js');
const express = (await import('express')).default;

// Exercise csrfMiddleware directly. Force CSRF checking on (x-verify-csrf), then a webhook path
// must be waved through (next called) while a normal mutation without a token is rejected.
function runCsrf(url) {
  const req = { method: 'POST', originalUrl: url, url, headers: { 'x-verify-csrf': 'true' } };
  let status = null, nexted = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  csrfMiddleware(req, res, () => { nexted = true; });
  return { nexted, status };
}

const WEBHOOK_PATHS = [
  '/api/insurer/webhook',
  '/api/finance/lender/webhook',
  '/api/escrow/provider/webhook',
  '/api/escrow/webhook',
  '/api/eligibility/insurance/webhook',
  '/api/eligibility/finance/webhook',
];

test('csrf: every Full Activation signed webhook path bypasses CSRF (would 403 otherwise)', () => {
  for (const p of WEBHOOK_PATHS) {
    const { nexted, status } = runCsrf(p);
    assert.equal(nexted, true, `${p} must bypass CSRF (machine-to-machine, HMAC-verified)`);
    assert.equal(status, null, `${p} must not be rejected by CSRF`);
  }
});

test('csrf: a normal mutation without a token is still rejected (bypass is scoped to webhooks)', () => {
  const { nexted, status } = runCsrf('/api/vehicles/V1/finance/lender/eligibility');
  assert.equal(nexted, false);
  assert.equal(status, 403);
});

// The exact global-parser wiring from server.js: capture raw bytes for /webhook paths so
// in-service HMAC verification sees the real payload the provider signed.
test('rawBody: the global JSON parser captures exact webhook bytes (not a re-serialized body)', async () => {
  const app = express();
  app.use(express.json({
    limit: '15mb',
    verify: (req, _res, buf) => { const u = req.originalUrl || req.url || ''; if (u.includes('/webhook')) req.rawBody = buf.toString('utf8'); },
  }));
  app.post('/api/insurer/webhook', (req, res) => res.json({ rawBody: req.rawBody ?? null, reserialized: JSON.stringify(req.body) }));
  app.post('/api/normal', (req, res) => res.json({ rawBody: req.rawBody ?? null }));

  const call = (path, raw) => new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { srv.close(); resolve(JSON.parse(b)); });
      });
      r.on('error', e => { srv.close(); reject(e); }); r.write(raw); r.end();
    });
  });

  // Note the non-canonical spacing: a re-serialized body would differ, breaking HMAC.
  const raw = '{ "outcome" : "conditional" ,  "provider_reference":"POL-1" }';
  const hook = await call('/api/insurer/webhook', raw);
  assert.equal(hook.rawBody, raw, 'webhook route sees the EXACT bytes the provider signed');
  assert.notEqual(hook.rawBody, hook.reserialized, 'a re-serialized body would not match the signature');

  const normal = await call('/api/normal', raw);
  assert.equal(normal.rawBody, null, 'non-webhook paths do not buffer rawBody (scoped capture)');
});
