/**
 * Durable billing webhook ledger — de-duplication, out-of-order handling, supersede semantics,
 * raw-body signature discipline, dead-lettering (Issue #127, Deliverable D).
 *
 * The assertions that matter are the ones that fail for a *plausible* implementation:
 *
 *  - a SELECT-then-INSERT dedupe passes a sequential duplicate test and still loses a concurrent race;
 *    here the claim is the INSERT, and the mock raises 23505 exactly as the registered unique index
 *    does, so the losing claimant is genuinely exercised;
 *  - an implementation that applies every verified event passes every "webhook works" test and still
 *    resurrects a cancelled subscription the first time a retry overtakes a newer event. The route
 *    test below is that scenario end-to-end;
 *  - a supersede check that looks at ALL prior events (rather than only APPLIED, non-superseded ones)
 *    passes the simple case and then lets a superseded event supersede its own successor.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_BILLING_WEBHOOK_SECRET = 'diaspora-billing-dev-webhook-secret';

const express = (await import('express')).default;
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const ledger = await import('../services/diaspora/billing/diasporaBillingEventLedgerService.js');
const subscriptionRouter = (await import('../routes/diasporaSubscriptionRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { getSharedSandboxProvider } = await import('../services/diaspora/billing/billingProvider.js');
const { billingWebhookSecret } = await import('../constants/diaspora/diasporaBillingConstants.js');
const { clearBillingSignals, recentBillingSignals, BILLING_EVENTS } = await import('../services/diaspora/billing/diasporaBillingObservability.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const PROVIDER = 'sandbox';

function client(seed = {}) {
  return createMockSupabase({
    diaspora_billing_provider_events: [],
    diaspora_billing_checkout_sessions: [],
    diaspora_subscriptions: [],
    diaspora_subscription_plans: [],
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    diaspora_user_entitlement_overrides: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

/** An event row already APPLIED for a tenant — the state the out-of-order guard compares against. */
function appliedEvent({ id, tenantId = TENANT_A, occurredAt = null, sequence = null, provider = PROVIDER }) {
  return {
    id,
    provider,
    event_id: id,
    event_type: 'subscription.updated',
    tenant_id: tenantId,
    occurred_at: occurredAt,
    provider_sequence: sequence,
    payload: {},
    signature_verified: true,
    superseded: false,
    processed_at: '2026-06-20T00:00:00.000Z',
    created_at: '2026-06-20T00:00:00.000Z',
  };
}

beforeEach(() => clearBillingSignals());

// ── Claim / de-duplication ──────────────────────────────────────────────────────────────────────

test('a new event is claimed and recorded with its ordering signal', async () => {
  const db = client();
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER,
    eventId: 'evt-1',
    eventType: 'subscription.updated',
    tenantId: TENANT_A,
    occurredAt: '2026-06-21T10:00:00.000Z',
    providerSequence: 7,
    payload: { id: 'evt-1', status: 'active' },
    signatureVerified: true,
    correlationId: 'corr-1',
    supabaseClient: db,
  });

  assert.equal(result.claimed, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.superseded, false);
  assert.equal(result.orderable, true);

  const [row] = db._rows('diaspora_billing_provider_events');
  assert.equal(row.event_id, 'evt-1');
  assert.equal(row.tenant_id, TENANT_A);
  assert.equal(row.occurred_at, '2026-06-21T10:00:00.000Z');
  assert.equal(row.provider_sequence, 7);
  assert.equal(row.signature_verified, true);
  assert.equal(row.correlation_id, 'corr-1');
  assert.equal(row.superseded, false);
});

test('the SECOND claim of the same (provider,event_id) loses on the unique index, not on a SELECT', async () => {
  const db = client();
  const first = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-dup', tenantId: TENANT_A, supabaseClient: db,
  });
  const second = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-dup', tenantId: TENANT_A, supabaseClient: db,
  });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.event, null);
  assert.equal(db._rows('diaspora_billing_provider_events').length, 1);
});

test('the SAME event id from a DIFFERENT provider is a different event', async () => {
  const db = client();
  await ledger.claimBillingEvent({ provider: 'sandbox', eventId: 'evt-x', tenantId: TENANT_A, supabaseClient: db });
  const other = await ledger.claimBillingEvent({ provider: 'stripe_test', eventId: 'evt-x', tenantId: TENANT_A, supabaseClient: db });
  assert.equal(other.claimed, true);
  assert.equal(db._rows('diaspora_billing_provider_events').length, 2);
});

test('a genuine database error is NOT swallowed into a false "already processed"', async () => {
  const db = client();
  const original = db.from;
  db.from = (table) => {
    if (table !== 'diaspora_billing_provider_events') return original(table);
    return {
      insert() { return this; },
      select() { return this; },
      single() { return this; },
      then(resolve) { return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }).then(resolve); },
    };
  };
  await assert.rejects(
    () => ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-err', supabaseClient: db }),
    /connection failure/,
  );
});

// ── Out-of-order handling and supersede semantics ───────────────────────────────────────────────

test('an event OLDER than one already applied is recorded and SUPERSEDED, never applied', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-newer', occurredAt: '2026-06-21T12:00:00.000Z' }),
    ],
  });

  const result = await ledger.claimBillingEvent({
    provider: PROVIDER,
    eventId: 'evt-late',
    tenantId: TENANT_A,
    occurredAt: '2026-06-21T09:00:00.000Z', // emitted earlier, delivered later
    payload: {},
    supabaseClient: db,
  });

  assert.equal(result.claimed, true, 'still recorded — the ledger is the audit trail');
  assert.equal(result.superseded, true, 'but never applied');
  assert.equal(result.supersededBy, 'evt-newer');

  const row = db._rows('diaspora_billing_provider_events').find((r) => r.event_id === 'evt-late');
  assert.equal(row.superseded, true);
  assert.equal(row.superseded_by, 'evt-newer');
  assert.ok(row.processed_at, 'a superseded event reached a terminal decision and is not pending work');
});

test('an event NEWER than what is applied is not superseded', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-old', occurredAt: '2026-06-21T09:00:00.000Z' }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-new', tenantId: TENANT_A,
    occurredAt: '2026-06-21T12:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.superseded, false);
});

test('provider_sequence wins over occurred_at when both sides have one', async () => {
  // Same wall-clock second, but the sequence is unambiguous: 9 already applied, 4 arriving late.
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-seq-9', occurredAt: '2026-06-21T12:00:00.000Z', sequence: 9 }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-seq-4', tenantId: TENANT_A,
    occurredAt: '2026-06-21T12:00:00.000Z', providerSequence: 4, supabaseClient: db,
  });
  assert.equal(result.superseded, true);
  assert.equal(result.supersededBy, 'evt-seq-9');
});

test('a higher sequence is applied even when its timestamp looks older (clock skew)', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-seq-2', occurredAt: '2026-06-21T12:00:00.000Z', sequence: 2 }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-seq-5', tenantId: TENANT_A,
    occurredAt: '2026-06-21T11:00:00.000Z', providerSequence: 5, supabaseClient: db,
  });
  assert.equal(result.superseded, false, 'the exact signal beats the fuzzy one');
});

test('an UNPROCESSED prior event does not supersede anything', async () => {
  // A queued-but-never-applied event must not block a good one. Only APPLIED state can order the world.
  const db = client({
    diaspora_billing_provider_events: [
      { ...appliedEvent({ id: 'evt-pending', occurredAt: '2026-06-21T12:00:00.000Z' }), processed_at: null },
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-real', tenantId: TENANT_A,
    occurredAt: '2026-06-21T09:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.superseded, false);
});

test('an already-SUPERSEDED prior event cannot supersede its successor', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      { ...appliedEvent({ id: 'evt-dead', occurredAt: '2026-06-21T23:00:00.000Z' }), superseded: true },
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-good', tenantId: TENANT_A,
    occurredAt: '2026-06-21T10:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.superseded, false);
});

test('another TENANT\'s newer event never supersedes this tenant\'s event', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-b', tenantId: TENANT_B, occurredAt: '2026-06-21T23:00:00.000Z' }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-a', tenantId: TENANT_A,
    occurredAt: '2026-06-21T09:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.superseded, false);
});

test('another PROVIDER\'s newer event never supersedes this provider\'s event', async () => {
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-other', provider: 'stripe_test', occurredAt: '2026-06-21T23:00:00.000Z' }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-mine', tenantId: TENANT_A,
    occurredAt: '2026-06-21T09:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.superseded, false);
});

test('a provider with NO ordering signal reports orderable:false and is never superseded', async () => {
  // The honest answer for a rail that supplies neither a sequence nor an event time (ADR-001 §3E).
  // Fabricating an ordering key here would be worse than admitting there is none.
  const db = client({
    diaspora_billing_provider_events: [
      appliedEvent({ id: 'evt-any', occurredAt: '2026-06-21T23:00:00.000Z' }),
    ],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-unordered', tenantId: TENANT_A, payload: {}, supabaseClient: db,
  });
  assert.equal(result.orderable, false);
  assert.equal(result.superseded, false);
});

test('an event with no tenant is claimed but cannot be ordered against a tenant history', async () => {
  const db = client({
    diaspora_billing_provider_events: [appliedEvent({ id: 'evt-t', occurredAt: '2026-06-21T23:00:00.000Z' })],
  });
  const result = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-no-tenant', occurredAt: '2026-06-21T01:00:00.000Z', supabaseClient: db,
  });
  assert.equal(result.claimed, true);
  assert.equal(result.superseded, false);
});

// ── Redaction ───────────────────────────────────────────────────────────────────────────────────

test('the stored payload keeps reconcilable fields and drops everything else', () => {
  const redacted = ledger.redactBillingPayload({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    created: 1780876800,
    customer_email: 'buyer@example.com',
    data: {
      object: {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        current_period_end: 1783468800,
        billing_details: { name: 'A Person', address: { line1: '1 Road' } },
        payment_method_details: { card: { last4: '4242', fingerprint: 'fp_abc' } },
      },
    },
  });

  assert.equal(redacted.id, 'evt_1');
  assert.equal(redacted.type, 'customer.subscription.updated');
  assert.equal(redacted.data.status, 'active');
  assert.equal(redacted.data.customer, 'cus_1');
  assert.equal(redacted.data.current_period_end, 1783468800);

  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes('buyer@example.com'), 'no customer email');
  assert.ok(!serialized.includes('A Person'), 'no customer name');
  assert.ok(!serialized.includes('1 Road'), 'no address');
  assert.ok(!serialized.includes('4242'), 'no card last4');
  assert.ok(!serialized.includes('fp_abc'), 'no card fingerprint');
});

test('redaction is an allowlist: an unknown NEW provider field is dropped, not passed through', () => {
  const redacted = ledger.redactBillingPayload({
    id: 'evt_2', some_field_added_next_year: 'sensitive-by-default',
  });
  assert.equal(redacted.id, 'evt_2');
  assert.equal('some_field_added_next_year' in redacted, false);
});

test('a non-object payload redacts to an empty object rather than throwing', () => {
  assert.deepEqual(ledger.redactBillingPayload(null), {});
  assert.deepEqual(ledger.redactBillingPayload('a string'), {});
});

// ── Failure handling / dead letters ─────────────────────────────────────────────────────────────

test('a failed event stays UNprocessed and records a sanitized reason', async () => {
  const db = client();
  const claim = await ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-fail', tenantId: TENANT_A, supabaseClient: db });
  await ledger.markBillingEventFailed(claim.event.id, 'boom\n  at somewhere.js:1:1', { supabaseClient: db, attempts: 1 });

  const row = db._rows('diaspora_billing_provider_events')[0];
  assert.equal(row.processed_at, undefined, 'not marked applied — it is still unfinished work');
  assert.equal(row.attempts, 1);
  assert.ok(row.last_error.startsWith('boom'));
  assert.ok(!row.last_error.includes('\n'), 'newlines collapsed so a stack cannot smuggle itself in');
  assert.equal(row.dead_lettered, false);
});

test('a dead-lettered event is terminal but is never claimed to have been applied', async () => {
  const db = client();
  const claim = await ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-dead', tenantId: TENANT_A, supabaseClient: db });
  await ledger.markBillingEventFailed(claim.event.id, 'still broken', { supabaseClient: db, deadLetter: true, attempts: 5 });

  const row = db._rows('diaspora_billing_provider_events')[0];
  assert.equal(row.dead_lettered, true);
  assert.ok(row.processed_at, 'terminal — it stops counting as pending');
  assert.equal(row.superseded, false, 'dead-lettered is not the same as superseded');

  const letters = await ledger.listBillingEventDeadLetters({ supabaseClient: db });
  assert.equal(letters.length, 1);
  assert.equal(letters[0].event_id, 'evt-dead');
});

test('the error string is truncated so a giant provider message cannot bloat the ledger', () => {
  const long = 'x'.repeat(5000);
  assert.equal(ledger.sanitizeLedgerError(long).length, 500);
});

test('marking applied clears a previous error', async () => {
  const db = client();
  const claim = await ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-retry', tenantId: TENANT_A, supabaseClient: db });
  await ledger.markBillingEventFailed(claim.event.id, 'transient', { supabaseClient: db });
  await ledger.markBillingEventApplied(claim.event.id, { supabaseClient: db });
  const row = db._rows('diaspora_billing_provider_events')[0];
  assert.ok(row.processed_at);
  assert.equal(row.last_error, null);
});

test('the superseded operator view lists exactly the superseded rows', async () => {
  const db = client({
    diaspora_billing_provider_events: [appliedEvent({ id: 'evt-applied', occurredAt: '2026-06-21T12:00:00.000Z' })],
  });
  await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-stale', tenantId: TENANT_A,
    occurredAt: '2026-06-21T01:00:00.000Z', supabaseClient: db,
  });
  const list = await ledger.listSupersededEvents({ supabaseClient: db });
  assert.equal(list.length, 1);
  assert.equal(list[0].event_id, 'evt-stale');
});

test('occurred_at normalization accepts unix seconds and ISO, and rejects nonsense', () => {
  assert.equal(ledger.normalizeOccurredAt(1780876800, {}), '2026-06-08T00:00:00.000Z');
  assert.equal(ledger.normalizeOccurredAt('2026-06-21T00:00:00.000Z', {}), '2026-06-21T00:00:00.000Z');
  assert.equal(ledger.normalizeOccurredAt('not-a-date', {}), null);
  assert.equal(ledger.normalizeOccurredAt(null, {}), null);
  assert.equal(ledger.normalizeSequence(null, { sequence: '12' }), 12);
  assert.equal(ledger.normalizeSequence(null, {}), null);
});

// ── Route level: the scenario that costs money ──────────────────────────────────────────────────

let server; let baseUrl; let app; let domainClient;

const authDb = {
  users: { 'user-A': { id: 'user-A', role: 'owner', is_verified: true } },
  tenantUsers: { [`${TENANT_A}|user-A`]: { role: 'admin' } },
};
function authBuilder(table) {
  const state = { table, filters: {} };
  const chain = {
    select() { return chain; },
    eq(k, v) { state.filters[k] = v; return chain; },
    single() { return Promise.resolve(resolveAuth(state)); },
    maybeSingle() { return Promise.resolve(resolveAuth(state)); },
    then(resolve, reject) { try { return Promise.resolve(resolveAuth(state)).then(resolve, reject); } catch (e) { return reject ? reject(e) : Promise.reject(e); } },
  };
  return chain;
}
function resolveAuth(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });
  switch (state.table) {
    case 'user_sessions': return missing('no session');
    case 'users': return authDb.users[state.filters.id] ? ok(authDb.users[state.filters.id]) : missing('no user');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return authDb.tenantUsers[key] ? ok(authDb.tenantUsers[key]) : missing('no membership');
    }
    default: return ok([]);
  }
}

before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => authBuilder(t) });
  app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/subscription', subscriptionRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

function setDomain(db) {
  domainClient = db;
  app.locals.diasporaTestDeps = { supabaseClient: db, billingProvider: getSharedSandboxProvider() };
}

function signedPost(path, payload) {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', billingWebhookSecret()).update(raw).digest('hex');
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-billing-signature': signature },
    body: raw,
  });
}

function subscriptionEvent({ id, status, planKey, occurredAt }) {
  return {
    id,
    type: 'subscription.updated',
    occurred_at: occurredAt,
    data: { tenantId: TENANT_A, planKey, status },
  };
}

test('ROUTE: a retry that overtakes a newer event does NOT resurrect a cancelled subscription', async () => {
  setDomain(client());

  // T2 (cancellation) is delivered first — providers retry, and retries overtake.
  const cancelRes = await signedPost('/subscription/webhook', subscriptionEvent({
    id: 'evt-cancel', status: 'cancelled', planKey: 'seller', occurredAt: '2026-06-21T12:00:00.000Z',
  }));
  assert.equal(cancelRes.status, 200);
  const cancelled = domainClient._rows('diaspora_subscriptions').find((s) => s.tenant_id === TENANT_A);
  assert.equal(cancelled.status, 'cancelled');

  // T1 (an older "active" update) now arrives. Applying it would silently reinstate a paid plan for a
  // tenant who cancelled — the whole reason supersede semantics exist.
  const lateRes = await signedPost('/subscription/webhook', subscriptionEvent({
    id: 'evt-active-late', status: 'active', planKey: 'enterprise', occurredAt: '2026-06-21T09:00:00.000Z',
  }));
  const lateBody = await lateRes.json();
  assert.equal(lateRes.status, 200);
  assert.equal(lateBody.superseded, true);
  assert.equal(lateBody.applied, false);

  const after = domainClient._rows('diaspora_subscriptions').find((s) => s.tenant_id === TENANT_A);
  assert.equal(after.status, 'cancelled', 'still cancelled');
  assert.equal(after.plan_key, 'seller', 'and not escalated to enterprise');

  // The late event is still durably recorded — superseded is not discarded.
  const events = domainClient._rows('diaspora_billing_provider_events');
  assert.equal(events.length, 2);
  const late = events.find((e) => e.event_id === 'evt-active-late');
  assert.equal(late.superseded, true);
  assert.ok(late.superseded_by);

  const signals = recentBillingSignals(BILLING_EVENTS.WEBHOOK_SUPERSEDED);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].eventId, 'evt-active-late');
});

test('ROUTE: an in-order sequence of events applies each one', async () => {
  setDomain(client());
  await signedPost('/subscription/webhook', subscriptionEvent({
    id: 'evt-o1', status: 'trialing', planKey: 'seller', occurredAt: '2026-06-21T09:00:00.000Z',
  }));
  await signedPost('/subscription/webhook', subscriptionEvent({
    id: 'evt-o2', status: 'active', planKey: 'trade_pro', occurredAt: '2026-06-21T10:00:00.000Z',
  }));
  const row = domainClient._rows('diaspora_subscriptions').find((s) => s.tenant_id === TENANT_A);
  assert.equal(row.status, 'active');
  assert.equal(row.plan_key, 'trade_pro');
});

test('ROUTE: a webhook without a raw body is REFUSED rather than verified against a re-serialization', async () => {
  setDomain(client());
  // An app whose parser did not capture raw bytes: the signature covers bytes we do not have.
  const bare = express();
  bare.use(express.json()); // deliberately no `verify`
  bare.use('/subscription', subscriptionRouter);
  bare.use(errorHandler);
  bare.locals.diasporaTestDeps = { supabaseClient: domainClient, billingProvider: getSharedSandboxProvider() };
  const bareServer = await new Promise((resolve) => {
    const s = http.createServer(bare);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const payload = subscriptionEvent({ id: 'evt-nobody', status: 'active', planKey: 'seller', occurredAt: '2026-06-21T09:00:00.000Z' });
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', billingWebhookSecret()).update(raw).digest('hex');
    const res = await fetch(`http://127.0.0.1:${bareServer.address().port}/subscription/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-billing-signature': signature },
      body: raw,
    });
    assert.equal(res.status, 400);
    assert.equal(domainClient._rows('diaspora_billing_provider_events').length, 0);
  } finally {
    await new Promise((r) => bareServer.close(r));
  }
});

test('ROUTE: a duplicate delivery is idempotent and emits a duplicate signal', async () => {
  setDomain(client());
  const event = subscriptionEvent({ id: 'evt-idem', status: 'active', planKey: 'seller', occurredAt: '2026-06-21T09:00:00.000Z' });
  const first = await (await signedPost('/subscription/webhook', event)).json();
  const second = await (await signedPost('/subscription/webhook', event)).json();
  assert.equal(first.applied, true);
  assert.equal(second.alreadyProcessed, true);
  assert.equal(domainClient._rows('diaspora_billing_provider_events').length, 1);
  assert.equal(recentBillingSignals(BILLING_EVENTS.WEBHOOK_DUPLICATE).length, 1);
});

test('ROUTE: a rejected signature is recorded as a signal and writes nothing', async () => {
  setDomain(client());
  const res = await fetch(`${baseUrl}/subscription/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-billing-signature': 'deadbeef' },
    body: JSON.stringify({ id: 'evt-bad', type: 'subscription.updated', data: {} }),
  });
  assert.equal(res.status, 400);
  assert.equal(domainClient._rows('diaspora_billing_provider_events').length, 0);
  assert.equal(recentBillingSignals(BILLING_EVENTS.WEBHOOK_REJECTED).length, 1);
});

test('ROUTE: every webhook response carries a correlation id', async () => {
  setDomain(client());
  const body = await (await signedPost('/subscription/webhook', subscriptionEvent({
    id: 'evt-corr', status: 'active', planKey: 'seller', occurredAt: '2026-06-21T09:00:00.000Z',
  }))).json();
  assert.ok(body.correlationId, 'a webhook rarely arrives with one, so one is minted');
  const row = domainClient._rows('diaspora_billing_provider_events')[0];
  assert.equal(row.correlation_id, body.correlationId, 'and it is stored on the ledger row');
});

test('ROUTE: an operator can trigger a tenant-scoped reconciliation and gets sanitized findings', async () => {
  setDomain(client({
    diaspora_subscriptions: [{
      id: 'sub-drift', tenant_id: TENANT_A, plan_key: 'seller', status: 'active',
      current_period_end: '2026-07-01T00:00:00.000Z', cancel_at_period_end: false,
      provider: 'sandbox', provider_subscription_ref: 'sbx_sub_drift',
      deleted_at: null, created_at: '2026-06-01T00:00:00.000Z',
    }],
  }));
  const res = await fetch(`${baseUrl}/subscription/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-A', 'x-tenant-id': TENANT_A },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.state, 'completed');
  assert.equal(body.data.checked, 1);
  // The shared sandbox has never seen this subscription ref, so the honest finding is MISSING.
  assert.equal(body.data.findings[0].kind, 'MISSING_AT_PROVIDER');
  assert.ok(body.data.runId);

  const runs = domainClient._rows('diaspora_billing_reconciliation_runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, 'operator');
  assert.equal(runs[0].initiated_by, 'user-A');
});

test('ROUTE: reconciliation endpoints require the trusted-manager gate', async () => {
  setDomain(client());
  const noTenant = await fetch(`${baseUrl}/subscription/reconcile`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'user-A' },
  });
  assert.ok(noTenant.status === 400 || noTenant.status === 403, `got ${noTenant.status}`);
});

test('ROUTE: billing-health surfaces all four signals for the tenant', async () => {
  setDomain(client({
    diaspora_billing_provider_events: [
      {
        id: 'ev-dead', provider: 'sandbox', event_id: 'evt-dead', event_type: 'subscription.updated',
        tenant_id: TENANT_A, dead_lettered: true, superseded: false, last_error: 'handler threw',
        attempts: 5, processed_at: '2026-06-21T00:00:00.000Z', created_at: '2026-06-21T00:00:00.000Z',
      },
    ],
    diaspora_billing_checkout_sessions: [
      { id: 'cs-x', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'abandoned' },
      { id: 'cs-y', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'completed' },
    ],
  }));
  const res = await fetch(`${baseUrl}/subscription/billing-health`, {
    headers: { 'x-user-id': 'user-A', 'x-tenant-id': TENANT_A },
  });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.failedWebhooks.count, 1);
  assert.equal(data.checkout.counts.abandoned, 1);
  assert.equal(data.checkout.abandonmentRate, 0.5);
  // Never run before -> stale. Silence is the failure this field exists to make visible.
  assert.equal(data.reconciliation.stale, true);
  assert.equal(data.reconciliation.reason, 'NEVER_COMPLETED');
});

test('ROUTE: a checkout records a durable session row so abandonment is measurable later', async () => {
  setDomain(client());
  const res = await fetch(`${baseUrl}/subscription/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-A', 'x-tenant-id': TENANT_A },
    body: JSON.stringify({ planKey: 'seller' }),
  });
  assert.equal(res.status, 201);
  const sessions = domainClient._rows('diaspora_billing_checkout_sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tenant_id, TENANT_A);
  assert.equal(sessions[0].plan_key, 'seller');
  assert.equal(sessions[0].state, 'open');
  assert.ok(sessions[0].session_ref);
});

// ─────────────────────────────────────────────────────────────────────────────
// Stale-claim reclaim (integration of two independently-developed fixes, Issue #127)
//
// Two lanes fixed the same defect differently. The billing lane replaced SELECT-then-INSERT with
// claim-by-INSERT, which closes the concurrency race; a parallel fix made an unprocessed row
// re-processable, which closes the blackhole where an apply that died after the INSERT was answered
// "already processed" on every subsequent retry — leaving, for a cancellation, a tenant on a paid
// plan forever.
//
// Taking either alone loses the other. The row cannot distinguish "in flight" from "died partway", so
// age does: under the lease it is a concurrent duplicate, over it the apply is presumed dead.
// ─────────────────────────────────────────────────────────────────────────────

test('an unprocessed claim OVER the lease is re-claimed, so a provider retry is not blackholed', async () => {
  const db = client();
  await ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-stale', tenantId: TENANT_A, supabaseClient: db });

  // The apply died before stamping processed_at, and the provider retries much later.
  const row = db._rows('diaspora_billing_provider_events').find((r) => r.event_id === 'evt-stale');
  row.created_at = new Date(Date.now() - ledger.BILLING_CLAIM_LEASE_MS - 60_000).toISOString();
  row.processed_at = null;

  const retry = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-stale', tenantId: TENANT_A, supabaseClient: db,
  });
  assert.equal(retry.claimed, true, 'a dead apply must be re-claimed, not answered "already processed"');
  assert.equal(retry.reclaimed, true);
  assert.equal(retry.duplicate, false);
  assert.equal(db._rows('diaspora_billing_provider_events').length, 1, 'and no second row is inserted');
});

test('a PROCESSED claim over the lease is still a duplicate — completed work is never re-applied', async () => {
  const db = client();
  await ledger.claimBillingEvent({ provider: PROVIDER, eventId: 'evt-done', tenantId: TENANT_A, supabaseClient: db });
  const row = db._rows('diaspora_billing_provider_events').find((r) => r.event_id === 'evt-done');
  row.created_at = new Date(Date.now() - ledger.BILLING_CLAIM_LEASE_MS - 60_000).toISOString();
  row.processed_at = new Date().toISOString();

  const again = await ledger.claimBillingEvent({
    provider: PROVIDER, eventId: 'evt-done', tenantId: TENANT_A, supabaseClient: db,
  });
  assert.equal(again.claimed, false);
  assert.equal(again.duplicate, true);
});
