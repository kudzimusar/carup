/**
 * Service Network hardening — lifecycle atomicity, concurrency, idempotency and correction.
 *
 * These cover the failure modes that only appear under partial failure and contention:
 * a state change whose history is lost, two callers racing the same transition, retries
 * of consequential writes, and the correction of a fact that has already been projected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  acceptServiceCase, cancelServiceCase, completeServiceCase, declineServiceCase,
  requestServiceCase, startServiceCase,
} from '../services/serviceNetwork/serviceCaseService.js';
import { assignMechanic, createWorkOrderForCase, updateWorkOrderStatus } from '../services/serviceNetwork/workOrderAssignmentService.js';
import { linkPartRecord, recordMileageObservation, recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { grantCapability, redeemCapability } from '../services/serviceNetwork/serviceLinkService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VININTEG0001';
const owner = { id: 'u-owner', role: 'owner' };
const garageA = { id: 'u-garage-a', role: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-garage-b', role: 'mechanic', tenantId: TENANT_B };
const noEmit = { emitDomainEvent: async () => ({ id: 'e' }) };

function world(over = {}) {
  return createMockSupabase({
    users: [{ id: 'u-owner' }, { id: 'u-garage-a' }, { id: 'u-garage-b' }, { id: 'u-mech-1' }, { id: 'u-mech-2' }],
    vehicles: [{ vin: VIN, owner_id: 'u-owner', mileage: 120000 }],
    tenants: [{ id: TENANT_A, type: 'garage' }, { id: TENANT_B, type: 'garage' }],
    tenant_users: [
      { tenant_id: TENANT_A, user_id: 'u-mech-1', role: 'mechanic' },
      { tenant_id: TENANT_A, user_id: 'u-mech-2', role: 'mechanic' },
      { tenant_id: TENANT_B, user_id: 'u-garage-b', role: 'admin' },
    ],
    garage_public_profiles: [
      { tenant_id: TENANT_A, slug: 'a', display_name: 'A', publication_status: 'published' },
      { tenant_id: TENANT_B, slug: 'b', display_name: 'B', publication_status: 'published' },
    ],
    garage_branches: [], service_cases: [], service_case_events: [], mechanic_work_orders: [],
    work_order_assignments: [], service_records: [], service_mileage_observations: [],
    service_record_parts: [], service_record_evidence: [],
    partsentry_logs: [{ id: 42, vin: VIN, tenant_id: TENANT_A }],
    vehicle_evidence: [], service_capability_grants: [], service_links: [],
    ...over,
  });
}

async function openCase(client) {
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  return c;
}

/** Make service_case_events inserts fail, to exercise the lost-history window. */
function breakHistory(client) {
  const originalFrom = client.from.bind(client);
  client.from = (table) => (table === 'service_case_events'
    ? { insert: async () => ({ data: null, error: { message: 'history store unavailable' } }) }
    : originalFrom(table));
}

// ─────────── Area 5 — lifecycle atomicity ───────────

test('a transition whose history cannot be recorded is ROLLED BACK, not silently kept', async () => {
  const client = world();
  const c = await openCase(client);
  assert.equal(client._tables.service_cases[0].status, 'requested');

  breakHistory(client);
  await assert.rejects(() => acceptServiceCase(client, garageA, c.id, {}, noEmit), /rolled back/);

  assert.equal(client._tables.service_cases[0].status, 'requested',
    'the state change did not survive without its history');
  assert.equal(client._tables.service_cases[0].accepted_at ?? null, null);
});

test('a case whose creation history cannot be recorded does not remain live', async () => {
  const client = world();
  breakHistory(client);
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit),
    /could not be recorded/);
  const stored = client._tables.service_cases[0];
  assert.equal(stored.status, 'cancelled', 'a case without provenance is retired, not left requested');
});

test('an outbox failure is reported but never rolls back the transition', async () => {
  const client = world();
  const c = await openCase(client);
  const exploding = { emitDomainEvent: async () => { throw new Error('outbox down'); } };
  const accepted = await acceptServiceCase(client, garageA, c.id, {}, exploding);

  assert.equal(accepted.case.status, 'accepted', 'authoritative truth stands');
  assert.equal(accepted.notification.emitted, false, 'and the failure is surfaced');
  // the history row exists, so the event is replayable
  const events = client._tables.service_case_events.filter((e) => e.to_status === 'accepted');
  assert.equal(events.length, 1, 'history retains what the outbox lost');
});

// ─────────── Area 8 — concurrency and idempotency ───────────

test('two simultaneous accepts produce exactly one acceptance', async () => {
  const client = world();
  const c = await openCase(client);
  const results = await Promise.allSettled([
    acceptServiceCase(client, garageA, c.id, {}, noEmit),
    acceptServiceCase(client, garageA, c.id, {}, noEmit),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1, 'the loser must not also succeed');
  assert.equal(client._tables.service_cases[0].status, 'accepted');
  const acceptEvents = client._tables.service_case_events.filter((e) => e.to_status === 'accepted');
  assert.equal(acceptEvents.length, 1, 'exactly one acceptance in history');
});

test('two simultaneous completions produce exactly one completion event', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  await startServiceCase(client, garageA, c.id, noEmit);

  const emitted = [];
  const capture = { emitDomainEvent: async (_pg, t) => { emitted.push(t); return { id: 'e' }; } };
  const results = await Promise.allSettled([
    completeServiceCase(client, garageA, c.id, capture),
    completeServiceCase(client, garageA, c.id, capture),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(emitted.filter((e) => e === 'service.case.completed').length, 1);
});

test('accept and decline racing each other cannot both win', async () => {
  const client = world();
  const c = await openCase(client);
  const results = await Promise.allSettled([
    acceptServiceCase(client, garageA, c.id, {}, noEmit),
    declineServiceCase(client, garageA, c.id, { reason_code: 'capacity' }, noEmit),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1,
    'a case cannot be both accepted and declined');
  assert.ok(['accepted', 'declined'].includes(client._tables.service_cases[0].status));
});

test('simultaneous work-order creation for one case yields exactly one work order', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  await Promise.allSettled([
    createWorkOrderForCase(client, garageA, c.id, {}),
    createWorkOrderForCase(client, garageA, c.id, {}),
  ]);
  assert.equal(client._tables.mechanic_work_orders.length, 1);
});

test('simultaneous assignment of two different mechanics leaves exactly one live', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  const results = await Promise.allSettled([
    assignMechanic(client, garageA, workOrder.id, { mechanic_user_id: 'u-mech-1' }),
    assignMechanic(client, garageA, workOrder.id, { mechanic_user_id: 'u-mech-2' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'no two current mechanics');
  const live = client._tables.work_order_assignments.filter((a) => !a.unassigned_at);
  assert.equal(live.length, 1);
});

test('retried part links and mileage observations do not duplicate business truth', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  const { record } = await recordService(client, garageA, workOrder.id, {});

  const links = await Promise.allSettled([
    linkPartRecord(client, garageA, record.id, { partsentry_log_id: 42 }),
    linkPartRecord(client, garageA, record.id, { partsentry_log_id: 42 }),
  ]);
  assert.equal(links.filter((r) => r.status === 'rejected').length, 0, 'a retry is not an error');
  assert.equal(client._tables.service_record_parts.length, 1, 'but it is not a second link');

  // A repeated identical odometer reading is a legitimate second observation, and both are
  // retained — observations are a log, not a single mutable value.
  await recordMileageObservation(client, garageA, record.id, { observed_mileage: 131500 });
  await recordMileageObservation(client, garageA, record.id, { observed_mileage: 131500 });
  assert.equal(client._tables.service_mileage_observations.length, 2);
});

test('a capability cannot be redeemed twice under a race', async () => {
  const client = world();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  const results = await Promise.allSettled([
    redeemCapability(client, garageA, token),
    redeemCapability(client, garageA, token),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('a terminal work order cannot be reopened by a racing writer', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  await updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'Completed' });
  const results = await Promise.allSettled([
    updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'In Progress' }),
    updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'In Progress' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0);
  assert.equal(client._tables.mechanic_work_orders[0].status, 'Completed');
});

// ─────────── Area 9 — correction and supersession ───────────

test('a mileage correction supersedes rather than overwrites (plan §26)', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  const { record } = await recordService(client, garageA, workOrder.id, {});

  await recordMileageObservation(client, garageA, record.id, { observed_mileage: 131500 });
  await recordMileageObservation(client, garageA, record.id, { observed_mileage: 113500 });

  const observations = client._tables.service_mileage_observations;
  assert.equal(observations.length, 2, 'the mistaken reading is retained, not erased');
  assert.equal(observations[0].observed_mileage, 131500, 'the original stands in the record');
  // The database also refuses to let the earlier one be deleted (proven in the S5 harness).
});

test('assignment history is superseded, never rewritten', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  await assignMechanic(client, garageA, workOrder.id, { mechanic_user_id: 'u-mech-1' });

  const { unassignMechanic } = await import('../services/serviceNetwork/workOrderAssignmentService.js');
  await unassignMechanic(client, garageA, workOrder.id, { reason_code: 'reassigned' });
  await assignMechanic(client, garageA, workOrder.id, { mechanic_user_id: 'u-mech-2' });

  const rows = client._tables.work_order_assignments;
  assert.equal(rows.length, 2, 'the wrong attribution is superseded, not deleted');
  assert.equal(rows[0].mechanic_user_id, 'u-mech-1');
  assert.ok(rows[0].unassigned_at, 'and it is closed with a timestamp');
  assert.equal(rows[0].unassign_reason_code, 'reassigned', 'with an auditable reason');
});

test('case history is append-only, so a cancellation adds to the record', async () => {
  const client = world();
  const c = await openCase(client);
  await cancelServiceCase(client, owner, c.id, { reason_code: 'requester_withdrew' }, noEmit);

  const events = client._tables.service_case_events.filter((e) => e.service_case_id === c.id);
  assert.deepEqual(events.map((e) => e.to_status), ['requested', 'cancelled']);
  assert.equal(events[1].metadata.reason_code, 'requester_withdrew');
  assert.equal(events[1].metadata.cancelled_by, 'requester', 'who corrected it is recorded');
});

test('cross-tenant writers cannot corrupt another garage record under contention', async () => {
  const client = world();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const results = await Promise.allSettled([
    startServiceCase(client, garageB, c.id, noEmit),
    completeServiceCase(client, garageB, c.id, noEmit),
    cancelServiceCase(client, garageB, c.id, {}, noEmit),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0);
  assert.equal(client._tables.service_cases[0].status, 'accepted');
});
