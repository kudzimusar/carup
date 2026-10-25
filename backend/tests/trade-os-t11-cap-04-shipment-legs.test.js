/**
 * T11-CAP-04 — shipment legs.
 *
 * A leg is a DECLARED fact about a vessel and a route. It is not a record that anything sailed:
 * movement is T11's alone, and a second place to assert "it sailed" would be a second lifecycle.
 * These tests hold the service to that, to honest provenance, and to T11's own rule for who may write.
 *
 * Fixtures are synthetic and exist only inside this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  addShipmentLeg,
  updateShipmentLeg,
  supersedeShipmentLeg,
  listLegsForShipment,
  projectLeg,
  isValidImo,
  LEG_SOURCES,
} from '../services/diaspora/diasporaShipmentLegService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const OPERATOR = { id: 'u-operator', platformRole: 'member' };            // coordinator of cont-1
const TENANT_ADMIN = { id: 'u-tenant-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
const OTHER_TENANT_ADMIN = { id: 'u-other-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };
const BUYER = { id: 'u-buyer', platformRole: 'member' };
const OUTSIDER = { id: 'u-outsider', platformRole: 'member' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };

const opts = (client) => ({ supabaseClient: client });

function world(over = {}) {
  return createMockSupabase({
    diaspora_shipments: over.shipments || [{
      id: 'ship-1', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'PLANNED',
      carrier_name: 'Sample Carrier', origin_port: 'Port A', destination_port: 'Port B',
      departure_date: null, estimated_arrival_date: null, actual_arrival_date: null, metadata: {}, deleted_at: null,
    }],
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', deleted_at: null }],
    diaspora_shipment_legs: over.legs || [],
    diaspora_shipment_stage_events: [],
    diaspora_trade_documents: [
      { id: 'doc-mine', import_order_id: 'ord-a', document_type: 'bill_of_lading', deleted_at: null },
      { id: 'doc-theirs', import_order_id: 'ord-z', document_type: 'bill_of_lading', deleted_at: null },
    ],
    diaspora_import_audit_log: [],
  });
}

const VALID = { vessel_name: 'SAMPLE VESSEL', voyage_ref: 'V-1', imo: '9074729', port_of_loading: 'Port A', port_of_discharge: 'Port B',
  planned_departure_date: '2026-08-29T00:00:00Z', estimated_arrival_date: '2026-09-18T00:00:00Z' };

const audit = (client) => client._rows('diaspora_import_audit_log');
const legs = (client) => client._rows('diaspora_shipment_legs');

// ── IMO numbers are checked, not just shaped ──────────────────────────────

test('CAP-04: a valid IMO number passes its check digit', () => {
  assert.equal(isValidImo('9074729'), true);
  assert.equal(isValidImo('IMO 9074729'), true);
});

test('CAP-04: a seven-digit number with the wrong check digit is refused', () => {
  assert.equal(isValidImo('9074728'), false);
  // 1234567 happens to be a VALID IMO (weighted sum 77, check digit 7), so it is the wrong example.
  assert.equal(isValidImo('1234567'), true);
  assert.equal(isValidImo('1234568'), false);
});

test('CAP-04: anything that is not seven digits is refused', () => {
  for (const bad of ['', '907472', '90747290', '90747A9', null, undefined]) assert.equal(isValidImo(bad), false, String(bad));
});

// ── Declaring a leg ───────────────────────────────────────────────────────

test('CAP-04: an operator declares a leg, attributed, and the audit trail records it', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  assert.equal(leg.leg_sequence, 1);
  assert.equal(leg.source, 'OPERATOR_DECLARED');
  assert.equal(leg.created_by, 'u-operator');
  assert.equal(leg.tenant_id, 'tenant-1');
  assert.equal(leg.imo, '9074729');
  assert.equal(audit(c).length, 1);
  assert.equal(audit(c)[0].action, 'SHIPMENT_LEG_DECLARED');
  assert.equal(audit(c)[0].actor_id, 'u-operator');
});

test('CAP-04: declaring a leg never moves the shipment it describes', async () => {
  const c = world();
  const before = JSON.stringify(c._rows('diaspora_shipments'));
  await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await addShipmentLeg('ship-1', { vessel_name: 'SECOND', port_of_loading: 'Port B', port_of_discharge: 'Port C' }, OPERATOR, opts(c));
  assert.equal(JSON.stringify(c._rows('diaspora_shipments')), before, 'a leg changed the shipment');
  assert.deepEqual(c._rows('diaspora_shipment_stage_events'), [], 'a leg wrote a movement event');
});

test('CAP-04: the next leg takes the next position, and a transshipment is representable', async () => {
  const c = world();
  await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  const second = await addShipmentLeg('ship-1', { vessel_name: 'SECOND VESSEL', port_of_loading: 'Port B', port_of_discharge: 'Port C' }, OPERATOR, opts(c));
  assert.equal(second.leg_sequence, 2);
  assert.equal(legs(c).length, 2);
});

test('CAP-04: a position already in use is refused with a plain message', async () => {
  const c = world();
  await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, leg_sequence: 1 }, OPERATOR, opts(c)),
    (e) => e instanceof ValidationError && /position/i.test(e.message));
});

test('CAP-04: values are trimmed, and blank text becomes unknown rather than an empty string', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', { vessel_name: '  SPACED  ', voyage_ref: '   ', port_of_loading: 'Port A' }, OPERATOR, opts(c));
  assert.equal(leg.vessel_name, 'SPACED');
  assert.equal(leg.voyage_ref, null);
});

// ── Validation ────────────────────────────────────────────────────────────

test('CAP-04: a leg that identifies nothing is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', {}, OPERATOR, opts(world())), ValidationError);
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: '   ' }, OPERATOR, opts(world())), ValidationError);
});

test('CAP-04: an IMO that fails its check digit is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'V', imo: '9074728' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /imo/i.test(e.message));
});

test('CAP-04: an MMSI must be nine digits', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'V', mmsi: '1234' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /mmsi/i.test(e.message));
  const ok = await addShipmentLeg('ship-1', { vessel_name: 'V', mmsi: '123456789' }, OPERATOR, opts(world()));
  assert.equal(ok.mmsi, '123456789');
});

test('CAP-04: an unreadable date is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'V', planned_departure_date: 'next week' }, OPERATOR, opts(world())), ValidationError);
});

test('CAP-04: an estimated arrival before the planned departure is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'V', planned_departure_date: '2026-09-20T00:00:00Z', estimated_arrival_date: '2026-09-01T00:00:00Z' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /before/i.test(e.message));
});

test('CAP-04: over-long text is refused, not truncated into a different fact', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'X'.repeat(500) }, OPERATOR, opts(world())), ValidationError);
});

test('CAP-04: a position below 1 is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { vessel_name: 'V', leg_sequence: 0 }, OPERATOR, opts(world())), ValidationError);
});

// ── Provenance: nobody can claim a source that does not exist yet ─────────

test('CAP-04: the known sources are the four the database allows', () => {
  assert.deepEqual([...LEG_SOURCES].sort(), ['CARRIER', 'DOCUMENT', 'OPERATOR_DECLARED', 'PROVIDER']);
});

test('CAP-04: a caller cannot declare a leg as CARRIER- or PROVIDER-sourced — no such integration exists', async () => {
  for (const source of ['CARRIER', 'PROVIDER']) {
    await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, source }, OPERATOR, opts(world())),
      (e) => e instanceof ValidationError && /pending external authority/i.test(e.message), source);
  }
});

test('CAP-04: an unknown source is refused', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, source: 'GUESSED' }, OPERATOR, opts(world())), ValidationError);
});

test('CAP-04: a DOCUMENT-sourced leg must point at a document of THIS order', async () => {
  await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, source: 'DOCUMENT' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /document/i.test(e.message));
  await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, source: 'DOCUMENT', source_reference: 'doc-theirs' }, OPERATOR, opts(world())),
    (e) => e instanceof ValidationError && /this order/i.test(e.message), 'another order\'s document was accepted as provenance');
  await assert.rejects(() => addShipmentLeg('ship-1', { ...VALID, source: 'DOCUMENT', source_reference: 'no-such-doc' }, OPERATOR, opts(world())), ValidationError);
  const ok = await addShipmentLeg('ship-1', { ...VALID, source: 'DOCUMENT', source_reference: 'doc-mine' }, OPERATOR, opts(world()));
  assert.equal(ok.source, 'DOCUMENT');
});

// ── Who may write: T11's own rule ─────────────────────────────────────────

test('CAP-04: the container operator, a tenant admin of the order and a platform admin may declare legs', async () => {
  for (const who of [OPERATOR, TENANT_ADMIN, ADMIN]) {
    const leg = await addShipmentLeg('ship-1', VALID, who, opts(world()));
    assert.equal(leg.created_by, who.id);
  }
});

test('CAP-04: the buyer, another tenant\'s admin and an outsider are refused', async () => {
  for (const who of [BUYER, OTHER_TENANT_ADMIN, OUTSIDER]) {
    await assert.rejects(() => addShipmentLeg('ship-1', VALID, who, opts(world())), ForbiddenError, who.id);
  }
});

test('CAP-04: a missing shipment is not found', async () => {
  await assert.rejects(() => addShipmentLeg('no-such-shipment', VALID, OPERATOR, opts(world())), NotFoundError);
});

test('CAP-04: a refused caller leaves no leg and no audit row behind', async () => {
  const c = world();
  await assert.rejects(() => addShipmentLeg('ship-1', VALID, BUYER, opts(c)), ForbiddenError);
  assert.equal(legs(c).length, 0);
  assert.equal(audit(c).length, 0);
});

// ── Correcting and superseding ────────────────────────────────────────────

test('CAP-04: a vessel name can be corrected, attributed, with before and after in the audit trail', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  const fixed = await updateShipmentLeg(leg.id, { vessel_name: 'SAMPLE VESSEL (CORRECTED)' }, TENANT_ADMIN, opts(c));
  assert.equal(fixed.vessel_name, 'SAMPLE VESSEL (CORRECTED)');
  assert.equal(fixed.created_by, 'u-operator', 'the original author was overwritten');
  assert.equal(fixed.updated_by, 'u-tenant-admin');
  const entry = audit(c).find((a) => a.action === 'SHIPMENT_LEG_UPDATED');
  assert.ok(entry, 'no audit entry for the correction');
  assert.equal(entry.previous_state.vessel_name, 'SAMPLE VESSEL');
  assert.equal(entry.new_state.vessel_name, 'SAMPLE VESSEL (CORRECTED)');
});

test('CAP-04: an update that changes nothing writes no audit row', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  const before = audit(c).length;
  await updateShipmentLeg(leg.id, { vessel_name: 'SAMPLE VESSEL' }, OPERATOR, opts(c));
  assert.equal(audit(c).length, before);
});

test('CAP-04: position and shipment cannot be changed by an update — supersede instead', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  for (const patch of [{ leg_sequence: 3 }, { shipment_id: 'ship-2' }, { created_by: 'u-x' }]) {
    await assert.rejects(() => updateShipmentLeg(leg.id, patch, OPERATOR, opts(c)), ValidationError, JSON.stringify(patch));
  }
});

test('CAP-04: a correction is validated exactly like a declaration', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await assert.rejects(() => updateShipmentLeg(leg.id, { imo: '9074728' }, OPERATOR, opts(c)), ValidationError);
  await assert.rejects(() => updateShipmentLeg(leg.id, { estimated_arrival_date: '2026-01-01T00:00:00Z' }, OPERATOR, opts(c)), ValidationError,
    'an estimate before the stored planned departure was accepted');
});

test('CAP-04: only an authorised caller may correct a leg', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await assert.rejects(() => updateShipmentLeg(leg.id, { vessel_name: 'HIJACK' }, BUYER, opts(c)), ForbiddenError);
  assert.equal(legs(c)[0].vessel_name, 'SAMPLE VESSEL');
});

test('CAP-04: a leg is superseded, never erased, and its position is freed for a replacement', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await supersedeShipmentLeg(leg.id, OPERATOR, opts(c));
  assert.equal(legs(c).length, 1, 'the superseded leg was erased');
  assert.ok(legs(c)[0].deleted_at);
  assert.ok(audit(c).some((a) => a.action === 'SHIPMENT_LEG_SUPERSEDED'));
  const replacement = await addShipmentLeg('ship-1', { vessel_name: 'REPLACEMENT', port_of_loading: 'Port A' }, OPERATOR, opts(c));
  assert.equal(replacement.leg_sequence, 1);
  assert.equal(legs(c).length, 2);
});

test('CAP-04: superseding twice, or correcting a superseded leg, is not found', async () => {
  const c = world();
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await supersedeShipmentLeg(leg.id, OPERATOR, opts(c));
  await assert.rejects(() => supersedeShipmentLeg(leg.id, OPERATOR, opts(c)), NotFoundError);
  await assert.rejects(() => updateShipmentLeg(leg.id, { vessel_name: 'X' }, OPERATOR, opts(c)), NotFoundError);
});

// ── Reading ───────────────────────────────────────────────────────────────

test('CAP-04: legs list in journey order and exclude superseded ones', async () => {
  const c = world();
  const a = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(c));
  await addShipmentLeg('ship-1', { vessel_name: 'SECOND', port_of_loading: 'Port B' }, OPERATOR, opts(c));
  await addShipmentLeg('ship-1', { vessel_name: 'THIRD', port_of_loading: 'Port C' }, OPERATOR, opts(c));
  await supersedeShipmentLeg(a.id, OPERATOR, opts(c));
  const live = await listLegsForShipment('ship-1', c);
  assert.deepEqual(live.map((l) => l.leg_sequence), [2, 3]);
});

test('CAP-04: the participant projection carries the declaration and never internals', () => {
  const p = projectLeg({
    id: 'leg-1', shipment_id: 'ship-1', tenant_id: 'tenant-1', leg_sequence: 1, carrier_name: 'C', vessel_name: 'V', voyage_ref: 'V1',
    imo: '9074729', mmsi: null, port_of_loading: 'A', port_of_discharge: 'B',
    planned_departure_date: '2026-08-29T00:00:00Z', estimated_arrival_date: '2026-09-18T00:00:00Z',
    source: 'DOCUMENT', source_reference: 'doc-mine', metadata: { internal: 'SECRET' }, created_by: 'u-operator', updated_by: 'u-x', deleted_at: null,
  });
  const text = JSON.stringify(p);
  for (const leak of ['SECRET', 'u-operator', 'u-x', 'tenant-1', 'doc-mine', 'shipment_id']) assert.ok(!text.includes(leak), `${leak} leaked`);
  assert.equal(p.sequence, 1);
  assert.equal(p.vessel_name, 'V');
  assert.equal(p.planned_departure, '2026-08-29T00:00:00Z');
  assert.equal(p.estimated_arrival, '2026-09-18T00:00:00Z');
  assert.equal(p.source, 'DOCUMENT');
  assert.ok(!('observed_departure' in p) && !('observed_arrival' in p), 'a leg projection asserted a sailing');
});

// ── It touches nothing it does not own ────────────────────────────────────

test('CAP-04: the service writes only legs and audit rows — never a shipment, a stage event or a document', async () => {
  const c = world();
  const writes = [];
  const trapped = {
    ...c,
    from(table) {
      const chain = c.from(table);
      return new Proxy(chain, {
        get(target, prop) {
          if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
  const leg = await addShipmentLeg('ship-1', VALID, OPERATOR, opts(trapped));
  await updateShipmentLeg(leg.id, { vessel_name: 'RENAMED' }, OPERATOR, opts(trapped));
  await supersedeShipmentLeg(leg.id, OPERATOR, opts(trapped));
  const tables = new Set(writes.map((w) => w.split(' ')[1]));
  assert.deepEqual([...tables].sort(), ['diaspora_import_audit_log', 'diaspora_shipment_legs']);
  assert.ok(!writes.some((w) => /delete /.test(w)), `a delete was issued: ${writes.join(', ')}`);
});
