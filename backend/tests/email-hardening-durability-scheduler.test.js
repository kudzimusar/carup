import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createCommunicationRouter } from '../routes/communicationBaseRoutes.js';
import { EMAIL_VERIFIED_EVENT } from '../services/communication/producers/leadershipWelcomeProducer.js';
import { CommunicationOrchestratorService } from '../services/communication/communicationOrchestratorService.js';
import { deterministicEventIdentity } from '../services/eventBus/eventBusService.js';
import {
  TRUST_WORK_COLUMN,
  WELCOME_WORK_COLUMN,
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(HERE, '..', '..', 'database', 'migrations', '20260826120000_email_1_0_hardening.sql');
const CONTROLLER_PATH = path.join(HERE, '..', 'services', 'communication', 'reconcileCommunicationDurability.js');

const WORKER_SECRET = 'durability-scheduler-worker-secret';
const BEFORE = '2026-08-01T00:00:00.000Z';
const AFTER = '2026-08-28T00:00:00.000Z';

/** A historical row: verified/evaluated long ago and, crucially, NOT flagged as pending work. */
const historicalUser = (id) => ({ id, email: `${id}@example.test`, email_verified_at: BEFORE, [WELCOME_WORK_COLUMN]: false });
const historicalVehicle = (vin) => ({ vin, owner_id: 'owner-1', trust_evaluated_at: BEFORE, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: false });

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
function world({ vehicles = [], users = [] } = {}) {
  const store = {
    vehicles,
    users,
    domain_events: [],
    notification_queue: [],
  };
  const queued = [];
  const scans = { vehicles: [], users: [] };
  const failUserLookup = { value: false };
  const failVehicleLookup = { value: false };
  const failEventLookup = { value: false };

  function dedupeKeyFor(eventType, payload) {
    const identity = deterministicEventIdentity(eventType, payload);
    return identity?.dedupeKey || null;
  }

  const repository = {
    rows: (table) => (store[table] || (store[table] = [])),
    findOne: async (table, filters) => {
      if (table === 'domain_events' && failEventLookup.value) throw new Error('domain_events lookup failed');
      return (store[table] || []).find((row) => Object.entries(filters)
        .every(([k, v]) => (v === null ? row[k] == null : String(row[k] ?? '') === String(v ?? '')))) || null;
    },
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
    updateById: async (table, id, patch) => {
      const row = (store[table] || []).find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return row || {};
    },
    updateWhere: async (table, filters, patch) => {
      (store[table] || []).filter((r) => Object.entries(filters).every(([k, v]) => String(r[k] ?? '') === String(v ?? '')))
        .forEach((r) => Object.assign(r, patch));
      return true;
    },
    // The Supabase-shaped surface reconcileTrustPresentation reads/writes the marker through.
    client: {
      from: (table) => {
        const filters = [];
        let patch = null;
        let selected = '';
        const api = {
          select: (cols) => { selected = String(cols || ''); return api; },
          update: (p) => { patch = p; return api; },
          eq: (c, v) => { filters.push((r) => String(r[c] ?? '') === String(v ?? '')); return api; },
          maybeSingle: async () => {
            if (table === 'users' && failUserLookup.value) {
              return { data: null, error: { code: '08006', message: 'connection failure' } };
            }
            // Fault ONLY the owner-resolution read (`vin, owner_id`), not the marker read, so the
            // transient branch inside resolveCurrentVehicleOwner is actually reached.
            if (table === 'vehicles' && failVehicleLookup.value && selected.includes('owner_id')) {
              return { data: null, error: { code: '08006', message: 'connection failure' } };
            }
            return { data: (store[table] || []).find((r) => filters.every((f) => f(r))) || null, error: null };
          },
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

  return { app, store, queued, repository, emit, pgClient, scans, runEventWorker, notificationService, failUserLookup, failVehicleLookup, failEventLookup };
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
    vehicles: [{ vin: 'FIXTUREVIN0000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true }],
    users: [{ id: 'u-1', email: 'someone@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true }],
  });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });
  const result = await runScheduledWorker(w.app);
  const serialized = JSON.stringify(result.body?.reconciliation);
  for (const forbidden of ['someone@example.test', 'FIXTUREVIN0000001', WORKER_SECRET, 'owner-1']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in operational telemetry`);
  }
});

// ============================================================================
// BASELINE — historical state is baseline BY CONSTRUCTION, not by comparison
// ============================================================================

test('BASELINE-1 historical VERIFIED ACCOUNTS get no reconstructed welcome — their flag is FALSE', async () => {
  const w = world({ users: [historicalUser('old-1'), historicalUser('old-2'), historicalUser('old-3')] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_scanned, 0, 'a FALSE flag is not selected at all');
  assert.equal(w.store.domain_events.length, 0);
  await w.runEventWorker();
  assert.equal(w.queued.length, 0, 'no welcome Email');
});

test('BASELINE-2 historical TRUST POSITIONS get no reconstructed announcement', async () => {
  const w = world({ vehicles: [historicalVehicle('OLDVIN0000000001'), historicalVehicle('OLDVIN0000000002')] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(w.store.domain_events.length, 0);
});

test('BASELINE-3 (P1-D) a TIMESTAMP-ONLY recompute of a historical vehicle stays baseline', async () => {
  // The defect this replaces: eligibility was `trust_evaluated_at > watermark`, so a routine
  // reevaluation that changed nothing a customer can see moved a historical vehicle past the line
  // while its announced-fingerprint was still NULL — and the scanner then mailed its whole current
  // position as news. Eligibility is now an explicit flag that only a MATERIAL change sets.
  const vehicle = historicalVehicle('OLDVIN0000000001');
  const w = world({ vehicles: [vehicle] });

  // The recompute: the clock moves, the position does not. The trigger does not fire.
  vehicle.trust_evaluated_at = AFTER;

  const result = await runScheduledWorker(w.app);
  assert.equal(vehicle[TRUST_WORK_COLUMN], false, 'a timestamp-only recompute must not declare work');
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(w.store.domain_events.length, 0, 'NO R5 event');
  await w.runEventWorker();
  assert.equal(w.queued.length, 0, 'NO R5 Email');
});

test('BASELINE-4 (P1-D) the SAME historical vehicle after a REAL material change is recovered', async () => {
  // The positive half. Baseline must not mean "permanently ineligible".
  const vehicle = historicalVehicle('OLDVIN0000000001');
  const w = world({ vehicles: [vehicle] });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });

  // A material change: the trigger sets the flag in the same transaction as the cache write.
  vehicle.trust_score = 91;
  vehicle[TRUST_WORK_COLUMN] = true;

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 1);
  assert.equal(result.body.reconciliation.trust_reconciled, 1);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
  assert.equal(vehicle[TRUST_WORK_COLUMN], false, 'the settled flag is retired');

  // Exactly one, and the next run adds nothing.
  await runScheduledWorker(w.app);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
});

// ============================================================================
// P1-B / P1-C — starvation
// ============================================================================

test('STARVE-1 (P1-B) 100 settled accounts cannot hide one genuinely pending account', async () => {
  // Previously the LIMIT was applied to INFERRED candidates and the "already handled" test ran
  // afterwards in JavaScript, so a settled prefix re-occupied the batch every minute and anything
  // behind it was never reached. The LIMIT now applies only to rows that are already pending.
  const users = [
    ...Array.from({ length: 100 }, (_, i) => historicalUser(`settled-${String(i).padStart(3, '0')}`)),
    { id: 'zzz-genuinely-pending', email: 'p@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true },
  ];
  const w = world({ users });
  // Default limit is 25 — far smaller than the settled population, which is the whole point.
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_scanned, 1, 'only the pending row is even selected');
  assert.equal(result.body.reconciliation.welcome_reconstructed, 1);
  assert.equal(w.store.domain_events[0].payload.recipientUserId, 'zzz-genuinely-pending',
    'the pending account is found despite sorting last behind 100 settled ones');
});

test('STARVE-2 (P1-C) a no-recipient vehicle settles and cannot block later pending work', async () => {
  // A vehicle whose owner is gone can never progress. Retrying it forever held the front of the
  // queue. It is now a TERMINAL disposition: the flag is retired, and — critically — the
  // announced-fingerprint is NOT written, because nothing was sent.
  const orphan = { vin: 'AAAORPHAN00000001', owner_id: null, trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true };
  const real = { vin: 'ZZZREAL0000000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true };
  const w = world({ vehicles: [orphan, real] });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 2);
  assert.equal(result.body.reconciliation.trust_reconciled, 1, 'the real one is announced');
  assert.equal(result.body.reconciliation.trust_settled_no_recipient, 1, 'the orphan settles rather than retrying');
  assert.equal(orphan[TRUST_WORK_COLUMN], false, 'and stops occupying the batch');
  assert.equal(orphan[ANNOUNCED_FINGERPRINT_COLUMN], null, 'but must NOT look as though an Email was sent');
  assert.equal(real[TRUST_WORK_COLUMN], false);
});

test('STARVE-3 a TRANSIENT owner-lookup fault stays pending — it is not a terminal disposition', async () => {
  const vehicle = { vin: 'VIN0000000000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true };
  const w = world({ vehicles: [vehicle] });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });
  w.failUserLookup.value = true;

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_reconciled, 0);
  assert.equal(vehicle[TRUST_WORK_COLUMN], true, 'a database blip must not retire real work');

  // ...and it recovers once the store is healthy again.
  w.failUserLookup.value = false;
  const retry = await runScheduledWorker(w.app);
  assert.equal(retry.body.reconciliation.trust_reconciled, 1);
  assert.equal(vehicle[TRUST_WORK_COLUMN], false);
});

test('STARVE-4 a TRANSIENT VEHICLE-lookup fault also stays pending, not terminal', async () => {
  // The other half of the terminal/transient split. Faulting the users lookup exercises only one
  // branch; the vehicles read has its own, and collapsing IT would retire real work over a blip.
  const vehicle = { vin: 'VIN0000000000002', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true };
  const w = world({ vehicles: [vehicle] });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });
  w.failVehicleLookup.value = true;

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_reconciled, 0);
  assert.equal(result.body.reconciliation.trust_settled_no_recipient, 0, 'a fault is NOT a no-recipient disposition');
  assert.equal(vehicle[TRUST_WORK_COLUMN], true, 'the work must remain pending');

  w.failVehicleLookup.value = false;
  const retry = await runScheduledWorker(w.app);
  assert.equal(retry.body.reconciliation.trust_reconciled, 1);
  assert.equal(vehicle[TRUST_WORK_COLUMN], false);
});

// ============================================================================
// R1 — the scheduled recovery sequence
// ============================================================================

test('R1-SCHED the full sequence through the PRODUCTION scheduler', async () => {
  const user = { id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true };
  const w = world({ users: [user] });
  assert.equal(w.store.domain_events.length, 0, 'precondition: the event really is missing');

  const first = await runScheduledWorker(w.app);
  assert.equal(first.body.reconciliation.welcome_reconstructed, 1);
  assert.equal(w.store.domain_events[0].dedupe_key, `${EMAIL_VERIFIED_EVENT}:u-1`);
  assert.equal(user[WELCOME_WORK_COLUMN], false, 'the flag is retired once the durable event exists');

  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
  assert.deepEqual(w.queued[0].dedupeParts, ['leadership_welcome', 'u-1']);

  const second = await runScheduledWorker(w.app);
  assert.equal(second.body.reconciliation.welcome_scanned, 0);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'exactly one welcome, forever');
});

test('R1-SCHED2 the scanner reconstructs the EVENT and never sends the Email itself', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true }] });
  await runScheduledWorker(w.app);
  assert.equal(w.store.domain_events.length, 1);
  assert.equal(w.queued.length, 0, 'the scanner must not be a second welcome producer');
  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
});

test('R1-SCHED3 an account whose welcome already exists settles without a second event', async () => {
  const user = { id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true };
  const w = world({ users: [user] });
  w.store.notification_queue.push({ id: 'n-pre', dedupe_key: 'leadership_welcome:u-1', status: 'sent' });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(result.body.reconciliation.welcome_settled, 1);
  assert.equal(user[WELCOME_WORK_COLUMN], false);
  assert.equal(w.store.domain_events.length, 0);
});

test('R1-SCHED4 a lookup fault leaves the flag PENDING rather than retiring the work', async () => {
  const user = { id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true };
  const w = world({ users: [user] });
  w.failEventLookup.value = true;
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(user[WELCOME_WORK_COLUMN], true, 'an unreadable answer must never settle real work');
  assert.equal(w.store.domain_events.length, 0, 'and must never emit on a guess');
});

// ============================================================================
// Concurrency, crash recovery and bounds
// ============================================================================

test('CONC-1 overlapping workers produce ONE event each, not duplicates', async () => {
  const w = world({
    users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true }],
    vehicles: [{ vin: 'NEWVIN0000000001', owner_id: 'owner-1', trust_evaluated_at: AFTER, [ANNOUNCED_FINGERPRINT_COLUMN]: null, [TRUST_WORK_COLUMN]: true }],
  });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });

  await Promise.all([runScheduledWorker(w.app), runScheduledWorker(w.app), runScheduledWorker(w.app)]);

  assert.equal(w.store.domain_events.filter((e) => e.event_type === EMAIL_VERIFIED_EVENT).length, 1);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'one welcome despite three concurrent workers');
});

test('CONC-2 a crash AFTER the durable event but BEFORE clearing the flag recovers cleanly', async () => {
  const user = { id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true };
  const w = world({ users: [user] });
  // The event landed; the process died before retiring the flag.
  await w.emit(null, EMAIL_VERIFIED_EVENT, { recipientUserId: 'u-1' });
  assert.equal(user[WELCOME_WORK_COLUMN], true);

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0, 'no second event');
  assert.equal(result.body.reconciliation.welcome_settled, 1);
  assert.equal(user[WELCOME_WORK_COLUMN], false, 'the existing event is recognised and the flag retired');
  assert.equal(w.store.domain_events.length, 1);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
});

test('BOUND-1 the batch is finite and applied to genuinely pending rows only', async () => {
  const users = Array.from({ length: 60 }, (_, i) => ({
    id: `u-${String(i).padStart(2, '0')}`, email: `u${i}@example.test`,
    email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true,
  }));
  const w = world({ users });
  const result = await reconcileCommunicationDurability({ repository: w.repository, verifiedUserBatchLimit: 10, trustBatchLimit: 0, emit: w.emit });
  assert.equal(result.welcome_scanned, 10, 'the batch limit is respected, not the full 60');
  assert.equal(result.welcome_reconstructed, 10);
  assert.deepEqual(w.store.domain_events.map((e) => e.payload.recipientUserId), users.slice(0, 10).map((u) => u.id));

  // The next pass picks up the NEXT ten — the batch drains rather than repeating.
  await reconcileCommunicationDurability({ repository: w.repository, verifiedUserBatchLimit: 10, trustBatchLimit: 0, emit: w.emit });
  assert.equal(w.store.domain_events.length, 20);
});

test('BOUND-2 an empty backlog is a near no-op — the worker is not a table sweeper', async () => {
  const w = world({ users: [historicalUser('old')] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(result.body.reconciliation.welcome_scanned, 0);
  assert.equal(w.scans.users.length, 1);
  assert.equal(w.scans.vehicles.length, 1);
});

test('FAIL-1 one failing item does NOT abort the rest of the batch', async () => {
  const users = ['u-bad', 'u-ok-1', 'u-ok-2'].map((id) => ({ id, email: `${id}@example.test`, email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true }));
  const w = world({ users });
  const failingEmit = async (pg, type, payload) => {
    if (payload.recipientUserId === 'u-bad') throw new Error('transient outbox failure');
    return w.emit(pg, type, payload);
  };
  const result = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: failingEmit });
  assert.equal(result.welcome_scanned, 3);
  assert.equal(result.welcome_failed, 1);
  assert.equal(result.welcome_reconstructed, 2, 'the other two must still be reconstructed');
  assert.equal(users[0][WELCOME_WORK_COLUMN], true, 'and the failed one stays pending');

  const retry = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: w.emit });
  assert.equal(retry.welcome_reconstructed, 1);
});

test('FAIL-2 a reconciliation fault never fails the worker request that drains the queue', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: AFTER, [WELCOME_WORK_COLUMN]: true }] });
  w.repository.list = async () => { throw new Error('database unavailable'); };
  const result = await runScheduledWorker(w.app);
  assert.equal(result.status, 200, 'delivery must not be taken down by a reconciliation fault');
  assert.equal(result.body.success, true);
});

// ============================================================================
// P1-A — the removed authority
// ============================================================================

test('AUTHORITY-1 (P1-A) the client-mutable activation table is GONE, not merely secured', async () => {
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.equal(migration.includes('communication_activation_boundaries'), false,
    'unnecessary authority is deleted, not defended');
  // ...and nothing in the application still depends on it.
  const controller = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.equal(controller.includes('activation_boundaries'), false);
  assert.equal(controller.includes('activated_at'), false);
});

test('AUTHORITY-2 (P1-A) the replacement work flags are service-only in the migration', async () => {
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  // Column-level revokes, proven by the migration text rather than asserted in a comment.
  assert.match(migration, /REVOKE UPDATE \(email_welcome_reconcile_required\) ON public\.users FROM PUBLIC, anon, authenticated;/);
  assert.ok(migration.includes('REVOKE UPDATE (trust_presentation_reconcile_required, trust_presentation_announced_fingerprint)')
    && migration.includes('ON public.vehicles FROM PUBLIC, anon, authenticated;'),
    'the vehicles flags must be revoked from client roles');

  // CREATE FUNCTION grants EXECUTE to PUBLIC by default. A caller able to invoke either trigger body
  // directly could stamp reconciliation work onto any row, so each must be revoked in this file.
  for (const fn of ['email_welcome_reconcile_flag', 'trust_presentation_reconcile_flag', 'communication_domain_event_dedupe_key']) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${fn}()`),
      `${fn} must have EXECUTE revoked from PUBLIC/anon/authenticated`);
  }
});

test('AUTHORITY-3 the flags are set by TRIGGER, so no deployment order can open a gap', async () => {
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  // Exact trigger identity, not a substring: `trg_users_email_welcome_reconcile_DISABLED` contains
  // the name and would have satisfied a naive includes() while the trigger no longer existed.
  assert.match(migration, /CREATE TRIGGER trg_users_email_welcome_reconcile\b(?!_)/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_users_email_welcome_reconcile\b(?!_) ON public\.users;/);
  assert.ok(migration.includes('BEFORE UPDATE OF email_verified_at ON public.users'), 'R1 trigger target');
  assert.match(migration, /CREATE TRIGGER trg_vehicles_trust_presentation_reconcile\b(?!_)/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_vehicles_trust_presentation_reconcile\b(?!_) ON public\.vehicles;/);
  assert.ok(migration.includes('BEFORE UPDATE ON public.vehicles'), 'R5 trigger target');
  // R1 fires ONLY on the NULL -> NOT NULL transition.
  assert.match(migration, /IF OLD\.email_verified_at IS NULL AND NEW\.email_verified_at IS NOT NULL THEN/);
  // R5 keys on material fields and deliberately excludes the timestamp and the identity.
  for (const col of ['trust_score', 'trust_band', 'trust_confidence', 'trust_evidence_basis', 'trust_known_limitations', 'trust_calculation_version']) {
    assert.ok(migration.includes(`NEW.${col}`), `${col} must be part of the material comparison`);
  }
  const fn = migration.slice(migration.indexOf('trust_presentation_reconcile_flag()'), migration.indexOf('DROP TRIGGER IF EXISTS trg_vehicles_trust_presentation_reconcile'));
  assert.equal(fn.includes('NEW.trust_evaluated_at'), false, 'a timestamp-only recompute must not be material');
  assert.equal(fn.includes('NEW.vin'), false, 'identity is not presentation');
  assert.ok(fn.includes('IS DISTINCT FROM'), 'nullable and jsonb columns need IS DISTINCT FROM');
});

test('AUTHORITY-4 historical rows default FALSE and are never backfilled', async () => {
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(migration, /email_welcome_reconcile_required boolean NOT NULL DEFAULT false/);
  assert.match(migration, /trust_presentation_reconcile_required boolean NOT NULL DEFAULT false/);
  // No UPDATE anywhere that could turn history into pending work.
  assert.equal(/UPDATE public\.(users|vehicles)\s+SET/i.test(migration), false,
    'the migration must not backfill either flag');
});
