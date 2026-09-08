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
/**
 * Outbox events the T3 notifier actually wrote. emitDomainEvent with no pgClient goes through the
 * global supabase client, so capturing `domain_events` inserts here exercises the real emission
 * path rather than a stubbed notifier.
 */
let emittedEvents;
function stubVehicleAuthority() {
  emittedEvents = [];
  vehicleRows = {
    [MY_VIN]: { vin: MY_VIN, owner_id: 'requester-a', current_seller_id: null, tenant_id: null },
    [FOREIGN_VIN]: { vin: FOREIGN_VIN, owner_id: 'someone-else', current_seller_id: null, tenant_id: OTHER_TENANT },
  };
  Object.defineProperty(supabase, 'from', {
    configurable: true,
    writable: true,
    value: (table) => {
      if (table === 'domain_events') {
        return {
          insert(rows) {
            const list = Array.isArray(rows) ? rows : [rows];
            emittedEvents.push(...list);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: `evt-${emittedEvents.length}`, ...list[0] }, error: null }),
              }),
            };
          },
        };
      }
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

// ── T3 lifecycle notifications (§9.12 discipline, applied to logistics) ─────────────────────────
// These are emitted AFTER the audited mutation and are never authoritative. What matters is who
// is told, who is not, and that nothing is claimed beyond the offer's own state.

function quoteRow(overrides = {}) {
  return {
    id: 'lq-1', logistics_request_id: 'ship-open', provider_id: 'provider-b', provider_tenant_id: TENANT_B,
    compatible_container_id: null, service_mode: 'lcl', total_amount: 800, currency: 'USD',
    status: 'SUBMITTED', metadata: {}, created_by: 'provider-b', updated_by: 'provider-b', deleted_at: null,
    ...overrides,
  };
}

function eventsOfType(type) {
  return emittedEvents.filter((event) => event.event_type === type);
}

test('NOTIFY: a submitted offer tells the requester; a draft tells nobody', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow()],
  }));

  await logistics.createLogisticsQuote('ship-open', { total_amount: 800, currency: 'USD', service_mode: 'lcl' }, provider, { supabaseClient: c });
  assert.equal(eventsOfType('diaspora.logistics.quote_submitted').length, 0, 'a DRAFT offer is private to the provider and must notify nobody');

  await logistics.createLogisticsQuote('ship-open', { total_amount: 900, currency: 'USD', service_mode: 'lcl', submit: true }, provider, { supabaseClient: c });
  const submitted = eventsOfType('diaspora.logistics.quote_submitted');
  assert.equal(submitted.length, 1);
  // C1 addressability: the recipient is a literal on the payload, never inferred downstream.
  assert.equal(submitted[0].payload.recipientUserId, 'requester-a');
  assert.equal(submitted[0].payload.status, 'OFFER_RECEIVED');
  assert.equal(submitted[0].payload.reference, 'SHIP-SHIPOPEN');
  assert.equal(submitted[0].payload.route, 'Yokohama, Japan → Harare, Zimbabwe');
  // The provider's own price is commercially private; it must not ride along in the notification.
  assert.ok(!JSON.stringify(submitted[0].payload).includes('900'));
});

test('NOTIFY: award tells the winner and every provider who was not selected — but never a withdrawn one', async () => {
  const winner = quoteRow({ id: 'lq-win', provider_id: 'provider-b' });
  const loser = quoteRow({ id: 'lq-lose', provider_id: 'provider-z', provider_tenant_id: OTHER_TENANT });
  const gone = quoteRow({ id: 'lq-gone', provider_id: 'provider-w', status: 'WITHDRAWN' });
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_request_items: [itemRow()],
    diaspora_logistics_quotes: [winner, loser, gone],
  }), {
    rpc: {
      diaspora_accept_logistics_quote_atomic: (params, { table }) => {
        const request = table('diaspora_logistics_requests').find((row) => row.id === params.p_request_id);
        const accepted = table('diaspora_logistics_quotes').find((row) => row.id === params.p_quote_id);
        request.status = 'AWARDED';
        request.accepted_quote_id = accepted.id;
        accepted.status = 'ACCEPTED';
        return { request, acceptedQuote: accepted, idempotentReplay: false };
      },
    },
  });

  await logistics.acceptLogisticsQuote('ship-open', 'lq-win', requester, { supabaseClient: c });

  const accepted = eventsOfType('diaspora.logistics.quote_accepted');
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].payload.recipientUserId, 'provider-b');
  assert.equal(accepted[0].payload.status, 'OFFER_ACCEPTED');

  const notSelected = eventsOfType('diaspora.logistics.quote_not_selected');
  assert.equal(notSelected.length, 1, 'exactly the competing provider is told — not the winner, not the withdrawn one');
  assert.equal(notSelected[0].payload.recipientUserId, 'provider-z');

  // An award is an offer decision and nothing more. It must not imply approved container space,
  // carrier acceptance, customs or payment.
  const wording = JSON.stringify([...accepted, ...notSelected]);
  assert.ok(!/APPROVED|BOOKED|SHIPPED|CLEARED|PAID/i.test(wording));
});

test('NOTIFY: an idempotent acceptance replay re-notifies nobody', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow({ status: 'AWARDED', accepted_quote_id: 'lq-win' })],
    diaspora_logistics_request_items: [itemRow()],
    diaspora_logistics_quotes: [quoteRow({ id: 'lq-win', status: 'ACCEPTED' })],
  }), {
    rpc: {
      diaspora_accept_logistics_quote_atomic: (params, { table }) => ({
        request: table('diaspora_logistics_requests').find((row) => row.id === params.p_request_id),
        acceptedQuote: table('diaspora_logistics_quotes').find((row) => row.id === params.p_quote_id),
        idempotentReplay: true,
      }),
    },
  });

  const result = await logistics.acceptLogisticsQuote('ship-open', 'lq-win', requester, { supabaseClient: c });
  assert.equal(result.idempotentReplay, true);
  assert.equal(emittedEvents.length, 0, 'a client retry must never re-notify the winner or the losers');
});

// ── The requester's own list must tell them an offer is waiting ──────────────
//
// Found by walking the product: a customer whose request had a SUBMITTED offer saw
// "Waiting for offers · Logistics providers can respond" — indistinguishable from a request
// nobody had answered. The list payload carried no count at all.
//
// The count uses EXACTLY the rule the detail screen uses to build its offer list (neither DRAFT
// nor WITHDRAWN), because a badge that disagrees with the page it opens is worse than no badge.

test('the requester\'s own list counts the offers waiting for them', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_quotes: [quoteRow(), quoteRow({ id: 'lq-2', provider_id: 'provider-b2' })],
  }));
  supabase.from = c.from;
  const [row] = await logistics.listMyLogisticsRequests({}, requester);
  assert.equal(row.offer_count, 2);
});

test('a provider DRAFT is not an offer to anyone, and a WITHDRAWN one is taken back', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow()],
    diaspora_logistics_quotes: [
      quoteRow({ id: 'q1', status: 'DRAFT' }),
      quoteRow({ id: 'q2', status: 'WITHDRAWN' }),
      quoteRow({ id: 'q3', status: 'SUBMITTED' }),
    ],
  }));
  supabase.from = c.from;
  const [row] = await logistics.listMyLogisticsRequests({}, requester);
  assert.equal(row.offer_count, 1, 'only the submitted offer counts');
});

test('an accepted offer still counts — the customer has not lost it', async () => {
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow({ accepted_quote_id: 'q1' })],
    diaspora_logistics_quotes: [quoteRow({ id: 'q1', status: 'ACCEPTED' })],
  }));
  supabase.from = c.from;
  const [row] = await logistics.listMyLogisticsRequests({}, requester);
  assert.equal(row.offer_count, 1);
});

test('a request nobody has answered reports a real, earned zero', async () => {
  const c = createMockSupabase(seed({ diaspora_logistics_requests: [requestRow()] }));
  supabase.from = c.from;
  const [row] = await logistics.listMyLogisticsRequests({}, requester);
  assert.equal(row.offer_count, 0);
});

test('an UNREADABLE count is absent, never reported as zero offers', async () => {
  // DESIGN.md §8.1 — unknown is not zero. If the quotes read fails, the customer must be told
  // nothing rather than told, falsely, that no provider has responded.
  const c = createMockSupabase(seed({ diaspora_logistics_requests: [requestRow()] }));
  supabase.from = (table) => {
    if (table === 'diaspora_logistics_quotes') {
      const failing = {
        select: () => failing, in: () => failing, eq: () => failing,
        is: () => Promise.resolve({ data: null, error: { message: 'quotes unreadable' } }),
      };
      return failing;
    }
    return c.from(table);
  };
  const [row] = await logistics.listMyLogisticsRequests({}, requester);
  assert.ok(!Object.hasOwn(row, 'offer_count'),
    'an unreadable count must be ABSENT so the UI stays silent, not 0');
  assert.equal(row.id, 'ship-open', 'the request itself still lists');
});

test('an offer is attributed to the request it was made on, not spread across rows', async () => {
  // Deliberately hostile: the quotes read returns a FOREIGN request's offers alongside the
  // requester's own, as an over-broad or regressed query would. Isolation must come from
  // attributing each offer to its own logistics_request_id — not from trusting the query to have
  // filtered. (The mock's own `.in()` would otherwise do the isolating and prove nothing, which
  // is exactly what an earlier version of this test did.)
  const c = createMockSupabase(seed({
    diaspora_logistics_requests: [requestRow(), requestRow({ id: 'ship-other', requester_id: 'someone-else' })],
  }));
  supabase.from = (table) => {
    if (table === 'diaspora_logistics_quotes') {
      const rows = [
        quoteRow({ id: 'lq-1', logistics_request_id: 'ship-open' }),
        quoteRow({ id: 'lq-2', logistics_request_id: 'ship-other' }),
        quoteRow({ id: 'lq-3', logistics_request_id: 'ship-other' }),
      ];
      const q = { select: () => q, in: () => q, eq: () => q, is: () => Promise.resolve({ data: rows, error: null }) };
      return q;
    }
    return c.from(table);
  };
  const rows = await logistics.listMyLogisticsRequests({}, requester);
  assert.equal(rows.length, 1, "only the requester's own request lists");
  assert.equal(rows[0].offer_count, 1, 'the two foreign offers must not land on this row');
});
