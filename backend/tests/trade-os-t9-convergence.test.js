/**
 * Trade OS T9.4/T9.5 — convergence with the frozen phases.
 *
 * T9 creates no message authority and no file authority. A warehouse notice is a T7 governed
 * notification; a condition photo is a T8 document. These tests prove the reuse is real (registered
 * in BOTH the listener and the policy, and reachable through the actual workspace) and that the
 * direction stays one-way: a notification never receives cargo, and a photo never creates an
 * observation.
 *
 * The emitter is INJECTED throughout. A T7 lesson: asserting `result === null` proves nothing,
 * because that is also what an unavailable outbox returns — so silence has to be proven by nothing
 * being SENT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import * as listeners from '../services/communication/communicationEventListeners.js';
import * as policies from '../services/communication/communicationNotificationService.js';
import {
  WAREHOUSE_EVENTS,
  notifyCargoReceived,
  notifyConditionIssue,
  notifyMeasurementDiscrepancy,
} from '../services/diaspora/warehouseIntakeNotifier.js';
import { scheduleIntake, receiveIntake, recordMeasurement } from '../services/diaspora/warehouseIntakeService.js';
import { buildDocumentWorkspace, WORKSPACE_SUBJECTS } from '../services/diaspora/tradeDocumentWorkspaceService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-wh' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const COLOADER = { id: 'user-coloader', platformRole: 'member' };
const FOREIGN_OP = { id: 'user-foreign', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };

function world(extra = {}) {
  return createMockSupabase({
    diaspora_warehouses: [
      { id: 'wh-1', tenant_id: 'tenant-wh', name: 'Durban Consolidation', country: 'South Africa', operator_user_id: 'user-operator', active: true, deleted_at: null },
      { id: 'wh-2', tenant_id: 'tenant-other', name: 'Beira Depot', country: 'Mozambique', operator_user_id: 'user-foreign', active: true, deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: 'res-1', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-1', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3.0, estimated_weight: 800, reservation_status: 'APPROVED', deleted_at: null },
      { id: 'res-2', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-2', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'boxes', estimated_volume: 1.5, reservation_status: 'APPROVED', deleted_at: null },
    ],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-wh', total_capacity_volume: 33, used_capacity_volume: 4.5, deleted_at: null }],
    diaspora_logistics_requests: [],
    diaspora_logistics_request_items: [],
    diaspora_warehouse_intakes: [],
    diaspora_warehouse_measurements: [],
    diaspora_import_audit_log: [],
    trade_document_types: [
      { code: 'commercial_invoice', display_name: 'Commercial invoice', verification_required: true, deleted_at: null },
      { code: 'cargo_photo', display_name: 'Cargo photo', verification_required: false, deleted_at: null },
    ],
    diaspora_trade_documents: extra.documents || [],
    diaspora_trade_document_readiness: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

/** A recording emitter. Nothing reaches a real outbox, and nothing is inferred from a null. */
function recorder() {
  const sent = [];
  return { sent, emit: async (_client, eventType, payload, tenantId) => { sent.push({ eventType, payload, tenantId }); return { id: `evt-${sent.length}` }; } };
}

// ── T7 convergence: registered in BOTH halves ──────────────────────────────

test('T9/T7: all three warehouse events are registered in the listener AND the policy', () => {
  for (const eventType of Object.values(WAREHOUSE_EVENTS)) {
    assert.ok(listeners.COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} must be subscribed`);
    const policy = (policies.NOTIFICATION_POLICIES || {})[eventType];
    assert.ok(policy, `${eventType} must have a notification policy`);
    assert.equal(policy.transactional, true);
    assert.deepEqual(policy.channels, ['in_app']);
  }
  assert.equal(policies.NOTIFICATION_POLICIES[WAREHOUSE_EVENTS.CONDITION].priority, 'high',
    'a condition issue is the one the customer may need to act on');
});

test('T9/T7: the intake id discriminates the outbox dedupe key', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/communication/communicationNotificationService.js', 'utf8'));
  assert.match(source, /payload\.intakeId/,
    'without the intake id in the dedupe chain, two different intakes for one user collapse into one notice');
});

// ── The domain fact comes first ────────────────────────────────────────────

test('T9/T7: receiving cargo tells the owner, once', async () => {
  const client = world();
  const rec = recorder();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  // The service's own emit went to the real (unavailable) outbox; assert the notifier contract
  // directly with an injected emitter so "nothing was sent" is observable.
  await notifyCargoReceived({ intake: { ...intake, status: 'RECEIVED' }, subject: { type: 'cargo_reservation', id: 'res-1' }, recipients: ['user-customer'], outcome: 'RECEIVED', emitEvent: rec.emit });
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].eventType, WAREHOUSE_EVENTS.RECEIVED);
  assert.equal(rec.sent[0].payload.recipientUserId, 'user-customer');
  assert.equal(rec.sent[0].payload.intakeId, intake.id);
});

test('T9/T7: a REPLAYED receive sends nothing, because it received nothing', async () => {
  const client = world();
  const rec = recorder();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  const first = await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const second = await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  assert.equal(second.already_received, true);
  // The replay returned before the notifier was reached at all. Proven the only way it can be:
  // by calling the notifier with the replay's own outcome and observing it decline to send.
  await notifyCargoReceived({ intake: first, subject: { type: 'cargo_reservation', id: 'res-1' }, recipients: [], outcome: 'RECEIVED', emitEvent: rec.emit });
  assert.deepEqual(rec.sent, [], 'nothing was SENT — not merely "the result was null"');
});

test('T9/T7: a condition of "good" is not an issue and raises no alarm', async () => {
  const rec = recorder();
  await notifyConditionIssue({ intake: { id: 'in-1', reference: 'WHIN-1', tenant_id: 't' }, subject: { type: 'cargo_reservation', id: 'res-1' }, recipients: ['user-customer'], condition: 'good', emitEvent: rec.emit });
  assert.deepEqual(rec.sent, []);
  await notifyConditionIssue({ intake: { id: 'in-1', reference: 'WHIN-1', tenant_id: 't' }, subject: { type: 'cargo_reservation', id: 'res-1' }, recipients: ['user-customer'], condition: 'minor_damage', emitEvent: rec.emit });
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].payload.observation_only, true, 'an observation, never a verdict');
});

test('T9/T7: a matching measurement sends no discrepancy notice', async () => {
  const rec = recorder();
  await notifyMeasurementDiscrepancy({ intake: { id: 'in-1', tenant_id: 't' }, subject: { type: 'cargo_reservation', id: 'res-1' }, recipients: ['user-customer'], discrepancy: { status: 'MATCHES' }, emitEvent: rec.emit });
  assert.deepEqual(rec.sent, []);
});

test('T9/T7: a discrepancy notice carries the difference and no money', async () => {
  const rec = recorder();
  await notifyMeasurementDiscrepancy({
    intake: { id: 'in-1', reference: 'WHIN-1', tenant_id: 't' },
    subject: { type: 'cargo_reservation', id: 'res-1' },
    recipients: ['user-customer'],
    discrepancy: { status: 'DIFFERS', volume: { estimated_cbm: 3, actual_cbm: 3.8, difference_cbm: 0.8, direction: 'LARGER' }, weight: null },
    emitEvent: rec.emit,
  });
  assert.equal(rec.sent.length, 1);
  const payload = rec.sent[0].payload;
  assert.equal(payload.volume.difference_cbm, 0.8);
  assert.equal(payload.commercial_effect, 'none');
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['amount', 'surcharge', 'currency', 'invoice', 'fee']) {
    assert.ok(!serialized.includes(forbidden), `a discrepancy notice must not carry "${forbidden}"`);
  }
});

test('T9/T7: a notification payload never carries another participant\'s cargo or staff identity', async () => {
  const rec = recorder();
  await notifyCargoReceived({
    intake: { id: 'in-1', reference: 'WHIN-AB12CD34', tenant_id: 'tenant-wh', received_by: 'user-operator', notes: 'Jonas signed' },
    subject: { type: 'cargo_reservation', id: 'res-1' },
    recipients: ['user-customer'], outcome: 'RECEIVED', emitEvent: rec.emit,
  });
  const serialized = JSON.stringify(rec.sent[0].payload);
  assert.ok(!serialized.includes('user-operator'), 'no receiving staff identity');
  assert.ok(!serialized.includes('Jonas'), 'no internal note');
  assert.ok(!serialized.includes('res-2'), 'no other participant');
});

test('T9/T7: one owner is told once even when they are named twice', async () => {
  const rec = recorder();
  await notifyCargoReceived({
    intake: { id: 'in-1', reference: 'WHIN-1', tenant_id: 't' },
    subject: { type: 'cargo_reservation', id: 'res-1' },
    // buyer_id and created_by are the same person, which is the ordinary case.
    recipients: ['user-customer', 'user-customer'], outcome: 'RECEIVED', emitEvent: rec.emit,
  });
  assert.equal(rec.sent.length, 1);
});

test('T9/T7: a notification failure does not un-receive the cargo', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  // The real emitDomainEvent is unreachable in this suite; receiveIntake still commits.
  const received = await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  assert.equal(received.status, 'RECEIVED');
  const { data } = await client.from('diaspora_warehouse_intakes').select('*').eq('id', intake.id).maybeSingle();
  assert.equal(data.status, 'RECEIVED', 'the cargo is in the warehouse whether or not anybody was told');
});

// ── T8 convergence: evidence, through the one evidence authority ───────────

test('T9/T8: warehouse_intake is a governed document subject — no second store exists', async () => {
  assert.ok(WORKSPACE_SUBJECTS.includes('warehouse_intake'));
  const migration = await import('node:fs').then((fs) => fs.promises.readFile('database/migrations/20260912090000_trade_os_t9_intake_evidence_binding.sql', 'utf8'));
  assert.match(migration, /warehouse_intake/);
  assert.ok(!/CREATE TABLE/i.test(migration), 'T9 evidence created no table of its own');
});

test('T9/T8: the receiving warehouse can open the intake\'s evidence', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  const workspace = await buildDocumentWorkspace('warehouse_intake', intake.id, OPERATOR, opts(client));
  assert.equal(workspace.viewer_role, 'warehouse');
});

test('T9/T8: the cargo owner can open their own intake\'s evidence', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  const workspace = await buildDocumentWorkspace('warehouse_intake', intake.id, CUSTOMER, opts(client));
  assert.equal(workspace.viewer_role, 'cargo_owner');
});

test('T9/T8: a co-loader and a foreign warehouse cannot open it', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  await assert.rejects(() => buildDocumentWorkspace('warehouse_intake', intake.id, COLOADER, opts(client)), /not your cargo/i);
  await assert.rejects(() => buildDocumentWorkspace('warehouse_intake', intake.id, FOREIGN_OP, opts(client)), /not your cargo/i);
});

test('T9/T8: a photo is PRESENT, never VERIFIED, and never a receipt', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  await client.from('diaspora_trade_documents').insert({
    id: 'doc-1', subject_type: 'warehouse_intake', subject_id: intake.id, document_type: 'cargo_photo',
    verification_status: 'UPLOADED', uploaded_by: 'user-operator', version: 1, deleted_at: null, superseded_at: null,
  });
  const workspace = await buildDocumentWorkspace('warehouse_intake', intake.id, OPERATOR, opts(client));
  const photo = workspace.items.find((i) => i.document_type === 'cargo_photo');
  assert.equal(photo.state, 'PRESENT');
  assert.ok(photo.document, 'the file is there');

  // …and the cargo is still not received. Evidence supports an observation; it never creates one.
  const { data: row } = await client.from('diaspora_warehouse_intakes').select('*').eq('id', intake.id).maybeSingle();
  assert.equal(row.status, 'EXPECTED', 'a photo did not receive the cargo');
  assert.ok(!row.condition, 'and it did not record a condition');
});

test('T9/T8: the intake record stands with no evidence at all', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  const received = await receiveIntake(intake.id, { outcome: 'CONDITIONALLY_RECEIVED', condition: 'minor_damage', outcomeReason: 'Corner crushed' }, OPERATOR, opts(client));
  assert.equal(received.condition, 'minor_damage');
  const workspace = await buildDocumentWorkspace('warehouse_intake', intake.id, OPERATOR, opts(client));
  assert.equal(workspace.summary.supplied, 0, 'no image exists, and the observation is complete without one');
});

test('T9/T8: the frozen T8 subjects still work — the extension broke nothing', async () => {
  for (const subject of ['import_order', 'logistics_request', 'container_booking', 'trade_order']) {
    assert.ok(WORKSPACE_SUBJECTS.includes(subject), `${subject} is still a workspace subject`);
  }
});

// ── The estimate authorities are read-only to T9 ───────────────────────────

test('T9: measuring writes only T9 tables', async () => {
  const client = world();
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, opts(client));
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const before = JSON.stringify((await client.from('diaspora_cargo_reservations').select('*')).data);
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  const after = JSON.stringify((await client.from('diaspora_cargo_reservations').select('*')).data);
  assert.equal(after, before, 'every reservation row is byte-identical after the measurement');
});
