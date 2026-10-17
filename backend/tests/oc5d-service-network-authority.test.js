/**
 * OC-5D (P4) — the Service Network's authority, as ported from PR #197 onto the verified, explicit
 * active-tenant context. Two layers:
 *
 *   ROUTES, through the SHIPPED app with real sessions and explicit selections:
 *     · a garage route needs a selected ACTIVE GARAGE and a role inside it — no selection, the wrong kind
 *       of organisation, the wrong role, a platform admin with no garage, the x-user-id fallback: refused
 *       by name; a revoked membership stops working on the next request;
 *     · the workspace is {admin, mechanic}; assignment and the public profile are {admin};
 *     · F2: a raw x-tenant-id never makes a stranger a case participant.
 *
 *   SERVICES (the §5 fixes the port carries):
 *     · `source_inquiry_id` is server-side only — a body cannot name or squat another person's inquiry;
 *     · the marketplace bridge has no vehicle-authority bypass, and refuses a guest inquiry;
 *     · a practitioner link is minted by a garage ADMIN, for a mechanic/admin of that garage;
 *     · only a mechanic/admin can be assigned; the picker lists only them;
 *     · a case-born work order awaits the owner (OC-5A) and nothing is recorded until it is authorized;
 *     · provenance and observation sources are not declarable; dates are real; parts are attested on
 *       the same work order; a link's affiliation is its own garage, re-verified;
 *     · failed reads fail — never "no work order", never "no spend", never "this link is not valid".
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { garageCtx } = await import('./helpers/garageContext.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { requestServiceCase } = await import('../services/serviceNetwork/serviceCaseService.js');
const { bridgeInquiryToServiceCase } = await import('../services/serviceNetwork/serviceCaseBridgeService.js');
const { assertPractitionerAuthority } = await import('../services/serviceNetwork/serviceAuthority.js');
const { assignMechanic, createWorkOrderForCase } = await import('../services/serviceNetwork/workOrderAssignmentService.js');
const { getGarageCustomers, getGarageMechanics, getGarageQueue } = await import('../services/serviceNetwork/garageQueueService.js');
const { linkPartRecord, recordMileageObservation, recordService } = await import('../services/serviceNetwork/serviceRecordService.js');
const { ensureServiceLink, resolveServiceLink } = await import('../services/serviceNetwork/serviceLinkService.js');
const { publishMyGarageProfile, upsertMyGarageProfile } = await import('../services/serviceNetwork/garageDirectoryService.js');
const { listOwnerServiceHistory } = await import('../services/serviceNetwork/ownerServiceHistoryService.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const GARAGE = '11111111-1111-1111-1111-111111111111';
const DEALERSHIP = '22222222-2222-2222-2222-222222222222';
const OTHER_GARAGE = '33333333-3333-3333-3333-333333333333';
const VIN = 'OC5DSNVIN0000001';

// ── ROUTES, through the shipped app ─────────────────────────────────────────────────────────────

let world; let restoreWorld; let server; let baseUrl;
function seedWorld() {
  restoreWorld?.();
  const session = (token, user, tenant) => ({ token, user_id: user, active_role: 'owner', active_organization_id: tenant, is_valid: true, expires_at: FUTURE });
  world = createSupabaseWorld({
    users: [
      { id: 'u-admin', name: 'Garage Admin', role: 'owner', is_verified: true },
      { id: 'u-mech', name: 'Garage Mechanic', role: 'owner', is_verified: true },
      { id: 'u-member', name: 'Garage Member', role: 'owner', is_verified: true },
      { id: 'u-dealer', name: 'Dealer Admin', role: 'owner', is_verified: true },
      { id: 'u-padmin', name: 'Platform Admin', role: 'admin', is_verified: true },
      { id: 'u-owner', name: 'Vehicle Owner', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      session('tok-admin', 'u-admin', GARAGE),
      session('tok-mech', 'u-mech', GARAGE),
      session('tok-member', 'u-member', GARAGE),
      session('tok-dealer', 'u-dealer', DEALERSHIP),
      session('tok-padmin', 'u-padmin', null),
      session('tok-unselected', 'u-mech', null),
      session('tok-owner', 'u-owner', null),
    ],
    tenants: [
      { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' },
      { id: DEALERSHIP, name: 'Avondale Dealers', type: 'dealership', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-admin', role: 'admin' },
      { tenant_id: GARAGE, user_id: 'u-mech', role: 'mechanic' },
      { tenant_id: GARAGE, user_id: 'u-member', role: 'member' },
      { tenant_id: DEALERSHIP, user_id: 'u-dealer', role: 'admin' },
    ],
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }],
    service_cases: [{ id: 'case-1', vin: VIN, garage_tenant_id: GARAGE, requester_user_id: 'u-owner', status: 'accepted', requested_at: '2026-10-01T08:00:00.000Z' }],
    mechanic_work_orders: [{ id: 'wo-1', tenant_id: GARAGE, vin: VIN, service_case_id: 'case-1', status: 'In Progress', owner_authorization: 'pending' }],
    work_order_assignments: [],
    service_links: [{ id: 'link-1', public_token: 'tok-link-case', resource_type: 'service_case', resource_id: 'case-1', tenant_id: GARAGE, is_active: true }],
    trust_audit_events: [],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seedWorld();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => seedWorld());

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

test('routes: the garage workspace needs a SELECTED active garage and a role inside it — each refusal by name', async () => {
  const unselected = await call('GET', '/api/garage/queue', { token: 'tok-unselected' });
  assert.equal(unselected.status, 403);
  assert.equal(unselected.body.code, 'ACTIVE_TENANT_REQUIRED', 'membership exists, but nothing was selected — the server never picks');

  const dealership = await call('GET', '/api/garage/queue', { token: 'tok-dealer' });
  assert.equal(dealership.status, 403);
  assert.equal(dealership.body.code, 'ACTIVE_TENANT_TYPE');

  const member = await call('GET', '/api/garage/queue', { token: 'tok-member' });
  assert.equal(member.status, 403);
  assert.equal(member.body.code, 'ACTIVE_TENANT_ROLE', 'a member is not part of the workspace');

  const platformAdmin = await call('GET', '/api/garage/queue', { token: 'tok-padmin' });
  assert.equal(platformAdmin.status, 403, 'no platform-admin bypass — acting for a garage is a garage member\'s act');

  const fallback = await call('GET', '/api/garage/queue', { headers: { 'x-user-id': 'u-mech', 'x-tenant-id': GARAGE } });
  assert.equal(fallback.status, 401, 'the x-user-id fallback never stands in for a session here');

  for (const token of ['tok-mech', 'tok-admin']) {
    const ok = await call('GET', '/api/garage/queue', { token });
    assert.equal(ok.status, 200, `${token}: ${ok.text}`);
    assert.equal(ok.body.total, 1);
  }
});

test('routes: assignment and the public profile are an ADMIN\'s; a mechanic is refused by role', async () => {
  for (const [method, path, body] of [
    ['POST', '/api/service-work-orders/wo-1/assign', { mechanic_user_id: 'u-mech' }],
    ['POST', '/api/garage/profile/publish', undefined],
    ['PUT', '/api/garage/profile', { display_name: 'Mbare Motors' }],
    ['POST', '/api/garage/branches', { name: 'Mbare' }],
  ]) {
    const res = await call(method, path, { token: 'tok-mech', body });
    assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
    assert.equal(res.body.code, 'ACTIVE_TENANT_ROLE');
  }
  const assigned = await call('POST', '/api/service-work-orders/wo-1/assign', { token: 'tok-admin', body: { mechanic_user_id: 'u-mech' } });
  assert.equal(assigned.status, 201, assigned.text);
  assert.equal(world.rows('work_order_assignments')[0].mechanic_user_id, 'u-mech');
});

test('routes: revoking the garage membership ends its authority on the NEXT request', async () => {
  assert.equal((await call('GET', '/api/garage/queue', { token: 'tok-mech' })).status, 200);
  world.tables.tenant_users = world.rows('tenant_users').filter((m) => m.user_id !== 'u-mech');
  const after = await call('GET', '/api/garage/queue', { token: 'tok-mech' });
  assert.equal(after.status, 403);
  assert.equal(after.body.code, 'TENANT_CONTEXT_REVOKED');
});

test('routes (F2): a raw x-tenant-id never makes a stranger a participant of the garage\'s case', async () => {
  // optional-auth resolver: a signed-in stranger naming the garage's tenant id learns nothing
  const forged = await call('GET', '/api/service-links/tok-link-case', { token: 'tok-owner', headers: { 'x-tenant-id': GARAGE } });
  assert.equal(forged.status, 200, forged.text);
  // the owner IS the requester, so pick a non-participant: the dealership's admin
  const stranger = await call('GET', '/api/service-links/tok-link-case', { token: 'tok-dealer', headers: { 'x-tenant-id': GARAGE } });
  assert.equal(stranger.status, 200, stranger.text);
  assert.equal(stranger.body.access, 'not_a_participant', 'a header naming a garage is not membership of it');
  assert.equal(stranger.body.status, undefined, 'not even the case status leaks');
  const garage = await call('GET', '/api/service-links/tok-link-case', { token: 'tok-mech' });
  assert.equal(garage.body.access, 'participant', 'the verified selection is');
  const member = await call('GET', '/api/service-links/tok-link-case', { token: 'tok-member' });
  assert.equal(member.body.access, 'not_a_participant', 'a verified MEMBER of the garage is outside its workspace');
  // and a case detail read by the stranger is not-found, not forbidden (no existence oracle)
  const detail = await call('GET', '/api/service-cases/case-1', { token: 'tok-dealer', headers: { 'x-tenant-id': DEALERSHIP } });
  assert.equal(detail.status, 404);
  // a VERIFIED member of the garage who is outside its workspace is not a participant either
  const memberRead = await call('GET', '/api/service-cases/case-1', { token: 'tok-member' });
  assert.equal(memberRead.status, 404, 'membership alone is not the garage workspace');
  const mechanicRead = await call('GET', '/api/service-cases/case-1', { token: 'tok-mech' });
  assert.equal(mechanicRead.status, 200, mechanicRead.text);
  assert.equal(mechanicRead.body.access_basis, 'garage');
});

test('routes: garage analytics is the active garage\'s — a platform-owner mechanic gets in, a dealership does not', async () => {
  const mechanic = await call('GET', '/api/garage/analytics', { token: 'tok-mech' });
  assert.notEqual(mechanic.status, 403, `a garage employee whose platform role is 'owner' was refused: ${mechanic.text}`);
  assert.notEqual(mechanic.status, 401, mechanic.text);
  const dealership = await call('GET', '/api/garage/analytics', { token: 'tok-dealer' });
  assert.equal(dealership.status, 403);
  assert.equal(dealership.body.code, 'ACTIVE_TENANT_TYPE', 'a dealership is not served "garage intelligence" about itself');
  const member = await call('GET', '/api/garage/analytics', { token: 'tok-member' });
  assert.equal(member.body.code, 'ACTIVE_TENANT_ROLE');
});

test('routes: recording service waits for the OWNER — the OC-5A decision is the only way in', async () => {
  const early = await call('POST', '/api/service-work-orders/wo-1/records', { token: 'tok-mech', body: { work_performed: 'Pads' } });
  assert.equal(early.status, 409, early.text);
  assert.match(early.body.error?.message || early.body.error || '', /awaiting the vehicle owner's authorization/);
  assert.equal(world.rows('service_records').length, 0);
});

// ── SERVICES ────────────────────────────────────────────────────────────────────────────────────

function mockWorld(over = {}) {
  return createMockSupabase({
    users: [{ id: 'u-owner', name: 'Owner' }, { id: 'u-other', name: 'Other' }, { id: 'u-mech', name: 'Mech' }, { id: 'u-member', name: 'Member' }, { id: 'u-admin', name: 'Admin' }],
    vehicles: [{ vin: VIN, owner_id: 'u-owner', mileage: 100000 }, { vin: 'OC5DSNVIN0000002', owner_id: 'u-other' }],
    tenants: [{ id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' }, { id: OTHER_GARAGE, name: 'Other Garage', type: 'garage', status: 'active' }],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-admin', role: 'admin' },
      { tenant_id: GARAGE, user_id: 'u-mech', role: 'mechanic' },
      { tenant_id: GARAGE, user_id: 'u-member', role: 'member' },
      { tenant_id: OTHER_GARAGE, user_id: 'u-mech', role: 'mechanic' },
    ],
    garage_public_profiles: [
      { tenant_id: GARAGE, slug: 'mbare-motors', display_name: 'Mbare Motors', publication_status: 'published' },
      { tenant_id: OTHER_GARAGE, slug: 'other-garage', display_name: 'Other Garage', publication_status: 'published' },
    ],
    garage_branches: [], service_cases: [], service_case_events: [], mechanic_work_orders: [], work_order_assignments: [],
    service_records: [], service_mileage_observations: [], service_record_parts: [], service_record_evidence: [],
    partsentry_logs: [], vehicle_evidence: [], marketplace_inquiries: [], service_links: [], service_capability_grants: [],
    ...over,
  });
}
const owner = { id: 'u-owner', role: 'owner' };
const admin = garageCtx({ id: 'u-admin', tenantId: GARAGE, tenantRole: 'admin' });
const mechanic = garageCtx({ id: 'u-mech', tenantId: GARAGE, tenantRole: 'mechanic' });
const noEmit = { emitDomainEvent: async () => ({ id: 'evt' }) };

test('source_inquiry_id is server-side only: a body naming one is ignored, and cannot squat or fetch another person\'s case', async () => {
  const client = mockWorld();
  const bridged = await requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: GARAGE, request_summary: 'private note' }, { ...noEmit, sourceInquiryId: 'inq-victim' });
  assert.equal(bridged.created, true);
  // another person names the same inquiry id in a body: no hit, no leak — a fresh case of their own
  const attacker = { id: 'u-other', role: 'owner' };
  const own = await requestServiceCase(client, attacker, { vin: 'OC5DSNVIN0000002', garage_tenant_id: GARAGE, source_inquiry_id: 'inq-victim' }, noEmit);
  assert.equal(own.created, true);
  assert.notEqual(own.case.id, bridged.case.id);
  assert.equal(own.case.source_inquiry_id, null, 'a client cannot set it');
  assert.equal(own.case.request_summary, null, 'and never receives another person\'s summary');
  // the bridge replay is only for the SAME request
  await assert.rejects(
    () => requestServiceCase(client, owner, { vin: VIN, garage_tenant_id: OTHER_GARAGE }, { ...noEmit, sourceInquiryId: 'inq-victim' }),
    /already opened a different service case/,
  );
});

test('the marketplace bridge has no authority bypass, and refuses a guest inquiry', async () => {
  const inquiry = (over) => ({ id: 'inq-1', inquiry_type: 'garage_service_request', target_provider_tenant_id: GARAGE, listing_id: VIN, buyer_id: 'u-other', ...over });
  // the buyer is not the vehicle's owner: #197 skipped this check for the bridge
  await assert.rejects(() => bridgeInquiryToServiceCase(mockWorld({ marketplace_inquiries: [inquiry()] }), owner, 'inq-1', noEmit), /Vehicle not found/);
  await assert.rejects(() => bridgeInquiryToServiceCase(mockWorld({ marketplace_inquiries: [inquiry({ buyer_id: null })] }), owner, 'inq-1', noEmit), /without an account/);
  const client = mockWorld({ marketplace_inquiries: [inquiry({ buyer_id: 'u-owner' })] });
  const ok = await bridgeInquiryToServiceCase(client, owner, 'inq-1', noEmit);
  assert.equal(ok.created, true);
  assert.equal(ok.case.source_inquiry_id, 'inq-1');
  const replay = await bridgeInquiryToServiceCase(client, owner, 'inq-1', noEmit);
  assert.equal(replay.created, false);
  assert.equal(replay.case.id, ok.case.id);
});

test('a practitioner link is a garage ADMIN\'s to mint, for a mechanic or admin of THAT garage', async () => {
  const client = mockWorld();
  await assert.rejects(() => assertPractitionerAuthority(client, mechanic, 'u-admin'), /not found/i, 'a mechanic cannot mint a colleague\'s identity');
  await assert.rejects(() => assertPractitionerAuthority(client, admin, 'u-member'), /not found/i, 'a member is not a practitioner');
  await assert.rejects(() => assertPractitionerAuthority(client, { id: 'u-admin', tenantId: GARAGE }, 'u-mech'), /not found/i, 'a bare tenantId (a header claim) is no authority');
  assert.deepEqual(await assertPractitionerAuthority(client, admin, 'u-mech'), { basis: 'garage_affiliation', tenantId: GARAGE });
  assert.deepEqual(await assertPractitionerAuthority(client, mechanic, 'u-mech'), { basis: 'self' });
});

test('only a mechanic or admin can be assigned, and the picker offers only them', async () => {
  const client = mockWorld({ mechanic_work_orders: [{ id: 'wo-1', tenant_id: GARAGE, vin: VIN, status: 'In Progress' }] });
  await assert.rejects(() => assignMechanic(client, admin, 'wo-1', { mechanic_user_id: 'u-member' }), /not a mechanic/);
  await assert.rejects(() => assignMechanic(client, mechanic, 'wo-1', { mechanic_user_id: 'u-mech' }), /role in this garage/);
  const assigned = await assignMechanic(client, admin, 'wo-1', { mechanic_user_id: 'u-mech' });
  assert.equal(assigned.created, true);
  const { mechanics } = await getGarageMechanics(client, admin);
  assert.deepEqual(mechanics.map((m) => m.user_id).sort(), ['u-admin', 'u-mech']);
});

test('a case-born work order awaits the owner; nothing is recorded until the OC-5A decision is "authorized"', async () => {
  const client = mockWorld({ service_cases: [{ id: 'case-1', vin: VIN, garage_tenant_id: GARAGE, requester_user_id: 'u-owner', status: 'accepted' }] });
  const { workOrder } = await createWorkOrderForCase(client, mechanic, 'case-1', {});
  assert.equal(workOrder.owner_authorization, 'pending');
  for (const decision of ['pending', 'declined', 'revoked']) {
    client._tables.mechanic_work_orders[0].owner_authorization = decision;
    await assert.rejects(() => recordService(client, mechanic, workOrder.id, {}), /authoriz/, `${decision} must refuse`);
  }
  client._tables.mechanic_work_orders[0].owner_authorization = 'authorized';
  const { record } = await recordService(client, mechanic, workOrder.id, { work_performed: 'Pads' });
  assert.equal(record.service_authority, 'garage_stated');
});

test('nothing a garage records can be dated in the future or with a date that is not one; observation sources are its own', async () => {
  const client = mockWorld({ mechanic_work_orders: [{ id: 'wo-1', tenant_id: GARAGE, vin: VIN, status: 'In Progress', owner_authorization: 'authorized' }] });
  await assert.rejects(() => recordService(client, mechanic, 'wo-1', { performed_at: '2999-01-01T00:00:00Z' }), /cannot be in the future/);
  await assert.rejects(() => recordService(client, mechanic, 'wo-1', { performed_at: 'last tuesday' }), /not a valid date/);
  const { record } = await recordService(client, mechanic, 'wo-1', { performed_at: '2026-09-30T10:00:00Z' });
  for (const source of ['evidence_backed', 'owner_declared']) {
    await assert.rejects(() => recordMileageObservation(client, mechanic, record.id, { observed_mileage: 1, observation_source: source }), /not its to claim/);
  }
  await assert.rejects(() => recordMileageObservation(client, mechanic, record.id, { observed_mileage: 1, observed_at: '2999-01-01T00:00:00Z' }), /cannot be in the future/);
});

test('a part is linked only when PartSentry attested it on THIS work order', async () => {
  const client = mockWorld({
    mechanic_work_orders: [
      { id: 'wo-1', tenant_id: GARAGE, vin: VIN, status: 'In Progress', owner_authorization: 'authorized' },
      { id: 'wo-2', tenant_id: GARAGE, vin: VIN, status: 'In Progress', owner_authorization: 'authorized' },
    ],
    partsentry_logs: [
      { id: 41, vin: VIN, tenant_id: null },                       // legacy, unattributed
      { id: 42, vin: VIN, tenant_id: GARAGE, work_order_id: 'wo-2' }, // attested on another order
      { id: 43, vin: VIN, tenant_id: GARAGE, work_order_id: 'wo-1' },
    ],
  });
  const { record } = await recordService(client, mechanic, 'wo-1', {});
  await assert.rejects(() => linkPartRecord(client, mechanic, record.id, { partsentry_log_id: 41 }), /not attested on this work order/,
    '#197 let any garage claim an unattributed legacy log');
  await assert.rejects(() => linkPartRecord(client, mechanic, record.id, { partsentry_log_id: 42 }), /not attested on this work order/);
  assert.equal((await linkPartRecord(client, mechanic, record.id, { partsentry_log_id: 43 })).created, true);
});

test('a practitioner link names the garage it was issued for — re-verified, so a person who left is no longer affiliated', async () => {
  const client = mockWorld();
  const { link } = await ensureServiceLink(client, admin, { resource_type: 'practitioner', resource_id: 'u-mech' });
  const scanned = await resolveServiceLink(client, owner, link.public_token);
  assert.deepEqual(scanned.practitioner.affiliation, { display_name: 'Mbare Motors', slug: 'mbare-motors' },
    'the link\'s own garage — not "a" membership of a person who works for two');
  client._tables.tenant_users = client._tables.tenant_users.filter((m) => !(m.user_id === 'u-mech' && m.tenant_id === GARAGE));
  const afterLeaving = await resolveServiceLink(client, owner, link.public_token);
  assert.equal(afterLeaving.practitioner.affiliation, null);
});

test('failed reads fail: never "no work order", never "no spend", never "this link is not valid"', async () => {
  const failing = (table) => {
    const client = mockWorld({
      service_cases: [{ id: 'case-1', vin: VIN, garage_tenant_id: GARAGE, requester_user_id: 'u-owner', status: 'accepted', requested_at: '2026-10-01T00:00:00Z' }],
      service_links: [{ id: 'l1', public_token: 'tok-v', resource_type: 'vehicle', resource_id: VIN, is_active: true }],
    });
    const from = client.from.bind(client);
    client.from = (name) => {
      const builder = from(name);
      if (name !== table) return builder;
      const failure = { data: null, error: { message: 'connection reset' } };
      builder.then = (resolve, reject) => Promise.resolve(failure).then(resolve, reject);
      builder.maybeSingle = async () => failure;
      builder.single = async () => failure;
      return builder;
    };
    return client;
  };
  await assert.rejects(() => getGarageQueue(failing('mechanic_work_orders'), mechanic, {}), /Failed to load work orders/);
  await assert.rejects(() => getGarageCustomers(failing('service_records'), admin), /Failed to load service records/);
  await assert.rejects(() => resolveServiceLink(failing('vehicles'), owner, 'tok-v'), /Failed to resolve link/);
});

test('customer spend counts EVERY record of a case, per currency, never adding currencies together', async () => {
  const client = mockWorld({
    service_cases: [{ id: 'case-1', vin: VIN, garage_tenant_id: GARAGE, requester_user_id: 'u-owner', status: 'completed', requested_at: '2026-10-01T00:00:00Z' }],
    service_records: [
      { id: 'r1', service_case_id: 'case-1', total_cost: 100, currency: 'USD' },
      { id: 'r2', service_case_id: 'case-1', total_cost: 50, currency: 'USD' },
      { id: 'r3', service_case_id: 'case-1', total_cost: 900, currency: 'ZAR' },
    ],
  });
  const { customers } = await getGarageCustomers(client, admin);
  assert.deepEqual(customers[0].spend_by_currency, { USD: 150, ZAR: 900 }, '#197 kept only the last record of a case');
});

test('the public profile is an ADMIN\'s at the service too (defence in depth behind the route gate)', async () => {
  const client = mockWorld({ garage_public_profiles: [] });
  await assert.rejects(() => upsertMyGarageProfile(client, mechanic, { display_name: 'Mbare Motors' }), /role in this garage/);
  await upsertMyGarageProfile(client, admin, { display_name: 'Mbare Motors', location_city: 'Harare', service_categories: ['brakes'] });
  await assert.rejects(() => publishMyGarageProfile(client, mechanic), /role in this garage/);
  const published = await publishMyGarageProfile(client, admin);
  assert.equal(published.profile.publication_status, 'published');
});

test('the owner\'s history: an unreadable Service Network source is a 503, an undeployed one adds nothing', async () => {
  const seeded = (recordsResult) => {
    const client = mockWorld({ mechanic_work_orders: [{ id: 'wo-1', tenant_id: GARAGE, vin: VIN, status: 'Completed' }] });
    const from = client.from.bind(client);
    client.from = (name) => {
      const builder = from(name);
      if (name === 'service_records') builder.then = (resolve, reject) => Promise.resolve(recordsResult).then(resolve, reject);
      return builder;
    };
    return client;
  };
  await assert.rejects(() => listOwnerServiceHistory(seeded({ data: null, error: { message: 'connection reset' } }), 'u-owner'),
    (error) => error.statusCode === 503);
  const undeployed = await listOwnerServiceHistory(seeded({ data: null, error: { code: '42P01', message: 'relation "service_records" does not exist' } }), 'u-owner');
  assert.equal(undeployed.length, 1);
  assert.equal(undeployed[0].provenance, undefined, 'no enrichment keys at all — not "unknown" claimed from a table that is not there');
});

test('only a GARAGE has practitioners: a dealership admin cannot mint a practitioner link for its own staff', async () => {
  const client = mockWorld({
    tenants: [{ id: DEALERSHIP, name: 'Avondale Dealers', type: 'dealership', status: 'active' }],
    tenant_users: [{ tenant_id: DEALERSHIP, user_id: 'u-admin', role: 'admin' }, { tenant_id: DEALERSHIP, user_id: 'u-mech', role: 'mechanic' }],
  });
  const dealershipAdmin = garageCtx({ id: 'u-admin', tenantId: DEALERSHIP, tenantRole: 'admin', type: 'dealership' });
  await assert.rejects(() => assertPractitionerAuthority(client, dealershipAdmin, 'u-mech'), /not found/i);
});

test('a practitioner link\'s garage is the one the authority was PROVEN in — never a bare tenantId field', async () => {
  const client = mockWorld();
  // A context whose loose `tenantId` disagrees with its verified activeTenant (the middleware never builds
  // one; the service must not care): the link is stamped with the VERIFIED garage.
  const inconsistent = { ...admin, tenantId: OTHER_GARAGE };
  await ensureServiceLink(client, inconsistent, { resource_type: 'practitioner', resource_id: 'u-mech' });
  assert.equal(client._tables.service_links[0].tenant_id, GARAGE);
});
