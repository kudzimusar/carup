/**
 * Trade OS T10.4/T10.5 — convergence with the frozen phases.
 *
 * T10 creates no message authority and no file authority. A loading notice is a T7 governed
 * notification; a container photo is a T8 document under one added subject value.
 *
 * The emitter is INJECTED throughout, because asserting `result === null` proves nothing — that is
 * also what an unavailable outbox returns. Silence has to be proven by nothing being SENT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import * as listeners from '../services/communication/communicationEventListeners.js';
import * as policies from '../services/communication/communicationNotificationService.js';
import { LOADING_EVENTS, notifyCargoLoaded, notifyCargoLeftBehind } from '../services/diaspora/loadingLifecycleNotifier.js';
import { buildDocumentWorkspace, WORKSPACE_SUBJECTS } from '../services/diaspora/tradeDocumentWorkspaceService.js';
import { createLoadPlan, setPlanItem, confirmLoadPlan, openLoad, recordLoadItem } from '../services/diaspora/containerLoadService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-op' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const OUTSIDER = { id: 'user-outsider', platformRole: 'member' };

const CONTAINER = 'cont-1';
const RES_A = 'res-a';
const RES_B = 'res-b';

function world() {
  return createMockSupabase({
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', total_capacity_volume: 33, used_capacity_volume: 4.5, available_capacity_volume: 28.5, status: 'BOOKING_CLOSED', deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: RES_A, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3.0, reservation_status: 'APPROVED', deleted_at: null },
      { id: RES_B, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-b', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'other', estimated_volume: 1.5, reservation_status: 'APPROVED', deleted_at: null },
    ],
    diaspora_warehouse_intakes: [
      { id: 'in-a', tenant_id: 'tenant-op', warehouse_id: 'wh-1', subject_type: 'cargo_reservation', subject_id: RES_A, reference: 'WHIN-A', status: 'RECEIVED', condition: 'good', deleted_at: null },
      { id: 'in-b', tenant_id: 'tenant-op', warehouse_id: 'wh-1', subject_type: 'cargo_reservation', subject_id: RES_B, reference: 'WHIN-B', status: 'RECEIVED', condition: 'good', deleted_at: null },
    ],
    diaspora_warehouse_measurements: [
      { id: 'm-a', intake_id: 'in-a', actual_volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', deleted_at: null },
    ],
    trade_document_types: [
      { code: 'loading_photo', display_name: 'Loading photo', verification_required: false, deleted_at: null },
    ],
    diaspora_trade_documents: [],
    diaspora_trade_document_readiness: [],
    diaspora_container_load_plans: [],
    diaspora_container_load_plan_items: [],
    diaspora_container_loads: [],
    diaspora_container_load_items: [],
    diaspora_container_seal_records: [],
    diaspora_import_audit_log: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

function recorder() {
  const sent = [];
  return { sent, emit: async (_c, eventType, payload, tenantId) => { sent.push({ eventType, payload, tenantId }); return { id: `evt-${sent.length}` }; } };
}

async function loaded(client) {
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  await confirmLoadPlan(plan.id, OPERATOR, opts(client));
  return openLoad(CONTAINER, OPERATOR, opts(client));
}

// ── T7 convergence ─────────────────────────────────────────────────────────

test('T10/T7: both loading events are registered in the listener AND the policy', () => {
  for (const eventType of Object.values(LOADING_EVENTS)) {
    assert.ok(listeners.COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} must be subscribed`);
    const policy = (policies.NOTIFICATION_POLICIES || {})[eventType];
    assert.ok(policy, `${eventType} must have a policy`);
    assert.equal(policy.transactional, true);
  }
  // The customer whose cargo did NOT travel is the one waiting for goods that are not coming.
  assert.equal(policies.NOTIFICATION_POLICIES[LOADING_EVENTS.LEFT_BEHIND].priority, 'high');
  assert.equal(policies.NOTIFICATION_POLICIES[LOADING_EVENTS.LOADED].priority, 'normal');
});

test('T10/T7: the load-item id discriminates the outbox dedupe key', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/communication/communicationNotificationService.js', 'utf8'));
  assert.match(source, /payload\.loadItemId/,
    'without it, two consignments loaded for one person collapse into one notice');
});

test('T10/T7: the emitter literals are visible to the coverage gate', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/loadingLifecycleNotifier.js', 'utf8'));
  for (const eventType of Object.values(LOADING_EVENTS)) {
    assert.match(source, new RegExp(`emitEvent\\(null, '${eventType.replace(/\./g, '\\.')}'`),
      `${eventType} must be emitted with a LITERAL type — a threaded variable is invisible to communication-event-coverage`);
  }
});

test('T10/T7: recording a loaded line tells the owner, once', async () => {
  const rec = recorder();
  await notifyCargoLoaded({
    loadItem: { id: 'li-1', load_id: 'l-1', outcome: 'LOADED', subject_type: 'cargo_reservation', subject_id: RES_A, loaded_volume_cbm: 3.6 },
    load: { id: 'l-1', reference: 'LOAD-1', tenant_id: 'tenant-op' },
    // buyer_id and created_by are the same person — the ordinary case.
    recipients: ['user-customer', 'user-customer'],
    emitEvent: rec.emit,
  });
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].eventType, LOADING_EVENTS.LOADED);
  assert.match(rec.sent[0].payload.note, /does not mean the container has sailed/i);
});

test('T10/T7: a LEFT_BEHIND line carries the reason in plain words', async () => {
  const rec = recorder();
  await notifyCargoLeftBehind({
    loadItem: { id: 'li-2', load_id: 'l-1', outcome: 'LEFT_BEHIND', subject_type: 'cargo_reservation', subject_id: RES_B, left_behind_reason: 'NO_SPACE' },
    load: { id: 'l-1', reference: 'LOAD-1', tenant_id: 'tenant-op' },
    recipients: ['user-coloader'], emitEvent: rec.emit,
  });
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].payload.reasonCode, 'NO_SPACE');
  assert.match(rec.sent[0].payload.reason, /not enough room/i);
  // T10 records that it did not travel. What happens next is somebody's decision, not this notice's.
  assert.equal(rec.sent[0].payload.next_step_promised, false);
});

test('T10/T7: an unrecognised reason code yields NO sentence rather than a guess', async () => {
  const rec = recorder();
  await notifyCargoLeftBehind({
    loadItem: { id: 'li-3', load_id: 'l-1', outcome: 'LEFT_BEHIND', subject_type: 'cargo_reservation', subject_id: RES_B, left_behind_reason: 'SOMETHING_NEW' },
    load: { id: 'l-1', tenant_id: 't' }, recipients: ['user-coloader'], emitEvent: rec.emit,
  });
  assert.equal(rec.sent[0].payload.reason, null);
  assert.equal(rec.sent[0].payload.reasonCode, 'SOMETHING_NEW');
});

test('T10/T7: the notifiers refuse to speak about the wrong outcome', async () => {
  const rec = recorder();
  await notifyCargoLoaded({ loadItem: { id: 'x', outcome: 'LEFT_BEHIND' }, load: {}, recipients: ['u'], emitEvent: rec.emit });
  await notifyCargoLeftBehind({ loadItem: { id: 'x', outcome: 'LOADED' }, load: {}, recipients: ['u'], emitEvent: rec.emit });
  assert.deepEqual(rec.sent, [], 'nothing was SENT — not merely "the result was null"');
});

test('T10/T7: a loading notice carries no other participant, operator or capacity', async () => {
  const rec = recorder();
  await notifyCargoLoaded({
    loadItem: { id: 'li-1', load_id: 'l-1', outcome: 'LOADED', subject_type: 'cargo_reservation', subject_id: RES_A, loaded_volume_cbm: 3.6 },
    load: { id: 'l-1', reference: 'LOAD-1', tenant_id: 'tenant-op', confirmed_by: 'user-operator' },
    recipients: ['user-customer'], emitEvent: rec.emit,
  });
  const text = JSON.stringify(rec.sent[0].payload);
  assert.ok(!text.includes(RES_B), 'another participant appears');
  assert.ok(!text.includes('user-operator'), 'the operator is named to the customer');
  assert.ok(!text.includes('33'), 'the sailing capacity is exposed');
});

test('T10/T7: a notification failure does not unload the container', async () => {
  const client = world();
  const load = await loaded(client);
  // The real emitDomainEvent is unreachable in this suite; the manifest line still commits.
  const item = await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  assert.equal(item.outcome, 'LOADED');
  const { data } = await client.from('diaspora_container_load_items').select('*').eq('id', item.id).maybeSingle();
  assert.equal(data.outcome, 'LOADED', 'the cargo is in the container whether or not anybody was told');
});

// ── T8 convergence ─────────────────────────────────────────────────────────

test('T10/T8: container_load is a governed document subject — no second store exists', async () => {
  assert.ok(WORKSPACE_SUBJECTS.includes('container_load'));
  const migration = await import('node:fs').then((fs) => fs.promises.readFile('database/migrations/20260914090000_trade_os_t10_loading_evidence_binding.sql', 'utf8'));
  assert.match(migration, /container_load/);
  assert.ok(!/CREATE TABLE/i.test(migration), 'T10 evidence created a table of its own');
});

test('T10/T8: the operator can open the load\'s evidence', async () => {
  const client = world();
  const load = await loaded(client);
  const ws = await buildDocumentWorkspace('container_load', load.id, OPERATOR, opts(client));
  assert.equal(ws.viewer_role, 'operator');
});

test('T10/T8: a participant with cargo on the sailing can open it', async () => {
  const client = world();
  const load = await loaded(client);
  const ws = await buildDocumentWorkspace('container_load', load.id, CUSTOMER, opts(client));
  assert.equal(ws.viewer_role, 'participant');
});

test('T10/T8: somebody with no cargo on the sailing cannot', async () => {
  const client = world();
  const load = await loaded(client);
  await assert.rejects(() => buildDocumentWorkspace('container_load', load.id, OUTSIDER, opts(client)), /no cargo on this sailing/i);
});

test('T10/T8: a loading photo is PRESENT, never VERIFIED, and never a loaded fact', async () => {
  const client = world();
  const load = await loaded(client);
  await client.from('diaspora_trade_documents').insert({
    id: 'doc-1', subject_type: 'container_load', subject_id: load.id, document_type: 'loading_photo',
    verification_status: 'UPLOADED', uploaded_by: 'user-operator', version: 1, deleted_at: null, superseded_at: null,
  });
  const ws = await buildDocumentWorkspace('container_load', load.id, OPERATOR, opts(client));
  const photo = ws.items.find((i) => i.document_type === 'loading_photo');
  assert.equal(photo.state, 'PRESENT');

  // …and nothing has been loaded. A container with photos and no attributed line is not loaded.
  const { data: items } = await client.from('diaspora_container_load_items').select('*').eq('load_id', load.id);
  assert.equal((items || []).length, 0, 'a photo created a manifest line');
});

test('T10/T8: the loaded fact stands with no evidence at all', async () => {
  const client = world();
  const load = await loaded(client);
  const item = await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  assert.equal(item.outcome, 'LOADED');
  const ws = await buildDocumentWorkspace('container_load', load.id, OPERATOR, opts(client));
  assert.equal(ws.summary.supplied, 0, 'no image exists, and the load is complete without one');
});

test('T10/T8: every frozen subject still works — two extensions broke nothing', () => {
  for (const s of ['import_order', 'logistics_request', 'container_booking', 'trade_order', 'warehouse_intake']) {
    assert.ok(WORKSPACE_SUBJECTS.includes(s), `${s} is still a workspace subject`);
  }
});
