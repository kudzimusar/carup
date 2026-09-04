/**
 * Trade OS T3 — Logistics RFQ / "Ship something" contracts.
 *
 * The important invariants here are not cosmetic:
 * - logistics demand is separate from procurement demand;
 * - provider discovery is a safe projection, never the requester row;
 * - provider eligibility comes from the commercial profile, not a client role header;
 * - vehicle links are authorized server-side before any cargo item write;
 * - dimensions produce deterministic CBM while unknown measurements stay unknown;
 * - a provider cannot attach another organisation's container to its offer.
 */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { supabase } = await import('../db/supabase.js');
const logistics = await import('../services/diaspora/diasporaLogisticsRfqService.js');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MY_VIN = 'JHMGD18608S200001';
const FOREIGN_VIN = 'JHMGD18608S209999';

const requester = { id: 'requester-a', userId: 'requester-a', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const provider = { id: 'provider-b', userId: 'provider-b', role: 'owner', platformRole: 'owner', tenantId: TENANT_B, tenantRole: 'admin' };
const ordinaryBusiness = { id: 'ordinary-c', userId: 'ordinary-c', role: 'owner', platformRole: 'owner', tenantId: OTHER_TENANT, tenantRole: 'admin' };

function seed(extra = {}) {
  return {
    diaspora_logistics_requests: [],
    diaspora_logistics_request_items: [],
    diaspora_logistics_quotes: [],
    diaspora_container_shipments: [],
    diaspora_cargo_reservations: [],
    diaspora_import_audit_log: [],
    users: [
      { id: 'requester-a', name: 'Requester A' },
      { id: 'provider-b', name: 'Provider Person' },
      { id: 'ordinary-c', name: 'Ordinary Business' },
    ],
    user_registration_profiles: [
      { user_id: 'provider-b', business_type: 'logistics_provider', organization_name: 'Provider B Logistics', country_of_residence: 'Japan', city: 'Yokohama' },
      { user_id: 'ordinary-c', business_type: 'dealer', organization_name: 'Ordinary Dealer', country_of_residence: 'Japan', city: 'Tokyo' },
    ],
    tenants: [
      { id: TENANT_B, name: 'Provider B Logistics' },
      { id: OTHER_TENANT, name: 'Other Logistics' },
    ],
    ...extra,
  };
}

let vehicleRows;
function stubVehicleAuthority() {
  vehicleRows = {
    [MY_VIN]: { vin: MY_VIN, owner_id: 'requester-a', current_seller_id: null, tenant_id: null },
    [FOREIGN_VIN]: { vin: FOREIGN_VIN, owner_id: 'someone-else', current_seller_id: null, tenant_id: OTHER_TENANT },
  };
  Object.defineProperty(supabase, 'from', {
    configurable: true,
    writable: true,
    value: (table) => {
      const chain = {
        _vin: null,
        select() { return chain },
        eq(_column, value) { chain._vin = value; return chain },
        maybeSingle() {
          if (table !== 'vehicles') return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: vehicleRows[chain._vin] || null, error: null });
        },
      };
      return chain;
    },
  });
}

beforeEach(stubVehicleAuthority);
after(() => { delete supabase.from; });

function requestRow(overrides = {}) {
  return {
    id: 'ship-open', tenant_id: null, requester_id: 'requester-a', created_by: 'requester-a',
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
    service_preference: 'flexible', status: 'OPEN_FOR_QUOTES', accepted_quote_id: null, metadata: {}, deleted_at: null,
    ...overrides,
  };
}

function itemRow(overrides = {}) {
  return {
    id: 'item-1', logistics_request_id: 'ship-open', line_number: 1,
    cargo_category: 'boxes', description: 'Household cartons', quantity: 12,
    estimated_volume_cbm: 1.8, estimated_weight_kg: 180, measurement_basis: 'PROVIDED',
    linked_vehicle_vin: null, deleted_at: null,
    ...overrides,
  };
}

test('MARKETPLACE PRIVACY: provider projection excludes requester, tenant and linked VIN', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow({ linked_vehicle_vin: MY_VIN })],
  }));

  const [row] = await logistics.listLogisticsOpportunities({}, provider, { supabaseClient: c });
  assert.equal(row.reference, 'SHIP-SHIPOPEN'.slice(0, 13));
  assert.equal(row.requester_id, undefined);
  assert.equal(row.tenant_id, undefined);
  assert.equal(row.items[0].linked_vehicle_vin, undefined);
  assert.equal(row.items[0].has_linked_vehicle, true);
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('requester-a'));
  assert.ok(!serialized.includes(MY_VIN));
});

test('PROVIDER ELIGIBILITY: an ordinary dealer/business cannot quote logistics demand', async () => {
  const c = createMockSupabase(seed({ diaspora_logistics_requests: [requestRow()] }));
  await assert.rejects(
    () => logistics.listLogisticsOpportunities({}, ordinaryBusiness, { supabaseClient: c }),
    /logistics-provider business profile is required/i,
  );
});

test('PROVIDER ELIGIBILITY: a logistics_provider commercial profile sees cross-tenant open demand safely', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow()],
  }));
  const rows = await logistics.listLogisticsOpportunities({}, provider, { supabaseClient: c });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin_country, 'Japan');
  assert.equal(rows[0].destination_country, 'Zimbabwe');
});

test('TRUTH: dimensions calculate CBM including quantity; unknown measurements remain unknown', async () => {
  const c = createMockSupabase(seed());
  const created = await logistics.createLogisticsRequest({
    origin_country: 'Japan', destination_country: 'Zimbabwe',
    items: [
      { cargo_category: 'boxes', description: '14 cartons', quantity: 14, length_value: 60, width_value: 45, height_value: 40, dimension_unit: 'cm' },
      { cargo_category: 'household', description: 'Loose household effects', quantity: 1 },
    ],
  }, requester, { supabaseClient: c });

  assert.equal(created.items[0].measurement_basis, 'CALCULATED');
  assert.equal(created.items[0].estimated_volume_cbm, 1.512);
  assert.equal(created.items[1].measurement_basis, 'UNKNOWN');
  assert.equal(created.items[1].estimated_volume_cbm, null);
});

test('VEHICLE AUTH: foreign VIN is refused before any cargo row is written', async () => {
  const c = createMockSupabase(seed());
  await assert.rejects(
    () => logistics.createLogisticsRequest({
      origin_country: 'Japan', destination_country: 'Zimbabwe',
      items: [{ cargo_category: 'vehicle', description: 'Toyota Aqua', quantity: 1, linked_vehicle_vin: FOREIGN_VIN }],
    }, requester, { supabaseClient: c }),
    /not authorized to link that vehicle/i,
  );
  assert.equal(c._rows('diaspora_logistics_request_items').length, 0);
});

test('VEHICLE AUTH: requester may link their own canonical CarUp vehicle', async () => {
  const c = createMockSupabase(seed());
  const created = await logistics.createLogisticsRequest({
    origin_country: 'Japan', destination_country: 'Zimbabwe',
    items: [{ cargo_category: 'vehicle', description: 'My Toyota Aqua', quantity: 1, linked_vehicle_vin: MY_VIN }],
  }, requester, { supabaseClient: c });
  assert.equal(created.items[0].linked_vehicle_vin, MY_VIN);
});

test('CONTAINER AUTH: provider cannot attach another organisation\'s sailing to an offer', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow()],
    diaspora_container_shipments: [{
      id: 'foreign-container', tenant_id: OTHER_TENANT, coordinator_id: 'someone-else', status: 'BOOKING_OPEN',
      origin_country: 'Japan', destination_country: 'Zimbabwe', deleted_at: null,
    }],
  }));

  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-open', {
      service_mode: 'shared_container', compatible_container_id: 'foreign-container', total_amount: 900, currency: 'USD', submit: true,
    }, provider, { supabaseClient: c }),
    /cannot offer a container operated by another organisation/i,
  );
  assert.equal(c._rows('diaspora_logistics_quotes').length, 0);
});

test('CONTAINER AUTH: tenant admin may attach own open sailing but it remains only an offer', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow()],
    diaspora_container_shipments: [{
      id: 'own-container', tenant_id: TENANT_B, coordinator_id: 'provider-b', status: 'BOOKING_OPEN',
      origin_country: 'Japan', destination_country: 'Zimbabwe', deleted_at: null,
    }],
  }));

  const quote = await logistics.createLogisticsQuote('ship-open', {
    service_mode: 'shared_container', compatible_container_id: 'own-container',
    freight_amount: 700, handling_amount: 100, total_amount: 800, currency: 'USD', submit: true,
  }, provider, { supabaseClient: c });
  assert.equal(quote.status, 'SUBMITTED');
  assert.equal(quote.compatible_container_id, 'own-container');
  assert.equal(c._rows('diaspora_cargo_reservations').length, 0, 'submitting an offer must not book space');
});

test('SAILING MATCH: route and actual approved capacity are used; matching does not approve anything', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow({ estimated_volume_cbm: 10 })],
    diaspora_container_shipments: [{
      id: 'container-1', tenant_id: TENANT_B, coordinator_id: 'provider-b', status: 'BOOKING_OPEN',
      origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
      departure_date: '2026-10-15T00:00:00Z', booking_deadline: '2026-10-01T00:00:00Z', container_type: '40HC',
      total_capacity_volume: 60, used_capacity_volume: 999, available_capacity_volume: 0, deleted_at: null,
    }],
    diaspora_cargo_reservations: [
      { id: 'approved', container_id: 'container-1', reservation_status: 'APPROVED', estimated_volume: 22, deleted_at: null },
      { id: 'pending', container_id: 'container-1', reservation_status: 'REQUESTED', estimated_volume: 30, deleted_at: null },
    ],
  }));

  const matches = await logistics.findCompatibleSailings('ship-open', requester, { supabaseClient: c });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].available_capacity_cbm, 38, 'capacity must be recomputed from APPROVED reservations, not cached values');
  assert.equal(matches[0].capacity_match, true);
  assert.equal(matches[0].requires_operator_confirmation, true);
  assert.equal(c._rows('diaspora_cargo_reservations').length, 2, 'matching is read-only');
});
