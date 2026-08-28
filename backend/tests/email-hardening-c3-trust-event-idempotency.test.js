import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deterministicEventIdentity } from '../services/eventBus/eventBusService.js';
import {
  ANNOUNCED_FINGERPRINT_COLUMN,
  TRUST_MARKER_STATES,
  TRUST_PRESENTATION_CHANGED_EVENT,
  emitTrustPresentationChange,
  reconcileTrustPresentation,
  trustPresentationFingerprint,
} from '../services/trustDecision/trustPresentationChangeProducer.js';

/**
 * C3 — a Trust announcement must be durable AND idempotent, and the difference between "announced"
 * and "announced but not yet recorded as announced" must be visible to the caller.
 *
 * R5-D1 closed one direction: the emit fails, so the announcement stays outstanding and is retried.
 * It left the OTHER direction open, and that is the defect this file closes:
 *
 *     emit SUCCEEDS -> marker write FAILS -> markAnnounced() returns false -> caller ignores it and
 *     reports emitted:true -> next refresh sees a stale marker -> emits AGAIN -> and because
 *     domain_events derived a dedupe_key only for marketplace.inquiry.created, the second insert
 *     succeeds -> a second notification -> a SECOND Email about a Trust change the owner was
 *     already told about.
 *
 * The mutation that proves the gap was real is M-C3b: make markAnnounced write the marker
 * successfully but RETURN false. Before this file, the entire R5 suite stayed green (36/36) — no
 * test anywhere asserted that the caller respects that return value. `C3-C1` below kills it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, '..', '..', 'database', 'migrations', '20260826120000_email_1_0_hardening.sql');
const VIN = 'FIXTUREVIN0000001';

function record(overrides = {}) {
  return {
    vin: VIN, evaluation_state: 'evaluated', score: 78, band: 'moderate', confidence: 'medium',
    evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
    calculation_version: 'trust-decision-1.0.0', evaluated_at: '2026-08-26T00:00:00.000Z',
    known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
    source: 'cache', ...overrides,
  };
}

/**
 * A world whose `domain_events` table enforces the SAME partial unique index the migration creates,
 * and whose dedupe_key is derived by the SAME rule the trigger uses.
 *
 * Simulating the constraint is the point. A fixture that merely appends rows would let a duplicate
 * through and the test would prove nothing about idempotency.
 */
function world({ markerWrites = true, markerReadable = true } = {}) {
  // Mutable so a test can repair a transient fault mid-sequence, which is exactly what the
  // adversarial C3-C3 scenario requires.
  const ctl = { markerWrites, markerReadable };
  const vehicles = [{ vin: VIN, owner_id: 'owner-1', [ANNOUNCED_FINGERPRINT_COLUMN]: null }];
  const users = [{ id: 'owner-1', status: 'active', deleted_at: null }];
  const domainEvents = [];
  let markerWriteAttempts = 0;

  /** Mirrors communication_domain_event_dedupe_key() exactly. */
  function dedupeKeyFor(eventType, payload) {
    if (eventType === 'marketplace.inquiry.created') {
      const v = payload?.inquiryId ? String(payload.inquiryId) : '';
      return v ? `marketplace.inquiry.created:${v}` : null;
    }
    if (eventType === TRUST_PRESENTATION_CHANGED_EVENT) {
      const v = payload?.presentation_fingerprint ? String(payload.presentation_fingerprint) : '';
      return v ? `${TRUST_PRESENTATION_CHANGED_EVENT}:${v}` : null;
    }
    return null;
  }

  const pgClient = {
    query: async (sql, params) => {
      if (/INSERT INTO domain_events/.test(sql)) {
        const [event_type, payloadJson, status, attempts, tenant_id] = params;
        const payload = JSON.parse(payloadJson);
        const dedupe_key = dedupeKeyFor(event_type, payload);
        // The partial unique index: NOT NULL keys collide, NULL keys are exempt.
        if (dedupe_key && domainEvents.some((e) => e.dedupe_key === dedupe_key)) {
          if (/ON CONFLICT DO NOTHING/.test(sql)) return { rows: [] };
          const err = new Error('duplicate key value violates unique constraint "idx_domain_events_dedupe_key"');
          err.code = '23505';
          throw err;
        }
        const row = { id: `evt-${domainEvents.length + 1}`, event_type, payload, status, attempts, tenant_id, dedupe_key, created_at: new Date(Date.now() + domainEvents.length).toISOString() };
        domainEvents.push(row);
        return { rows: [row] };
      }
      if (/FROM domain_events/.test(sql) && /dedupe_key = \$1/.test(sql)) {
        return { rows: domainEvents.filter((e) => e.dedupe_key === params[0]) };
      }
      return { rows: [] };
    },
  };

  const client = {
    from: (table) => {
      const rows = table === 'vehicles' ? vehicles : table === 'users' ? users : [];
      const filters = [];
      let patch = null;
      const api = {
        select: () => api,
        eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
        update: (p) => { patch = p; return api; },
        maybeSingle: async () => {
          if (table === 'vehicles' && !ctl.markerReadable) {
            // What a pre-migration deploy really returns: the column does not exist.
            return { data: null, error: { code: '42703', message: `column vehicles.${ANNOUNCED_FINGERPRINT_COLUMN} does not exist` } };
          }
          return { data: rows.find((r) => filters.every((f) => f(r))) || null, error: null };
        },
        then: (res, rej) => {
          if (patch) {
            markerWriteAttempts += 1;
            if (ctl.markerWrites) rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
            const error = ctl.markerWrites ? null : { code: '42703', message: 'marker write failed' };
            return Promise.resolve({ data: null, error }).then(res, rej);
          }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };

  return { vehicles, domainEvents, client, pgClient, ctl, markerWriteAttempts: () => markerWriteAttempts };
}

const emit = (w, opts) => emitTrustPresentationChange({ vin: VIN, client: w.client, pgClient: w.pgClient, ...opts });

// ============================================================================
// C3-A — the database dedupe contract
// ============================================================================

test('C3-A1 the migration derives a dedupe key for the Trust event from its existing fingerprint', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /ELSIF NEW\.event_type = 'vehicle\.trust\.presentation_changed' THEN/);
  assert.match(sql, /NEW\.dedupe_key := 'vehicle\.trust\.presentation_changed:' \|\| v_fingerprint/);
  assert.match(sql, /presentation_fingerprint/);
  // No second notion of sameness was invented.
  assert.equal(/fingerprint/gi.test(sql), true);
  assert.equal(sql.includes('md5('), false, 'the migration must not compute its own fingerprint');
});

test('C3-A2 marketplace inquiry dedupe behaviour is preserved byte-for-byte', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /IF NEW\.event_type = 'marketplace\.inquiry\.created' THEN/);
  assert.match(sql, /v_inquiry_id := NULLIF\(NEW\.payload ->> 'inquiryId', ''\);/);
  assert.match(sql, /NEW\.dedupe_key := 'marketplace\.inquiry\.created:' \|\| v_inquiry_id;/);
});

test('C3-A3 the application key format matches the migration format exactly', () => {
  // A silent divergence here turns idempotent recovery into an unrecoverable insert failure: the
  // database rejects on its key while the application looks the row up by a different one.
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const fingerprint = 'abc123';
  const identity = deterministicEventIdentity(TRUST_PRESENTATION_CHANGED_EVENT, { presentation_fingerprint: fingerprint });
  assert.equal(identity.dedupeKey, `${TRUST_PRESENTATION_CHANGED_EVENT}:${fingerprint}`);
  assert.ok(sql.includes(`'${TRUST_PRESENTATION_CHANGED_EVENT}:' || v_fingerprint`));

  const inquiry = deterministicEventIdentity('marketplace.inquiry.created', { inquiryId: 'inq-9' });
  assert.equal(inquiry.dedupeKey, 'marketplace.inquiry.created:inq-9');
});

test('C3-A4 same material presentation -> same key; new presentation -> different key', () => {
  const a = trustPresentationFingerprint(record());
  const aAgain = trustPresentationFingerprint(record({ evaluated_at: '2099-01-01T00:00:00.000Z' }));
  const b = trustPresentationFingerprint(record({ score: 91, band: 'strong' }));
  assert.equal(a, aAgain, 'a timestamp-only recomputation is the same presentation');
  assert.notEqual(a, b);
  const key = (f) => deterministicEventIdentity(TRUST_PRESENTATION_CHANGED_EVENT, { presentation_fingerprint: f }).dedupeKey;
  assert.equal(key(a), key(aAgain));
  assert.notEqual(key(a), key(b));
});

test('C3-A5 an event type outside the registry has NO identity, so 23505 is never swallowed', () => {
  assert.equal(deterministicEventIdentity('VEHICLE_RESERVED', { id: 'x' }), null);
  assert.equal(deterministicEventIdentity('MARKETPLACE_FUNDS_HELD', { transactionIntentId: 't' }), null);
  // ...and a registered type with no identity value present is also null, not a bogus key.
  assert.equal(deterministicEventIdentity(TRUST_PRESENTATION_CHANGED_EVENT, {}), null);
  assert.equal(deterministicEventIdentity(TRUST_PRESENTATION_CHANGED_EVENT, { presentation_fingerprint: '  ' }), null);
});

// ============================================================================
// C3-B — duplicate recovery
// ============================================================================

test('C3-B1 first emission creates event A', async () => {
  const w = world();
  const out = await emit(w, { previousRecord: null, nextRecord: record() });
  assert.equal(out.emitted, true);
  assert.equal(w.domainEvents.length, 1);
  assert.equal(w.domainEvents[0].event_type, TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(w.domainEvents[0].dedupe_key, `${TRUST_PRESENTATION_CHANGED_EVENT}:${out.fingerprint}`);
});

test('C3-B2 an identical retry recovers event A and creates NO event B', async () => {
  const w = world({ markerWrites: false });
  const first = await emit(w, { previousRecord: null, nextRecord: record() });
  assert.equal(first.emitted, true);
  assert.equal(w.domainEvents.length, 1);
  const idA = w.domainEvents[0].id;

  // The marker never landed, so the announcement still looks outstanding and this re-emits.
  const second = await emit(w, { previousRecord: record(), nextRecord: record() });
  assert.equal(second.emitted, true);
  assert.equal(w.domainEvents.length, 1, 'the duplicate insert must be absorbed, not appended');
  assert.equal(w.domainEvents[0].id, idA, 'the SAME durable event is recovered');
  assert.equal(second.fingerprint, first.fingerprint);
});

test('C3-B3 a NEW fingerprint still creates a genuinely new event B', async () => {
  const w = world();
  const a = await emit(w, { previousRecord: null, nextRecord: record() });
  const b = await emit(w, { previousRecord: record(), nextRecord: record({ score: 91, band: 'strong' }) });
  assert.equal(w.domainEvents.length, 2);
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(w.domainEvents[0].id, w.domainEvents[1].id);
});

// ============================================================================
// C3-C — marker truth
// ============================================================================

test('C3-C1 KILLS M-C3b: a marker that did not persist is NOT reported as recorded', async () => {
  // The exact mutation that survived before this file existed. The event is durable either way;
  // what must differ is what the caller is TOLD, because only a truthful answer lets anything
  // schedule the repair.
  const ok = world();
  const good = await emit(ok, { previousRecord: null, nextRecord: record() });
  assert.equal(good.emitted, true);
  assert.equal(good.marker, TRUST_MARKER_STATES.RECORDED);
  assert.equal(ok.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], good.fingerprint);

  const bad = world({ markerWrites: false });
  const out = await emit(bad, { previousRecord: null, nextRecord: record() });
  assert.equal(out.emitted, true, 'the event IS durable — that much is true');
  assert.equal(out.marker, TRUST_MARKER_STATES.PENDING, 'but the marker is not, and saying so is the fix');
  assert.notEqual(out.marker, TRUST_MARKER_STATES.RECORDED);
  assert.equal(bad.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], null);
});

test('C3-C2 the durable event is NEVER rolled back because the marker failed', async () => {
  const w = world({ markerWrites: false });
  const out = await emit(w, { previousRecord: null, nextRecord: record() });
  assert.equal(out.marker, TRUST_MARKER_STATES.PENDING);
  assert.equal(w.domainEvents.length, 1, 'deleting it would destroy the announcement itself');
  assert.equal(w.domainEvents[0].event_type, TRUST_PRESENTATION_CHANGED_EVENT);
});

test('C3-C3 THE ADVERSARIAL SEQUENCE: event persists, marker fails, reconciliation repairs, ONE event', async () => {
  const w = world();

  // 1-2. Trust A is announced and its marker recorded; then Trust moves materially to B.
  const a = await emit(w, { previousRecord: null, nextRecord: record() });
  assert.equal(a.marker, TRUST_MARKER_STATES.RECORDED);

  // 3-5. Event B persists; the marker write fails; the caller does NOT claim complete success.
  w.ctl.markerWrites = false;
  const b = await emit(w, { previousRecord: record(), nextRecord: record({ score: 91, band: 'strong' }) });
  assert.equal(b.emitted, true, 'the announcement really did happen');
  assert.equal(b.marker, TRUST_MARKER_STATES.PENDING, 'and the bookkeeping really did not');
  assert.equal(w.domainEvents.length, 2);
  const idB = w.domainEvents[1].id;
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], a.fingerprint, 'marker still names A');

  // 6-7. Reconciliation retries; the DB dedupe returns the SAME event B rather than a third row.
  w.ctl.markerWrites = true;
  const repaired = await reconcileTrustPresentation(VIN, {
    client: w.client, pgClient: w.pgClient, getRecord: async () => record({ score: 91, band: 'strong' }),
  });
  assert.equal(repaired.emitted, true);
  assert.equal(repaired.fingerprint, b.fingerprint);
  assert.equal(w.domainEvents.length, 2, 'no third event — the retry recovered B');
  assert.equal(w.domainEvents[1].id, idB);

  // 8-9. The marker is repaired, so exactly one effective R5 notification exists for B.
  assert.equal(repaired.marker, TRUST_MARKER_STATES.RECORDED);
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], b.fingerprint);

  const settled = await reconcileTrustPresentation(VIN, {
    client: w.client, pgClient: w.pgClient, getRecord: async () => record({ score: 91, band: 'strong' }),
  });
  assert.equal(settled.emitted, false);
  assert.equal(settled.reason, 'already_announced');
  assert.equal(w.domainEvents.length, 2, 'exactly one durable event per material presentation');
});

test('C3-C4 an UNREADABLE marker refuses to emit — unknown state is not permission', async () => {
  // The pre-migration deploy window. Treating "I cannot read the marker" as "never announced" would
  // re-announce every material change on every refresh: not a rare race, a 100% duplication rate.
  const w = world({ markerReadable: false });
  const out = await emit(w, { previousRecord: null, nextRecord: record() });
  assert.equal(out.emitted, false);
  assert.equal(out.reason, 'announcement_state_unavailable');
  assert.equal(w.domainEvents.length, 0, 'nothing is announced while the state is unknowable');
  assert.ok(out.fingerprint, 'the fingerprint is still reported so the caller can log what was deferred');
});

test('C3-C5 the deferred announcement is delivered once the marker becomes readable', async () => {
  const blind = world({ markerReadable: false });
  assert.equal((await emit(blind, { previousRecord: null, nextRecord: record() })).emitted, false);

  const seeing = world();
  const out = await emit(seeing, { previousRecord: record(), nextRecord: record() });
  assert.equal(out.emitted, true, 'an outstanding announcement is not lost, only deferred');
  assert.equal(seeing.domainEvents.length, 1);
});
