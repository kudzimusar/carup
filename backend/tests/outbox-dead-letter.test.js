/**
 * Milestone 6 — Transactional Outbox dead-letter handling tests.
 *
 * Verifies that:
 *   1. A handler that keeps failing escalates attempts and, once attempts reach
 *      MAX_OUTBOX_ATTEMPTS, the event transitions to the terminal 'dead_letter'
 *      state (with dead_lettered_at stamped) rather than the generic 'failed'.
 *   2. Before the threshold, failures stay 'pending' for retry.
 *   3. reprocessDeadLetters() replays dead-lettered rows back to 'pending' with
 *      attempts reset, and honors id/eventType filters.
 *
 * Uses a table-aware in-memory pg mock injected onto the worker's pool, in the
 * same spirit as the Supabase mock in evidence-catalog-routes.test.js.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { eventWorker, MAX_OUTBOX_ATTEMPTS } = await import('../services/eventBus/eventWorker.js');

// ---- table-aware in-memory pg mock --------------------------------------------------
let rows; // domain_events table

function makeClient() {
  return {
    released: false,
    async query(sql, params = []) {
      const text = sql.trim();

      // processEvent failure path:
      // UPDATE domain_events SET status=$1, attempts=$2, error_log=$3, dead_lettered_at=NOW()|NULL WHERE id=$4
      if (/^UPDATE domain_events\s+SET status = \$1/i.test(text)) {
        const [status, attempts, errorLog] = params;
        const id = params[3];
        const stampsDeadLetter = /dead_lettered_at = NOW\(\)/i.test(text);
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.status = status;
          row.attempts = attempts;
          row.error_log = errorLog;
          row.dead_lettered_at = stampsDeadLetter ? new Date().toISOString() : null;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      // processEvent success path:
      // UPDATE domain_events SET status='processed', attempts=$1, error_log=NULL WHERE id=$2
      if (/^UPDATE domain_events\s+SET status = 'processed'/i.test(text)) {
        const [attempts, id] = params;
        const row = rows.find((r) => r.id === id);
        if (row) { row.status = 'processed'; row.attempts = attempts; row.error_log = null; }
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      // reprocessDeadLetters:
      // UPDATE domain_events SET status='pending', attempts=0, ... WHERE <conditions> RETURNING id
      if (/^UPDATE domain_events\s+SET status = 'pending'/i.test(text)) {
        let candidates = rows.filter((r) => r.status === 'dead_letter');
        // Conditions are appended in order: optional id = ANY($n), optional event_type = $n
        let pi = 0;
        if (/id = ANY/i.test(text)) {
          const idList = params[pi++];
          candidates = candidates.filter((r) => idList.includes(r.id));
        }
        if (/event_type = \$/i.test(text)) {
          const et = params[pi++];
          candidates = candidates.filter((r) => r.event_type === et);
        }
        for (const r of candidates) {
          r.status = 'pending';
          r.attempts = 0;
          r.error_log = null;
          r.dead_lettered_at = null;
        }
        return { rows: candidates.map((r) => ({ id: r.id })), rowCount: candidates.length };
      }

      throw new Error(`Unexpected SQL in mock: ${text.slice(0, 80)}`);
    },
    release() { this.released = true; },
  };
}

function installMockPool() {
  eventWorker.pool = {
    async connect() { return makeClient(); },
  };
}

beforeEach(() => {
  rows = [];
  installMockPool();
  // Reset handlers map between tests.
  eventWorker.handlers = new Map();
});

function seedEvent(overrides = {}) {
  const ev = {
    id: overrides.id || `evt-${rows.length + 1}`,
    event_type: overrides.event_type || 'demo.event',
    payload: overrides.payload || {},
    status: overrides.status || 'pending',
    attempts: overrides.attempts ?? 0,
    error_log: null,
    tenant_id: overrides.tenant_id || null,
    dead_lettered_at: null,
    created_at: new Date().toISOString(),
  };
  rows.push(ev);
  return ev;
}

test('failing handler keeps event pending below the attempt threshold', async () => {
  eventWorker.subscribe('demo.event', async () => { throw new Error('boom'); });
  const ev = seedEvent({ attempts: 0 });
  const client = makeClient();
  await eventWorker.processEvent(client, ev);

  const row = rows.find((r) => r.id === ev.id);
  assert.equal(row.attempts, 1);
  assert.equal(row.status, 'pending');
  assert.equal(row.dead_lettered_at, null);
});

test('event moves to dead_letter when attempts reach MAX_OUTBOX_ATTEMPTS', async () => {
  eventWorker.subscribe('demo.event', async () => { throw new Error('persistent failure'); });
  // Start one below the max so this attempt is the final one.
  const ev = seedEvent({ attempts: MAX_OUTBOX_ATTEMPTS - 1 });
  const client = makeClient();
  await eventWorker.processEvent(client, ev);

  const row = rows.find((r) => r.id === ev.id);
  assert.equal(row.attempts, MAX_OUTBOX_ATTEMPTS);
  assert.equal(row.status, 'dead_letter');
  assert.ok(row.dead_lettered_at, 'dead_lettered_at is stamped');
  assert.match(row.error_log, /persistent failure/);
});

test('repeated failures escalate from pending to dead_letter', async () => {
  eventWorker.subscribe('demo.event', async () => { throw new Error('always fails'); });
  let ev = seedEvent({ attempts: 0 });

  for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i++) {
    const row = rows.find((r) => r.id === ev.id);
    await eventWorker.processEvent(makeClient(), row);
  }
  const final = rows.find((r) => r.id === ev.id);
  assert.equal(final.attempts, MAX_OUTBOX_ATTEMPTS);
  assert.equal(final.status, 'dead_letter');
});

test('reprocessDeadLetters replays all dead-lettered events back to pending', async () => {
  seedEvent({ id: 'dl-1', status: 'dead_letter', attempts: 5 });
  seedEvent({ id: 'dl-2', status: 'dead_letter', attempts: 5 });
  seedEvent({ id: 'ok-1', status: 'processed', attempts: 1 });

  const result = await eventWorker.reprocessDeadLetters();
  assert.equal(result.replayed, 2);
  assert.deepEqual(result.ids.sort(), ['dl-1', 'dl-2']);

  for (const id of ['dl-1', 'dl-2']) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.dead_lettered_at, null);
  }
  // Unrelated processed row is untouched.
  assert.equal(rows.find((r) => r.id === 'ok-1').status, 'processed');
});

test('reprocessDeadLetters honors id and eventType filters', async () => {
  seedEvent({ id: 'a', status: 'dead_letter', event_type: 'type.x', attempts: 5 });
  seedEvent({ id: 'b', status: 'dead_letter', event_type: 'type.y', attempts: 5 });

  const byId = await eventWorker.reprocessDeadLetters({ ids: ['a'] });
  assert.deepEqual(byId.ids, ['a']);
  assert.equal(rows.find((r) => r.id === 'a').status, 'pending');
  assert.equal(rows.find((r) => r.id === 'b').status, 'dead_letter');

  const byType = await eventWorker.reprocessDeadLetters({ eventType: 'type.y' });
  assert.deepEqual(byType.ids, ['b']);
  assert.equal(rows.find((r) => r.id === 'b').status, 'pending');
});
