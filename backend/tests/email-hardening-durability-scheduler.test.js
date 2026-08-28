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
  RECONCILIATION_WORK_TABLE,
  WORK_TYPES,
  reconcileCommunicationDurability,
} from '../services/communication/reconcileCommunicationDurability.js';
import {
  ANNOUNCED_FINGERPRINT_COLUMN,
  TRUST_PRESENTATION_CHANGED_EVENT,
} from '../services/trustDecision/trustPresentationChangeProducer.js';

/**
 * THE PRIVATE RECONCILIATION WORK QUEUE — recovery that something schedules, in state no client
 * can touch, retired only by an atomic generational compare.
 *
 * Three designs, three lessons, all recorded here because each was found by an external review of a
 * green build:
 *
 *   1. Inference by timestamp: a routine Trust recompute looked like news; a settled prefix starved
 *      the batch; the watermark table was client-writable.
 *   2. Boolean flags on the public tables: PostgreSQL privileges are ADDITIVE and live staging
 *      grants anon/authenticated table-level UPDATE on public.users, so the column-level revoke was
 *      inert — a client could manufacture a Welcome or suppress one. And the final `SET flag=false`
 *      was unconditional, so a material change landing mid-reconciliation was silently wiped.
 *   3. This one: work rows in `communication_reconciliation_work` (RLS on, every client privilege
 *      revoked), enqueued by DB triggers in the same transaction as the state change, carrying a
 *      GENERATION and material FINGERPRINT, retired only by compare-and-delete on both.
 *
 * These tests drive the PRODUCTION ENTRY POINT — `POST /api/internal/communications/process`, the
 * route pg_cron calls every minute — not the reconcilers directly. The harness's `verifyUser` and
 * `materialTrustChange` helpers replicate the DB triggers' documented behaviour exactly (their SQL
 * semantics are pinned by the AUTHORITY tests and executed for real by the PGlite privilege check),
 * so what is proven here is the WORKER's contract against the queue those triggers feed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(HERE, '..', '..', 'database', 'migrations', '20260826120000_email_1_0_hardening.sql');
const CONTROLLER_PATH = path.join(HERE, '..', 'services', 'communication', 'reconcileCommunicationDurability.js');

const WORKER_SECRET = 'durability-scheduler-worker-secret';

function trustRecord(vin, overrides = {}) {
  return {
    vin, evaluation_state: 'evaluated', score: 78, band: 'moderate', confidence: 'medium',
    evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
    calculation_version: 'trust-decision-1.0.0', evaluated_at: '2026-08-28T00:00:00.000Z',
    known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
    source: 'cache', ...overrides,
  };
}

/** The trigger's fingerprint contract, mirrored: deterministic over material columns only. */
function materialFingerprint(vehicle) {
  return `fp|${vehicle.trust_score ?? ''}|${vehicle.trust_band ?? ''}|${vehicle.trust_confidence ?? ''}|${JSON.stringify(vehicle.trust_evidence_basis ?? null)}|${JSON.stringify(vehicle.trust_known_limitations ?? null)}|${vehicle.trust_calculation_version ?? ''}`;
}

function world({ vehicles = [], users = [] } = {}) {
  const store = {
    vehicles,
    users,
    [RECONCILIATION_WORK_TABLE]: [],
    domain_events: [],
    notification_queue: [],
  };
  const queued = [];
  const scans = { work: [] };
  const failUserLookup = { value: false };
  const failVehicleLookup = { value: false };
  const failEventLookup = { value: false };
  let workId = 0;

  // ---- the DB triggers, replicated over the in-memory store --------------------------------
  function enqueueWelcomeWork(userId) {
    const rows = store[RECONCILIATION_WORK_TABLE];
    const existing = rows.find((r) => r.work_type === WORK_TYPES.WELCOME && r.subject_id === userId);
    if (existing) { existing.updated_at = new Date().toISOString(); return existing; }
    workId += 1;
    const row = { id: workId, work_type: WORK_TYPES.WELCOME, subject_id: userId, generation: 1, work_fingerprint: null };
    rows.push(row);
    return row;
  }
  /** Sets email_verified_at NULL -> NOT NULL and enqueues, exactly as trg_users_enqueue... does. */
  function verifyUser(userId) {
    const user = store.users.find((u) => u.id === userId);
    if (!user || user.email_verified_at) return null;
    user.email_verified_at = new Date().toISOString();
    return enqueueWelcomeWork(userId);
  }
  /** Applies a trust patch; enqueues gen+1 work ONLY when a material column moved. */
  function materialTrustChange(vin, patch) {
    const vehicle = store.vehicles.find((v) => v.vin === vin);
    if (!vehicle) return null;
    const before = materialFingerprint(vehicle);
    Object.assign(vehicle, patch);
    const after = materialFingerprint(vehicle);
    if (before === after) return null; // timestamp-only / non-material: the trigger does not fire
    const rows = store[RECONCILIATION_WORK_TABLE];
    const existing = rows.find((r) => r.work_type === WORK_TYPES.TRUST && r.subject_id === vin);
    if (existing) {
      existing.generation += 1;
      existing.work_fingerprint = after;
      existing.updated_at = new Date().toISOString();
      return existing;
    }
    workId += 1;
    const row = { id: workId, work_type: WORK_TYPES.TRUST, subject_id: vin, generation: 1, work_fingerprint: after };
    rows.push(row);
    return row;
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
      if (options.order) {
        const { column, ascending = false } = options.order;
        rows = [...rows].sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
      }
      if (options.limit) rows = rows.slice(0, Number(options.limit));
      if (table === RECONCILIATION_WORK_TABLE) scans.work.push({ filters: { ...filters }, returned: rows.length });
      // Snapshot: the worker reasons about what it READ, not about live references.
      return rows.map((r) => ({ ...r }));
    },
    insert: async (table, row) => { (store[table] || (store[table] = [])).push(row); return row; },
    updateById: async (table, id, patch) => {
      const row = (store[table] || []).find((r) => String(r.id) === String(id));
      if (row) Object.assign(row, patch);
      return row || {};
    },
    deleteWhere: async (table, filters) => {
      // The interleaving seam for the §15 race tests: a hook fired AFTER the worker has emitted and
      // marked, but BEFORE its conditional retire executes — the exact window Codex B names.
      if (table === RECONCILIATION_WORK_TABLE && hooks.beforeRetire) await hooks.beforeRetire(filters);
      const rows = store[table] || [];
      const matches = rows.filter((row) => Object.entries(filters)
        .every(([k, v]) => (v === null ? row[k] == null : String(row[k] ?? '') === String(v ?? ''))));
      for (const row of matches) rows.splice(rows.indexOf(row), 1);
      return matches.length;
    },
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
            if (table === 'users' && failUserLookup.value) return { data: null, error: { code: '08006', message: 'connection failure' } };
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

  function dedupeKeyFor(eventType, payload) {
    const identity = deterministicEventIdentity(eventType, payload);
    return identity?.dedupeKey || null;
  }
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
    // The canonical service resolves trust events through its policy table; this stub only has to
    // dedupe deterministically per material fingerprint so exactly-once is observable.
    queueFromDomainEvent: async (event) => {
      const key = `${event.event_type}:${event.payload?.presentation_fingerprint || event.payload?.recipientUserId || event.id}`;
      const existing = queued.find((q) => (q.dedupeParts || []).join(':') === key);
      if (existing) return [{ notification: { id: 'n-existing', status: 'queued' } }];
      queued.push({ dedupeParts: [key], payload: event.payload });
      store.notification_queue.push({ id: `n-${queued.length}`, dedupe_key: key, status: 'queued' });
      return [{ notification: { id: `n-${queued.length}`, status: 'queued' } }];
    },
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

  async function runEventWorker() {
    for (const row of store.domain_events.filter((e) => e.status === 'pending')) {
      try { await orchestrator.handleDomainEvent(row, null, null); row.status = 'processed'; } catch { row.status = 'pending'; }
    }
  }

  // A per-test hook fired between a work read and its retirement — the interleaving seam.
  const hooks = { onTrustRecordRead: null, beforeRetire: null };
  const getTrustRecord = async (vin) => {
    const vehicle = store.vehicles.find((v) => v.vin === vin);
    if (hooks.onTrustRecordRead) await hooks.onTrustRecordRead(vin);
    if (!vehicle) return null;
    return trustRecord(vin, {
      score: vehicle.trust_score ?? 78,
      band: vehicle.trust_band ?? 'moderate',
      confidence: vehicle.trust_confidence ?? 'medium',
      calculation_version: vehicle.trust_calculation_version ?? 'trust-decision-1.0.0',
    });
  };

  process.env.COMMUNICATION_WORKER_SECRET = WORKER_SECRET;
  const app = express();
  app.use(express.json());
  app.use(createCommunicationRouter({
    services: {
      repository,
      deliveryWorker: { processDueNotifications: async () => [] },
      getTrustRecord,
      emitEvent: emit,
      pgClient,
      notificationService,
      threadService: { resolveOrCreateThread: async () => ({ thread: { id: 't', tenant_id: null } }) },
      identityService: {},
      adapterRegistry: { get: () => null },
      configurationValidator: { validate: () => ({ status: 'OK' }) },
    },
  }));

  return {
    app, store, queued, repository, emit, pgClient, scans, hooks,
    runEventWorker, verifyUser, materialTrustChange, getTrustRecord,
    failUserLookup, failVehicleLookup, failEventLookup,
    work: () => store[RECONCILIATION_WORK_TABLE],
  };
}

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
// The production scheduler path
// ============================================================================

test('SCHED-1 the scheduled worker really invokes reconciliation and reports safe counts', async () => {
  const w = world();
  const result = await runScheduledWorker(w.app);
  assert.equal(result.status, 200);
  const r = result.body?.reconciliation;
  assert.ok(r, 'the worker response must carry a reconciliation result — otherwise it was never called');
  for (const key of ['trust_scanned', 'trust_reconciled', 'trust_superseded', 'trust_failed', 'welcome_scanned', 'welcome_reconstructed', 'welcome_failed']) {
    assert.equal(typeof r[key], 'number', `${key} must be reported`);
  }
});

test('SCHED-2 the counts carry no addresses, tokens, VINs, evidence or secrets', async () => {
  const w = world({
    vehicles: [{ vin: 'FIXTUREVIN0000001', owner_id: 'owner-1', trust_score: 78, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [
      { id: 'u-1', email: 'someone@example.test', email_verified_at: null },
      { id: 'owner-1', status: 'active', deleted_at: null },
    ],
  });
  w.verifyUser('u-1');
  w.materialTrustChange('FIXTUREVIN0000001', { trust_score: 91 });
  const result = await runScheduledWorker(w.app);
  const serialized = JSON.stringify(result.body?.reconciliation);
  for (const forbidden of ['someone@example.test', 'FIXTUREVIN0000001', WORKER_SECRET, 'owner-1']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in operational telemetry`);
  }
});

// ============================================================================
// BASELINE — history creates no work, by construction
// ============================================================================

test('BASELINE-1 historical verified accounts have NO work rows and get NO welcome', async () => {
  const w = world({ users: [
    { id: 'old-1', email: 'o1@example.test', email_verified_at: '2026-08-01T00:00:00.000Z' },
    { id: 'old-2', email: 'o2@example.test', email_verified_at: '2026-08-01T00:00:00.000Z' },
  ] });
  assert.equal(w.work().length, 0, 'the migration backfills nothing, so the queue starts empty');
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_scanned, 0);
  assert.equal(w.store.domain_events.length, 0);
  await w.runEventWorker();
  assert.equal(w.queued.length, 0, 'no welcome Email');
});

test('BASELINE-2 historical Trust positions have NO work rows and get NO announcement', async () => {
  const w = world({ vehicles: [
    { vin: 'OLDVIN0000000001', owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null },
  ] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(w.store.domain_events.length, 0);
});

test('BASELINE-3 a timestamp-only recompute enqueues NOTHING — the trigger contract, exercised', async () => {
  const w = world({ vehicles: [{ vin: 'OLDVIN0000000001', owner_id: 'owner-1', trust_score: 60, trust_evaluated_at: '2026-08-01T00:00:00.000Z', [ANNOUNCED_FINGERPRINT_COLUMN]: null }] });
  const enqueued = w.materialTrustChange('OLDVIN0000000001', { trust_evaluated_at: '2026-08-28T00:00:00.000Z' });
  assert.equal(enqueued, null, 'the material comparison excludes the timestamp');
  assert.equal(w.work().length, 0);
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(w.store.domain_events.length, 0, 'NO R5 event');
  await w.runEventWorker();
  assert.equal(w.queued.length, 0, 'NO R5 Email');
});

test('BASELINE-4 an unrelated update to a verified account enqueues NOTHING', async () => {
  const w = world({ users: [{ id: 'old-1', email: 'o1@example.test', email_verified_at: '2026-08-01T00:00:00.000Z', name: 'Old Name' }] });
  // The trigger fires only on the NULL -> NOT NULL transition; verifyUser refuses a second firing.
  assert.equal(w.verifyUser('old-1'), null);
  w.store.users[0].name = 'New Name';
  assert.equal(w.work().length, 0);
});

test('BASELINE-5 the SAME historical vehicle after a REAL material change IS recovered, exactly once', async () => {
  const w = world({
    vehicles: [{ vin: 'OLDVIN0000000001', owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  const workRow = w.materialTrustChange('OLDVIN0000000001', { trust_score: 91, trust_band: 'strong' });
  assert.ok(workRow, 'a material change declares work');
  assert.equal(workRow.generation, 1);

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_reconciled, 1);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
  assert.equal(w.work().length, 0, 'the settled work row is retired');

  await runScheduledWorker(w.app);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1, 'exactly one');
});

// ============================================================================
// R1 through the production scheduler
// ============================================================================

test('R1-SCHED verification enqueues work; the scheduler reconstructs the event; the producer sends', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: null, name: 'Fixture Buyer' }] });
  const workRow = w.verifyUser('u-1');
  assert.ok(workRow, 'the trigger enqueued welcome work in the verification transaction');
  assert.equal(w.store.domain_events.length, 0, 'the app outbox write failed totally — the exact case this recovers');

  const first = await runScheduledWorker(w.app);
  assert.equal(first.body.reconciliation.welcome_scanned, 1);
  assert.equal(first.body.reconciliation.welcome_reconstructed, 1);
  assert.equal(w.store.domain_events[0].dedupe_key, `${EMAIL_VERIFIED_EVENT}:u-1`);
  assert.equal(w.work().length, 0, 'work retired after the durable event exists');

  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
  assert.deepEqual(w.queued[0].dedupeParts, ['leadership_welcome', 'u-1']);

  const second = await runScheduledWorker(w.app);
  assert.equal(second.body.reconciliation.welcome_scanned, 0);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'exactly one welcome, forever');
});

test('R1-SCHED2 the scanner reconstructs the EVENT and never sends the Email itself', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: null }] });
  w.verifyUser('u-1');
  await runScheduledWorker(w.app);
  assert.equal(w.store.domain_events.length, 1);
  assert.equal(w.queued.length, 0, 'the scanner must not be a second welcome producer');
  await w.runEventWorker();
  assert.equal(w.queued.length, 1);
});

test('R1-SCHED3 work whose event already exists settles without a second event', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: null }] });
  w.verifyUser('u-1');
  // The ordinary app path succeeded: the durable event exists; only the work row lingers
  // (crash after event persistence, before retirement).
  await w.emit(null, EMAIL_VERIFIED_EVENT, { recipientUserId: 'u-1' });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0, 'no second event');
  assert.equal(result.body.reconciliation.welcome_settled, 1);
  assert.equal(w.work().length, 0, 'the work retires against the existing event');
  assert.equal(w.store.domain_events.length, 1);
  await w.runEventWorker();
  assert.equal(w.queued.length, 1, 'crash recovery yields exactly one Email');
});

test('R1-SCHED4 a lookup fault leaves the work PENDING rather than retiring it', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: null }] });
  w.verifyUser('u-1');
  w.failEventLookup.value = true;
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.welcome_reconstructed, 0);
  assert.equal(w.work().length, 1, 'an unreadable answer must never settle real work');
  assert.equal(w.store.domain_events.length, 0, 'and must never emit on a guess');

  w.failEventLookup.value = false;
  const retry = await runScheduledWorker(w.app);
  assert.equal(retry.body.reconciliation.welcome_reconstructed, 1);
  assert.equal(w.work().length, 0);
});

// ============================================================================
// CODEX B — the generational lost-update race, closed
// ============================================================================

test('RACE-GEN the §15 interleaving: a material change mid-reconciliation SURVIVES the old retire', async () => {
  const vin = 'RACEVIN000000001';
  const w = world({
    vehicles: [{ vin, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  // 1. Work at generation G / fingerprint F.
  const workRow = w.materialTrustChange(vin, { trust_score: 78 });
  const G = workRow.generation;
  const F = workRow.work_fingerprint;

  // 2-3. The scheduler reads the work and reconciles F — and BETWEEN its emit and its retire, a
  // new material change commits: the trigger moves the row to G+1/F2. This is the §15 window.
  let interleaved = false;
  w.hooks.beforeRetire = async () => {
    if (interleaved) return;
    interleaved = true;
    const updated = w.materialTrustChange(vin, { trust_score: 91, trust_band: 'strong' });
    assert.equal(updated.generation, G + 1);
    assert.notEqual(updated.work_fingerprint, F);
  };

  const first = await runScheduledWorker(w.app);
  w.hooks.beforeRetire = null;

  // 4-6. The old conditional retire affected ZERO rows; G+1/F2 remains pending.
  assert.equal(first.body.reconciliation.trust_superseded, 1, 'the stale worker must observe supersession');
  assert.equal(first.body.reconciliation.trust_reconciled, 0, 'and must not claim the newer work settled');
  assert.equal(w.work().length, 1, 'the newer generation SURVIVES — this is the whole fix');
  assert.equal(w.work()[0].generation, G + 1);

  // 7. The next run reconciles F2 exactly once.
  const second = await runScheduledWorker(w.app);
  assert.equal(second.body.reconciliation.trust_reconciled, 1);
  assert.equal(w.work().length, 0);
  const trustEvents = w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(trustEvents.length, 2, 'one event per material presentation — F and F2, nothing lost');

  const third = await runScheduledWorker(w.app);
  assert.equal(third.body.reconciliation.trust_scanned, 0);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 2);
});

test('RACE-GEN2 A->B->A: same fingerprint, advanced generation — the old retire still affects zero', async () => {
  // The generation compare must hold even when the material state returns to its original value:
  // the fingerprint alone would match, and only the generation says this is NEWER work.
  const vin = 'RACEVIN000000002';
  const w = world({
    vehicles: [{ vin, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  const workRow = w.materialTrustChange(vin, { trust_score: 78 });
  const F = workRow.work_fingerprint;

  const G0 = workRow.generation;
  let interleaved = false;
  w.hooks.beforeRetire = async () => {
    if (interleaved) return;
    interleaved = true;
    w.materialTrustChange(vin, { trust_score: 91 }); // A -> B
    const back = w.materialTrustChange(vin, { trust_score: 78 }); // B -> A
    assert.equal(back.work_fingerprint, F, 'the fingerprint really is back to F');
    assert.equal(back.generation, G0 + 2, 'but the generation says otherwise');
  };
  const first = await runScheduledWorker(w.app);
  w.hooks.beforeRetire = null;
  assert.equal(first.body.reconciliation.trust_superseded, 1);
  assert.equal(w.work().length, 1, 'newer work survives on the strength of the generation alone');
});

test('RACE-GEN3 defence in depth: a fingerprint mismatch alone also blocks retirement', async () => {
  // Cannot arise through the trigger (a new fingerprint always bumps the generation), but the
  // retire primitive must hold each guard independently, or removing one is invisible.
  const vin = 'RACEVIN000000003';
  const w = world({
    vehicles: [{ vin, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  const workRow = w.materialTrustChange(vin, { trust_score: 78 });
  let interleaved = false;
  w.hooks.beforeRetire = async () => {
    if (interleaved) return;
    interleaved = true;
    const live = w.work().find((r) => r.subject_id === vin);
    live.work_fingerprint = 'synthetically-different'; // same generation, different fingerprint
  };
  const first = await runScheduledWorker(w.app);
  w.hooks.beforeRetire = null;
  assert.equal(first.body.reconciliation.trust_superseded, 1);
  assert.equal(w.work().length, 1);
  assert.equal(w.work()[0].generation, workRow.generation);
});

// ============================================================================
// R5 dispositions
// ============================================================================

test('R5-NOOWNER a no-recipient generation settles terminally without faking an announcement', async () => {
  const orphanVin = 'AAAORPHAN0000001';
  const realVin = 'ZZZREAL000000001';
  const w = world({
    vehicles: [
      { vin: orphanVin, owner_id: null, trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null },
      { vin: realVin, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null },
    ],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  w.materialTrustChange(orphanVin, { trust_score: 78 });
  w.materialTrustChange(realVin, { trust_score: 78 });

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 2);
  assert.equal(result.body.reconciliation.trust_reconciled, 1, 'the owned vehicle is announced');
  assert.equal(result.body.reconciliation.trust_settled_no_recipient, 1, 'the orphan settles for THIS generation');
  assert.equal(w.work().length, 0, 'and stops occupying the queue');
  const orphan = w.store.vehicles.find((v) => v.vin === orphanVin);
  assert.equal(orphan[ANNOUNCED_FINGERPRINT_COLUMN], null, 'nothing was sent, so nothing claims it was');

  // A later material change re-opens the orphan's work as a FRESH row. The retired row was
  // deleted, so the new one starts at generation 1 — generation is per-row-lifetime optimistic
  // concurrency, not per-subject history; "new work" is the row's existence.
  const reopened = w.materialTrustChange(orphanVin, { trust_score: 91 });
  assert.ok(reopened, 'the trigger re-opens the work');
  assert.equal(w.work().length, 1);
});

test('R5-TRANSIENT an owner-lookup fault stays pending — never a terminal disposition', async () => {
  const vin = 'VIN0000000000001';
  const w = world({
    vehicles: [{ vin, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
    users: [{ id: 'owner-1', status: 'active', deleted_at: null }],
  });
  w.materialTrustChange(vin, { trust_score: 78 });
  w.failVehicleLookup.value = true;

  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_reconciled, 0);
  assert.equal(result.body.reconciliation.trust_settled_no_recipient, 0, 'a fault is NOT a no-recipient disposition');
  assert.equal(w.work().length, 1, 'the work must remain pending');

  w.failVehicleLookup.value = false;
  const retry = await runScheduledWorker(w.app);
  assert.equal(retry.body.reconciliation.trust_reconciled, 1);
  assert.equal(w.work().length, 0);
});

// ============================================================================
// Concurrency, crash recovery and bounds
// ============================================================================

test('CONC-1 overlapping workers: one event, one welcome, work retires exactly once', async () => {
  const w = world({
    users: [
      { id: 'u-1', email: 'u1@example.test', email_verified_at: null },
      { id: 'owner-1', status: 'active', deleted_at: null },
    ],
    vehicles: [{ vin: 'NEWVIN0000000001', owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null }],
  });
  w.verifyUser('u-1');
  w.materialTrustChange('NEWVIN0000000001', { trust_score: 78 });

  await Promise.all([runScheduledWorker(w.app), runScheduledWorker(w.app), runScheduledWorker(w.app)]);

  assert.equal(w.store.domain_events.filter((e) => e.event_type === EMAIL_VERIFIED_EVENT).length, 1);
  assert.equal(w.store.domain_events.filter((e) => e.event_type === TRUST_PRESENTATION_CHANGED_EVENT).length, 1);
  assert.equal(w.work().length, 0);
  await w.runEventWorker();
  assert.equal(w.queued.length, 2, 'one welcome and one trust notification, despite three workers');
});

test('BOUND-1 the LIMIT applies to pending work of the requested type only', async () => {
  const w = world({
    users: [{ id: 'zzz-pending', email: 'p@example.test', email_verified_at: null }],
    vehicles: Array.from({ length: 30 }, (_, i) => ({
      vin: `VIN${String(i).padStart(13, '0')}`, owner_id: 'owner-1', trust_score: 60, [ANNOUNCED_FINGERPRINT_COLUMN]: null,
    })),
  });
  w.store.users.push({ id: 'owner-1', status: 'active', deleted_at: null });
  for (const v of w.store.vehicles.filter((x) => x.vin.startsWith('VIN'))) w.materialTrustChange(v.vin, { trust_score: 78 });
  w.verifyUser('zzz-pending');

  // 30 pending trust rows must not crowd the ONE pending welcome out of its own scan.
  const result = await reconcileCommunicationDurability({
    repository: w.repository, trustBatchLimit: 5, verifiedUserBatchLimit: 5, emit: w.emit, getTrustRecord: w.getTrustRecord, pgClient: w.pgClient,
  });
  assert.equal(result.trust_scanned, 5, 'trust batch bounded to 5 of 30');
  assert.equal(result.welcome_scanned, 1, 'the welcome scan sees ITS work type, not a mixed page');
  assert.equal(result.welcome_reconstructed, 1);

  // The trust backlog drains across passes rather than repeating a settled prefix.
  let remaining = w.work().filter((r) => r.work_type === WORK_TYPES.TRUST).length;
  assert.equal(remaining, 25);
  await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 5, verifiedUserBatchLimit: 0, emit: w.emit, getTrustRecord: w.getTrustRecord, pgClient: w.pgClient });
  remaining = w.work().filter((r) => r.work_type === WORK_TYPES.TRUST).length;
  assert.equal(remaining, 20, 'each pass retires its batch — no re-fetched settled prefix');
});

test('BOUND-2 an empty queue is a near no-op — one bounded query per work type', async () => {
  const w = world({ users: [{ id: 'old', email: 'o@example.test', email_verified_at: '2026-08-01T00:00:00.000Z' }] });
  const result = await runScheduledWorker(w.app);
  assert.equal(result.body.reconciliation.trust_scanned, 0);
  assert.equal(result.body.reconciliation.welcome_scanned, 0);
  assert.equal(w.scans.work.length, 2, 'exactly one work-queue query per domain');
  for (const scan of w.scans.work) {
    assert.ok(scan.filters.work_type, 'the work_type filter is IN the query, not applied afterwards');
  }
});

test('FAIL-1 one failing item does NOT abort the rest of the batch', async () => {
  const w = world({ users: [
    { id: 'u-bad', email: 'b@example.test', email_verified_at: null },
    { id: 'u-ok-1', email: 'o1@example.test', email_verified_at: null },
    { id: 'u-ok-2', email: 'o2@example.test', email_verified_at: null },
  ] });
  for (const id of ['u-bad', 'u-ok-1', 'u-ok-2']) w.verifyUser(id);
  const failingEmit = async (pg, type, payload) => {
    if (payload.recipientUserId === 'u-bad') throw new Error('transient outbox failure');
    return w.emit(pg, type, payload);
  };
  const result = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: failingEmit });
  assert.equal(result.welcome_scanned, 3);
  assert.equal(result.welcome_failed, 1);
  assert.equal(result.welcome_reconstructed, 2);
  assert.equal(w.work().length, 1, 'only the failed item stays pending');
  assert.equal(w.work()[0].subject_id, 'u-bad');

  const retry = await reconcileCommunicationDurability({ repository: w.repository, trustBatchLimit: 0, emit: w.emit });
  assert.equal(retry.welcome_reconstructed, 1);
  assert.equal(w.work().length, 0);
});

test('FAIL-2 a reconciliation fault never fails the worker request that drains the queue', async () => {
  const w = world({ users: [{ id: 'u-1', email: 'u1@example.test', email_verified_at: null }] });
  w.verifyUser('u-1');
  w.repository.list = async () => { throw new Error('database unavailable'); };
  const result = await runScheduledWorker(w.app);
  assert.equal(result.status, 200, 'delivery must not be taken down by a reconciliation fault');
  assert.equal(result.body.success, true);
});

// ============================================================================
// AUTHORITY — the migration text contract (executed for real by the PGlite check)
// ============================================================================

function migrationText() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

test('AUTHORITY-1 the work queue is a private table: RLS on, every client privilege revoked', () => {
  const migration = migrationText();
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.communication_reconciliation_work'));
  assert.ok(migration.includes('ALTER TABLE public.communication_reconciliation_work ENABLE ROW LEVEL SECURITY;'));
  assert.ok(migration.includes('ALTER TABLE public.communication_reconciliation_work FORCE ROW LEVEL SECURITY;'));
  assert.ok(migration.includes('REVOKE ALL ON TABLE public.communication_reconciliation_work FROM PUBLIC, anon, authenticated;'));
  // No policy grants anything back to a client role.
  assert.equal(/CREATE POLICY[^;]*communication_reconciliation_work/i.test(migration), false,
    'no policy may admit client access to the work queue');
});

test('AUTHORITY-2 no reconciliation control state lives on client-reachable tables any more', () => {
  const migration = migrationText();
  assert.equal(migration.includes('email_welcome_reconcile_required'), false,
    'the users flag is gone — table-level UPDATE grants on public.users made it uncontrollable');
  assert.equal(migration.includes('trust_presentation_reconcile_required'), false);
  assert.equal(migration.includes('communication_activation_boundaries'), false);
  const controller = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.equal(controller.includes('reconcile_required'), false);
  assert.ok(controller.includes(RECONCILIATION_WORK_TABLE), 'one eligibility authority: the work queue');
});

test('AUTHORITY-3 the triggers exist with exact identities and fire only on the real transitions', () => {
  const migration = migrationText();
  assert.match(migration, /CREATE TRIGGER trg_users_enqueue_welcome_reconciliation\b(?!_)/);
  assert.ok(migration.includes('AFTER UPDATE OF email_verified_at ON public.users'));
  assert.ok(migration.includes('IF OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL THEN'));

  assert.match(migration, /CREATE TRIGGER trg_vehicles_enqueue_trust_reconciliation\b(?!_)/);
  assert.ok(migration.includes('AFTER UPDATE ON public.vehicles'));
  for (const col of ['trust_score', 'trust_band', 'trust_confidence', 'trust_evidence_basis', 'trust_known_limitations', 'trust_calculation_version']) {
    assert.ok(migration.includes(`NEW.${col}`), `${col} must be part of the material comparison`);
  }
  const fn = migration.slice(
    migration.indexOf('enqueue_trust_presentation_reconciliation()'),
    migration.indexOf('DROP TRIGGER IF EXISTS trg_vehicles_enqueue_trust_reconciliation'),
  );
  assert.equal(/NEW\.trust_evaluated_at\s+IS DISTINCT FROM/.test(fn), false, 'a timestamp-only recompute must not be material');
  assert.equal(/NEW\.vin\s+IS DISTINCT FROM/.test(fn), false, 'identity is not presentation');
  assert.ok(fn.includes('IS DISTINCT FROM'), 'nullable and jsonb columns need IS DISTINCT FROM');
  assert.ok(fn.includes('generation = public.communication_reconciliation_work.generation + 1'),
    'a newer material state advances the generation on the existing row');
});

test('AUTHORITY-4 historical rows are never backfilled into the queue', () => {
  const migration = migrationText();
  assert.equal(/INSERT INTO public\.communication_reconciliation_work[\s\S]{0,400}?SELECT/i.test(migration), false,
    'no INSERT ... SELECT backfill');
  assert.equal(/UPDATE public\.(users|vehicles)\s+SET/i.test(migration), false,
    'no public-table rewrite that could fire the triggers en masse');
});

test('AUTHORITY-5 the trigger functions are not directly executable by clients', () => {
  const migration = migrationText();
  for (const fn of ['enqueue_email_welcome_reconciliation', 'enqueue_trust_presentation_reconciliation', 'communication_domain_event_dedupe_key']) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${fn}()`),
      `${fn} must have EXECUTE revoked from PUBLIC/anon/authenticated`);
  }
});
