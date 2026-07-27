/**
 * SafeTrade transactional-outbox drainer — service tests (ST-3 item #1, Issue #127).
 *
 * The database half (atomicity, claim leases, backoff, dead-lettering) is proven on real PostgreSQL
 * in database/test/diaspora_st3_item1_migration_check.mjs. This file covers the JavaScript half: the
 * drainer's behaviour around handlers, which is where an outbox usually goes wrong in practice.
 *
 * The failure modes under test are the ones that quietly defeat the whole mechanism:
 *   · one poisonous event aborting the batch and stranding everything behind it;
 *   · a handler throwing and the event being marked delivered anyway;
 *   · an event with no registered handler being treated as a failure and filling the dead-letter
 *     queue with things that are working exactly as intended;
 *   · payloads carrying participant data into a downstream that never needed it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const outbox = await import('../services/diaspora/safetrade/diasporaSafeTradeOutboxService.js');
const { SAFETRADE_RPCS } = await import('./helpers/diasporaSafeTradeRpcReference.js');

/** Minimal client exposing the two drainer RPCs plus a table read, backed by an in-memory store. */
function createOutboxClient(rows = []) {
  const tables = { diaspora_safetrade_outbox: rows.map((r, i) => ({
    id: r.id || `evt-${i + 1}`,
    tenant_id: r.tenant_id ?? 'tenant-A',
    transaction_id: r.transaction_id ?? 'txn-1',
    milestone_id: r.milestone_id ?? null,
    event_type: r.event_type || 'SAFETRADE_TEST_EVENT',
    payload: r.payload || {},
    correlation_id: r.correlation_id ?? null,
    actor_id: r.actor_id ?? 'user-1',
    status: r.status || 'pending',
    attempts: r.attempts ?? 0,
    next_attempt_at: r.next_attempt_at ?? null,
    dispatched_at: null,
    last_error: null,
    created_at: r.created_at || `2026-06-21T00:00:0${i}.000Z`,
  })) };
  const table = (name) => (tables[name] ||= []);
  const nextId = (() => { let n = 0; return (p) => `${p}-${++n}`; })();

  return {
    _tables: tables,
    async rpc(name, params) {
      const impl = SAFETRADE_RPCS[name];
      if (!impl) return { data: null, error: { message: `no such rpc ${name}` } };
      try { return { data: impl(params, { table, nextId, faults: {} }), error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
    },
    from(name) {
      const state = { eq: [], inList: null, payload: null, op: 'select', columns: null };
      // Honour the select() column list. supabase-js returns ONLY the requested columns, and the
      // "payload is never returned" guarantee is implemented precisely by omitting it from that list.
      // A fake that returns whole rows regardless would report a leak that does not exist — and,
      // worse, would report no leak if someone later added `payload` to the list.
      const project = (row) => {
        if (!state.columns) return { ...row };
        const out = {};
        for (const c of state.columns) if (c in row) out[c] = row[c];
        return out;
      };
      const api = {
        select(cols) {
          if (typeof cols === 'string' && cols.trim() && cols.trim() !== '*') {
            state.columns = cols.split(',').map((c) => c.trim()).filter(Boolean);
          }
          return api;
        },
        update(p) { state.op = 'update'; state.payload = p; return api; },
        eq(c, v) { state.eq.push([c, v]); return api; },
        in(c, v) { state.inList = [c, v]; return api; },
        order() { return api; },
        limit() { return api; },
        _matched() {
          let rs = table(name);
          for (const [c, v] of state.eq) rs = rs.filter((r) => r[c] === v);
          if (state.inList) rs = rs.filter((r) => state.inList[1].includes(r[state.inList[0]]));
          return rs;
        },
        async maybeSingle() {
          const rs = api._matched();
          if (state.op === 'update') rs.forEach((r) => Object.assign(r, state.payload));
          return { data: rs[0] ? project(rs[0]) : null, error: null };
        },
        then(res, rej) {
          const rs = api._matched();
          if (state.op === 'update') rs.forEach((r) => Object.assign(r, state.payload));
          return Promise.resolve({ data: rs.map(project), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

test.beforeEach(() => outbox.__resetOutboxHandlers());

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────

test('a registered handler receives the event and the event is marked dispatched', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  const seen = [];
  outbox.registerOutboxHandler('A', async (e) => { seen.push(e.event_type); });

  const summary = await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.equal(summary.claimed, 1);
  assert.equal(summary.dispatched, 1);
  assert.deepEqual(seen, ['A']);
  assert.equal(client._tables.diaspora_safetrade_outbox[0].status, 'dispatched');
});

test('every handler registered for a type runs', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  const calls = [];
  outbox.registerOutboxHandler('A', async () => { calls.push('first'); });
  outbox.registerOutboxHandler('A', async () => { calls.push('second'); });
  await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.deepEqual(calls, ['first', 'second']);
});

test('an event with NO registered handler is dispatched, not dead-lettered', async () => {
  // "Nobody is listening yet" is not a failure. Treating it as one would fill the dead-letter queue
  // with events that are behaving exactly as intended, and bury the real failures.
  const client = createOutboxClient([{ event_type: 'NOBODY_LISTENING' }]);
  const summary = await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.equal(summary.noHandler, 1);
  assert.equal(summary.dispatched, 1);
  assert.equal(summary.deadLettered, 0);
  assert.equal(client._tables.diaspora_safetrade_outbox[0].status, 'dispatched');
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure handling
// ─────────────────────────────────────────────────────────────────────────────

test('a throwing handler does NOT mark the event delivered', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  outbox.registerOutboxHandler('A', async () => { throw new Error('downstream unavailable'); });

  const summary = await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.equal(summary.dispatched, 0);
  assert.equal(summary.failed, 1);
  const row = client._tables.diaspora_safetrade_outbox[0];
  assert.equal(row.status, 'failed');
  assert.ok(row.next_attempt_at, 'it must be scheduled for another attempt');
  assert.match(row.last_error, /downstream unavailable/);
});

test('one poisonous event does not strand the rest of the batch', async () => {
  const client = createOutboxClient([
    { id: 'e1', event_type: 'POISON', created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'e2', event_type: 'FINE', created_at: '2026-06-21T00:00:01.000Z' },
    { id: 'e3', event_type: 'FINE', created_at: '2026-06-21T00:00:02.000Z' },
  ]);
  outbox.registerOutboxHandler('POISON', async () => { throw new Error('boom'); });
  outbox.registerOutboxHandler('FINE', async () => {});

  const summary = await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.equal(summary.claimed, 3);
  assert.equal(summary.dispatched, 2, 'the two healthy events must still be delivered');
  assert.equal(summary.failed, 1);
});

test('an event reaching the attempt ceiling is dead-lettered, not retried forever', async () => {
  const client = createOutboxClient([{ event_type: 'A', attempts: 4 }]);
  outbox.registerOutboxHandler('A', async () => { throw new Error('still broken'); });

  // Claiming takes attempts to 5, which is the ceiling.
  const summary = await outbox.drainOutboxBatch({ supabaseClient: client, maxAttempts: 5 });
  assert.equal(summary.deadLettered, 1);
  assert.equal(summary.failed, 0);
  const row = client._tables.diaspora_safetrade_outbox[0];
  assert.equal(row.status, 'dead_lettered');
  assert.equal(row.next_attempt_at, null);
});

test('backoff grows with each attempt', async () => {
  const early = createOutboxClient([{ event_type: 'A', attempts: 0 }]);
  const late = createOutboxClient([{ event_type: 'A', attempts: 3 }]);
  outbox.registerOutboxHandler('A', async () => { throw new Error('nope'); });

  const now = '2026-06-21T00:00:00.000Z';
  await outbox.drainOutboxBatch({ supabaseClient: early, now, maxAttempts: 10 });
  await outbox.drainOutboxBatch({ supabaseClient: late, now, maxAttempts: 10 });

  const earlyWait = Date.parse(early._tables.diaspora_safetrade_outbox[0].next_attempt_at) - Date.parse(now);
  const lateWait = Date.parse(late._tables.diaspora_safetrade_outbox[0].next_attempt_at) - Date.parse(now);
  assert.ok(lateWait > earlyWait, `a later attempt must wait longer (${lateWait} vs ${earlyWait})`);
});

test('a failed handler reports a sanitized reason, not a raw stack', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  outbox.registerOutboxHandler('A', async () => { throw new Error('x'.repeat(2000)); });
  const summary = await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.ok(summary.results[0].error.length <= 300, 'the operator-facing reason is bounded');
  assert.ok(client._tables.diaspora_safetrade_outbox[0].last_error.length <= 500);
});

// ─────────────────────────────────────────────────────────────────────────────
// Claiming
// ─────────────────────────────────────────────────────────────────────────────

test('a leased event is not claimed again by a second drain', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  // A handler that never settles would leave the lease in place; simulate by claiming directly.
  const first = await outbox.claimOutboxEvents({ supabaseClient: client, now: '2026-06-21T00:00:00.000Z' });
  assert.equal(first.length, 1);
  const second = await outbox.claimOutboxEvents({ supabaseClient: client, now: '2026-06-21T00:00:00.000Z' });
  assert.equal(second.length, 0, 'the lease must prevent a duplicate delivery');
});

test('an expired lease makes the event claimable again', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  await outbox.claimOutboxEvents({ supabaseClient: client, leaseSeconds: 60, now: '2026-06-21T00:00:00.000Z' });
  const later = await outbox.claimOutboxEvents({ supabaseClient: client, now: '2026-06-21T00:05:00.000Z' });
  assert.equal(later.length, 1, 'a drainer that died mid-flight must not park the event forever');
});

test('claims are ordered oldest-first so the queue cannot starve', async () => {
  const client = createOutboxClient([
    { id: 'new', event_type: 'A', created_at: '2026-06-21T10:00:00.000Z' },
    { id: 'old', event_type: 'A', created_at: '2026-06-21T09:00:00.000Z' },
  ]);
  const claimed = await outbox.claimOutboxEvents({ supabaseClient: client, limit: 1, now: '2026-06-21T11:00:00.000Z' });
  assert.equal(claimed[0].id, 'old');
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator visibility
// ─────────────────────────────────────────────────────────────────────────────

test('the backlog summary reports the OLDEST unsettled age, not just a count', async () => {
  // Three events whose oldest is hours old is a stalled drainer; a count alone hides that entirely.
  const client = createOutboxClient([
    { id: 'a', status: 'pending', created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'b', status: 'failed', created_at: '2026-06-21T02:00:00.000Z' },
    { id: 'c', status: 'dead_lettered', created_at: '2026-06-21T01:00:00.000Z' },
  ]);
  const summary = await outbox.outboxBacklogSummary({ supabaseClient: client, now: '2026-06-21T04:00:00.000Z' });
  assert.equal(summary.pending, 1);
  assert.equal(summary.retrying, 1);
  assert.equal(summary.deadLettered, 1);
  assert.equal(summary.oldestPendingAgeSeconds, 4 * 3600);
});

test('a dead letter never returns its payload, and says why', async () => {
  const client = createOutboxClient([
    { id: 'dl', status: 'dead_lettered', event_type: 'A', payload: { participantId: 'p-1', email: 'x@y.z' } },
  ]);
  const rows = await outbox.listOutboxDeadLetters({ supabaseClient: client });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload, undefined);
  assert.equal(rows[0].payloadWithheld, true);
  assert.match(rows[0].payloadWithheldReason, /never returned/);
});

test('replaying a dead letter resets attempts so a transient blip does not re-bury it', async () => {
  const client = createOutboxClient([{ id: 'dl', status: 'dead_lettered', attempts: 5 }]);
  const row = await outbox.replayDeadLetter({ id: 'dl', supabaseClient: client });
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
  assert.equal(row.next_attempt_at, null);
});

test('only a dead-lettered event can be replayed', async () => {
  const client = createOutboxClient([{ id: 'p', status: 'pending' }]);
  const row = await outbox.replayDeadLetter({ id: 'p', supabaseClient: client });
  assert.equal(row, null, 'replaying a live event would duplicate its delivery');
});

// ─────────────────────────────────────────────────────────────────────────────
// Payload hygiene
// ─────────────────────────────────────────────────────────────────────────────

test('aux payloads keep operational facts and drop identities', async () => {
  const sanitized = outbox.sanitizeAuxPayload({
    milestoneId: 'm-1',
    disputeId: 'd-1',
    holdReference: 'hold-1',
    reasons: ['ACTIVE_DISPUTE'],
    // None of these belong in a downstream notification.
    buyerId: 'user-buyer',
    sellerId: 'user-seller',
    email: 'buyer@example.com',
    phone: '+263771234567',
    statement: 'free text a participant typed',
  });
  assert.deepEqual(Object.keys(sanitized).sort(), ['disputeId', 'holdReference', 'milestoneId', 'reasons']);
});

test('sanitization is an allowlist, so a field added later is dropped by default', () => {
  const sanitized = outbox.sanitizeAuxPayload({ milestoneId: 'm-1', someFuturePiiField: 'sensitive' });
  assert.deepEqual(Object.keys(sanitized), ['milestoneId']);
});

test('buildAuxEvent sanitizes on the way in, so an emitter cannot bypass it', () => {
  const event = outbox.buildAuxEvent(outbox.SAFETRADE_AUX_EVENTS.DISPUTE_HOLD_PLACED, {
    disputeId: 'd-1', buyerId: 'user-buyer',
  });
  assert.equal(event.eventType, 'SAFETRADE_DISPUTE_HOLD_PLACED');
  assert.equal(event.payload.disputeId, 'd-1');
  assert.equal(event.payload.buyerId, undefined);
});

test('handler registration returns an unsubscribe', async () => {
  const client = createOutboxClient([{ event_type: 'A' }]);
  let calls = 0;
  const off = outbox.registerOutboxHandler('A', async () => { calls += 1; });
  off();
  await outbox.drainOutboxBatch({ supabaseClient: client });
  assert.equal(calls, 0);
});

test('a non-function handler is refused at registration time', () => {
  assert.throws(() => outbox.registerOutboxHandler('A', 'not a function'), /must be a function/);
});
