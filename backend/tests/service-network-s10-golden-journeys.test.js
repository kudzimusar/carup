/**
 * Service Network S10 — Golden Journey certification.
 *
 * Drives the REAL Service Network services end-to-end over a mocked Supabase, exercising
 * the full plan §S10 journey:
 *
 *   owner → vehicle → garage → service request → conversation → acceptance → work order
 *   → mechanic assignment → mileage/work/part/evidence → completion → history
 *
 * plus the seven adversarial and degraded journeys the plan names (Golden A–H). These are
 * the integration proofs: each phase certified its own contracts, and this file proves the
 * phases actually compose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';

import { publishMyGarageProfile, upsertMyGarageProfile, getPublicGarageDirectory, getPublicGarageDetail } from '../services/serviceNetwork/garageDirectoryService.js';
import { acceptServiceCase, cancelServiceCase, completeServiceCase, getServiceCase, requestServiceCase, startServiceCase } from '../services/serviceNetwork/serviceCaseService.js';
import { bindServiceCaseConversation, bridgeInquiryToServiceCase } from '../services/serviceNetwork/serviceCaseBridgeService.js';
import { assignMechanic, createWorkOrderForCase, getWorkOrderAssignment, updateWorkOrderStatus } from '../services/serviceNetwork/workOrderAssignmentService.js';
import { linkEvidence, linkPartRecord, recordMileageObservation, recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { getOwnerServiceHistory } from '../services/serviceNetwork/ownerServiceHistoryService.js';
import { ensureServiceLink, grantCapability, redeemCapability, resolveServiceLink } from '../services/serviceNetwork/serviceLinkService.js';
import { getGarageCustomers, getGarageQueue } from '../services/serviceNetwork/garageQueueService.js';
import { evaluateMeasurability } from '../services/serviceNetwork/serviceMetricCatalogue.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINGOLDEN001';

const owner = { id: 'u-owner', role: 'owner' };
const garageA = { id: 'u-garage-a', role: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-garage-b', role: 'mechanic', tenantId: TENANT_B };
const noEmit = { emitDomainEvent: async () => ({ id: 'evt' }) };

function world(over = {}) {
  return createMockSupabase({
    users: [
      { id: 'u-owner', name: 'Tendai Moyo', role: 'owner' },
      { id: 'u-garage-a', name: 'Garage A Manager', role: 'mechanic' },
      { id: 'u-mech-1', name: 'Rudo M', role: 'mechanic' },
      { id: 'u-garage-b', name: 'Garage B Manager', role: 'mechanic' },
    ],
    vehicles: [{ vin: VIN, owner_id: 'u-owner', make: 'Toyota', model: 'Hilux', year: 2019, mileage: 120000, trust_score: 72 }],
    tenants: [{ id: TENANT_A, name: 'Harare Motors', type: 'garage' }, { id: TENANT_B, name: 'Bulawayo Auto', type: 'garage' }],
    tenant_users: [
      { tenant_id: TENANT_A, user_id: 'u-garage-a', role: 'admin' },
      { tenant_id: TENANT_A, user_id: 'u-mech-1', role: 'mechanic' },
      { tenant_id: TENANT_B, user_id: 'u-garage-b', role: 'admin' },
    ],
    garage_public_profiles: [], garage_branches: [], service_cases: [], service_case_events: [],
    mechanic_work_orders: [], work_order_assignments: [], service_records: [],
    service_mileage_observations: [], service_record_parts: [], service_record_evidence: [],
    partsentry_logs: [{ id: 42, vin: VIN, tenant_id: TENANT_A, part_name: 'Front pads' }],
    vehicle_evidence: [{ id: 'ev-1', vin: VIN }],
    marketplace_inquiries: [], service_links: [], service_capability_grants: [],
    ...over,
  });
}

/** Publish garage A so it can receive service requests. */
async function publishGarageA(client) {
  await upsertMyGarageProfile(client, garageA, {
    display_name: 'Harare Motors', location_city: 'Harare', service_categories: ['brakes', 'engine'],
  });
  await publishMyGarageProfile(client, garageA);
}

// ─────────────────── Golden A — evidence-rich service ───────────────────

test('Golden A — the full evidence-rich journey composes end to end', async () => {
  const client = world();
  await publishGarageA(client);

  // owner → garage directory
  const directory = await getPublicGarageDirectory(client, {});
  assert.equal(directory.total, 1);
  const detail = await getPublicGarageDetail(client, directory.garages[0].slug);
  assert.equal(detail.garage.display_name, 'Harare Motors');

  // → service request
  const { case: serviceCase } = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, service_category: 'brakes',
    request_summary: 'Grinding when braking', source_channel: 'directory',
  }, noEmit);
  assert.equal(serviceCase.status, 'requested');

  // → canonical conversation
  const workflowService = { ensureBusinessConversation: async () => ({ thread: { id: 'thread-1' }, created: true }) };
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], { workflowService });
  assert.equal(bound.bound, true);

  // → acceptance → work order → assignment
  await acceptServiceCase(client, garageA, serviceCase.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, serviceCase.id, {});
  await assignMechanic(client, garageA, workOrder.id, { mechanic_user_id: 'u-mech-1' });
  const assignment = await getWorkOrderAssignment(client, garageA, workOrder.id);
  assert.equal(assignment.assigned_mechanic_user_id, 'u-mech-1');

  await startServiceCase(client, garageA, serviceCase.id, noEmit);

  // → mileage / work / part / evidence
  const { record } = await recordService(client, garageA, workOrder.id, {
    work_performed: 'Replaced front pads', service_authority: 'professional_governed',
    total_cost: 250, currency: 'ZWG',
  });
  const mileage = await recordMileageObservation(client, garageA, record.id, {
    observed_mileage: 131500, observation_source: 'mechanic_attributed',
  });
  await linkPartRecord(client, garageA, record.id, { partsentry_log_id: 42 });
  await linkEvidence(client, garageA, record.id, { evidence_id: 'ev-1' });

  // The canonical odometer is never moved by a service observation.
  assert.equal(client._tables.vehicles[0].mileage, 120000);
  assert.equal(mileage.observation.observed_mileage, 131500);

  // → completion
  await updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'Completed' });
  const completed = await completeServiceCase(client, garageA, serviceCase.id, noEmit);
  assert.equal(completed.case.status, 'completed');
  assert.ok(completed.case.completed_at);

  // Trust is NOT moved by service activity (Invariant 4).
  assert.equal(client._tables.vehicles[0].trust_score, 72);

  // → owner Service History
  const history = await getOwnerServiceHistory(client, owner);
  const entry = history.entries.find((e) => e.id === workOrder.id);
  assert.equal(entry.provider.display_name, 'Harare Motors');
  assert.equal(entry.cost.recorded, true);
  assert.equal(entry.cost.currency, 'ZWG');
  assert.equal(entry.provenance, 'evidence_backed', 'provenance was earned by attaching evidence');
  assert.equal(entry.mileage_observation.observed_mileage, 131500);

  // → garage surfaces reflect the same truth
  const customers = await getGarageCustomers(client, garageA);
  assert.equal(customers.customers[0].display_name, 'Tendai Moyo');
  assert.deepEqual(customers.customers[0].spend_by_currency, { ZWG: 250 });

  // → Intelligence can measure it, without computing business truth
  const measurable = await evaluateMeasurability(client, 'accept_to_completion_elapsed');
  assert.equal(measurable.measurable, true);
  assert.equal(Object.hasOwn(measurable, 'value'), false);
});

// ─────────────────── Golden B — sparse service ───────────────────

test('Golden B — a sparse service renders truthfully rather than filling gaps', async () => {
  const client = world();
  await publishGarageA(client);
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  await recordService(client, garageA, workOrder.id, {});   // no cost, no provenance, no text
  await updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'Completed' });

  const history = await getOwnerServiceHistory(client, owner);
  const entry = history.entries[0];
  assert.equal(entry.cost.recorded, false);
  assert.equal(entry.cost.amount, null, 'absent cost is never zero');
  assert.equal(entry.provenance, 'unknown', 'provenance is not flattered');
  assert.equal(entry.mileage_observation, null, 'no reading means no claim');
  assert.equal(entry.work_performed, null);
});

// ─────────────────── Golden C — cross-tenant attack ───────────────────

test('Golden C — garage B cannot reach garage A private case, order or customers', async () => {
  const client = world();
  await publishGarageA(client);
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});

  // every hostile path reads as not-found, never as forbidden (no existence oracle)
  await assert.rejects(() => getServiceCase(client, garageB, c.id), /not found/i);
  await assert.rejects(() => acceptServiceCase(client, garageB, c.id, {}, noEmit), /not found/i);
  await assert.rejects(() => completeServiceCase(client, garageB, c.id, noEmit), /not found/i);
  await assert.rejects(() => createWorkOrderForCase(client, garageB, c.id, {}), /not found/i);
  await assert.rejects(() => updateWorkOrderStatus(client, garageB, workOrder.id, { status: 'Completed' }), /not found/i);
  await assert.rejects(() => assignMechanic(client, garageB, workOrder.id, { mechanic_user_id: 'u-garage-b' }), /not found/i);
  await assert.rejects(() => getWorkOrderAssignment(client, garageB, workOrder.id), /not found/i);

  // and garage B's own surfaces show nothing of garage A's work
  const queueB = await getGarageQueue(client, garageB, {});
  assert.equal(queueB.total, 0);
  const customersB = await getGarageCustomers(client, garageB);
  assert.equal(customersB.total, 0);

  // nothing was mutated by the attempts
  assert.equal(client._tables.service_cases[0].status, 'accepted');
  assert.equal(client._tables.work_order_assignments.length, 0);
});

// ─────────────────── Golden D — QR ───────────────────

test('Golden D — QR resolves the right resource, requires auth, and preserves attribution', async () => {
  const client = world();
  await publishGarageA(client);
  const { case: c } = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, source_channel: 'qr',
  }, noEmit);

  const { link } = await ensureServiceLink(client, owner, { resource_type: 'service_case', resource_id: c.id });

  // requires auth
  const anon = await resolveServiceLink(client, {}, link.public_token);
  assert.equal(anon.access, 'authentication_required');
  assert.equal(JSON.stringify(anon).includes(VIN), false);

  // preserves tenant authorization
  const outsider = await resolveServiceLink(client, garageB, link.public_token);
  assert.equal(outsider.access, 'not_a_participant');
  assert.equal(outsider.status, undefined);

  const participant = await resolveServiceLink(client, garageA, link.public_token);
  assert.equal(participant.access, 'participant');

  // source attribution survives the whole journey
  assert.equal(participant.source_channel, 'qr');
  assert.equal(client._tables.service_cases[0].source_channel, 'qr');

  // a scoped capability can be granted by the owner and redeemed once
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_case_participation', resource_type: 'service_case', resource_id: c.id,
  });
  const redeemed = await redeemCapability(client, garageA, token);
  assert.equal(redeemed.grant.resource_id, c.id);
  await assert.rejects(() => redeemCapability(client, garageA, token), /not valid/);
});

// ─────────────────── Golden E — Communications degraded ───────────────────

test('Golden E — service truth survives a Communications outage and reports it honestly', async () => {
  const client = world();
  await publishGarageA(client);

  const exploding = { emitDomainEvent: async () => { throw new Error('outbox unavailable'); } };
  const result = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, exploding);
  assert.equal(result.created, true, 'the case is still authoritative');
  assert.equal(result.notification.emitted, false, 'and the failure is reported, not hidden');

  const failingWorkflow = { ensureBusinessConversation: async () => { throw new Error('provider down'); } };
  const before = JSON.stringify(client._tables.service_cases[0]);
  const bound = await bindServiceCaseConversation(client, client._tables.service_cases[0], { workflowService: failingWorkflow });
  assert.equal(bound.bound, false);
  assert.match(bound.reason, /provider down/);
  assert.equal(JSON.stringify(client._tables.service_cases[0]), before, 'the case is untouched');

  // and the journey can still continue
  const accepted = await acceptServiceCase(client, garageA, result.case.id, {}, exploding);
  assert.equal(accepted.case.status, 'accepted');
  assert.equal(accepted.notification.emitted, false);
});

// ─────────────────── Golden F — ownership continuity ───────────────────

test('Golden F — service history survives ownership transfer without prior-owner data', async () => {
  const client = world();
  await publishGarageA(client);
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  await recordService(client, garageA, workOrder.id, { work_performed: 'Replaced pads', service_authority: 'garage_stated' });
  await updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'Completed' });

  // ownership transfers to a new owner
  client._tables.users.push({ id: 'u-new-owner', name: 'New Owner', role: 'owner' });
  client._tables.vehicles[0].owner_id = 'u-new-owner';
  const newOwner = { id: 'u-new-owner', role: 'owner' };

  // the vehicle's service history continues
  const history = await getOwnerServiceHistory(client, newOwner);
  assert.equal(history.total, 1, 'service history survives the transfer');
  assert.equal(history.entries[0].work_performed, 'Replaced pads');

  // and carries no prior-owner identity
  const serialized = JSON.stringify(history.entries);
  assert.equal(serialized.includes('u-owner'), false, 'no prior-owner id leaks to the new owner');
  assert.equal(serialized.includes('Tendai Moyo'), false, 'no prior-owner name leaks');

  // the previous owner no longer sees the vehicle
  const oldHistory = await getOwnerServiceHistory(client, owner);
  assert.equal(oldHistory.total, 0);
});

// ─────────────────── Golden G — duplicate / retry ───────────────────

test('Golden G — retry cannot duplicate case, work order, assignment or completion', async () => {
  const client = world({
    marketplace_inquiries: [{
      id: 'aaaaaaaa-1111-1111-1111-111111111111', listing_id: VIN, buyer_id: 'u-owner',
      inquiry_type: 'garage_service_request', message: 'Brakes', source_channel: 'qr',
      status: 'new', target_provider_tenant_id: TENANT_A, metadata: {},
    }],
  });
  await publishGarageA(client);

  // case: a replayed inquiry bridges to the SAME case
  const first = await bridgeInquiryToServiceCase(client, owner, 'aaaaaaaa-1111-1111-1111-111111111111', noEmit);
  const retry = await bridgeInquiryToServiceCase(client, owner, 'aaaaaaaa-1111-1111-1111-111111111111', noEmit);
  assert.equal(retry.case.id, first.case.id);
  assert.equal(client._tables.service_cases.length, 1);

  await acceptServiceCase(client, garageA, first.case.id, {}, noEmit);

  // work order: retry returns the same one
  const wo1 = await createWorkOrderForCase(client, garageA, first.case.id, {});
  const wo2 = await createWorkOrderForCase(client, garageA, first.case.id, {});
  assert.equal(wo2.workOrder.id, wo1.workOrder.id);
  assert.equal(client._tables.mechanic_work_orders.length, 1);

  // assignment: re-assigning the same mechanic is idempotent
  await assignMechanic(client, garageA, wo1.workOrder.id, { mechanic_user_id: 'u-mech-1' });
  await assignMechanic(client, garageA, wo1.workOrder.id, { mechanic_user_id: 'u-mech-1' });
  assert.equal(client._tables.work_order_assignments.length, 1);

  // completion: a second completion is refused, so no duplicate completion event
  await startServiceCase(client, garageA, first.case.id, noEmit);
  const emitted = [];
  const capture = { emitDomainEvent: async (_pg, type) => { emitted.push(type); return { id: 'e' }; } };
  await completeServiceCase(client, garageA, first.case.id, capture);
  await assert.rejects(() => completeServiceCase(client, garageA, first.case.id, capture), /remains historical/);
  assert.equal(emitted.filter((e) => e === 'service.case.completed').length, 1);
});

// ─────────────────── Golden H — adverse truth ───────────────────

test('Golden H — adverse truth renders correctly across every unknown', async () => {
  const client = world();
  await publishGarageA(client);
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  await updateWorkOrderStatus(client, garageA, workOrder.id, { status: 'Completed' });

  // a work order whose garage has no governed profile
  client._tables.mechanic_work_orders.push({
    id: 'wo-orphan', tenant_id: '99999999-9999-9999-9999-999999999999', vin: VIN,
    status: 'Completed', created_at: '2026-08-01T00:00:00Z',
  });

  const history = await getOwnerServiceHistory(client, owner);
  const orphan = history.entries.find((e) => e.id === 'wo-orphan');
  assert.equal(orphan.provider.known, false, 'unknown provider is stated, not invented');
  assert.equal(orphan.provider.display_name, null);
  assert.equal(orphan.cost.recorded, false, 'absent cost is stated, never zero');
  assert.equal(orphan.provenance, 'unknown');

  // no maintenance-interval prediction exists anywhere in the payload
  assert.equal(/next_service|nextService/i.test(JSON.stringify(history.entries)), false);

  // a cancelled case remains visible and truthful
  const { case: c2 } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  const cancelled = await cancelServiceCase(client, owner, c2.id, { reason_code: 'requester_withdrew' }, noEmit);
  assert.equal(cancelled.case.status, 'cancelled');
  assert.equal(cancelled.case.cancellation_reason_code, 'requester_withdrew');
  const read = await getServiceCase(client, owner, c2.id);
  assert.equal(read.case.status, 'cancelled', 'cancelled history is retained, not deleted');
});
