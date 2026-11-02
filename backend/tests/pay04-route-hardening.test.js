/**
 * CARUP-PAY-04-LR01 — route hardening (the PAY-03B R12 rule, applied to PAY-04).
 *
 * Every PAY-04 route that calls the garage's payment provider (checkout creation, provider re-read, checkout stop,
 * refund) is behind the SHARED sensitive-tier limiter with the same 60-second window every other sensitive limiter uses,
 * mounted in server.js BEFORE the PAY-04 router so it runs first. Read-only PAY-04 routes that only read CarUp's own
 * tables are not limited beyond the global limiter. (Found in physical UAT: a route-level 15-minute window on the shared
 * per-IP sensitive counter skewed every other sensitive limiter's window.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const routesSrc = readFileSync(new URL('../routes/pay04GaragePaymentRoutes.js', import.meta.url), 'utf8');

function limiterAt(method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp(`app\\.${method}\\('${escaped}', rateLimiter\\(\\{ max: \\d+, windowMs: 60 \\* 1000, isSensitive: true \\}\\)\\)`).exec(serverSrc);
  return match ? match.index : -1;
}

const PROVIDER_CALLING = [
  ['post', '/api/pay04/garage-invoices/:invoiceId/payments'], // createCheckout at the garage's provider
  ['use', '/api/pay04/garage-payments'], // verify (provider read) and cancel (provider cancel); POST-only prefix
  ['use', '/api/pay04/garage/payments'], // refund, reconcile, cancel (provider calls); POST-only prefix
];

test('every provider-calling PAY-04 route is behind a 60 s sensitive limiter mounted before the PAY-04 router', () => {
  const routerAt = serverSrc.indexOf('app.use(pay04GaragePaymentRouter)');
  assert.ok(routerAt > 0, 'the PAY-04 router is mounted');
  for (const [method, path] of PROVIDER_CALLING) {
    const at = limiterAt(method, path);
    assert.ok(at >= 0, `${method.toUpperCase()} ${path} has a sensitive-tier limiter with the shared 60 s window`);
    assert.ok(at < routerAt, `${path} limiter runs before the router`);
  }
});

test('the POST-only prefixes really are POST-only, and read-only routes are not sensitive-limited', () => {
  for (const prefix of ['/api/pay04/garage-payments/', '/api/pay04/garage/payments/']) {
    const methods = [...routesSrc.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)].filter(([, , p]) => p.startsWith(prefix)).map(([, m]) => m);
    assert.ok(methods.length > 0 && methods.every((m) => m === 'post'), `${prefix} has only POST routes (${methods})`);
  }
  assert.ok(!/app\.use\('\/api\/pay04\/garage-invoices'/.test(serverSrc), 'reading how to pay is not sensitive-limited');
  assert.ok(!/app\.use\('\/api\/pay04\/garage\/(financial-overview|payment-instructions|invoices)'/.test(serverSrc), 'garage reads are not sensitive-limited');
});

test('no PAY-04 route carries its own limiter window on the shared sensitive counter', () => {
  assert.ok(!/rateLimiter\(/.test(routesSrc), 'PAY-04 limiters live in server.js only (one window convention)');
});
