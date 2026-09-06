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
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { requestServiceCase, listMyServiceCases } = await import('../services/serviceNetwork/serviceCaseService.js');

const VIN = 'JTDBR32E870123456';
const TENANT = '0e263095-7ebd-449f-a8fb-3420dd7fc697';
const OWNER = 'u_owner_1';

/** Supabase-shaped stub: every builder is thenable and resolves from the seeded tables. */
function client(tables, log = []) {
  const from = (table) => {
    const filters = {};
    let inFilter = null;
    const result = () => {
      log.push({ table, filters: { ...filters }, in: inFilter });
      const entry = tables[table];
      if (typeof entry === 'function') return entry(filters, inFilter);
      return { data: entry === undefined ? null : entry, error: null };
    };
    const chain = {
      select() { return chain; },
      insert(payload) { log.push({ table, op: 'insert', payload }); return chain; },
      update(payload) { log.push({ table, op: 'update', payload }); return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      in(k, v) { inFilter = { key: k, values: v }; return chain; },
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
