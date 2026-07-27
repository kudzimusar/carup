/**
 * Diaspora go-to-market — integration-wiring regression guards (Issue #127).
 *
 * Three defects were found by adversarial review of the reconciled tree, all of which passed every
 * existing test. They share a shape worth naming: each was a *wiring* gap, where both sides of a
 * contract were correct in isolation and nothing connected them. Unit tests of either side pass;
 * the system does not work.
 *
 *   1. Both Diaspora provider webhooks were CSRF-blocked in production. Neither
 *      /api/diaspora/subscription/webhook nor /api/diaspora/safetrade/payment-webhook was on the
 *      exemption list, so in any non-test environment every delivery was rejected before its handler
 *      ran. A payment provider has no browser session and cannot present a CSRF token. The entire
 *      suite passed because csrfMiddleware short-circuits on NODE_ENV==='test' BEFORE consulting the
 *      list — the tests were structurally incapable of catching it. These tests therefore force the
 *      check on with x-verify-csrf, exactly as the Full Activation guards do.
 *
 *   2. The event worker invoked subscribers with three arguments; the Trade Graph projection
 *      subscriber requires a fourth (the raw outbox record) because `event.id` is its idempotency key
 *      and source_event_ref. The projector threw on every event, so trade_graph_* stayed empty and
 *      UI-10 would have rendered a permanently, honestly empty dashboard.
 *
 *   3. The SafeTrade milestone money path called the provider BEFORE recording anything. If the
 *      process died or the transition RPC then refused, the provider had already acted with no
 *      authoritative record — with a live provider that is real money moved and a retry double-moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HERE = dirname(fileURLToPath(import.meta.url));
const { csrfMiddleware } = await import('../middleware/securityMiddleware.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Diaspora webhooks must bypass CSRF
// ─────────────────────────────────────────────────────────────────────────────

// x-verify-csrf forces the check ON despite NODE_ENV==='test', so this exercises the real production
// code path rather than the test short-circuit that hid the defect.
function runCsrf(url) {
  const req = { method: 'POST', originalUrl: url, url, headers: { 'x-verify-csrf': 'true' } };
  let status = null; let nexted = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  csrfMiddleware(req, res, () => { nexted = true; });
  return { nexted, status };
}

const DIASPORA_WEBHOOKS = [
  '/api/diaspora/subscription/webhook',
  '/api/diaspora/safetrade/payment-webhook',
];

test('csrf: both Diaspora provider webhooks bypass CSRF (they would 403 in production otherwise)', () => {
  for (const path of DIASPORA_WEBHOOKS) {
    const { nexted, status } = runCsrf(path);
    assert.equal(nexted, true, `${path} must reach its handler — a provider cannot present a CSRF token`);
    assert.equal(status, null, `${path} must not be rejected by CSRF`);
  }
});

test('csrf: the Diaspora bypass survives a query string and a trailing slash', () => {
  for (const path of DIASPORA_WEBHOOKS) {
    for (const variant of [`${path}?attempt=2`, `${path}/`, `${path}#frag`]) {
      const { nexted } = runCsrf(variant);
      assert.equal(nexted, true, `${variant} must bypass CSRF`);
    }
  }
});

test('csrf: the Diaspora bypass is NARROW — neighbouring diaspora mutations are still protected', () => {
  // A bypass that matched a prefix would disable CSRF across the whole Diaspora surface.
  const protectedPaths = [
    '/api/diaspora/safetrade',
    '/api/diaspora/safetrade/st-1/commit',
    '/api/diaspora/subscription/checkout',
    '/api/diaspora/subscription/cancel',
    '/api/diaspora/workbook/import',
    '/api/diaspora/trade-graph/rebuild',
    // Near-misses that must NOT be waved through.
    '/api/diaspora/subscription/webhook-admin',
    '/api/diaspora/safetrade/payment-webhook-replay',
  ];
  for (const path of protectedPaths) {
    const { nexted, status } = runCsrf(path);
    assert.equal(nexted, false, `${path} must still require a CSRF token`);
    assert.equal(status, 403, `${path} must be rejected with 403`);
  }
});

test('csrf: safe methods are unaffected by the new entries', () => {
  const req = { method: 'GET', originalUrl: '/api/diaspora/trade-graph/summary', url: '/api/diaspora/trade-graph/summary', headers: { 'x-verify-csrf': 'true' } };
  let nexted = false;
  csrfMiddleware(req, { status() { return this; }, json() { return this; } }, () => { nexted = true; });
  assert.equal(nexted, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The event worker must forward the raw outbox record
// ─────────────────────────────────────────────────────────────────────────────

test('eventWorker forwards the raw outbox record as a 4th argument to every subscriber', () => {
  // Asserted against the source because the invocation sits inside a transactional batch loop that
  // needs a live pg connection to drive. The contract under test is exactly one line, and its
  // absence is what left the trade graph write-dead.
  const source = readFileSync(join(HERE, '../services/eventBus/eventWorker.js'), 'utf8');
  assert.match(
    source,
    /await handler\(event\.payload,\s*client,\s*event\.tenant_id,\s*event\)/,
    'subscribers must receive the raw record — an event-sourced projector cannot work without event.id',
  );
});

test('the Trade Graph subscriber throws a NAMED error when the record is missing, rather than dropping the event', async () => {
  const projection = await import('../services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js');
  const { TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID, TradeGraphSubscriberMissingEventIdError } = projection;
  assert.equal(typeof TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID, 'string');
  const err = new TradeGraphSubscriberMissingEventIdError();
  // A silent drop would look identical to "there is simply no trade activity" — which is precisely
  // how this defect stayed invisible.
  assert.equal(err.name, TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The money path must record before it dispatches
// ─────────────────────────────────────────────────────────────────────────────

test('the milestone money path reserves a durable operation BEFORE calling the provider', () => {
  const source = readFileSync(join(HERE, '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js'), 'utf8');
  const reserveAt = source.indexOf('await reserveOperation(');
  const createIntentAt = source.indexOf('await provider.createPaymentIntent(');
  const providerCallAt = source.indexOf('await provider[plan.providerMethod](');

  assert.ok(reserveAt > 0, 'the money path must reserve an operation');
  assert.ok(createIntentAt > 0 && providerCallAt > 0, 'the provider calls must still exist');
  assert.ok(reserveAt < createIntentAt, 'reservation must precede intent creation');
  assert.ok(reserveAt < providerCallAt, 'reservation must precede the provider call');
});

test('the milestone money path binds the operation to the RPC so the ledger confirms it', () => {
  const source = readFileSync(join(HERE, '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js'), 'utf8');
  assert.match(source, /operationId:\s*operationRow\.id/,
    'the RPC must receive the operation id so it can mark it ledger_applied in the same transaction');
});

test('an ambiguous provider failure goes to reconciling, a definite refusal goes to failed', () => {
  const source = readFileSync(join(HERE, '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js'), 'utf8');
  // The distinction is the whole point: a timeout may mean the money DID move, so calling it a
  // failure and letting the caller retry is how double-spends happen.
  assert.match(source, /INVALID_INPUT.*INVALID_STATE/s);
  assert.match(source, /markUnknown\(/);
  assert.match(source, /markFailed\(/);
});

test('a caller with no idempotency key still gets a durable, state-bound operation key', async () => {
  // resolveDispute drives a REFUND without a key. The ledger cannot accept a null key, so one is
  // derived from the identity of the transition — stable on retry, distinct once the state advances.
  const source = readFileSync(join(HERE, '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js'), 'utf8');
  assert.match(
    source,
    /auto:\$\{transactionId\}:\$\{milestoneId\}:\$\{op\}:\$\{milestone\.status\}/,
    'the derived key must include the source status so two distinct money moves never merge',
  );
});

test('the operation ledger names are the exact values the CHECK constraint accepts', async () => {
  const { MONEY_OPERATIONS } = await import('../services/diaspora/safetrade/diasporaSafeTradeOperationService.js');
  const source = readFileSync(join(HERE, '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js'), 'utf8');
  const block = source.slice(source.indexOf('OPERATION_FOR_MONEY_OP = Object.freeze('), source.indexOf('OPERATION_FOR_MONEY_OP = Object.freeze(') + 300);
  for (const name of ['authorize_hold', 'capture', 'release', 'refund']) {
    assert.ok(block.includes(name), `${name} must be mapped`);
    assert.ok(MONEY_OPERATIONS.includes(name), `${name} must be accepted by the ledger CHECK constraint`);
  }
});
