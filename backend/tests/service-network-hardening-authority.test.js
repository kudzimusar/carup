/**
 * Service Network hardening — resource authority, capability abuse and branch integrity.
 *
 * These are the adversarial tests for the seams the hardening pass closed. Each one
 * describes an attack that SUCCEEDED against the first implementation:
 *
 *   - any authenticated user could open a service engagement against any VIN;
 *   - any authenticated user could mint a permanent public link for a stranger's vehicle,
 *     a case they had nothing to do with, or an unaffiliated practitioner, and could stamp
 *     an arbitrary tenant_id onto it;
 *   - a capability bound to one garage could be redeemed by another;
 *   - a redeemed capability was recorded but never actually granted anything;
 *   - a garage could attach any evidence row that merely shared the VIN;
 *   - a branch belonging to garage B could be attached to garage A's case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { acceptServiceCase, getServiceCase, requestServiceCase } from '../services/serviceNetwork/serviceCaseService.js';
import { createWorkOrderForCase } from '../services/serviceNetwork/workOrderAssignmentService.js';
import { linkEvidence, recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { ensureServiceLink, grantCapability, redeemCapability, revokeCapability } from '../services/serviceNetwork/serviceLinkService.js';
import { assertVehicleAuthority, findLiveCapability } from '../services/serviceNetwork/serviceAuthority.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINHARD00001';
const CASE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const owner = { id: 'u-owner', role: 'owner' };
const attacker = { id: 'u-attacker', role: 'owner' };
const garageA = { id: 'u-garage-a', role: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-garage-b', role: 'mechanic', tenantId: TENANT_B };
const noEmit = { emitDomainEvent: async () => ({ id: 'e' }) };

function world(over = {}) {
  return createMockSupabase({
    users: [
      { id: 'u-owner', name: 'Owner' }, { id: 'u-attacker', name: 'Attacker' },
      { id: 'u-garage-a', name: 'A' }, { id: 'u-garage-b', name: 'B' }, { id: 'u-mech-1', name: 'M' },
    ],
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }, { vin: 'OTHERVIN', owner_id: 'u-attacker' }],
    tenants: [{ id: TENANT_A, type: 'garage' }, { id: TENANT_B, type: 'garage' }],
    tenant_users: [
      { tenant_id: TENANT_A, user_id: 'u-garage-a', role: 'admin' },
      { tenant_id: TENANT_A, user_id: 'u-mech-1', role: 'mechanic' },
      { tenant_id: TENANT_B, user_id: 'u-garage-b', role: 'admin' },
    ],
    garage_public_profiles: [
      { tenant_id: TENANT_A, slug: 'garage-a', display_name: 'Garage A', publication_status: 'published' },
      { tenant_id: TENANT_B, slug: 'garage-b', display_name: 'Garage B', publication_status: 'published' },
    ],
    garage_branches: [
      { id: BRANCH_A, tenant_id: TENANT_A, name: 'A Workshop', is_active: true },
      { id: BRANCH_B, tenant_id: TENANT_B, name: 'B Workshop', is_active: true },
    ],
    service_cases: [], service_case_events: [], mechanic_work_orders: [],
    service_records: [], service_record_evidence: [], service_record_parts: [],
    service_mileage_observations: [], service_links: [], service_capability_grants: [],
    vehicle_evidence: [], work_order_assignments: [],
    ...over,
  });
}

// ─────────── Area 3 — vehicle / requester authority ───────────

test('HOSTILE: a stranger cannot open a service case against a VIN they do not own', async () => {
  const client = world();
  await assert.rejects(
    () => requestServiceCase(client, attacker, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit),
    /not found/i,
    'and the refusal must not reveal that the VIN exists',
  );
  assert.equal(client._tables.service_cases.length, 0);
});

test('HOSTILE: an unknown VIN and an unauthorised VIN are indistinguishable', async () => {
  const client = world();
  const unauthorised = await requestServiceCase(client, attacker, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit).catch(e => e.message);
  const unknown = await requestServiceCase(client, attacker, { vin: 'NOSUCHVIN', garage_tenant_id: TENANT_A }, noEmit).catch(e => e.message);
  assert.equal(unauthorised, unknown, 'the service must not be a VIN-existence oracle');
});

test('the canonical owner can open a case', async () => {
  const client = world();
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  assert.equal(c.vin, VIN);
});

test('ownership is NEVER inferred from seller, tenant or marketplace state', async () => {
  const client = world({
    vehicles: [{ vin: VIN, owner_id: 'u-owner', current_seller_id: 'u-attacker', tenant_id: TENANT_B }],
    marketplace_inquiries: [{ id: 'inq-1', listing_id: VIN, buyer_id: 'u-attacker', inquiry_type: 'garage_service_request' }],
  });
  // seller identity, tenant stamp and an open inquiry must all fail to confer authority
  await assert.rejects(
    () => requestServiceCase(client, attacker, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit), /not found/i);
  await assert.rejects(
    () => requestServiceCase(client, garageB, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit), /not found/i);
});

test('a live owner-granted capability IS a governed authority path', async () => {
  const client = world();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await redeemCapability(client, garageA, token);
  const authority = await assertVehicleAuthority(client, garageA, VIN);
  assert.equal(authority.basis, 'capability');
});

test('an UNREDEEMED capability is not access', async () => {
  const client = world();
  await grantCapability(client, owner, { purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN });
  await assert.rejects(() => assertVehicleAuthority(client, garageA, VIN), /not found/i);
});

// ─────────── Area 1 — permanent Service Link authorization ───────────

test('HOSTILE: a stranger cannot mint a permanent link for a vehicle they do not own', async () => {
  const client = world();
  await assert.rejects(
    () => ensureServiceLink(client, attacker, { resource_type: 'vehicle', resource_id: VIN }), /not found/i);
  assert.equal(client._tables.service_links.length, 0);
});

test('HOSTILE: an outsider cannot mint a link for a case they are not party to', async () => {
  const client = world({
    service_cases: [{ id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, requester_user_id: 'u-owner', status: 'accepted' }],
  });
  await assert.rejects(
    () => ensureServiceLink(client, garageB, { resource_type: 'service_case', resource_id: CASE_ID }), /not found/i);
  await assert.rejects(
    () => ensureServiceLink(client, attacker, { resource_type: 'service_case', resource_id: CASE_ID }), /not found/i);
  // both genuine participants may
  const byGarage = await ensureServiceLink(client, garageA, { resource_type: 'service_case', resource_id: CASE_ID });
  assert.ok(byGarage.link.public_token);
});

test('HOSTILE: a garage cannot mint a practitioner link for someone unaffiliated', async () => {
  const client = world();
  await assert.rejects(
    () => ensureServiceLink(client, garageB, { resource_type: 'practitioner', resource_id: 'u-mech-1' }), /not found/i,
    'u-mech-1 belongs to garage A, not garage B');
  const ok = await ensureServiceLink(client, garageA, { resource_type: 'practitioner', resource_id: 'u-mech-1' });
  assert.ok(ok.link.public_token);
});

test('HOSTILE: a client-supplied tenant_id is never stamped onto a link', async () => {
  const client = world({
    service_cases: [{ id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, requester_user_id: 'u-owner', status: 'accepted' }],
  });
  await ensureServiceLink(client, garageA, {
    resource_type: 'service_case', resource_id: CASE_ID,
    tenant_id: TENANT_B,           // attacker-supplied
  });
  const stored = client._tables.service_links[0];
  assert.equal(stored.tenant_id, TENANT_A, 'the tenant is derived from the case, never from the body');
});

// ─────────── Area 2 — capability grants as real authorization ───────────

test('HOSTILE: a capability bound to garage A cannot be redeemed by garage B', async () => {
  const client = world();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN, grantee_tenant_id: TENANT_A,
  });
  await assert.rejects(() => redeemCapability(client, garageB, token), /not valid/);
  // and the mis-delivered attempt must not burn the grant for the rightful holder
  const ok = await redeemCapability(client, garageA, token);
  assert.equal(ok.grant.resource_id, VIN);
});

test('a redeemed capability stops granting access the moment it is revoked', async () => {
  const client = world();
  const { token, grant } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await redeemCapability(client, garageA, token);
  assert.ok(await findLiveCapability(client, garageA, 'vehicle', VIN), 'live before revocation');

  await revokeCapability(client, owner, grant.id);
  assert.equal(await findLiveCapability(client, garageA, 'vehicle', VIN), null, 'dead immediately after');
  await assert.rejects(() => assertVehicleAuthority(client, garageA, VIN), /not found/i);
});

test('a redeemed capability stops granting access the moment it expires', async () => {
  const client = world();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await redeemCapability(client, garageA, token);
  client._tables.service_capability_grants[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await findLiveCapability(client, garageA, 'vehicle', VIN), null);
  await assert.rejects(() => assertVehicleAuthority(client, garageA, VIN), /not found/i);
});

test('a capability redeemed by one actor does not confer access to a different actor', async () => {
  const client = world();
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN,
  });
  await redeemCapability(client, garageA, token);
  const other = { id: 'u-mech-1', tenantId: TENANT_A };
  assert.equal(await findLiveCapability(client, other, 'vehicle', VIN), null,
    'the redeeming actor is bound, not merely their tenant');
});

test('a case capability grants service context but NOT the conversation', async () => {
  const client = world({
    service_cases: [{
      id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, requester_user_id: 'u-owner',
      status: 'accepted', conversation_thread_id: 'thread-1', requested_at: '2026-08-01T00:00:00Z',
    }],
  });
  const { token } = await grantCapability(client, owner, {
    purpose: 'service_case_participation', resource_type: 'service_case', resource_id: CASE_ID,
  });
  await redeemCapability(client, garageB, token);

  const view = await getServiceCase(client, garageB, CASE_ID);
  assert.equal(view.access_basis, 'capability');
  assert.equal(view.case.conversation_thread_id, null,
    'Communications owns participation; a capability never confers conversation access');

  // a genuine participant still sees the thread reference
  const participant = await getServiceCase(client, garageA, CASE_ID);
  assert.equal(participant.case.conversation_thread_id, 'thread-1');
});

test('all bearer-token failures remain indistinguishable', async () => {
  const client = world();
  const { token, grant } = await grantCapability(client, owner, {
    purpose: 'service_context_read', resource_type: 'vehicle', resource_id: VIN, grantee_tenant_id: TENANT_A,
  });
  const messages = new Set();
  messages.add(await redeemCapability(client, garageB, token).catch(e => e.message));       // wrong recipient
  messages.add(await redeemCapability(client, garageA, 'forged').catch(e => e.message));    // unknown
  await revokeCapability(client, owner, grant.id);
  messages.add(await redeemCapability(client, garageA, token).catch(e => e.message));       // revoked
  assert.equal(messages.size, 1, `expected one indistinguishable message, got ${[...messages].join(' | ')}`);
});

// ─────────── Area 4 — branch integrity ───────────

test("HOSTILE: garage B's branch cannot be attached to a case for garage A", async () => {
  const client = world();
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A, branch_id: BRANCH_B }, noEmit),
    /does not belong to this garage/);
  assert.equal(client._tables.service_cases.length, 0);
});

test("HOSTILE: a garage cannot ACCEPT a case onto another garage's branch", async () => {
  const client = world();
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await assert.rejects(
    () => acceptServiceCase(client, garageA, c.id, { branch_id: BRANCH_B }, noEmit),
    /does not belong to this garage/);
  assert.equal(client._tables.service_cases[0].status, 'requested', 'the case did not move');
});

test('a foreign branch on a case row cannot be laundered into a work order', async () => {
  const client = world();
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  // simulate a case row that somehow carries a foreign branch
  client._tables.service_cases[0].branch_id = BRANCH_B;
  await assert.rejects(
    () => createWorkOrderForCase(client, garageA, c.id, {}), /does not belong to this garage/);
  assert.equal(client._tables.mechanic_work_orders.length, 0);
});

test("a garage's own branch flows through the whole journey", async () => {
  const client = world();
  const { case: c } = await requestServiceCase(client, owner, {
    vin: VIN, garage_tenant_id: TENANT_A, branch_id: BRANCH_A,
  }, noEmit);
  assert.equal(c.branch_id, BRANCH_A);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  assert.equal(workOrder.branch_id, BRANCH_A);
});

// ─────────── Area 7 — evidence authorization ───────────

async function activeCaseWithRecord(client) {
  const { case: c } = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: TENANT_A }, noEmit);
  await acceptServiceCase(client, garageA, c.id, {}, noEmit);
  const { workOrder } = await createWorkOrderForCase(client, garageA, c.id, {});
  const { record } = await recordService(client, garageA, workOrder.id, { work_performed: 'x' });
  return { c, record };
}

test('HOSTILE: matching VIN alone does not authorize attaching evidence', async () => {
  const client = world({
    vehicle_evidence: [{ id: 'ev-other-party', vin: VIN, tenant_id: TENANT_B, uploaded_by: 'u-garage-b' }],
  });
  const { record } = await activeCaseWithRecord(client);
  await assert.rejects(
    () => linkEvidence(client, garageA, record.id, { evidence_id: 'ev-other-party' }),
    /provided by another party/,
    'same VIN, but garage B uploaded it');
  assert.equal(client._tables.service_record_evidence.length, 0);
});

test('evidence uploaded by the vehicle owner IS usable by the servicing garage', async () => {
  const client = world({
    vehicle_evidence: [{ id: 'ev-owner', vin: VIN, tenant_id: TENANT_B, uploaded_by: 'u-owner' }],
  });
  const { record } = await activeCaseWithRecord(client);
  const linked = await linkEvidence(client, garageA, record.id, { evidence_id: 'ev-owner' });
  assert.equal(linked.created, true);
});

test('HOSTILE: evidence cannot be attached without a governed case for this garage', async () => {
  const client = world({ vehicle_evidence: [{ id: 'ev-1', vin: VIN }] });
  const { record } = await activeCaseWithRecord(client);
  // strip the governed engagement from the record
  client._tables.service_records[0].service_case_id = null;
  await assert.rejects(
    () => linkEvidence(client, garageA, record.id, { evidence_id: 'ev-1' }),
    /governed service case/);
});

test('HOSTILE: a case belonging to another garage does not authorize evidence use', async () => {
  const client = world({ vehicle_evidence: [{ id: 'ev-1', vin: VIN }] });
  const { record } = await activeCaseWithRecord(client);
  client._tables.service_cases[0].garage_tenant_id = TENANT_B;
  await assert.rejects(
    () => linkEvidence(client, garageA, record.id, { evidence_id: 'ev-1' }), /governed service case/);
});
