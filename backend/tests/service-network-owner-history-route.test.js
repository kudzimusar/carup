/**
 * Service Network S6 — the MOUNTED /api/service-history/me route serves the governed projection.
 *
 * Why this file exists
 * --------------------
 * This endpoint has now regressed once. The post-#194 reconciliation took main's side of
 * backend/server.js wholesale, which reinstated a raw `select('*')` over mechanic_work_orders in
 * place of the governed owner projection. Nothing failed, because no test asserted what the
 * *mounted route* does — only what the service does when called directly.
 *
 * The discriminator used below is exact: the governed projection refuses a request with no owner
 * identity by throwing ForbiddenError('An authenticated owner is required') → HTTP 403. The legacy
 * raw implementation cannot produce that: it would query Supabase with an undefined owner_id and
 * answer 200 [] or 500. So a 403 with that message, produced by the handler registered in the live
 * Express stack, proves the delegation is in place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { app } = await import('../server.js');
const { getOwnerServiceHistory } = await import('../services/serviceNetwork/ownerServiceHistoryService.js');

const ROUTE = '/api/service-history/me';

/** Pull the layer for a given method+path out of the LIVE router stack. */
function findRouteLayer(application, method, path) {
  const stack = application._router?.stack || application.router?.stack || [];
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods?.[method]) return layer.route;
  }
  return null;
}

/** Minimal Express-shaped response recorder. */
function recorder() {
  const captured = { statusCode: 200, body: undefined };
  const res = {
    status(code) { captured.statusCode = code; return res; },
    json(payload) { captured.body = payload; return res; },
  };
  return { res, captured };
}

/** A Supabase-shaped stub: every builder is thenable and resolves to a queued table result. */
function stubClient(tables, log = []) {
  const from = (table) => {
    const state = { table, filters: {} };
    const result = () => {
      log.push(state);
      const entry = tables[table];
      return entry === undefined ? { data: [], error: null } : entry;
    };
    const chain = {
      select() { return chain; },
      eq(key, value) { state.filters[key] = value; return chain; },
      in(key, value) { state.filters[key] = value; return chain; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return chain;
  };
  return { from };
}

// ---------------------------------------------------------------------------------------------
// Integration: the mounted route, not the service in isolation
// ---------------------------------------------------------------------------------------------

test('S6 route: the endpoint is registered in the live Express stack', () => {
  const route = findRouteLayer(app, 'get', ROUTE);
  assert.ok(route, `${ROUTE} is not mounted`);
  // authorizeRole + the handler. The route must not be reachable without an authorization gate.
  assert.ok(route.stack.length >= 2, 'the mounted route must compose an authorization middleware before its handler');
});

test('S6 route: the MOUNTED handler delegates to the governed projection, not a raw table dump', async () => {
  const route = findRouteLayer(app, 'get', ROUTE);
  const handler = route.stack[route.stack.length - 1].handle;

  const { res, captured } = recorder();
  // No owner identity. Only the governed projection answers this with 403 + this exact message;
  // the legacy `select('*')` implementation answers 200 [] or 500.
  await handler({ userContext: {} }, res, () => {});

  assert.equal(captured.statusCode, 403,
    'the mounted handler did not refuse an unauthenticated owner the way the governed projection does — '
    + 'the raw mechanic_work_orders implementation has most likely been reinstated');
  assert.match(String(captured.body?.error || ''), /An authenticated owner is required/);
});

// ---------------------------------------------------------------------------------------------
// The governed contract the route now serves
// ---------------------------------------------------------------------------------------------

test('S6: ownership-authorized — the projection is scoped to the calling owner', async () => {
  const log = [];
  const client = stubClient({ vehicles: { data: [], error: null } }, log);
  await getOwnerServiceHistory(client, { id: 'owner-1' });
  const vehicleQuery = log.find((q) => q.table === 'vehicles');
  assert.equal(vehicleQuery.filters.owner_id, 'owner-1', 'vehicles must be filtered by the caller');
});

test('S6: an unavailable source is an error, never an empty history', async () => {
  const unreadableVehicles = stubClient({ vehicles: { data: null, error: { message: 'connection reset' } } });
  await assert.rejects(
    getOwnerServiceHistory(unreadableVehicles, { id: 'owner-1' }),
    /Failed to load vehicles/,
    'an unreadable vehicle source must not be reported to the owner as "no service history"',
  );

  const unreadableWorkOrders = stubClient({
    vehicles: { data: [{ vin: 'JTDBR32E870123456' }], error: null },
    mechanic_work_orders: { data: null, error: { message: 'statement timeout' } },
  });
  await assert.rejects(
    getOwnerServiceHistory(unreadableWorkOrders, { id: 'owner-1' }),
    /Failed to load service history/,
  );
});

test('S6: absent money stays absent — never rendered as zero, never assumed USD', async () => {
  const client = stubClient({
    vehicles: { data: [{ vin: 'JTDBR32E870123456' }], error: null },
    mechanic_work_orders: {
      data: [
        { id: 'wo-1', vin: 'JTDBR32E870123456', tenant_id: 't-1', status: 'completed', total_cost: null, currency: null },
        // Recorded amount with NO currency: not safely displayable as money.
        { id: 'wo-2', vin: 'JTDBR32E870123456', tenant_id: 't-1', status: 'completed', total_cost: 120, currency: null },
        { id: 'wo-3', vin: 'JTDBR32E870123456', tenant_id: 't-1', status: 'completed', total_cost: 250, currency: 'ZiG' },
      ],
      error: null,
    },
    service_records: { data: [], error: null },
    garage_public_profiles: { data: [], error: null },
  });

  const { entries } = await getOwnerServiceHistory(client, { id: 'owner-1' });
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

  assert.deepEqual(byId['wo-1'].cost, { recorded: false, amount: null, currency: null });
  assert.deepEqual(byId['wo-2'].cost, { recorded: false, amount: null, currency: null },
    'an amount without a currency is not money and must not be displayed as one');
  assert.deepEqual(byId['wo-3'].cost, { recorded: true, amount: 250, currency: 'ZiG' },
    'currency is carried through as recorded, not normalised to USD');
  for (const entry of entries) assert.notEqual(entry.cost.amount, 0, 'absent cost must never become 0');
});

test('S6: provider identity is never fabricated — an unprofiled garage is reported unknown', async () => {
  const client = stubClient({
    vehicles: { data: [{ vin: 'JTDBR32E870123456' }], error: null },
    mechanic_work_orders: {
      data: [
        { id: 'wo-known', vin: 'JTDBR32E870123456', tenant_id: 't-published', status: 'completed' },
        { id: 'wo-unpublished', vin: 'JTDBR32E870123456', tenant_id: 't-draft', status: 'completed' },
        { id: 'wo-unprofiled', vin: 'JTDBR32E870123456', tenant_id: 't-none', status: 'completed' },
      ],
      error: null,
    },
    service_records: { data: [], error: null },
    garage_public_profiles: {
      data: [
        { tenant_id: 't-published', display_name: 'Msasa Motors', slug: 'msasa-motors', publication_status: 'published' },
        { tenant_id: 't-draft', display_name: 'Belgravia Auto', slug: 'belgravia-auto', publication_status: 'draft' },
      ],
      error: null,
    },
  });

  const { entries } = await getOwnerServiceHistory(client, { id: 'owner-1' });
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

  assert.deepEqual(byId['wo-known'].provider, { known: true, display_name: 'Msasa Motors', slug: 'msasa-motors' });
  assert.deepEqual(byId['wo-unpublished'].provider, { known: true, display_name: 'Belgravia Auto', slug: null },
    'an unpublished garage is a real provider but has no public page to link to');
  assert.deepEqual(byId['wo-unprofiled'].provider, { known: false, display_name: null, slug: null });

  for (const entry of entries) {
    assert.notEqual(entry.provider.display_name, 'Garage',
      'the generic literal "Garage" is the exact truth debt this projection exists to retire');
  }
});

test('S6: the response is a canonical projection, not a raw row dump', async () => {
  const client = stubClient({
    vehicles: { data: [{ vin: 'JTDBR32E870123456' }], error: null },
    mechanic_work_orders: {
      data: [{
        id: 'wo-1',
        vin: 'JTDBR32E870123456',
        tenant_id: 't-1',
        status: 'completed',
        // Fields a raw select('*') would leak straight to the owner surface.
        internal_notes: 'customer disputes the bill',
        assigned_mechanic_id: 'mech-9',
        updated_at: '2026-09-01T00:00:00Z',
      }],
      error: null,
    },
    service_records: { data: [], error: null },
    garage_public_profiles: { data: [], error: null },
  });

  const { entries, total } = await getOwnerServiceHistory(client, { id: 'owner-1' });
  assert.equal(total, 1);
  const [entry] = entries;

  assert.equal(entry.internal_notes, undefined, 'private work-order columns must not reach the owner projection');
  assert.equal(entry.assigned_mechanic_id, undefined);
  assert.equal(entry.updated_at, undefined, 'completion time is the stamped column, never updated_at');

  // The governed shape, present regardless of what the underlying row happened to contain.
  for (const field of ['provider', 'cost', 'provenance', 'completed_at', 'mileage_observation']) {
    assert.ok(field in entry, `governed projection field missing: ${field}`);
  }
  assert.equal(entry.provenance, 'unknown', 'with no service record, provenance is unknown — not assumed');
});
