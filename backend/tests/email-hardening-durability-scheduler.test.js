import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { createCommunicationRouter } from '../routes/communicationBaseRoutes.js';
import { EMAIL_VERIFIED_EVENT } from '../services/communication/producers/leadershipWelcomeProducer.js';
import { CommunicationOrchestratorService } from '../services/communication/communicationOrchestratorService.js';
import { deterministicEventIdentity } from '../services/eventBus/eventBusService.js';
import {
  EMAIL_1_0_PROGRAM,
  reconcileCommunicationDurability,
} from '../services/communication/reconcileCommunicationDurability.js';
import {
  ANNOUNCED_FINGERPRINT_COLUMN,
  TRUST_PRESENTATION_CHANGED_EVENT,
  trustPresentationFingerprint,
} from '../services/trustDecision/trustPresentationChangeProducer.js';

/**
 * THE DURABILITY SCHEDULER — recovery that something actually invokes.
 *
 * THE DEFECT CLASS. `reconcileTrustPresentation()` was written for R5-D1, hardened again in C3,
 * thoroughly tested — and every call site was a test file. R1's durable outbox event closes every
 * failure after the insert, but nothing reconstructed the event when the insert itself failed.
 * `idx_vehicles_trust_unannounced` was added to the migration expressly to make the Trust scan cheap,
 * so the index existed for a scanner that did not. A recovery mechanism nothing schedules is not one.
 *
 * These tests drive the PRODUCTION ENTRY POINT — `POST /api/internal/communications/process`, the
 * route pg_cron already calls every minute — not the reconcilers directly. Calling the reconciler in
 * a test and declaring victory is exactly the mistake that produced this defect in the first place.
 *
 * THE MOST IMPORTANT THING PROVEN HERE IS A NEGATIVE. On its first run, without an activation
 * boundary, each scanner would classify the whole of history as outstanding work: every existing
 * vehicle has a NULL announced-fingerprint, and every account verified before Email 1.0 existed has
 * no welcome. Reconciling those would mail every historical customer. `BASELINE-1` and `BASELINE-2`
 * are the tests that must never be deleted.
 */

const WORKER_SECRET = 'durability-scheduler-worker-secret';
const BOUNDARY = '2026-08-27T00:00:00.000Z';
const BEFORE = '2026-08-01T00:00:00.000Z';
const AFTER = '2026-08-28T00:00:00.000Z';

function trustRecord(vin, overrides = {}) {
  return {
    vin, evaluation_state: 'evaluated', score: 78, band: 'moderate', confidence: 'medium',
    evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
    calculation_version: 'trust-decision-1.0.0', evaluated_at: '2026-08-28T00:00:00.000Z',
    known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
    source: 'cache', ...overrides,
  };
}

/**
 * A world with a real activation boundary row, a domain_events table that enforces the partial
 * unique dedupe index, and vehicles/users spanning both sides of the boundary.
 */
function world({ boundary = BOUNDARY, vehicles = [], users = [] } = {}) {
  const store = {
    communication_activation_boundaries: boundary ? [{ program: EMAIL_1_0_PROGRAM, activated_at: boundary }] : [],
    vehicles,
    users,
    domain_events: [],
    notification_queue: [],
  };
  const queued = [];
  const scans = { vehicles: [], users: [] };

  function dedupeKeyFor(eventType, payload) {
    const identity = deterministicEventIdentity(eventType, payload);
    return identity?.dedupeKey || null;
  }

  const repository = {
    rows: (table) => (store[table] || (store[table] = [])),
    findOne: async (table, filters) => (store[table] || []).find((row) => Object.entries(filters)
      .every(([k, v]) => (v === null ? row[k] == null : String(row[k] ?? '') === String(v ?? '')))) || null,
    list: async (table, filters = {}, options = {}) => {
      let rows = (store[table] || []).filter((row) => Object.entries(filters)
        .every(([k, v]) => (v === null ? row[k] == null : String(row[k] ?? '') === String(v ?? ''))));
      if (options.gt) {
        const { column, value } = options.gt;
        rows = rows.filter((row) => row[column] != null && new Date(row[column]) > new Date(value));
      }
      if (options.order) {
        const { column, ascending = false } = options.order;
        rows = [...rows].sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
      }
      if (options.limit) rows = rows.slice(0, Number(options.limit));
      if (table === 'vehicles') scans.vehicles.push(rows.length);
      if (table === 'users') scans.users.push(rows.length);
      return rows;
    },
    insert: async (table, row) => { (store[table] || (store[table] = [])).push(row); return row; },
    updateById: async () => ({}),
    // The Supabase-shaped surface reconcileTrustPresentation reads/writes the marker through.
    client: {
      from: (table) => {
        const filters = [];
        let patch = null;
        const api = {
          select: () => api,
          update: (p) => { patch = p; return api; },
          eq: (c, v) => { filters.push((r) => String(r[c] ?? '') === String(v ?? '')); return api; },
          maybeSingle: async () => ({ data: (store[table] || []).find((r) => filters.every((f) => f(r))) || null, error: null }),
          then: (res, rej) => {
            if (patch) (store[table] || []).filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return api;
      },
    },
  };

  // A domain-event emitter that enforces the partial unique index, exactly like the migration.
  const emit = async (_pg, eventType, payload) => {
    const dedupe_key = dedupeKeyFor(eventType, payload);
    if (dedupe_key) {
      const existing = store.domain_events.find((e) => e.dedupe_key === dedupe_key);
      if (existing) return existing;
    }
    const row = { id: `evt-${store.domain_events.length + 1}`, event_type: eventType, payload, status: 'pending', dedupe_key };
    store.domain_events.push(row);
    return row;
  };

  // The raw-pg surface emitDomainEvent uses when a pgClient is supplied. Enforces the partial unique
  // dedupe index exactly as the migration does, so idempotency is proven against the real code path.
  const pgClient = {
    query: async (sql, params) => {
      if (/INSERT INTO domain_events/.test(sql)) {
        const [event_type, payloadJson, status] = params;
        const payload = JSON.parse(payloadJson);
        const dedupe_key = dedupeKeyFor(event_type, payload);
        if (dedupe_key && store.domain_events.some((e) => e.dedupe_key === dedupe_key)) return { rows: [] };
        const row = { id: `evt-${store.domain_events.length + 1}`, event_type, payload, status, dedupe_key };
        store.domain_events.push(row);
        return { rows: [row] };
      }
      if (/FROM domain_events/.test(sql) && /dedupe_key = \$1/.test(sql)) {
        return { rows: store.domain_events.filter((e) => e.dedupe_key === params[0]) };
      }
      return { rows: [] };
    },
  };

  const notificationService = {
    queueNotification: async (input) => {
      const key = (input.dedupeParts || []).join(':');
      const existing = queued.find((q) => (q.dedupeParts || []).join(':') === key);
      if (existing) return { notification: { id: 'n-existing', status: 'queued' } };
      queued.push(input);
      store.notification_queue.push({ id: `n-${queued.length}`, dedupe_key: key, status: 'queued' });
      return { notification: { id: `n-${queued.length}`, status: 'queued' } };
    },
  };
  const orchestrator = new CommunicationOrchestratorService({ notificationService, repository });

  /** Play the event worker over pending outbox rows, as eventWorker.processEvent does. */
  async function runEventWorker() {
    for (const row of store.domain_events.filter((e) => e.status === 'pending')) {
      try { await orchestrator.handleDomainEvent(row, null, null); row.status = 'processed'; } catch { row.status = 'pending'; }
    }
  }

  process.env.COMMUNICATION_WORKER_SECRET = WORKER_SECRET;
  const app = express();
  app.use(express.json());
  app.use(createCommunicationRouter({
    services: {
      repository,
      deliveryWorker: { processDueNotifications: async () => [] },
      getTrustRecord: async (vin) => trustRecord(vin),
      emitEvent: emit,
      pgClient,
      notificationService,
      threadService: { resolveOrCreateThread: async () => ({ thread: { id: 't', tenant_id: null } }) },
      identityService: {},
      adapterRegistry: { get: () => null },
      configurationValidator: { validate: () => ({ status: 'OK' }) },
    },
  }));

  return { app, store, queued, repository, emit, pgClient, scans, runEventWorker, notificationService };
}

/** Invoke the PRODUCTION scheduler entry point exactly as pg_cron does. */
async function runScheduledWorker(app) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/communications/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-communication-worker-secret': WORKER_SECRET },
      body: JSON.stringify({ limit: 10 }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.close();
  }
}

// ============================================================================
// The production scheduler path exists at all
// ============================================================================

test('SCHED-1 the scheduled worker really invokes reconciliation and reports safe counts', async () => {
  const w = world();
  const result = await runScheduledWorker(w.app);
  assert.equal(result.status, 200);
  const r = result.body?.reconciliation;
  assert.ok(r, 'the worker response must carry a reconciliation result — otherwise it was never called');
  for (const key of ['trust_scanned', 'trust_reconciled', 'trust_failed', 'welcome_scanned', 'welcome_reconstructed', 'welcome_failed']) {
    assert.equal(typeof r[key], 'number', `${key} must be reported`);
  }
});

test('SCHED-2 the counts carry no addresses, tokens, VINs, evidence or secrets', async () => {
  const w = world({
    vehicles: [{ vin: 'FIXTUREVIN0000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'u-1', email: 'someone@example.test', email_verified_at: AFTER }],
  });
  const result = await runScheduledWorker(w.app);
  const serialized = JSON.stringify(result.body?.reconciliation);
  for (const forbidden of ['someone@example.test', 'FIXTUREVIN0000001', WORKER_SECRET, 'owner-1']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in operational telemetry`);
  }
});

// ============================================================================
// BASELINE — the negative that must never regress
// ============================================================================

test('BASELINE-1 a historical VERIFIED ACCOUNT gets NO reconstructed welcome', async () => {
  // Every account verified before Email 1.0 existed has no welcome. Without the boundary this scan
  // would classify all of them as owed one and mail the entire historical customer base.
  const w = world({ users: [
    { id: 'old-1', email: 'old1@example.test', email_verified_at: BEFORE },
    { id: 'old-2', email: 'old2@example.test', email_verified_at: BEFORE },
    { id: 'old-3', email: 'old3@example.test', email_verified_at: BOUNDARY },
  ] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_scanned, 0, 'historical accounts must not even be scanned');
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(w.store.domain_events.length, 0, 'no durable welcome work may be created for them');

  await w.runEventWorker();
  assert.equal(w.queued.length, 0, 'and absolutely no welcome Email');
});

test('BASELINE-2 a historical TRUST POSITION gets NO reconstructed announcement', async () => {
  const w = world({ vehicles: [
    { vin: 'OLDVIN0000000001', owner_id: 'owner-1', trust_evaluated_at: BEFORE, [ANNOUNCED_FINGERPRINT_COLUMN]: null },
    { vin: 'OLDVIN0000000002', owner_id: 'owner-2', trust_evaluated_at: BOUNDARY, [ANNOUNCED_FINGERPRINT_COLUMN]: null },
  ] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0, 'the boundary is exclusive: "at" the boundary is still baseline');
  assert.equal(result.body.reconciliation.trust_reconciled, 0);
  assert.equal(w.store.domain_events.length, 0);
});

test('BASELINE-3 with NO boundary row the scanners refuse to run at all', async () => {
  // Fail closed. Without a durable line between history and live work there is no safe way to tell
  // an outstanding announcement from a pre-existing one, and guessing means a mass send.
  const w = world({
    boundary: null,
    users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }],
    vehicles: [{ vin: 'NEWVIN0000000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
  });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.skipped, 'no_activation_boundary');
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(result.body.reconciliation.trust_reconciled, 0);
  assert.equal(w.store.domain_events.length, 0);
});

// ============================================================================
// R1 — the full scheduled recovery sequence
// ============================================================================

test('R1-SCHED the 8-point sequence through the PRODUCTION scheduler', async () => {
  // 1-4 are covered by email-hardening-r1-welcome-durability.test.js: the user verifies, the
  // outbox insert fails TOTALLY, and the response is still 200. This picks up from that state —
  // a verified account, after the boundary, with no event and no welcome.
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }] });
  assert.equal(w.store.domain_events.length, 0, 'precondition: the event really is missing');

  // 5-6. The scheduled scan discovers it and reconstructs exactly one durable event.
  const first = await runScheduledWorker(w.app);
  assert.equal(first.body.reconciliation.welcome_scanned, 1);
  assert.equal(first.body.reconciliation.welcome_reconstructed, 1);
  assert.equal(w.store.domain_events.length, 1);
  assert.equal(w.store.domain_events[0].event_type, EMAIL_VERIFIED_EVENT);
  assert.equal(w.store.domain_events[0].dedupe_key, `${EMAIL_VERIFIED_EVENT}:u-1`);

  // 7. The event worker queues exactly one welcome.
  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
  assert.deepEqual(w.queued[0].dedupeParts, ['leadership_welcome', 'u-1']);

  // 8. The next scanner run creates zero additional work.
  const second = await runScheduledWorker(w.app);
  assert.equal(second.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(w.store.domain_events.length, 1);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'exactly one welcome, forever');
});

test('R1-SCHED2 the scanner reconstructs the EVENT and never sends the Email itself', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }] });
  await runScheduledWorker(w.app);
  // The durable work exists...
  assert.equal(w.store.domain_events.length, 1);
  // ...and nothing was queued until the canonical producer ran from the event worker.
  assert.equal(w.queued.length, 0, 'the scanner must not be a second welcome producer');
  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
});

test('R1-SCHED3 an account whose welcome already exists is not reconstructed', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }] });
  w.store.notification_queue.push({ id: 'n-pre', dedupe_key: 'leadership_welcome:u-1', status: 'sent' });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_scanned, 1, 'it is scanned...');
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0, '...and correctly skipped');
  assert.equal(w.store.domain_events.length, 0);
});

// ============================================================================
// R5 — the full scheduled recovery sequence
// ============================================================================

test('R5-SCHED a post-activation Trust position with no announcement is recovered, exactly once', async () => {
  const vin = 'NEWVIN0000000001';
  const w = world({ vehicles: [{ vin, owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null }] });
  w.store.users = [{ id: 'owner-1', status: 'active', deleted_at: null }];

  // 3. No manual call to reconcileTrustPresentation anywhere in this test.
  // 4-5. The scheduled worker runs and recovers the missing durable state.
  const first = await runScheduledWorker(w.app);
  assert.equal(first.body.reconciliation.trust_scanned, 1);
  assert.equal(first.body.reconciliation.trust_reconciled, 1);
  assert.equal(first.body.reconciliation.trust_failed, 0);

  // 6. Exactly one R5 domain event, and the marker is repaired.
  const events = w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(events.length, 1);
  const expected = trustPresentationFingerprint(trustRecord(vin));
  assert.equal(events[0].dedupe_key, `${TRUST_PRESENTATION_CHANGED_EVENT}:${expected}`);
  assert.equal(w.store.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], expected, 'the marker is repaired');

  // 7. The next scheduled run creates zero additional notifications — the marker excludes it now.
  const second = await runScheduledWorker(w.app);
  assert.equal(second.body.reconciliation.trust_scanned, 0, 'the repaired marker removes it from the index scan');
  assert.equal(second.body.reconciliation.trust_reconciled, 0);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
});

// ============================================================================
// Idempotency, concurrency and operational bounds
// ============================================================================

test('CONC-1 overlapping workers produce ONE event each, not duplicates', async () => {
  // PostgREST offers no FOR UPDATE SKIP LOCKED, so two workers CAN select the same row. Safety comes
  // from the database dedupe keys, not from locking — so overlap must be wasteful, never duplicative.
  const w = world({
    users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }],
    vehicles: [{ vin: 'NEWVIN0000000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
  });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });

  await Promise.all([runScheduledWorker(w.app), runScheduledWorker(w.app), runScheduledWorker(w.app)]);

  assert.equal(w.store.domain_events.filter((e) => e.event_type === EMAIL_VERIFIED_EVENT).length, 1);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'one welcome despite three concurrent workers');
});

test('CONC-2 repeated runs converge and never re-create settled work', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }] });
  for (let i = 0; i < 5; i += 1) { await runScheduledWorker(w.app); await w.runEventWorker(); }
  assert.equal(w.store.domain_events.filter((e) => e.event_type === EMAIL_VERIFIED_EVENT).length, 1);
  assert.equal(w.queued.length, 1);
});

test('BOUND-1 the batch is finite and stably ordered — oldest outstanding work first', async () => {
  const users = Array.from({ length: 60 }, (_, i) => ({
    id: `u-${String(i).padStart(2, '0')}`,
    email: `u${i}@example.test`,
    email_verified_at: new Date(Date.parse(AFTER) + i * 1000).toISOString(),
  }));
  const w = world({ users });
  const result = await reconcileCommunicationDurability({ repository: w.repository, verifiedUserBatchLimit: 10, trustBatchLimit: 0, emit: w.emit });
  assert.equal(result.welcome_scanned, 10, 'the batch limit is respected, not the full 60');
  assert.equal(result.welcome_reconstructed, 10);
  // Stable ordering: the ten oldest, in order.
  const reconstructed = w.store.domain_events.map((e) => e.payload.recipientUserId);
  assert.deepEqual(reconstructed, users.slice(0, 10).map((u) => u.id));
});

test('BOUND-2 an empty backlog is a near no-op — the worker is not a table sweeper', async () => {
  const w = world({ users: [{ id: 'old', email: 'o@example.test', email_verified_at: BEFORE }] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(result.body.reconciliation.welcome_scanned, 0);
  // One bounded, indexed query per domain — never a repeated or unbounded sweep.
  assert.equal(w.scans.users.length, 1);
  assert.equal(w.scans.vehicles.length, 1);
});

test('FAIL-1 one failing item does NOT abort the rest of the batch', async () => {
  const users = [
    { id: 'u-bad', email: 'bad@example.test', email_verified_at: AFTER },
    { id: 'u-ok-1', email: 'ok1@example.test', email_verified_at: new Date(Date.parse(AFTER) + 1000).toISOString() },
    { id: 'u-ok-2', email: 'ok2@example.test', email_verified_at: new Date(Date.parse(AFTER) + 2000).toISOString() },
  ];
  const w = world({ users });
  const failingEmit = async (pg, type, payload) => {
    if (payload.recipientUserId === 'u-bad') throw new Error('transient outbox failure');
    return w.emit(pg, type, payload);
  };
  const result = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: failingEmit });
  assert.equal(result.welcome_scanned, 3);
  assert.equal(result.welcome_failed, 1);
  assert.equal(result.welcome_reconstructed, 2, 'the other two must still be reconstructed');

  // ...and the failed one stays eligible for a later pass.
  const retry = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: w.emit });
  assert.equal(retry.welcome_reconstructed, 1);
  assert.equal(w.store.domain_events.filter((e) => e.payload.recipientUserId === 'u-bad').length, 1);
});

test('FAIL-2 a reconciliation fault never fails the worker request that drains the queue', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER }] });
  w.repository.list = async () => { throw new Error('database unavailable'); };
  const result = await runScheduledWorker(w.app);
  assert.equal(result.status, 200, 'delivery must not be taken down by a reconciliation fault');
  assert.equal(result.body.success, true);
});
