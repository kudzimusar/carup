/**
 * Trade OS T10.2 — load readiness, the plan, and the loaded fact.
 *
 * Written against the sentences the phase has to be able to say. The five that carry it:
 *
 *   1. an APPROVED booking is not received cargo, and received cargo is not loaded cargo;
 *   2. a PLAN is not a LOAD — planning something in does not put it in;
 *   3. loading is an attributed act, and the loader is the authenticated actor;
 *   4. all THREE measurements survive: booked 3.0, warehouse 3.8, loaded 3.6;
 *   5. LOADED is not DEPARTED, and nothing here can say otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  deriveReadiness,
  getLoadReadiness,
  getContainerLoadState,
  createLoadPlan,
  setPlanItem,
  confirmLoadPlan,
  openLoad,
  recordLoadItem,
  completeLoad,
  recordSeal,
  getMyLoadStatus,
  projectPlanPressure,
  READINESS_BLOCKERS,
} from '../services/diaspora/containerLoadService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-op' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const COLOADER = { id: 'user-coloader', platformRole: 'member' };
const OUTSIDER = { id: 'user-outsider', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };

const CONTAINER = 'cont-1';
const RES_A = 'res-a';   // received + measured 3.8, booked 3.0  → ready
const RES_B = 'res-b';   // received, never measured             → not ready
const RES_C = 'res-c';   // approved, never received             → not ready

function world(over = {}) {
  return createMockSupabase({
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', total_capacity_volume: 33, used_capacity_volume: 5.5, available_capacity_volume: 27.5, status: 'BOOKING_CLOSED', deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: RES_A, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3.0, estimated_weight: 800, reservation_status: 'APPROVED', deleted_at: null },
      { id: RES_B, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-b', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'other', estimated_volume: 1.5, reservation_status: 'APPROVED', deleted_at: null },
      { id: RES_C, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-c', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 1.0, reservation_status: 'APPROVED', deleted_at: null },
      ...(over.reservations || []),
    ],
    diaspora_warehouse_intakes: [
      { id: 'in-a', tenant_id: 'tenant-op', warehouse_id: 'wh-1', subject_type: 'cargo_reservation', subject_id: RES_A, reference: 'WHIN-A', status: 'RECEIVED', received_by: 'user-staff', received_at: '2026-09-10T09:00:00Z', condition: 'good', deleted_at: null },
      { id: 'in-b', tenant_id: 'tenant-op', warehouse_id: 'wh-1', subject_type: 'cargo_reservation', subject_id: RES_B, reference: 'WHIN-B', status: 'RECEIVED', received_by: 'user-staff', received_at: '2026-09-10T09:00:00Z', condition: 'good', deleted_at: null },
      ...(over.intakes || []),
    ],
    diaspora_warehouse_measurements: [
      { id: 'm-a', intake_id: 'in-a', actual_volume_cbm: 3.8, weight_value: 900, weight_unit: 'kg', measured_at: '2026-09-10T10:00:00Z', deleted_at: null },
      ...(over.measurements || []),
    ],
    diaspora_trade_documents: over.documents || [],
    diaspora_container_load_plans: [],
    diaspora_container_load_plan_items: [],
    diaspora_container_loads: [],
    diaspora_container_load_items: [],
    diaspora_container_seal_records: [],
    diaspora_import_audit_log: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

// ── 1. Readiness is derived, and always says why ───────────────────────────

test('T10: readiness names its blockers rather than returning a magic false', () => {
  const notApproved = deriveReadiness({ reservation: { reservation_status: 'REQUESTED' }, intake: null, measurement: null });
  assert.equal(notApproved.ready, false);
  const codes = notApproved.blockers.map((b) => b.code);
  assert.deepEqual(codes, ['NOT_APPROVED', 'NOT_RECEIVED', 'NOT_MEASURED']);
  for (const b of notApproved.blockers) assert.equal(b.reason, READINESS_BLOCKERS[b.code]);
});

test('T10: an APPROVED booking is NOT ready — being booked is not being here', () => {
  const r = deriveReadiness({ reservation: { reservation_status: 'APPROVED' }, intake: null, measurement: null });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.code === 'NOT_RECEIVED'));
});

test('T10: received but unmeasured is NOT ready', () => {
  const r = deriveReadiness({
    reservation: { reservation_status: 'APPROVED' },
    intake: { status: 'RECEIVED', condition: 'good' }, measurement: null,
  });
  assert.equal(r.ready, false);
  assert.deepEqual(r.blockers.map((b) => b.code), ['NOT_MEASURED']);
  assert.equal(r.facts.measured_volume_cbm, null, 'an unmeasured volume is null, never 0');
});

test('T10: approved + received + measured IS ready — the positive control', () => {
  const r = deriveReadiness({
    reservation: { reservation_status: 'APPROVED' },
    intake: { status: 'RECEIVED', condition: 'good' },
    measurement: { actual_volume_cbm: 3.8 },
  });
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
});

test('T10: refused cargo is refused, not merely absent', () => {
  const r = deriveReadiness({ reservation: { reservation_status: 'APPROVED' }, intake: { status: 'REFUSED' }, measurement: null });
  assert.ok(r.blockers.some((b) => b.code === 'REFUSED_AT_INTAKE'));
});

test('T10: a noted condition is surfaced as a blocker the operator can see and override', () => {
  const r = deriveReadiness({
    reservation: { reservation_status: 'APPROVED' },
    intake: { status: 'CONDITIONALLY_RECEIVED', condition: 'minor_damage' },
    measurement: { actual_volume_cbm: 3.8 },
  });
  assert.ok(r.blockers.some((b) => b.code === 'CONDITION_NOTED'));
});

test('T10: readiness never claims customs or legal clearance', () => {
  const r = deriveReadiness({
    reservation: { reservation_status: 'APPROVED' },
    intake: { status: 'RECEIVED', condition: 'good' },
    measurement: { actual_volume_cbm: 3.8 },
    documentCount: 3,
  });
  assert.equal(r.facts.documents_present, 3, 'documents are COUNTED');
  const text = JSON.stringify(r).toLowerCase();
  for (const forbidden of ['customs ready', 'cleared', 'compliant', 'legally', 'permitted to']) {
    assert.ok(!text.includes(forbidden), `readiness must not say "${forbidden}"`);
  }
  assert.match(r.disclaimer, /not a statement about customs/i);
});

test('T10: readiness is DERIVED, not stored — no column holds it', async () => {
  const client = world();
  await getLoadReadiness(CONTAINER, OPERATOR, opts(client));
  for (const table of ['diaspora_container_load_plans', 'diaspora_container_loads', 'diaspora_container_load_items']) {
    const { data } = await client.from(table).select('*');
    assert.equal((data || []).length, 0, `reading readiness wrote a row into ${table}`);
  }
});

// ── 2. The queue shows all three numbers ───────────────────────────────────

test('T10: the readiness queue shows booked and warehouse volumes side by side', async () => {
  const client = world();
  const q = await getLoadReadiness(CONTAINER, OPERATOR, opts(client));
  const a = q.candidates.find((c) => c.subject.id === RES_A);
  assert.equal(a.booked_volume_cbm, 3);
  assert.equal(a.warehouse_volume_cbm, 3.8);
  assert.equal(a.readiness.ready, true);

  const b = q.candidates.find((c) => c.subject.id === RES_B);
  assert.equal(b.warehouse_volume_cbm, null, 'unmeasured is null, not zero');
  assert.equal(b.readiness.ready, false);

  assert.equal(q.summary.ready, 1);
  assert.equal(q.summary.not_ready, 2);
  assert.equal(q.summary.unmeasured, 2, 'the count of unmeasured consignments is reported');
});

test('T10: the queue reports T5 booked capacity, labelled as booked', async () => {
  const client = world();
  const q = await getLoadReadiness(CONTAINER, OPERATOR, opts(client));
  assert.equal(q.container.booked_capacity.used_cbm, 5.5);
  assert.match(q.container.booked_capacity.basis, /not what has been measured or loaded/i);
});

// ── 3. A plan is not a load ────────────────────────────────────────────────

test('T10: planning cargo in does NOT load it', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  const { data: loadItems } = await client.from('diaspora_container_load_items').select('*');
  assert.equal((loadItems || []).length, 0, 'a plan line created a manifest line');
  const mine = await getMyLoadStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, 'NOT_STARTED', 'the customer was told their cargo was loaded because it was planned');
});

test('T10: a plan line records WHICH number it was planned against', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  const measured = await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  assert.equal(Number(measured.planned_volume_cbm), 3.8);
  assert.equal(measured.planned_source, 'WAREHOUSE_ACTUAL');

  const estimated = await setPlanItem(plan.id, { subjectId: RES_B, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  assert.equal(Number(estimated.planned_volume_cbm), 1.5);
  assert.equal(estimated.planned_source, 'BOOKED_ESTIMATE', 'planning on an estimate must say so');
});

test('T10: a client-supplied planned volume is ignored — the server derives it', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  const item = await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN', planned_volume_cbm: 0.1, plannedVolumeCbm: 0.1 }, OPERATOR, opts(client));
  assert.equal(Number(item.planned_volume_cbm), 3.8);
});

test('T10: excluding cargo from the plan needs a bounded reason', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await assert.rejects(
    () => setPlanItem(plan.id, { subjectId: RES_C, disposition: 'PLANNED_OUT' }, OPERATOR, opts(client)),
    /say why this cargo is being left off/i,
  );
  await assert.rejects(
    () => setPlanItem(plan.id, { subjectId: RES_C, disposition: 'PLANNED_OUT', exclusionReason: 'we felt like it' }, OPERATOR, opts(client)),
    /say why this cargo is being left off/i,
  );
  const ok = await setPlanItem(plan.id, { subjectId: RES_C, disposition: 'PLANNED_OUT', exclusionReason: 'NOT_RECEIVED' }, OPERATOR, opts(client));
  assert.equal(ok.exclusion_reason, 'NOT_RECEIVED');
  assert.equal(ok.planned_volume_cbm, null, 'an excluded line carries no volume');
});

test('T10: a plan with nothing planned in cannot be confirmed', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await setPlanItem(plan.id, { subjectId: RES_C, disposition: 'PLANNED_OUT', exclusionReason: 'NOT_RECEIVED' }, OPERATOR, opts(client));
  await assert.rejects(() => confirmLoadPlan(plan.id, OPERATOR, opts(client)), /nothing planned in/i);
});

test('T10: confirming a plan is attributed, and a confirmed plan is not editable', async () => {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  const confirmed = await confirmLoadPlan(plan.id, OPERATOR, opts(client));
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.confirmed_by, 'user-operator');
  assert.ok(confirmed.confirmed_at);
  await assert.rejects(
    () => setPlanItem(plan.id, { subjectId: RES_B, disposition: 'PLANNED_IN' }, OPERATOR, opts(client)),
    /supersede it with a revision/i,
  );
});

test('T10: opening a plan twice yields ONE plan', async () => {
  const client = world();
  const first = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  const second = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  assert.equal(second.id, first.id);
  assert.equal(second.already_existed, true);
});

// ── 3b. Capacity pressure — a plan may be refused, an observation may not ──

test('T10: an impossible PLAN is refused, and the refusal says by how much', () => {
  const p = projectPlanPressure({ total_capacity_volume: 5 }, [
    { disposition: 'PLANNED_IN', planned_volume_cbm: 3.8 },
    { disposition: 'PLANNED_IN', planned_volume_cbm: 2.5 },
  ]);
  assert.equal(p.over_capacity, true);
  assert.equal(p.planned_in_cbm, 6.3);
  assert.equal(p.over_by_cbm, 1.3);
  assert.equal(p.headroom_cbm, 0);
});

test('T10: an excluded line does not count against capacity', () => {
  const p = projectPlanPressure({ total_capacity_volume: 5 }, [
    { disposition: 'PLANNED_IN', planned_volume_cbm: 3.8 },
    { disposition: 'PLANNED_OUT', planned_volume_cbm: null },
  ]);
  assert.equal(p.over_capacity, false);
  assert.equal(p.headroom_cbm, 1.2);
});

test('T10: unmeasured planned lines are COUNTED, not treated as zero', () => {
  const p = projectPlanPressure({ total_capacity_volume: 33 }, [
    { disposition: 'PLANNED_IN', planned_volume_cbm: 3.8 },
    { disposition: 'PLANNED_IN', planned_volume_cbm: null },
  ]);
  assert.equal(p.planned_in_cbm, 3.8);
  assert.equal(p.lines_without_volume, 1);
  assert.match(p.note, /floor rather than the whole plan/i);
});

test('T10: confirming an over-capacity plan is REFUSED with the overage named', async () => {
  const client = createMockSupabase({
    diaspora_container_shipments: [
      { id: 'small', tenant_id: 'tenant-op', coordinator_id: 'user-operator', total_capacity_volume: 4, used_capacity_volume: 0, available_capacity_volume: 4, status: 'BOOKING_CLOSED', deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: 'r1', tenant_id: 'tenant-op', container_id: 'small', import_order_id: 'o1', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3.0, reservation_status: 'APPROVED', deleted_at: null },
      { id: 'r2', tenant_id: 'tenant-op', container_id: 'small', import_order_id: 'o2', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'other', estimated_volume: 2.0, reservation_status: 'APPROVED', deleted_at: null },
    ],
    diaspora_warehouse_intakes: [
      { id: 'i1', tenant_id: 'tenant-op', warehouse_id: 'wh', subject_type: 'cargo_reservation', subject_id: 'r1', reference: 'W1', status: 'RECEIVED', condition: 'good', deleted_at: null },
      { id: 'i2', tenant_id: 'tenant-op', warehouse_id: 'wh', subject_type: 'cargo_reservation', subject_id: 'r2', reference: 'W2', status: 'RECEIVED', condition: 'good', deleted_at: null },
    ],
    diaspora_warehouse_measurements: [
      { id: 'm1', intake_id: 'i1', actual_volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', deleted_at: null },
      { id: 'm2', intake_id: 'i2', actual_volume_cbm: 2.5, measured_at: '2026-09-10T10:00:00Z', deleted_at: null },
    ],
    diaspora_trade_documents: [],
    diaspora_container_load_plans: [], diaspora_container_load_plan_items: [],
    diaspora_container_loads: [], diaspora_container_load_items: [], diaspora_container_seal_records: [],
    diaspora_import_audit_log: [],
  });
  const o = opts(client);
  const plan = await createLoadPlan('small', {}, OPERATOR, o);
  await setPlanItem(plan.id, { subjectId: 'r1', disposition: 'PLANNED_IN' }, OPERATOR, o);
  await setPlanItem(plan.id, { subjectId: 'r2', disposition: 'PLANNED_IN' }, OPERATOR, o);

  // 3.8 + 2.5 = 6.3 into a 4.0 CBM container.
  await assert.rejects(
    () => confirmLoadPlan(plan.id, OPERATOR, o),
    /1.3 CBM too much|too much/i,
  );
  const { data: after } = await client.from('diaspora_container_load_plans').select('*').eq('id', plan.id).maybeSingle();
  assert.equal(after.status, 'DRAFT', 'the plan was confirmed anyway');

  // T5's ledger is untouched by the refusal — the system did not "make room".
  const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', 'small').maybeSingle();
  assert.equal(Number(c.available_capacity_volume), 4);
  assert.equal(Number(c.total_capacity_volume), 4);

  // The governed resolution: take something out, with a reason. Then it confirms.
  await setPlanItem(plan.id, { subjectId: 'r2', disposition: 'PLANNED_OUT', exclusionReason: 'DOES_NOT_FIT' }, OPERATOR, o);
  const confirmed = await confirmLoadPlan(plan.id, OPERATOR, o);
  assert.equal(confirmed.status, 'CONFIRMED');
});

test('T10: the refusal invents no commercial consequence', async () => {
  const p = projectPlanPressure({ total_capacity_volume: 4 }, [{ disposition: 'PLANNED_IN', planned_volume_cbm: 6.3 }]);
  const text = JSON.stringify(p).toLowerCase();
  for (const forbidden of ['refund', 'charge', 'price', 'surcharge', 'next sailing', 'rebook', 'settle']) {
    assert.ok(!text.includes(forbidden), `capacity pressure must not mention "${forbidden}"`);
  }
});

// ── 4. Loading is an attributed act ────────────────────────────────────────

async function loadedWorld() {
  const client = world();
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, opts(client));
  await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, opts(client));
  await confirmLoadPlan(plan.id, OPERATOR, opts(client));
  const load = await openLoad(CONTAINER, OPERATOR, opts(client));
  return { client, plan, load };
}

test('T10: a loaded line names the authenticated loader, not the body', async () => {
  const { client, load } = await loadedWorld();
  const item = await recordLoadItem(load.id, {
    subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6,
    loaded_by: 'user-customer', loadedBy: 'user-customer',
  }, OPERATOR, opts(client));
  assert.equal(item.loaded_by, 'user-operator');
  assert.ok(item.loaded_at);
  assert.equal(Number(item.loaded_volume_cbm), 3.6);
});

test('T10: cargo the warehouse never received cannot be loaded', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(
    () => recordLoadItem(load.id, { subjectId: RES_C, outcome: 'LOADED' }, OPERATOR, opts(client)),
    /has not been received at a warehouse/i,
  );
});

test('T10: cargo not booked on this sailing cannot be put on its manifest', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(
    () => recordLoadItem(load.id, { subjectId: 'res-somewhere-else', outcome: 'LOADED' }, OPERATOR, opts(client)),
    /not booked on this sailing/i,
  );
});

test('T10: leaving cargo behind needs a bounded reason and keeps it on the manifest', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(
    () => recordLoadItem(load.id, { subjectId: RES_B, outcome: 'LEFT_BEHIND' }, OPERATOR, opts(client)),
    /say why this cargo was not loaded/i,
  );
  const left = await recordLoadItem(load.id, { subjectId: RES_B, outcome: 'LEFT_BEHIND', leftBehindReason: 'NO_SPACE' }, OPERATOR, opts(client));
  assert.equal(left.outcome, 'LEFT_BEHIND');
  assert.equal(left.left_behind_reason, 'NO_SPACE');
  assert.equal(left.loaded_volume_cbm, null, 'left-behind cargo has no loaded volume');
  const { data } = await client.from('diaspora_container_load_items').select('*').eq('load_id', load.id);
  assert.equal(data.length, 1, 'the line is on the manifest, not deleted from it');
});

test('T10: an ACTUAL load is NOT refused on capacity — an observation is not a claim', async () => {
  const { client, load } = await loadedWorld();
  // The container is 33 CBM and this says 40 went in. That is almost certainly a typo — and it is
  // still not the system's call. If a person watched it happen, the system records what they saw;
  // refusing would make them write the truth down somewhere the system cannot see.
  const item = await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 40 }, OPERATOR, opts(client));
  assert.equal(Number(item.loaded_volume_cbm), 40);
  // …and T5's ledger is still untouched by it.
  const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', CONTAINER).maybeSingle();
  assert.equal(Number(c.used_capacity_volume), 5.5);
});

test('T10: completing a load derives the total from what was LOADED', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await recordLoadItem(load.id, { subjectId: RES_B, outcome: 'LEFT_BEHIND', leftBehindReason: 'NO_SPACE' }, OPERATOR, opts(client));
  const done = await completeLoad(load.id, {}, OPERATOR, opts(client));
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.confirmed_by, 'user-operator');
  assert.equal(Number(done.actual_loaded_volume_cbm), 3.6, 'the left-behind line contributed nothing');
});

test('T10: a total is only stated when every loaded line has a figure', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  // RES_B was received but never measured, so there is no figure for it — and none is invented.
  await recordLoadItem(load.id, { subjectId: RES_B, outcome: 'LOADED' }, OPERATOR, opts(client));
  const done = await completeLoad(load.id, {}, OPERATOR, opts(client));
  assert.equal(done.actual_loaded_volume_cbm, null, 'a partial total was stated as if it were complete');
});

test('T10: a load with nothing loaded cannot be completed', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(() => completeLoad(load.id, {}, OPERATOR, opts(client)), /nothing has been recorded as loaded/i);
});

test('T10: completing twice does not complete twice', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  const first = await completeLoad(load.id, {}, OPERATOR, opts(client));
  const second = await completeLoad(load.id, {}, OPERATOR, opts(client));
  assert.equal(second.already_completed, true);
  assert.equal(second.confirmed_at, first.confirmed_at);
});

// ── 5. The three measurements ──────────────────────────────────────────────

test('T10: BOOKED 3.0, WAREHOUSE 3.8 and LOADED 3.6 all survive together', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await completeLoad(load.id, {}, OPERATOR, opts(client));

  const { data: res } = await client.from('diaspora_cargo_reservations').select('*').eq('id', RES_A).maybeSingle();
  assert.equal(Number(res.estimated_volume), 3.0, 'the booking estimate moved');
  const { data: m } = await client.from('diaspora_warehouse_measurements').select('*').eq('id', 'm-a').maybeSingle();
  assert.equal(Number(m.actual_volume_cbm), 3.8, 'the warehouse measurement moved');
  const { data: item } = await client.from('diaspora_container_load_items').select('*').eq('subject_id', RES_A).maybeSingle();
  assert.equal(Number(item.loaded_volume_cbm), 3.6);
});

test('T10: no T10 action writes T5 capacity, the estimate, or a T9 measurement — proven by trap', async () => {
  const client = world();
  const forbidden = new Set(['diaspora_cargo_reservations', 'diaspora_container_shipments', 'diaspora_warehouse_intakes', 'diaspora_warehouse_measurements']);
  const writes = [];
  const trapped = {
    ...client,
    from(table) {
      const chain = client.from(table);
      return new Proxy(chain, {
        get(target, prop) {
          if (['insert', 'update', 'delete', 'upsert'].includes(prop) && forbidden.has(table)) writes.push(`${prop} ${table}`);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
  const o = { supabaseClient: trapped };
  const plan = await createLoadPlan(CONTAINER, {}, OPERATOR, o);
  await setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, OPERATOR, o);
  await confirmLoadPlan(plan.id, OPERATOR, o);
  const load = await openLoad(CONTAINER, OPERATOR, o);
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, o);
  await completeLoad(load.id, {}, OPERATOR, o);
  await recordSeal(load.id, { containerNumber: 'MSKU1234567', sealNumber: 'SEAL-1' }, OPERATOR, o);
  await getLoadReadiness(CONTAINER, OPERATOR, o);
  assert.deepEqual(writes, [], 'T10 wrote into another phase\'s authority');
});

// ── 6. The T11 firewall ────────────────────────────────────────────────────

test('T10: completing a load says nothing about departure', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await completeLoad(load.id, {}, OPERATOR, opts(client));
  const state = await getContainerLoadState(CONTAINER, OPERATOR, opts(client));
  // The prose fields are allowed — required, in fact — to NAME the boundary they refuse to cross.
  // The ban is on the DATA claiming it. Stripping them and then asserting them separately is the
  // difference between a firewall and a word filter.
  const stripped = JSON.parse(JSON.stringify(state));
  delete stripped.note;
  delete stripped.candidates;
  const text = JSON.stringify(stripped).toLowerCase();
  for (const later of ['departed', 'shipped', 'in transit', 'sailed', 'arrived', 'customs']) {
    assert.ok(!text.includes(later), `the load state DATA says "${later}"`);
  }
  assert.match(state.note, /whether it has left.*recorded separately/i);
  // Every candidate's disclaimer must still be the refusal, not a claim.
  for (const c of state.candidates) {
    assert.match(c.readiness.disclaimer, /not a statement about customs/i);
    const factText = JSON.stringify(c.readiness.facts).toLowerCase();
    for (const later of ['departed', 'shipped', 'transit', 'customs', 'cleared']) {
      assert.ok(!factText.includes(later), `a readiness FACT says "${later}"`);
    }
  }
  // And the sailing's own status is untouched: T10 records the load, T5 owns the sailing's state.
  const { data: container } = await client.from('diaspora_container_shipments').select('*').eq('id', CONTAINER).maybeSingle();
  assert.equal(container.status, 'BOOKING_CLOSED');
});

test('T10: the customer is told loaded is not sailed', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  const mine = await getMyLoadStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, 'LOADED');
  assert.match(mine.note, /does not mean the container has sailed/i);
});

// ── 7. Container and seal ──────────────────────────────────────────────────

test('T10: an empty seal record is refused', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(() => recordSeal(load.id, {}, OPERATOR, opts(client)), /an empty record says nothing/i);
});

test('T10: replacing a seal keeps the previous one, and needs a reason', async () => {
  const { client, load } = await loadedWorld();
  await recordSeal(load.id, { containerNumber: 'MSKU1234567', sealNumber: 'SEAL-1' }, OPERATOR, opts(client));
  await assert.rejects(
    () => recordSeal(load.id, { sealNumber: 'SEAL-2', recordReason: 'SEAL_REPLACED' }, OPERATOR, opts(client)),
    /say why the seal was replaced/i,
  );
  await recordSeal(load.id, { sealNumber: 'SEAL-2', recordReason: 'SEAL_REPLACED', reasonNote: 'Customs inspection at the gate' }, OPERATOR, opts(client));
  const { data } = await client.from('diaspora_container_seal_records').select('*').eq('load_id', load.id);
  assert.equal(data.length, 2, 'the original seal record was destroyed');
  assert.ok(data.every((r) => r.recorded_by === 'user-operator'));
});

test('T10: an unrecorded container number stays unknown', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  const state = await getContainerLoadState(CONTAINER, OPERATOR, opts(client));
  assert.equal(state.load.container_number, null, 'a container number was manufactured');
  assert.equal(state.load.seal_number, null);
});

// ── 8. Privacy ─────────────────────────────────────────────────────────────

test('T10: a customer cannot plan, load or complete anything', async () => {
  const { client, load, plan } = await loadedWorld();
  await assert.rejects(() => setPlanItem(plan.id, { subjectId: RES_A, disposition: 'PLANNED_IN' }, CUSTOMER, opts(client)), /not authorized/i);
  await assert.rejects(() => recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED' }, CUSTOMER, opts(client)), /not authorized/i);
  await assert.rejects(() => completeLoad(load.id, {}, CUSTOMER, opts(client)), /not authorized/i);
  await assert.rejects(() => getContainerLoadState(CONTAINER, CUSTOMER, opts(client)), /not authorized/i);
});

test('T10: an operator of another sailing gets nothing', async () => {
  const { client, load } = await loadedWorld();
  await assert.rejects(() => getLoadReadiness(CONTAINER, OUTSIDER, opts(client)), /not authorized/i);
  await assert.rejects(() => recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED' }, OUTSIDER, opts(client)), /not authorized/i);
});

test('T10: a co-loader cannot read another participant\'s load status', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await assert.rejects(() => getMyLoadStatus('cargo_reservation', RES_A, COLOADER, opts(client)), /not your cargo/i);
  // POSITIVE CONTROL: they CAN read their own.
  const theirs = await getMyLoadStatus('cargo_reservation', RES_B, COLOADER, opts(client));
  assert.ok(theirs.state);
});

test('T10: the participant projection carries no other cargo, operator or sailing total', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await recordLoadItem(load.id, { subjectId: RES_B, outcome: 'LEFT_BEHIND', leftBehindReason: 'NO_SPACE' }, OPERATOR, opts(client));
  const mine = await getMyLoadStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  const text = JSON.stringify(mine);
  assert.ok(!text.includes(RES_B), 'another participant\'s cargo appears');
  assert.ok(!text.includes('user-operator'), 'the operator is named to the customer');
  assert.ok(!text.includes('tenant-op'), 'the tenant is exposed');
  assert.ok(!text.includes('33'), 'the sailing\'s capacity is exposed');
});

// ── 9. Truthful absence ────────────────────────────────────────────────────

test('T10: before loading starts, the customer is told exactly that', async () => {
  const client = world();
  const mine = await getMyLoadStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, 'NOT_STARTED');
  assert.match(mine.sentence, /has not started/i);
});

test('T10: cargo nobody recorded is NOT_RECORDED, not silently "left behind"', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  const theirs = await getMyLoadStatus('cargo_reservation', RES_B, COLOADER, opts(client));
  assert.equal(theirs.state, 'NOT_RECORDED');
  assert.match(theirs.sentence, /nothing has been recorded about your cargo yet/i);
  assert.equal(theirs.left_behind_reason, null, 'an absence was reported as an exclusion');
});

test('T10: after a completed load, unrecorded cargo says so plainly', async () => {
  const { client, load } = await loadedWorld();
  await recordLoadItem(load.id, { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 }, OPERATOR, opts(client));
  await completeLoad(load.id, {}, OPERATOR, opts(client));
  const theirs = await getMyLoadStatus('cargo_reservation', RES_B, COLOADER, opts(client));
  assert.match(theirs.sentence, /loading finished and nothing was recorded/i);
});
