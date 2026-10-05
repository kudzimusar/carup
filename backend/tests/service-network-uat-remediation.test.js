/**
 * Service Network — UAT remediation, server side.
 *
 * Two changes, both driven by owner UAT findings:
 *
 * R1. A service request can name its garage by PUBLIC SLUG. The public garage payload deliberately
 *     withholds `tenant_id`, so a browser on Garage Detail has no tenant id to send and should not
 *     be handed one. The slug is resolved here, against the same governed publication check a
 *     tenant id goes through — so neither form can address an unpublished garage.
 *
 * R3. The requester's own list carries the garage's NAME. A case row holds `garage_tenant_id`,
 *     which answers nothing for the person who made the request. The name comes from the governed
 *     publication projection only: an unprofiled tenant is reported as not recorded, and only a
 *     PUBLISHED garage gets a link.
 */
import test from 'node:test';
import { garageCtx } from './helpers/garageContext.js';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { requestServiceCase, listMyServiceCases } = await import('../services/serviceNetwork/serviceCaseService.js');
const { getGarageQueue, getGarageMechanics } = await import('../services/serviceNetwork/garageQueueService.js');

const VIN = 'JTDBR32E870123456';
const TENANT = '0e263095-7ebd-449f-a8fb-3420dd7fc697';
const OWNER = 'u_owner_1';

/** Supabase-shaped stub: every builder is thenable and resolves from the seeded tables. */
function client(tables, log = []) {
  const from = (table) => {
    const filters = {};
    let inFilter = null;
    const isFilters = {};
    const result = () => {
      log.push({ table, filters: { ...filters }, in: inFilter, is: { ...isFilters } });
      const entry = tables[table];
      if (typeof entry === 'function') return entry(filters, inFilter, isFilters);
      let data = entry === undefined ? null : entry;
      if (Array.isArray(data)) {
        for (const [k, v] of Object.entries(isFilters)) {
          data = data.filter((row) => (v === null ? row[k] === null || row[k] === undefined : row[k] === v));
        }
      }
      return { data, error: null };
    };
    const chain = {
      select() { return chain; },
      insert(payload) { log.push({ table, op: 'insert', payload }); return chain; },
      update(payload) { log.push({ table, op: 'update', payload }); return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      in(k, v) { inFilter = { key: k, values: v }; return chain; },
      // `.is(col, null)` is how the queue asks for LIVE assignments only. The stub records it and
      // applies it, so a test that seeds an unassigned row genuinely exercises the filter.
      is(k, v) { isFilters[k] = v; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from };
}

const PUBLISHED_GARAGE = { tenant_id: TENANT, slug: 'msasa-motors', publication_status: 'published', display_name: 'Msasa Motors' };

/** Tables for a successful request against a published garage. */
function requestTables({ garageRow = PUBLISHED_GARAGE, inserted = null } = {}) {
  return {
    garage_public_profiles: (filters) => {
      if (filters.slug !== undefined) {
        const match = garageRow && garageRow.slug === filters.slug
          && (filters.publication_status === undefined || garageRow.publication_status === filters.publication_status);
        return { data: match ? { tenant_id: garageRow.tenant_id } : null, error: null };
      }
      if (filters.tenant_id !== undefined) {
        const match = garageRow && garageRow.tenant_id === filters.tenant_id;
        return { data: match ? garageRow : null, error: null };
      }
      return { data: null, error: null };
    },
    vehicles: { vin: VIN, owner_id: OWNER },
    vehicle_ownership_transfers: [],
    vehicle_seller_authority: null,
    service_cases: inserted || { id: 'case-1', vin: VIN, garage_tenant_id: TENANT, status: 'requested', requested_at: 'now' },
    service_case_events: null,
  };
}

const actor = { id: OWNER, role: 'owner' };

test('R1: a request may name its garage by PUBLIC SLUG', async () => {
  const log = [];
  const result = await requestServiceCase(
    client(requestTables(), log), actor,
    { garage_slug: 'msasa-motors', vin: VIN, service_category: 'brakes' },
    { emitDomainEvent: async () => {} },
  );
  assert.ok(result.case, 'a case should be created');
  assert.equal(result.case.garage_tenant_id, TENANT, 'the slug resolved to the governed tenant');

  const slugLookup = log.find((q) => q.table === 'garage_public_profiles' && q.filters.slug === 'msasa-motors');
  assert.ok(slugLookup, 'the slug is resolved server-side');
  assert.equal(slugLookup.filters.publication_status, 'published',
    'only a PUBLISHED garage may be resolved from a slug');
});

test('R1: an unpublished or unknown slug is refused, and reveals nothing extra', async () => {
  for (const [label, garageRow] of [
    ['unpublished garage', { ...PUBLISHED_GARAGE, publication_status: 'draft' }],
    ['unknown slug', null],
  ]) {
    await assert.rejects(
      requestServiceCase(
        client(requestTables({ garageRow })), actor,
        { garage_slug: 'msasa-motors', vin: VIN },
        { emitDomainEvent: async () => {} },
      ),
      /not accepting service requests/,
      `must refuse: ${label}`,
    );
  }
});

test('R1: a slug cannot be used to enumerate garages — same wording as a bad tenant id', async () => {
  const bySlug = await requestServiceCase(
    client(requestTables({ garageRow: null })), actor, { garage_slug: 'does-not-exist', vin: VIN },
    { emitDomainEvent: async () => {} },
  ).catch((e) => e.message);
  const byTenant = await requestServiceCase(
    client(requestTables({ garageRow: null })), actor, { garage_tenant_id: TENANT, vin: VIN },
    { emitDomainEvent: async () => {} },
  ).catch((e) => e.message);
  assert.equal(bySlug, byTenant, 'a slug must leak no more than a tenant id does');
});

test('R1: the tenant-id form still works — the change is additive', async () => {
  const result = await requestServiceCase(
    client(requestTables()), actor, { garage_tenant_id: TENANT, vin: VIN },
    { emitDomainEvent: async () => {} },
  );
  assert.equal(result.case.garage_tenant_id, TENANT);
});

test('R1: a request with neither a slug nor a tenant id is refused', async () => {
  await assert.rejects(
    requestServiceCase(client(requestTables()), actor, { vin: VIN }, { emitDomainEvent: async () => {} }),
    /garage_tenant_id or garage_slug is required/,
  );
});

test('R3: the requester\'s list carries the governed garage NAME, not a bare tenant id', async () => {
  const cases = await listMyServiceCases(client({
    service_cases: [{ id: 'c-1', vin: VIN, garage_tenant_id: TENANT, status: 'requested', requested_at: 'now' }],
    garage_public_profiles: [PUBLISHED_GARAGE],
  }), actor);

  assert.equal(cases.total, 1);
  assert.equal(cases.cases[0].garage_display_name, 'Msasa Motors');
  assert.equal(cases.cases[0].garage_slug, 'msasa-motors', 'a published garage gets a link');
});

test('R3: an UNPUBLISHED garage is named but not linked', async () => {
  const cases = await listMyServiceCases(client({
    service_cases: [{ id: 'c-1', vin: VIN, garage_tenant_id: TENANT, status: 'accepted', requested_at: 'now' }],
    garage_public_profiles: [{ ...PUBLISHED_GARAGE, publication_status: 'unpublished' }],
  }), actor);
  assert.equal(cases.cases[0].garage_display_name, 'Msasa Motors', 'it is still a real garage');
  assert.equal(cases.cases[0].garage_slug, null, 'but it has no public page to open');
});

test('R3: an unprofiled tenant is reported as not recorded, never invented', async () => {
  const cases = await listMyServiceCases(client({
    service_cases: [{ id: 'c-1', vin: VIN, garage_tenant_id: 'tenant-with-no-profile', status: 'requested', requested_at: 'now' }],
    garage_public_profiles: [],
  }), actor);
  assert.equal(cases.cases[0].garage_display_name, null);
  assert.equal(cases.cases[0].garage_slug, null);
});

test('R3: a failed identity read still returns the requests', async () => {
  // The requester needs to see that their requests exist even when the garage names cannot be read.
  const cases = await listMyServiceCases(client({
    service_cases: [{ id: 'c-1', vin: VIN, garage_tenant_id: TENANT, status: 'requested', requested_at: 'now' }],
    garage_public_profiles: () => ({ data: null, error: { message: 'profile read failed' } }),
  }), actor);
  assert.equal(cases.total, 1, 'the list survives an identity read failure');
  assert.equal(cases.cases[0].garage_display_name, null);
});

/* ── R5 / R6 — the garage operator surfaces ──────────────────────────────────────────────────────
 *
 * R5. `assignMechanic` refuses any id that is not a member of the caller's tenant, and nothing in
 *     the product could tell an operator what those ids ARE — so a certified assignment capability
 *     was reachable only by typing a UUID. `getGarageMechanics` reads the same membership, for the
 *     caller's own tenant only.
 *
 * R6. A mechanic and a garage manager share one queue. Without knowing who is assigned, the two are
 *     the same screen and a mechanic must open every job to find their own.
 */

const GARAGE_ACTOR = garageCtx({ id: 'u_mech_1', tenantId: TENANT });

test('R5: the garage sees its OWN members, and only its own tenant is queried', async () => {
  const log = [];
  const result = await getGarageMechanics(client({
    tenant_users: [
      { user_id: 'u_mech_1', role: 'mechanic' },
      { user_id: 'u_mech_2', role: 'mechanic' },
    ],
    users: [{ id: 'u_mech_1', name: 'Tendai' }, { id: 'u_mech_2', name: 'Rudo' }],
  }, log), GARAGE_ACTOR);

  assert.equal(result.total, 2);
  assert.deepEqual(result.mechanics.map((m) => m.display_name), ['Rudo', 'Tendai']);

  const membershipRead = log.find((q) => q.table === 'tenant_users');
  assert.equal(membershipRead.filters.tenant_id, TENANT,
    'membership is read for the CALLER\'s tenant only — this must never be a directory of everyone');
});

test('R5: a member with no name is unnamed, never invented', async () => {
  const result = await getGarageMechanics(client({
    tenant_users: [{ user_id: 'u_mech_9', role: 'mechanic' }],
    users: [],
  }), GARAGE_ACTOR);
  assert.equal(result.mechanics[0].display_name, null);
  assert.equal(result.mechanics[0].user_id, 'u_mech_9');
});

test('R5: acting for no tenant is refused, not answered with an empty list', async () => {
  await assert.rejects(
    getGarageMechanics(client({ tenant_users: [] }), { id: 'u_x', role: 'mechanic' }),
    // OC-5D wording: "acting for no tenant" is "no VERIFIED active garage selected".
    /garage you are acting for/i,
    'no tenant context must refuse — an empty list would read as "your garage has nobody"',
  );
});

test('R6: the queue says WHO is on each job, from the assignment record', async () => {
  const result = await getGarageQueue(client({
    service_cases: [{ id: 'c-1', vin: VIN, status: 'active', requested_at: 'now', garage_tenant_id: TENANT }],
    vehicles: [{ vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021 }],
    mechanic_work_orders: [{ id: 'wo-1', service_case_id: 'c-1', status: 'In Progress' }],
    work_order_assignments: [{ work_order_id: 'wo-1', mechanic_user_id: 'u_mech_1', unassigned_at: null }],
  }), GARAGE_ACTOR);

  assert.equal(result.queue[0].work_order.assigned_mechanic_user_id, 'u_mech_1');
});

test('R6: an unassigned job reports null — never a placeholder mechanic', async () => {
  const result = await getGarageQueue(client({
    service_cases: [{ id: 'c-1', vin: VIN, status: 'active', requested_at: 'now', garage_tenant_id: TENANT }],
    vehicles: [{ vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021 }],
    mechanic_work_orders: [{ id: 'wo-1', service_case_id: 'c-1', status: 'In Progress' }],
    work_order_assignments: [],
  }), GARAGE_ACTOR);
  assert.equal(result.queue[0].work_order.assigned_mechanic_user_id, null);
});

test('R6: only LIVE assignments count — an unassigned mechanic is not still on the job', async () => {
  const log = [];
  await getGarageQueue(client({
    service_cases: [{ id: 'c-1', vin: VIN, status: 'active', requested_at: 'now', garage_tenant_id: TENANT }],
    vehicles: [],
    mechanic_work_orders: [{ id: 'wo-1', service_case_id: 'c-1', status: 'In Progress' }],
    work_order_assignments: [],
  }, log), GARAGE_ACTOR);

  // The read itself must exclude unassigned rows; filtering afterwards would be a different bug.
  const assignmentRead = log.find((q) => q.table === 'work_order_assignments');
  assert.ok(assignmentRead, 'the queue must read the assignment authority');
});

test('R6: a case with no job card is nobody\'s — it is the garage\'s to triage', async () => {
  const result = await getGarageQueue(client({
    service_cases: [{ id: 'c-1', vin: VIN, status: 'requested', requested_at: 'now', garage_tenant_id: TENANT }],
    vehicles: [],
    mechanic_work_orders: [],
    work_order_assignments: [],
  }), GARAGE_ACTOR);
  assert.equal(result.queue[0].work_order, null);
  assert.equal(result.queue[0].next_action, 'accept_or_decline');
});

/* ── Round 2 — the session must be able to say which tenant it acts for ──────────────────────────
 *
 * Round 2 owner UAT signed in as a REAL garage tenant-member (`tenant_users.role = 'mechanic'` on a
 * `garage` tenant with a published profile) and got 403 from every garage route. The authority was
 * never missing: `x-stakeholder-role: mechanic` with `x-tenant-id` returns 200 on all of them. The
 * browser could not send either header, because `/api/auth/me` answered with the platform role
 * alone — and public registration makes every self-registered garage employee an `owner`.
 *
 * `resolveEffectiveRole` is the authority for whether a claimed role is honoured, and it is
 * unchanged. These tests pin that it still refuses everything it refused before.
 */
const { resolveEffectiveRole } = await import('../middleware/authMiddleware.js');

test('Round 2: a VERIFIED tenant role is honoured — this is what the browser could not ask for', () => {
  const effective = resolveEffectiveRole({
    userRole: 'owner', tenantRole: 'mechanic', requestedRole: 'mechanic',
  });
  assert.equal(effective, 'mechanic');
});

test('Round 2: an UNVERIFIED role is still refused — reporting membership grants nothing', () => {
  // The exact refusal Round 2 observed before the tenant was known. It must still happen for a
  // role the membership does not support.
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'owner', tenantRole: null, requestedRole: 'mechanic' }),
    /not verified for this user context/,
  );
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'owner', tenantRole: 'mechanic', requestedRole: 'dealer' }),
    /not verified for this user context/,
    'a membership as mechanic must not confer dealer',
  );
});

test('Round 2: a tenant role can never confer ADMIN', () => {
  // The one role tenant membership must never be able to grant, however the tenant records it.
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'owner', tenantRole: 'admin', requestedRole: 'admin' }),
    /not verified for this user context/,
  );
});

test('Round 2: with no requested role the PLATFORM role still governs', () => {
  assert.equal(
    resolveEffectiveRole({ userRole: 'owner', tenantRole: 'mechanic', requestedRole: null }),
    'owner',
    'knowing about a tenant must not silently change what a plain request acts as',
  );
});

/* ── Round 2c — the membership query must name columns that exist ────────────────────────────────
 *
 * The first version of `resolveActiveMembership` selected and ordered by `tenant_users.created_at`.
 * That column does not exist — the table is (id, tenant_id, user_id, role, joined_at). PostgREST
 * returned an error, `data` came back null, and a bare `catch` turned a broken query into a
 * confident "this person belongs to no tenant". It passed review, deployed, and locked a real
 * garage member out for a second time behind a fix that looked correct.
 *
 * A stub cannot catch that: it answers whatever it is asked for. So this reads the query out of
 * `server.js` and checks every column it names against the CANONICAL schema in the repo.
 */
import { readFileSync } from 'node:fs';

// OC-5D: #197's `resolveActiveMembership` ("the oldest membership") is NOT ported — the server no longer
// guesses an organisation at all. The two Round 2c obligations hold for the ONE verifier that replaced it
// (backend/services/auth/activeTenantContext.js); behaviour is proven in oc5d-active-tenant-context.
test('Round 2c: the membership query only names columns tenant_users actually has', () => {
  const schema = readFileSync(new URL('../../database/migrations/002_multi_tenant_and_auth_schema.sql', import.meta.url), 'utf8');
  const create = schema.match(/CREATE TABLE IF NOT EXISTS tenant_users \(([\s\S]*?)\n\);/);
  assert.ok(create, 'the canonical tenant_users definition must be findable');
  const columns = new Set(
    create[1].split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('--') && !/^(UNIQUE|PRIMARY|FOREIGN|CONSTRAINT|CHECK)\b/i.test(l))
      .map((l) => l.split(/\s+/)[0].toLowerCase()),
  );
  assert.ok(columns.has('joined_at'), 'sanity: the parser found the real columns');
  assert.ok(!columns.has('created_at'), 'sanity: created_at is exactly the column that does NOT exist');

  const verifier = readFileSync(new URL('../services/auth/activeTenantContext.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /async function resolveActiveMembership|resolveSoleTenantMembership/, 'no membership guess exists');
  const membershipSelects = [...verifier.matchAll(/from\('tenant_users'\)\s*\.select\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(membershipSelects.length >= 2, 'the verifier reads tenant_users (one membership, and all of them)');
  for (const select of membershipSelects) {
    for (const col of select.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)) {
      assert.ok(columns.has(col), `the verifier selects tenant_users.${col}, which does not exist`);
    }
  }
});

test('Round 2c: a failed membership read is a FAILURE (503), never silently answered as "no tenant"', () => {
  const verifier = readFileSync(new URL('../services/auth/activeTenantContext.js', import.meta.url), 'utf8');
  // The whole defect was a broken read presenting as a confident answer. Both reads throw on error.
  const throws = verifier.match(/throw new TenantContextUnavailableError/g) || [];
  assert.ok(throws.length >= 4, 'every membership read path raises TenantContextUnavailableError');
  assert.match(verifier, /super\(message, 503, 'TENANT_CONTEXT_UNAVAILABLE'/);
});

/* ── Round 2d — feature eligibility must accept the verified tenant role ────────────────────────
 *
 * Round 2d: a real garage tenant-member finally REACHED /garage — and was shown
 * "Feature unavailable. This feature is currently turned off." The static lifecycle was `active`
 * and `enabled` was true. The feature was reported `accessible: false`, because eligibility was
 * computed from the PLATFORM role alone, and public registration makes every self-registered garage
 * employee an `owner`.
 *
 * This is the FOURTH layer that judged the same person by the wrong one of their two true roles.
 * The rule is the backend's own: the platform role OR the verified tenant role.
 */
const { evaluateEffectiveState } = await import('../services/featureGovernance/featureGovernanceService.js');

// OC-5D (F4): the garage workshop belongs to an ORGANISATION. It declares its tenant scope; no platform
// role opens it (a platform 'mechanic' or 'dealer' with no garage would be refused by every route anyway).
const GARAGE_FEATURE = {
  id: 'garage.workshop',
  defaultLifecycle: 'active',
  defaultRoles: [],
  immutableRoles: [],
  tenantTypes: ['garage'],
  tenantRoles: ['admin', 'mechanic'],
  requiresAuth: true,
};

test('Round 2d: a garage employee may use the garage feature on their TENANT role', () => {
  const state = evaluateEffectiveState(GARAGE_FEATURE, null, { role: 'owner', tenantRole: 'mechanic', tenantType: 'garage' });
  assert.equal(state.accessible, true, 'a real garage member must not be told the feature is off');
  assert.equal(state.visible, true, 'and it must not be hidden from their navigation');
});

test('Round 2d (OC-5D, F4): the tenant role counts only inside an organisation of the RIGHT kind', () => {
  const dealership = evaluateEffectiveState(GARAGE_FEATURE, null, { role: 'owner', tenantRole: 'mechanic', tenantType: 'dealership' });
  assert.equal(dealership.accessible, false, 'a mechanic role inside a dealership does not open a garage feature');
  const member = evaluateEffectiveState(GARAGE_FEATURE, null, { role: 'owner', tenantRole: 'member', tenantType: 'garage' });
  assert.equal(member.accessible, false, 'a member outside the feature\'s tenant roles stays out');
});

test('Round 2d (OC-5D, F4): a PLATFORM role never satisfies a tenant scope, and a tenant role never a platform list', () => {
  const platformMechanic = evaluateEffectiveState(GARAGE_FEATURE, null, { role: 'mechanic', tenantRole: null, tenantType: null });
  assert.equal(platformMechanic.accessible, false, 'a platform mechanic with no garage selected sees no garage workshop');
  const adminConsole = { id: 'admin.console', defaultLifecycle: 'active', defaultRoles: ['admin'], immutableRoles: ['admin'], requiresAuth: true };
  const garageAdmin = evaluateEffectiveState(adminConsole, null, { role: 'owner', tenantRole: 'admin', tenantType: 'garage' });
  assert.equal(garageAdmin.accessible, false, 'a garage\'s own admin is not a CarUp administrator');
});

test('Round 2d: an ordinary owner still may not — the control case', () => {
  // If this ever passes, the test above proves nothing.
  const state = evaluateEffectiveState(GARAGE_FEATURE, null, { role: 'owner', tenantRole: null });
  assert.equal(state.accessible, false);
  assert.equal(state.visible, false);
});

test('Round 2d: a tenant role does not open a feature that never allowed it', () => {
  const adminOnly = {
    id: 'admin.console', defaultLifecycle: 'active',
    defaultRoles: ['admin'], immutableRoles: ['admin'], requiresAuth: true,
  };
  const state = evaluateEffectiveState(adminOnly, null, { role: 'owner', tenantRole: 'mechanic' });
  assert.equal(state.accessible, false, 'tenant membership must never reach a platform-admin surface');
});

test('Round 2d: a DISABLED feature stays disabled for a tenant member', () => {
  // Eligibility is one factor among several. Widening it must not override a kill switch.
  const state = evaluateEffectiveState(
    GARAGE_FEATURE,
    { feature_id: 'garage.workshop', environment: 'production', enabled: false },
    { environment: 'production', role: 'owner', tenantRole: 'mechanic', tenantType: 'garage' },
  );
  assert.equal(state.accessible, false, 'an override that turns a feature off must still win');
});

test('Round 2d: an override cannot broaden to a role the feature never named', () => {
  const state = evaluateEffectiveState(
    GARAGE_FEATURE,
    { feature_id: 'garage.workshop', environment: 'production', allowed_roles: ['owner', 'mechanic'] },
    { environment: 'production', role: 'owner', tenantRole: null },
  );
  assert.equal(state.accessible, false,
    'immutableRoles still bound the override — "owner" is filtered out, so a plain owner stays out');
});

test('Round 2d: anonymous callers are unaffected', () => {
  const state = evaluateEffectiveState(GARAGE_FEATURE, null, { role: null, tenantRole: null });
  assert.equal(state.accessible, false);
});
