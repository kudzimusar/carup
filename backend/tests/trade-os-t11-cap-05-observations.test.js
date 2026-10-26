/**
 * T11-CAP-05 — shipment observations and the history of estimate revisions.
 *
 * An observation is something a provider or an operator SAYS about a shipment. It is an input, not a
 * verified fact, and it must never rewrite the shipment. Held here:
 *
 *   · T11 stays the authority: recording a revision writes observations and an audit row and NOTHING
 *     else — a trap proves it — and the shipment's own estimate is never overwritten;
 *   · the current estimate is the latest accepted revision, shown BESIDE the original, and a
 *     backdated revision recorded later can never become "current";
 *   · history is evidence: an older revision is superseded, never edited or erased;
 *   · replaying an event is idempotent, and reusing its id for different content is a conflict that
 *     reveals nothing about anyone else's shipment;
 *   · an estimate is not an arrival.
 *
 * Fixtures are synthetic and exist only inside this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  recordEtaRevision,
  listEtaRevisions,
  OBSERVATION_PROVIDERS_INGESTIBLE,
} from '../services/diaspora/diasporaShipmentObservationService.js';
import { projectEta, listEtaRevisionsForShipment } from '../services/diaspora/shipmentObservationRead.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const OPERATOR = { id: 'u-operator', platformRole: 'member' };
const TENANT_ADMIN = { id: 'u-tenant-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
const OTHER_TENANT_ADMIN = { id: 'u-other-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };
const BUYER = { id: 'u-buyer', platformRole: 'member' };
const OUTSIDER = { id: 'u-outsider', platformRole: 'member' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };

const opts = (client) => ({ supabaseClient: client });

function world(over = {}) {
  return createMockSupabase({
    diaspora_shipments: over.shipments || [
      { id: 'ship-1', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'IN_TRANSIT',
        estimated_arrival_date: '2026-09-18T00:00:00Z', departure_date: '2026-08-30T00:00:00Z', actual_arrival_date: null,
        metadata: { planned_departure_date: '2026-08-29T00:00:00Z' }, deleted_at: null },
      { id: 'ship-2', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'PLANNED',
        estimated_arrival_date: null, departure_date: null, actual_arrival_date: null, metadata: {}, deleted_at: null },
    ],
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', deleted_at: null }],
    diaspora_shipment_observations: over.observations || [],
    diaspora_shipment_stage_events: [],
    diaspora_import_audit_log: [],
  });
}

const rows = (c) => c._rows('diaspora_shipment_observations');
const audit = (c) => c._rows('diaspora_import_audit_log');
const REV = { estimated_arrival: '2026-09-25T00:00:00Z', reason: 'Vessel rescheduled by the carrier', observed_at: '2026-09-01T00:00:00Z' };

// ── Recording a revision ──────────────────────────────────────────────────

test('CAP-05: an operator records an estimate revision — accepted, attributed, audited', async () => {
  const c = world();
  const r = await recordEtaRevision('ship-1', REV, OPERATOR, opts(c));
  assert.equal(rows(c).length, 1);
  const row = rows(c)[0];
  assert.equal(row.kind, 'ETA_REVISION');
  assert.equal(row.provider_id, 'OPERATOR_DECLARED');
  assert.equal(row.status, 'ACCEPTED');
  assert.equal(row.decided_by, 'u-operator');
  assert.equal(row.created_by, 'u-operator');
  assert.equal(row.payload.estimated_arrival, '2026-09-25T00:00:00.000Z');
  assert.equal(row.payload.reason, 'Vessel rescheduled by the carrier');
  assert.equal(audit(c).length, 1);
  assert.equal(audit(c)[0].action, 'SHIPMENT_ETA_REVISED');
  assert.equal(r.estimated_arrival, '2026-09-25T00:00:00.000Z');
});

test('CAP-05: only the operator-declared provider can be ingested today — no other integration exists', () => {
  assert.deepEqual([...OBSERVATION_PROVIDERS_INGESTIBLE], ['OPERATOR_DECLARED']);
});

test('CAP-05: a caller cannot choose the provider, the status or the decision — those are not theirs to claim', async () => {
  for (const extra of [{ provider_id: 'CARRIER_API' }, { status: 'ACCEPTED' }, { decided_by: 'u-x' }, { kind: 'PORT_EVENT' }, { created_by: 'u-x' }]) {
    await assert.rejects(() => recordEtaRevision('ship-1', { ...REV, ...extra }, OPERATOR, opts(world())), ValidationError, JSON.stringify(extra));
  }
});

test('CAP-05: recording a revision writes observations and an audit row — never the shipment', async () => {
  const c = world();
  const before = JSON.stringify(c._rows('diaspora_shipments'));
  const writes = [];
  const trapped = { ...c, from(table) {
    const chain = c.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await recordEtaRevision('ship-1', REV, OPERATOR, opts(trapped));
  await recordEtaRevision('ship-1', { ...REV, estimated_arrival: '2026-09-28T00:00:00Z', observed_at: '2026-09-05T00:00:00Z' }, OPERATOR, opts(trapped));
  assert.equal(JSON.stringify(c._rows('diaspora_shipments')), before, 'a revision rewrote the shipment (its own estimate, its status or its dates)');
  assert.deepEqual(c._rows('diaspora_shipment_stage_events'), [], 'a revision wrote a movement event');
  assert.deepEqual([...new Set(writes.map((w) => w.split(' ')[1]))].sort(), ['diaspora_import_audit_log', 'diaspora_shipment_observations']);
  assert.ok(!writes.some((w) => w.startsWith('delete')), 'something was deleted');
});

test('CAP-05: a revised estimate is not an arrival — even one in the past', async () => {
  const c = world();
  await recordEtaRevision('ship-1', { estimated_arrival: '2026-09-02T00:00:00Z', observed_at: '2026-09-01T00:00:00Z' }, OPERATOR, opts(c));
  const ship = c._rows('diaspora_shipments').find((s) => s.id === 'ship-1');
  assert.equal(ship.actual_arrival_date, null);
  assert.equal(ship.status, 'IN_TRANSIT');
});

// ── Current vs original, and history ──────────────────────────────────────

test('CAP-05: a newer revision supersedes an older one, and the older one stays in the history', async () => {
  const c = world();
  await recordEtaRevision('ship-1', REV, OPERATOR, opts(c));
  await recordEtaRevision('ship-1', { estimated_arrival: '2026-10-02T00:00:00Z', reason: 'Port congestion', observed_at: '2026-09-10T00:00:00Z' }, OPERATOR, opts(c));
  const statuses = rows(c).map((r) => r.status).sort();
  assert.deepEqual(statuses, ['ACCEPTED', 'SUPERSEDED'], 'exactly one revision should be current');
  assert.equal(rows(c).length, 2, 'the earlier revision was erased instead of superseded');
  const revisions = await listEtaRevisionsForShipment('ship-1', c);
  assert.deepEqual(revisions.map((r) => r.payload.reason), ['Vessel rescheduled by the carrier', 'Port congestion']);
});

test('CAP-05: a BACKDATED revision recorded later never becomes current', async () => {
  const c = world();
  await recordEtaRevision('ship-1', { estimated_arrival: '2026-10-02T00:00:00Z', reason: 'Newer information', observed_at: '2026-09-10T00:00:00Z' }, OPERATOR, opts(c));
  await recordEtaRevision('ship-1', { estimated_arrival: '2026-09-25T00:00:00Z', reason: 'Older information, entered late', observed_at: '2026-09-01T00:00:00Z' }, OPERATOR, opts(c));
  const eta = projectEta(c._rows('diaspora_shipments')[0], await listEtaRevisionsForShipment('ship-1', c));
  assert.equal(eta.current, '2026-10-02T00:00:00.000Z', 'a late-entered older observation overrode the newer one');
  const accepted = rows(c).filter((r) => r.status === 'ACCEPTED');
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].payload.reason, 'Newer information');
});

test('CAP-05: revisions of one shipment do not touch another shipment\'s history', async () => {
  const c = world();
  await recordEtaRevision('ship-1', REV, OPERATOR, opts(c));
  await recordEtaRevision('ship-2', { estimated_arrival: '2026-11-01T00:00:00Z', observed_at: '2026-09-01T00:00:00Z' }, OPERATOR, opts(c));
  assert.equal(rows(c).filter((r) => r.status === 'ACCEPTED').length, 2, 'one shipment\'s revision superseded another\'s');
});

// ── Projection ────────────────────────────────────────────────────────────

const SHIP = { estimated_arrival_date: '2026-09-18T00:00:00Z' };
const R = (estimated, observed, over = {}) => ({ payload: { estimated_arrival: estimated, reason: over.reason ?? null }, observed_at: observed,
  provider_id: 'OPERATOR_DECLARED', status: over.status ?? 'ACCEPTED', decided_by: 'u-secret-decider', created_by: 'u-secret-author',
  source_reference: 'doc-secret', provider_event_id: 'evt-secret', ...over });

test('CAP-05: with no revision, the current estimate is the shipment record\'s own, and says so', () => {
  const eta = projectEta(SHIP, []);
  assert.equal(eta.basis, 'shipment_record');
  assert.equal(eta.original, '2026-09-18T00:00:00Z');
  assert.equal(eta.current, '2026-09-18T00:00:00Z');
  assert.equal(eta.revision_count, 0);
  assert.equal(eta.change_days, null);
  assert.deepEqual(eta.revisions, []);
});

test('CAP-05: with no estimate anywhere, nothing is invented', () => {
  const eta = projectEta({ estimated_arrival_date: null }, []);
  assert.equal(eta.basis, 'none');
  assert.equal(eta.current, null);
  assert.equal(eta.original, null);
});

test('CAP-05: the current estimate is the latest accepted revision, shown beside the original', () => {
  const eta = projectEta(SHIP, [R('2026-09-25T00:00:00Z', '2026-09-01T00:00:00Z', { status: 'SUPERSEDED', reason: 'First' }), R('2026-10-02T00:00:00Z', '2026-09-10T00:00:00Z', { reason: 'Second' })]);
  assert.equal(eta.basis, 'revision');
  assert.equal(eta.original, '2026-09-18T00:00:00Z');
  assert.equal(eta.current, '2026-10-02T00:00:00Z');
  assert.equal(eta.revision_count, 2);
  assert.equal(eta.last_revised_at, '2026-09-10T00:00:00Z');
  assert.equal(eta.change_days, 14);
  assert.deepEqual(eta.revisions.map((r) => [r.estimated_arrival, r.superseded, r.reason]),
    [['2026-09-25T00:00:00Z', true, 'First'], ['2026-10-02T00:00:00Z', false, 'Second']]);
});

test('CAP-05: an estimate that moved EARLIER is reported as a negative change, and a no-op as zero', () => {
  assert.equal(projectEta(SHIP, [R('2026-09-15T00:00:00Z', '2026-09-01T00:00:00Z')]).change_days, -3);
  assert.equal(projectEta(SHIP, [R('2026-09-18T00:00:00Z', '2026-09-01T00:00:00Z')]).change_days, 0);
});

test('CAP-05: revisions are listed oldest first whatever order they arrive in', () => {
  const eta = projectEta(SHIP, [R('2026-10-02T00:00:00Z', '2026-09-10T00:00:00Z'), R('2026-09-25T00:00:00Z', '2026-09-01T00:00:00Z', { status: 'SUPERSEDED' })]);
  assert.deepEqual(eta.revisions.map((r) => r.observed_at), ['2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z']);
});

test('CAP-05: the projection carries the estimate, when and why — and never who decided, who recorded, or any reference', () => {
  const eta = projectEta(SHIP, [R('2026-09-25T00:00:00Z', '2026-09-01T00:00:00Z', { reason: 'Carrier notice' })]);
  const text = JSON.stringify(eta);
  for (const leak of ['u-secret-decider', 'u-secret-author', 'doc-secret', 'evt-secret', 'decided_by', 'created_by', 'provider_event_id']) {
    assert.ok(!text.includes(leak), `${leak} leaked`);
  }
  assert.equal(eta.revisions[0].source, 'OPERATOR_DECLARED');
  assert.equal(eta.revisions[0].reason, 'Carrier notice');
  assert.match(eta.note, /still an estimate/i);
});

test('CAP-05: a missing reason stays missing — "why did it change" is never invented', () => {
  const eta = projectEta(SHIP, [R('2026-09-25T00:00:00Z', '2026-09-01T00:00:00Z')]);
  assert.equal(eta.revisions[0].reason, null);
});

// ── Validation ────────────────────────────────────────────────────────────

test('CAP-05: an unreadable estimate, or none at all, is refused', async () => {
  await assert.rejects(() => recordEtaRevision('ship-1', { estimated_arrival: 'next week' }, OPERATOR, opts(world())), ValidationError);
  await assert.rejects(() => recordEtaRevision('ship-1', {}, OPERATOR, opts(world())), ValidationError);
});

test('CAP-05: an estimate before the planned departure, or before an observed departure, is refused', async () => {
  await assert.rejects(() => recordEtaRevision('ship-1', { estimated_arrival: '2026-08-01T00:00:00Z' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /departure/i.test(e.message));
});

test('CAP-05: an observation cannot be dated in the future', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  await assert.rejects(() => recordEtaRevision('ship-1', { estimated_arrival: '2026-10-01T00:00:00Z', observed_at: future }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /future/i.test(e.message));
});

test('CAP-05: a reason is bounded, and a blank reason is stored as unknown', async () => {
  await assert.rejects(() => recordEtaRevision('ship-1', { estimated_arrival: '2026-10-01T00:00:00Z', reason: 'x'.repeat(600) }, OPERATOR, opts(world())), ValidationError);
  const c = world();
  await recordEtaRevision('ship-1', { estimated_arrival: '2026-10-01T00:00:00Z', reason: '   ' }, OPERATOR, opts(c));
  assert.equal(rows(c)[0].payload.reason, null);
});

// ── Who may record ────────────────────────────────────────────────────────

test('CAP-05: the container operator, the order\'s tenant admin and a platform admin may record', async () => {
  for (const who of [OPERATOR, TENANT_ADMIN, ADMIN]) {
    const c = world();
    await recordEtaRevision('ship-1', REV, who, opts(c));
    assert.equal(rows(c)[0].created_by, who.id);
  }
});

test('CAP-05: the buyer, another tenant\'s admin and an outsider are refused — and leave nothing behind', async () => {
  for (const who of [BUYER, OTHER_TENANT_ADMIN, OUTSIDER]) {
    const c = world();
    await assert.rejects(() => recordEtaRevision('ship-1', REV, who, opts(c)), ForbiddenError, who.id);
    assert.equal(rows(c).length, 0);
    assert.equal(audit(c).length, 0);
  }
});

test('CAP-05: a missing shipment is not found', async () => {
  await assert.rejects(() => recordEtaRevision('nope', REV, OPERATOR, opts(world())), NotFoundError);
});

test('CAP-05: listing the history needs the same authority', async () => {
  const c = world();
  await recordEtaRevision('ship-1', REV, OPERATOR, opts(c));
  assert.equal((await listEtaRevisions('ship-1', OPERATOR, opts(c))).length, 1);
  await assert.rejects(() => listEtaRevisions('ship-1', BUYER, opts(c)), ForbiddenError);
});

// ── Idempotency ───────────────────────────────────────────────────────────

test('CAP-05: replaying the same event is idempotent — no second row, no second audit entry', async () => {
  const c = world();
  const first = await recordEtaRevision('ship-1', { ...REV, provider_event_id: 'evt-A' }, OPERATOR, opts(c));
  const again = await recordEtaRevision('ship-1', { ...REV, provider_event_id: 'evt-A' }, OPERATOR, opts(c));
  assert.equal(rows(c).length, 1, 'a replay recorded a duplicate');
  assert.equal(audit(c).length, 1, 'a replay audited twice');
  assert.equal(again.estimated_arrival, first.estimated_arrival);
});

test('CAP-05: the same event id with DIFFERENT content is a conflict, not a silent overwrite', async () => {
  const c = world();
  await recordEtaRevision('ship-1', { ...REV, provider_event_id: 'evt-A' }, OPERATOR, opts(c));
  await assert.rejects(() => recordEtaRevision('ship-1', { ...REV, estimated_arrival: '2026-12-01T00:00:00Z', provider_event_id: 'evt-A' }, OPERATOR, opts(c)), ConflictError);
  assert.equal(rows(c).length, 1);
});

test('CAP-05: an event id used on ANOTHER shipment is a conflict that reveals nothing about it', async () => {
  const c = world();
  await recordEtaRevision('ship-2', { estimated_arrival: '2026-11-01T00:00:00Z', provider_event_id: 'evt-shared' }, OPERATOR, opts(c));
  const err = await recordEtaRevision('ship-1', { ...REV, provider_event_id: 'evt-shared' }, OPERATOR, opts(c)).catch((e) => e);
  assert.ok(err instanceof ConflictError);
  assert.ok(!/ship-2|2026-11-01/.test(err.message), 'the conflict leaked the other shipment');
});

test('CAP-05: without an event id each call is its own event', async () => {
  const c = world();
  await recordEtaRevision('ship-1', REV, OPERATOR, opts(c));
  await recordEtaRevision('ship-1', { ...REV, observed_at: '2026-09-02T00:00:00Z' }, OPERATOR, opts(c));
  assert.equal(rows(c).length, 2);
});
