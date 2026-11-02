/**
 * CARUP-PAY-03B-LR01 — route hardening (independent review R12).
 *
 * Every PAY-03B route that makes a provider call (Checkout, portal, invoice link, plan change/preview, cancel,
 * verify, the Level 2 test clock, administrator reconcile/refund/F5) is behind the sensitive-tier rate limiter, and
 * the limiters are mounted before the PAY-03B router so they run first. Read-only routes that only read CarUp's own
 * tables are not limited beyond the global limiter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function sensitiveLimiterIndex(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp(`app\\.use\\('${escaped}', rateLimiter\\(\\{ max: \\d+, windowMs: [^)]*isSensitive: true \\}\\)\\)`).exec(serverSrc);
  return match ? match.index : -1;
}

const PROVIDER_CALLING_PREFIXES = [
  '/api/pay03b/dealer/subscription/checkout', // also covers /checkout/abandon (prefix match at a segment boundary)
  '/api/pay03b/dealer/subscription/verify',
  '/api/pay03b/dealer/subscription/change',
  '/api/pay03b/dealer/subscription/change-preview',
  '/api/pay03b/dealer/subscription/cancel',
  '/api/pay03b/dealer/subscription/payment-method',
  '/api/pay03b/dealer/subscription/invoices',
  '/api/pay03b/admin/subscriptions',
  '/api/pay03b/admin/reconciliation-exceptions',
  '/api/pay03b/admin/stripe-sandbox',
];

test('R12: every provider-calling PAY-03B route is behind the sensitive limiter, mounted before the PAY-03B router', () => {
  const routerAt = serverSrc.indexOf('app.use(pay03bRouter)');
  assert.ok(routerAt > 0, 'the PAY-03B router is mounted');
  for (const prefix of PROVIDER_CALLING_PREFIXES) {
    const at = sensitiveLimiterIndex(prefix);
    assert.ok(at >= 0, `${prefix} has a sensitive-tier limiter`);
    assert.ok(at < routerAt, `${prefix} limiter runs before the router`);
  }
});
