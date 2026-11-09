/**
 * Service Network S2 — Canonical Service Case authority contracts.
 *
 * Proves the rules the migration cannot express:
 *   - the lifecycle state machine, including that terminal states are terminal
 *     (a completed/declined/cancelled case remains historical — Invariant 12);
 *   - the idempotent marketplace bridge: a retry returns the SAME case;
 *   - tenant safety: another garage cannot see or act on a case, and its
 *     attempts read as not-found rather than forbidden (no existence oracle);
 *   - the case orchestrates without becoming another authority: completion
 *     writes no trust, no vehicle, no work-order row (Invariant 2 / Invariant 4);
 *   - event payloads carry identifiers and status only — never the private
 *     request summary (plan §8);
 *   - a Communications/outbox failure does NOT roll back an authoritative case
 *     (plan §15.5);
 *   - requests may only be routed to a PUBLISHED garage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  SERVICE_CASE_EVENTS,
  acceptServiceCase,
  cancelServiceCase,
  completeServiceCase,
  declineServiceCase,
  getServiceCase,
  listGarageServiceCases,
  listMyServiceCases,
  requestServiceCase,
  startServiceCase,
} from '../services/serviceNetwork/serviceCaseService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINCASE0001';

const owner = { id: 'u-owner', role: 'owner', effectiveRole: 'owner' };
const garageA = { id: 'u-garage-a', role: 'mechanic', effectiveRole: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-garage-b', role: 'mechanic', effectiveRole: 'mechanic', tenantId: TENANT_B };

function seedClient(extra = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner', trust_score: 72 }],
    tenants: [
      { id: TENANT_A, name: 'Harare Motors', type: 'garage', status: 'active' },
      { id: TENANT_B, name: 'Bulawayo Auto', type: 'garage', status: 'active' },
    ],
    garage_public_profiles: [
      { tenant_id: TENANT_A, slug: 'harare-motors', display_name: 'Harare Motors', publication_status: 'published' },
      { tenant_id: TENANT_B, slug: 'bulawayo-auto', display_name: 'Bulawayo Auto', publication_status: 'published' },
    ],
    service_cases: [],
    service_case_events: [],
    domain_events: [],
    ...extra,
  });
}

async function openCase(client, body = {}) {
  const { case: c } = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, service_category: 'engine', ...body,
  });
  return c;
}

test('a request creates a case in requested state with a server timestamp', async () => {
  const client = seedClient();
  const result = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, service_category: 'brakes',
    request_summary: 'Grinding noise when braking', source_channel: 'directory',
  });
  assert.equal(result.created, true);
  assert.equal(result.case.status, 'requested');
  assert.equal(result.case.service_category, 'brakes');
  assert.equal(result.case.source_channel, 'directory');
  assert.ok(result.case.requested_at, 'requested_at is server-stamped');
  assert.equal(result.case.accepted_at, null);
});

test('the marketplace bridge is idempotent — a retry returns the SAME case', async () => {
  const client = seedClient();
  const first = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, source_inquiry_id: 'inq-1', source_channel: 'marketplace',
  });
  const retry = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, source_inquiry_id: 'inq-1', source_channel: 'marketplace',
  });
  assert.equal(first.created, true);
  assert.equal(retry.created, false, 'a retry must not create a second case');
  assert.equal(retry.case.id, first.case.id);
  assert.equal(client._tables.service_cases.length, 1, 'exactly one case exists');
});

test('a service request can only be routed to a PUBLISHED garage', async () => {
  const client = seedClient({
    garage_public_profiles: [
      { tenant_id: TENANT_A, slug: 'harare-motors', display_name: 'Harare Motors', publication_status: 'draft' },
    ],
  });
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }),
    /not accepting service requests/,
  );
});

test('the full happy lifecycle transitions and stamps each timestamp', async () => {
  const client = seedClient();
  const c = await openCase(client);
  const accepted = await acceptServiceCase(client, garageA, c.id, {});
  assert.equal(accepted.case.status, 'accepted');
  assert.ok(accepted.case.accepted_at);

  const active = await startServiceCase(client, garageA, c.id);
  assert.equal(active.case.status, 'active');
  assert.ok(active.case.started_at);

  const completed = await completeServiceCase(client, garageA, c.id);
  assert.equal(completed.case.status, 'completed');
  assert.ok(completed.case.completed_at, 'completion has an authoritative server timestamp');
});

test('terminal states are terminal — a completed case remains historical', async () => {
  const client = seedClient();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {});
  await startServiceCase(client, garageA, c.id);
  await completeServiceCase(client, garageA, c.id);

  await assert.rejects(() => startServiceCase(client, garageA, c.id), /remains historical/);
  await assert.rejects(() => cancelServiceCase(client, garageA, c.id, {}), /remains historical/);
  await assert.rejects(() => acceptServiceCase(client, garageA, c.id, {}), /remains historical/);
});

test('a declined case is terminal and records a structured reason', async () => {
  const client = seedClient();
  const c = await openCase(client);
  const declined = await declineServiceCase(client, garageA, c.id, { reason_code: 'capacity' });
  assert.equal(declined.case.status, 'declined');
  assert.equal(declined.case.decline_reason_code, 'capacity');
  assert.ok(declined.case.declined_at);
  await assert.rejects(() => acceptServiceCase(client, garageA, c.id, {}), /remains historical/);
  await assert.rejects(
    () => declineServiceCase(client, garageA, c.id, { reason_code: 'because_i_said_so' }),
    /Unknown decline reason code/,
  );
});

test('cancellation is a state, never a deletion', async () => {
  const client = seedClient();
  const c = await openCase(client);
  const cancelled = await cancelServiceCase(client, owner, c.id, { reason_code: 'requester_withdrew' });
  assert.equal(cancelled.case.status, 'cancelled');
  assert.ok(cancelled.case.cancelled_at);
  assert.equal(client._tables.service_cases.length, 1, 'the row survives cancellation');
  const read = await getServiceCase(client, owner, c.id);
  assert.equal(read.case.status, 'cancelled');
});

test('an illegal transition is refused', async () => {
  const client = seedClient();
  const c = await openCase(client);
  // requested -> active skips acceptance
  await assert.rejects(() => startServiceCase(client, garageA, c.id), /cannot move to active/);
  // requested -> completed
  await assert.rejects(() => completeServiceCase(client, garageA, c.id), /cannot move to completed/);
});

test('another garage cannot act on the case, and it reads as not-found', async () => {
  const client = seedClient();
  const c = await openCase(client);
  await assert.rejects(() => acceptServiceCase(client, garageB, c.id, {}), /not found/i);
  await assert.rejects(() => declineServiceCase(client, garageB, c.id, {}), /not found/i);
  await assert.rejects(() => getServiceCase(client, garageB, c.id), /not found/i);

  const stored = client._tables.service_cases[0];
  assert.equal(stored.status, 'requested', 'the cross-tenant attempts changed nothing');
});

test('the garage queue is strictly tenant-scoped', async () => {
  const client = seedClient();
  await openCase(client);
  await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_B });

  const queueA = await listGarageServiceCases(client, garageA, {});
  assert.equal(queueA.total, 1);
  assert.equal(queueA.cases[0].garage_tenant_id, TENANT_A);

  const queueB = await listGarageServiceCases(client, garageB, {});
  assert.equal(queueB.total, 1);
  assert.equal(queueB.cases[0].garage_tenant_id, TENANT_B);
});

test('the requester sees their own cases', async () => {
  const client = seedClient();
  await openCase(client);
  const mine = await listMyServiceCases(client, owner);
  assert.equal(mine.total, 1);
  const someoneElse = await listMyServiceCases(client, { id: 'u-stranger' });
  assert.equal(someoneElse.total, 0);
});

test('every transition appends immutable history', async () => {
  const client = seedClient();
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {});
  await startServiceCase(client, garageA, c.id);
  await completeServiceCase(client, garageA, c.id);

  const { history } = await getServiceCase(client, owner, c.id);
  assert.deepEqual(history.map((h) => h.event_type), [
    SERVICE_CASE_EVENTS.requested,
    SERVICE_CASE_EVENTS.accepted,
    SERVICE_CASE_EVENTS.started,
    SERVICE_CASE_EVENTS.completed,
  ]);
  assert.deepEqual(history.map((h) => h.to_status), ['requested', 'accepted', 'active', 'completed']);
});

test('events use the canonical namespace and never carry the private summary', async () => {
  const client = seedClient();
  const emitted = [];
  const capture = async (pgClient, eventType, payload, tenantId) => {
    emitted.push({ pgClient, eventType, payload, tenantId });
    return { id: 'evt-1' };
  };
  await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A,
    request_summary: 'SECRET customer complaint about the previous mechanic',
  }, { emitDomainEvent: capture });

  assert.equal(emitted.length, 1, 'exactly one domain event was emitted');
  assert.equal(emitted[0].eventType, 'service.case.requested', 'canonical dot-lowercase namespace');
  assert.equal(emitted[0].tenantId, TENANT_A, 'the outbox row is tenant-attributed');
  const serialized = JSON.stringify(emitted[0].payload);
  assert.equal(serialized.includes('SECRET'), false, 'private free text must never enter a domain event');
  assert.equal(serialized.includes(VIN), true, 'identifiers are carried');
  assert.equal(Object.hasOwn(emitted[0].payload, 'request_summary'), false);
});

test('every lifecycle transition emits its canonical event exactly once', async () => {
  const client = seedClient();
  const emitted = [];
  const deps = { emitDomainEvent: async (_pg, eventType) => { emitted.push(eventType); return { id: 'e' }; } };

  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, deps);
  await acceptServiceCase(client, garageA, c.id, {}, deps);
  await startServiceCase(client, garageA, c.id, deps);
  await completeServiceCase(client, garageA, c.id, deps);

  assert.deepEqual(emitted, [
    'service.case.requested',
    'service.case.accepted',
    'service.work.started',
    'service.case.completed',
  ]);
});

test('the production emitter is the real outbox writer, not a stub', async () => {
  // Guards against an injected-collaborator test passing while the production path
  // is dead by construction: the DEFAULT emitter must be the real eventBus writer.
  const { emitDomainEvent } = await import('../services/eventBus/eventBusService.js');
  assert.equal(typeof emitDomainEvent, 'function');
  const source = (await import('node:fs')).readFileSync(
    new URL('../services/serviceNetwork/serviceCaseService.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ emitDomainEvent \} from '\.\.\/eventBus\/eventBusService\.js'/);
  assert.match(source, /deps\.emitDomainEvent \|\| emitDomainEvent/);
});

test('completion writes NO trust and NO vehicle mutation (Invariants 2 and 4)', async () => {
  const client = seedClient();
  const vehicleBefore = JSON.stringify(client._tables.vehicles[0]);
  const c = await openCase(client);
  await acceptServiceCase(client, garageA, c.id, {});
  await startServiceCase(client, garageA, c.id);
  await completeServiceCase(client, garageA, c.id);

  assert.equal(JSON.stringify(client._tables.vehicles[0]), vehicleBefore, 'the vehicle row is untouched');
  assert.equal(client._tables.vehicles[0].trust_score, 72, 'trust is not moved by service activity');
  assert.equal(client._tables.mechanic_work_orders, undefined, 'S2 creates no work-order rows');
});

test('an outbox failure does not roll back an authoritative case', async () => {
  const client = seedClient();
  const exploding = async () => { throw new Error('outbox down'); };

  const result = await requestServiceCase(client, owner,
    { vin: VIN, garage_tenant_id: TENANT_A }, { emitDomainEvent: exploding });
  assert.equal(result.created, true, 'the case is still authoritative');
  assert.equal(result.notification.emitted, false, 'and the delivery problem is reported, not hidden');
  assert.equal(client._tables.service_cases.length, 1);
});

test('unknown vocabulary is refused rather than coerced', async () => {
  const client = seedClient();
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A, service_category: 'teleportation' }),
    /Unknown service category/,
  );
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A, source_channel: 'telepathy' }),
    /Unknown source channel/,
  );
});
