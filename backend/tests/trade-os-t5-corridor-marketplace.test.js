/**
 * Trade OS T5 — corridor authority, corridor-aware discovery, sailing lifecycle, mode
 * reconciliation and the requester's lifecycle controls.
 *
 * The invariant everything here protects (master plan §40): a customer's FINAL DESTINATION is not
 * the destination of the sailing they book. Harare stays Harare while the ocean leg ends at
 * Beira — and nothing in that composition auto-books, invents an inland leg, or claims the cargo
 * shipped.
 */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const { createMockSupabase, DIASPORA_RPCS } = await import('./helpers/mockSupabase.js');
const { supabase } = await import('../db/supabase.js');
const corridorSvc = await import('../services/diaspora/tradeCorridorService.js');
const containers = await import('../services/diaspora/diasporaContainerMarketplaceService.js');
const logistics = await import('../services/diaspora/diasporaLogisticsRfqService.js');

const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const requester = { id: 'requester-a', userId: 'requester-a', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const stranger = { id: 'stranger-x', userId: 'stranger-x', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const provider = { id: 'provider-b', userId: 'provider-b', role: 'owner', platformRole: 'owner', tenantId: TENANT_B, tenantRole: 'admin' };
const foreignOperator = { id: 'ordinary-c', userId: 'ordinary-c', role: 'owner', platformRole: 'owner', tenantId: OTHER_TENANT, tenantRole: 'admin' };
const reviewer = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null, tenantRole: null };

// ── Corridor reference fixtures: exactly the migration's JP-BEI-ZW shape ──
const CORRIDOR_BEI = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const CORRIDOR_DUR = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
function corridorRows() {
  return [
    { id: CORRIDOR_BEI, code: 'JP-BEI-ZW', display_name: 'Japan → Beira → Zimbabwe', origin_country: 'Japan', destination_country: 'Zimbabwe', planning_status: 'benchmark_candidate', active: true, deleted_at: null },
    { id: CORRIDOR_DUR, code: 'JP-DUR-ZW', display_name: 'Japan → Durban → Zimbabwe', origin_country: 'Japan', destination_country: 'Zimbabwe', planning_status: 'benchmark_candidate', active: true, deleted_at: null },
  ];
}
function legRows() {
  return [
    { id: 'leg-bei-1', corridor_id: CORRIDOR_BEI, sequence: 1, origin_country: 'Japan', origin_locality: null, destination_country: 'Mozambique', destination_locality: 'Beira', mode_options: ['ocean', 'shared_container'], jurisdiction_country: 'Mozambique', deleted_at: null },
    { id: 'leg-bei-2', corridor_id: CORRIDOR_BEI, sequence: 2, origin_country: 'Mozambique', origin_locality: 'Beira', destination_country: 'Zimbabwe', destination_locality: 'Forbes/Machipanda', mode_options: ['road'], jurisdiction_country: 'Mozambique', deleted_at: null },
    { id: 'leg-bei-3', corridor_id: CORRIDOR_BEI, sequence: 3, origin_country: 'Zimbabwe', origin_locality: 'Forbes/Machipanda', destination_country: 'Zimbabwe', destination_locality: 'Harare', mode_options: ['road'], jurisdiction_country: 'Zimbabwe', deleted_at: null },
    { id: 'leg-dur-1', corridor_id: CORRIDOR_DUR, sequence: 1, origin_country: 'Japan', origin_locality: null, destination_country: 'South Africa', destination_locality: 'Durban', mode_options: ['ocean'], jurisdiction_country: 'South Africa', deleted_at: null },
    { id: 'leg-dur-2', corridor_id: CORRIDOR_DUR, sequence: 2, origin_country: 'South Africa', origin_locality: 'Durban', destination_country: 'Zimbabwe', destination_locality: 'Beitbridge', mode_options: ['road'], jurisdiction_country: 'South Africa', deleted_at: null },
  ];
}

function seed(extra = {}) {
  return {
    diaspora_trade_corridors: corridorRows(),
    diaspora_trade_corridor_legs: legRows(),
    diaspora_container_shipments: [],
    diaspora_cargo_reservations: [],
    diaspora_logistics_requests: [],
    diaspora_logistics_request_items: [],
    diaspora_logistics_quotes: [],
    diaspora_import_audit_log: [],
    users: [
      { id: 'requester-a', name: 'Requester A' }, { id: 'stranger-x', name: 'Stranger X' },
      { id: 'provider-b', name: 'Provider Person' }, { id: 'ordinary-c', name: 'Foreign Operator' },
      { id: 'rev', name: 'Reviewer' },
    ],
    user_registration_profiles: [
      { user_id: 'provider-b', business_type: 'logistics_provider', organization_name: 'Provider B Logistics', country_of_residence: 'Japan', city: 'Yokohama' },
      { user_id: 'ordinary-c', business_type: 'logistics_provider', organization_name: 'Other Logistics', country_of_residence: 'Japan', city: 'Tokyo' },
    ],
    tenants: [
      { id: TENANT_B, name: 'Provider B Logistics' },
      { id: OTHER_TENANT, name: 'Other Logistics' },
    ],
    ...extra,
  };
}
const client = (extra = {}) => createMockSupabase(seed(extra), { rpc: DIASPORA_RPCS });

function beiraSailing(overrides = {}) {
  return {
    id: 'sail-beira', tenant_id: TENANT_B, coordinator_id: 'provider-b',
    origin_country: 'Japan', origin_city: 'Yokohama',
    destination_country: 'Mozambique', destination_city: 'Beira',
    origin_port: 'Yokohama', destination_port: 'Beira',
    corridor_id: null, corridor_leg_id: null,
    departure_date: '2027-03-18T00:00:00Z', booking_deadline: '2027-03-10T00:00:00Z',
    container_type: '40HC', status: 'BOOKING_OPEN',
    total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60,
    metadata: {}, deleted_at: null,
    ...overrides,
  };
}
function zwRequest(overrides = {}) {
  return {
    id: 'ship-zw', tenant_id: null, requester_id: 'requester-a', created_by: 'requester-a',
    origin_country: 'Japan', origin_city: 'Yokohama',
    destination_country: 'Zimbabwe', destination_city: 'Harare',
    service_preference: 'flexible', status: 'OPEN_FOR_QUOTES',
    accepted_quote_id: null, metadata: {}, deleted_at: null,
    ...overrides,
  };
}
function zwItem(overrides = {}) {
  return {
    id: 'item-zw', logistics_request_id: 'ship-zw', line_number: 1,
    cargo_category: 'vehicle', description: 'Toyota Alphard', quantity: 1,
    estimated_volume_cbm: 18, estimated_weight_kg: 2100, measurement_basis: 'PROVIDED',
    linked_vehicle_vin: null, deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => { delete supabase.from; });
after(() => { delete supabase.from; });

// ═══ 1. The pure route decision ═══════════════════════════════════════════

test('direct compatibility is preserved exactly as before', () => {
  const match = corridorSvc.sailingRouteMatch(
    { origin_country: 'Japan', destination_country: 'Zimbabwe' },
    { origin_country: 'Japan', destination_country: 'Zimbabwe' },
    []);
  assert.deepEqual(match, { route_kind: 'direct' });
});

test('THE CORRECTION: a Yokohama→Beira sailing serves a Harare request via JP-BEI-ZW', async () => {
  const corridors = await corridorSvc.listActiveCorridors({ supabaseClient: client() });
  const match = corridorSvc.sailingRouteMatch(beiraSailing(), zwRequest(), corridors);
  assert.equal(match.route_kind, 'gateway');
  assert.equal(match.corridor.code, 'JP-BEI-ZW');
  assert.equal(match.sailing_leg.destination_locality, 'Beira');
  // The onward legs are the ROUTE that remains — knowledge, not bookings.
  assert.deepEqual(match.onward_legs.map((l) => l.destination_locality), ['Forbes/Machipanda', 'Harare']);
});

test('no applicable corridor means NO match — geography is never invented', async () => {
  const corridors = await corridorSvc.listActiveCorridors({ supabaseClient: client() });
  // A Kenya-bound sailing serves no Zimbabwe corridor we know.
  assert.equal(corridorSvc.sailingRouteMatch(beiraSailing({ destination_country: 'Kenya' }), zwRequest(), corridors), null);
  // A Germany-origin request is not served by Japan legs even though the leg shape half-matches.
  assert.equal(corridorSvc.sailingRouteMatch(beiraSailing(), zwRequest({ origin_country: 'Germany' }), corridors), null);
});

test('corridors list in CODE order and never carry a preference', async () => {
  const corridors = await corridorSvc.listActiveCorridors({ supabaseClient: client() });
  assert.deepEqual(corridors.map((c) => c.code), ['JP-BEI-ZW', 'JP-DUR-ZW']);
  for (const c of corridors) {
    assert.ok(!('preferred' in c) && !('rank' in c) && !('score' in c), 'no preference facts may exist');
    assert.ok(!('created_by' in c) && !('metadata' in c), 'projection is allow-listed');
  }
});

// ═══ 2. Sailing lifecycle ═════════════════════════════════════════════════

test('publish:false records a DRAFT; the default remains immediately open', async () => {
  const c = client();
  const draft = await containers.createContainer({
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Mozambique', destination_city: 'Beira',
    departure_date: '2027-03-18', booking_deadline: '2027-03-10', total_capacity_volume: 60, publish: false,
  }, reviewer, { supabaseClient: c });
  assert.equal(draft.status, 'DRAFT');
  const open = await containers.createContainer({
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Mozambique', destination_city: 'Beira',
    departure_date: '2027-03-18', booking_deadline: '2027-03-10', total_capacity_volume: 60,
  }, reviewer, { supabaseClient: c });
  assert.equal(open.status, 'BOOKING_OPEN');
});

test('a DRAFT cannot take reservations — creating is not publishing', async () => {
  const c = client({ diaspora_container_shipments: [beiraSailing({ status: 'DRAFT' })] });
  await assert.rejects(
    () => containers.requestReservation('sail-beira', { estimated_volume: 10 }, requester, { supabaseClient: c }),
    /not open for booking/i);
});

test('openBooking publishes a DRAFT — operator only, DRAFT only', async () => {
  const c = client({ diaspora_container_shipments: [beiraSailing({ status: 'DRAFT' })] });
  await assert.rejects(() => containers.openBooking('sail-beira', stranger, { supabaseClient: c }), /reviewers|admins/i);
  const opened = await containers.openBooking('sail-beira', provider, { supabaseClient: c });
  assert.equal(opened.status, 'BOOKING_OPEN');
  await assert.rejects(() => containers.openBooking('sail-beira', provider, { supabaseClient: c }), /Only a DRAFT/i);
});

test('cancelSailing refuses while ANY live reservation exists, then releases', async () => {
  const c = client({ diaspora_container_shipments: [beiraSailing()] });
  const r = await containers.requestReservation('sail-beira', { estimated_volume: 10 }, requester, { supabaseClient: c });
  await assert.rejects(() => containers.cancelSailing('sail-beira', provider, { supabaseClient: c }), /live reservation/i);
  await containers.cancelReservation(r.id, requester, { supabaseClient: c });
  const cancelled = await containers.cancelSailing('sail-beira', provider, { supabaseClient: c });
  assert.equal(cancelled.status, 'CANCELLED');
});

test('ANTI-BYPASS: ?status=DRAFT shows a participant nothing, the operator their own', async () => {
  const c = client({ diaspora_container_shipments: [beiraSailing({ status: 'DRAFT' })] });
  const asStranger = await containers.listOpenContainers({ status: 'DRAFT' }, stranger, { supabaseClient: c });
  assert.equal(asStranger.length, 0, "a competitor's unpublished plan is invisible");
  const asOperator = await containers.listOpenContainers({ status: 'DRAFT' }, provider, { supabaseClient: c });
  assert.equal(asOperator.length, 1);
});

test('ANTI-BYPASS: a foreign DRAFT read by id is NotFound, not a confirmation', async () => {
  const c = client({ diaspora_container_shipments: [beiraSailing({ status: 'DRAFT' })] });
  await assert.rejects(() => containers.getContainerCapacity('sail-beira', stranger, { supabaseClient: c }), /not found/i);
  const own = await containers.getContainerCapacity('sail-beira', provider, { supabaseClient: c });
  assert.equal(own.container.id, 'sail-beira');
});

test('a declared corridor leg must actually cover the sailing route', async () => {
  const c = client();
  const base = {
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Mozambique', destination_city: 'Beira',
    departure_date: '2027-03-18', booking_deadline: '2027-03-10', total_capacity_volume: 60,
  };
  await assert.rejects(
    () => containers.createContainer({ ...base, corridor_leg_id: 'leg-bei-1' }, reviewer, { supabaseClient: c }),
    /requires corridor_id/i);
  await assert.rejects(
    () => containers.createContainer({ ...base, corridor_id: CORRIDOR_BEI, corridor_leg_id: 'leg-bei-2' }, reviewer, { supabaseClient: c }),
    /does not cover/i, 'the Beira→Forbes road leg cannot label an ocean sailing');
  const ok = await containers.createContainer({ ...base, corridor_id: CORRIDOR_BEI, corridor_leg_id: 'leg-bei-1' }, reviewer, { supabaseClient: c });
  assert.equal(ok.corridor_leg_id, 'leg-bei-1');
});

// ═══ 3. Corridor-aware discovery and provider attachment ═════════════════

test('discovery surfaces the gateway sailing with the WHOLE truth', async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing()],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const matches = await logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: c });
  assert.equal(matches.length, 1);
  const m = matches[0];
  assert.equal(m.route_kind, 'gateway');
  assert.equal(m.corridor.code, 'JP-BEI-ZW');
  assert.equal(m.final_destination.country, 'Zimbabwe', 'the customer destination is NEVER rewritten');
  assert.equal(m.final_destination.city, 'Harare');
  assert.deepEqual(m.onward_legs.map((l) => l.destination_locality), ['Forbes/Machipanda', 'Harare']);
  assert.ok(m.match_reasons.some((r) => /onward inland\/transit legs are still required/i.test(r)),
    'the remaining route is stated, not implied covered');
  assert.equal(m.requires_operator_confirmation, true, 'a match never auto-books');
});

test('a direct sailing still matches and reads as direct', async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing({ id: 'sail-direct', destination_country: 'Zimbabwe', destination_city: 'Harare', destination_port: null })],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const matches = await logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: c });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].route_kind, 'direct');
  assert.equal(matches[0].corridor, null);
});

test('PROVIDER ATTACH: the Beira sailing they operate now serves the Zimbabwe request', async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing()],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const quote = await logistics.createLogisticsQuote('ship-zw', {
    service_mode: 'shared_container', total_amount: 2600, currency: 'USD',
    compatible_container_id: 'sail-beira',
  }, provider, { supabaseClient: c });
  assert.equal(quote.compatible_container_id, 'sail-beira');
});

test('PROVIDER ATTACH: still refused when no corridor serves the route', async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing({ destination_country: 'Kenya', destination_city: 'Mombasa' })],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-zw', {
      service_mode: 'shared_container', total_amount: 2600, compatible_container_id: 'sail-beira',
    }, provider, { supabaseClient: c }),
    /does not serve this shipping request/i);
});

test("PROVIDER ATTACH: a foreign operator's sailing is still refused (regression)", async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing()],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-zw', {
      service_mode: 'shared_container', total_amount: 2600, compatible_container_id: 'sail-beira',
    }, foreignOperator, { supabaseClient: c }),
    /operated by another organisation/i);
});

test("MODE: an offer can now say 'roro' — but a roro offer cannot attach a container", async () => {
  const c = client({
    diaspora_container_shipments: [beiraSailing()],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const roro = await logistics.createLogisticsQuote('ship-zw', {
    service_mode: 'roro', total_amount: 1900, currency: 'USD',
  }, provider, { supabaseClient: c });
  assert.equal(roro.service_mode, 'roro');
  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-zw', {
      service_mode: 'roro', total_amount: 1900, compatible_container_id: 'sail-beira',
    }, provider, { supabaseClient: c }),
    /RoRo offer cannot attach/i);
});

test('MODE: an invented service mode is still refused', async () => {
  const c = client({
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-zw', { service_mode: 'hovercraft', total_amount: 100 }, provider, { supabaseClient: c }),
    /Unsupported logistics service mode/i);
});

// ═══ 4. The requester's lifecycle controls (the standing §36.10 gap) ═════

test('a requester can CANCEL their own open request before any acceptance', async () => {
  const c = client({ diaspora_logistics_requests: [zwRequest()], diaspora_logistics_request_items: [zwItem()] });
  const cancelled = await logistics.cancelMyLogisticsRequest('ship-zw', requester, { supabaseClient: c });
  assert.equal(cancelled.status, 'CANCELLED');
});

test('after acceptance, cancel is refused and CLOSE is the honest verb', async () => {
  const c = client({ diaspora_logistics_requests: [zwRequest({ status: 'AWARDED', accepted_quote_id: 'q-1' })] });
  await assert.rejects(() => logistics.cancelMyLogisticsRequest('ship-zw', requester, { supabaseClient: c }),
    /cannot become CANCELLED/i);
  const closed = await logistics.closeMyLogisticsRequest('ship-zw', requester, { supabaseClient: c });
  assert.equal(closed.status, 'CLOSED');
});

test('neither verb may discard live capacity state the container authority owns', async () => {
  for (const reservationStatus of ['REQUESTED', 'APPROVED']) {
    const c = client({
      diaspora_logistics_requests: [zwRequest({ status: 'AWARDED', accepted_quote_id: 'q-1', metadata: { reservation_id: 'res-1' } })],
      diaspora_cargo_reservations: [{ id: 'res-1', container_id: 'sail-beira', reservation_status: reservationStatus, estimated_volume: 10, deleted_at: null }],
    });
    await assert.rejects(() => logistics.closeMyLogisticsRequest('ship-zw', requester, { supabaseClient: c }),
      /Cancel it in Container space first/i, `${reservationStatus} must block`);
  }
});

test('a RELEASED reservation no longer blocks closing', async () => {
  const c = client({
    diaspora_logistics_requests: [zwRequest({ status: 'AWARDED', accepted_quote_id: 'q-1', metadata: { reservation_id: 'res-1' } })],
    diaspora_cargo_reservations: [{ id: 'res-1', container_id: 'sail-beira', reservation_status: 'CANCELLED', estimated_volume: 10, deleted_at: null }],
  });
  const closed = await logistics.closeMyLogisticsRequest('ship-zw', requester, { supabaseClient: c });
  assert.equal(closed.status, 'CLOSED');
});

test('only the requester holds these controls', async () => {
  const c = client({ diaspora_logistics_requests: [zwRequest()] });
  await assert.rejects(() => logistics.cancelMyLogisticsRequest('ship-zw', stranger, { supabaseClient: c }),
    /Only the requester/i);
});

test('a CANCELLED request no longer solicits offers', async () => {
  const c = client({ diaspora_logistics_requests: [zwRequest({ status: 'CANCELLED' })], diaspora_logistics_request_items: [zwItem()] });
  await assert.rejects(
    () => logistics.createLogisticsQuote('ship-zw', { service_mode: 'shared_container', total_amount: 100 }, provider, { supabaseClient: c }),
    /not open for offers/i);
});

// ═══ 5. F2 — discovery reads must be BOUNDED, not one per sailing ═════════
//
// The N+1 was real and measured: ~5.6s on staging, one reservations round trip per open sailing.
// A count assertion is the only guard that actually holds — a latency assertion would be flaky and
// a code-shape assertion would pass the moment someone reintroduces the loop differently.

/** Wrap a mock client so every .from(table) is counted. */
function countingClient(base) {
  const counts = new Map();
  return {
    counts,
    client: {
      ...base,
      from(table) { counts.set(table, (counts.get(table) || 0) + 1); return base.from(table); },
    },
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

function manySailings(n) {
  return Array.from({ length: n }, (_, i) => beiraSailing({
    id: `sail-${i}`,
    departure_date: `2027-0${(i % 9) + 1}-18T00:00:00Z`,
  }));
}

test('F2: discovery query count is BOUNDED — identical at 1, 10 and 50 sailings', async () => {
  const measure = async (n) => {
    const base = client({
      diaspora_container_shipments: manySailings(n),
      diaspora_logistics_requests: [zwRequest()],
      diaspora_logistics_request_items: [zwItem()],
    });
    const counted = countingClient(base);
    const matches = await logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: counted.client });
    return { total: counted.total(), reservations: counted.counts.get('diaspora_cargo_reservations') || 0, matches: matches.length };
  };
  const one = await measure(1);
  const ten = await measure(10);
  const fifty = await measure(50);

  assert.equal(one.matches, 1);
  assert.equal(ten.matches, 10, 'all ten sailings still match');
  assert.equal(fifty.matches, 50, 'all fifty sailings still match');

  // The reservations table is read exactly ONCE regardless of how many sailings are candidates.
  assert.equal(one.reservations, 1);
  assert.equal(ten.reservations, 1, `10 sailings caused ${ten.reservations} reservation reads`);
  assert.equal(fifty.reservations, 1, `50 sailings caused ${fifty.reservations} reservation reads`);

  // And the TOTAL query count does not grow with the candidate set at all.
  assert.equal(one.total, ten.total, `1 sailing = ${one.total} queries, 10 = ${ten.total}`);
  assert.equal(ten.total, fifty.total, `10 sailings = ${ten.total} queries, 50 = ${fifty.total}`);
  assert.ok(fifty.total <= 8, `discovery should cost a handful of queries, saw ${fifty.total}`);
});

test('F2: batching preserves capacity truth per sailing — rows are not pooled', async () => {
  // The danger of a batched read is attributing one sailing's reservations to another. Two
  // sailings, different approved volumes: each must see only its own.
  const c = client({
    diaspora_container_shipments: [beiraSailing({ id: 'sail-a' }), beiraSailing({ id: 'sail-b' })],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
    diaspora_cargo_reservations: [
      { id: 'r1', container_id: 'sail-a', reservation_status: 'APPROVED', estimated_volume: 40, deleted_at: null },
      { id: 'r2', container_id: 'sail-b', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null },
      { id: 'r3', container_id: 'sail-b', reservation_status: 'REQUESTED', estimated_volume: 25, deleted_at: null },
    ],
  });
  const matches = await logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: c });
  const byId = new Map(matches.map((m) => [m.id, m]));
  assert.equal(byId.get('sail-a').available_capacity_cbm, 20, 'sail-a: 60 total − 40 approved');
  assert.equal(byId.get('sail-b').available_capacity_cbm, 50, 'sail-b: 60 total − 10 approved (REQUESTED consumes 0)');
});

test('F2: an UNREADABLE capacity read refuses loudly — it never becomes "no space"', async () => {
  const base = client({
    diaspora_container_shipments: [beiraSailing()],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const broken = {
    ...base,
    from(table) {
      if (table === 'diaspora_cargo_reservations') {
        const q = { select: () => q, in: () => q, eq: () => q,
          is: () => Promise.resolve({ data: null, error: { message: 'capacity unreadable' } }) };
        return q;
      }
      return base.from(table);
    },
  };
  await assert.rejects(
    () => logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: broken }),
    /Could not read sailing capacity/i);
});

test('F2: the batched path returns the SAME shape it always did', async () => {
  const c = client({
    diaspora_container_shipments: [
      beiraSailing({ id: 'gw' }),
      beiraSailing({ id: 'direct', destination_country: 'Zimbabwe', destination_city: 'Harare', destination_port: null }),
    ],
    diaspora_logistics_requests: [zwRequest()],
    diaspora_logistics_request_items: [zwItem()],
  });
  const matches = await logistics.findCompatibleSailings('ship-zw', requester, { supabaseClient: c });
  const gw = matches.find((m) => m.id === 'gw');
  const direct = matches.find((m) => m.id === 'direct');
  // gateway semantics
  assert.equal(gw.route_kind, 'gateway');
  assert.equal(gw.corridor.code, 'JP-BEI-ZW');
  assert.equal(gw.sailing_leg.destination_locality, 'Beira');
  assert.deepEqual(gw.onward_legs.map((l) => l.destination_locality), ['Forbes/Machipanda', 'Harare']);
  assert.equal(gw.final_destination.country, 'Zimbabwe');
  assert.equal(gw.requires_operator_confirmation, true);
  assert.equal(gw.available_capacity_cbm, 60);
  // direct semantics
  assert.equal(direct.route_kind, 'direct');
  assert.equal(direct.corridor, null);
  assert.deepEqual(direct.onward_legs, []);
  // privacy: discovery never exposes operator/tenant internals
  const text = JSON.stringify(matches);
  for (const forbidden of ['tenant_id', 'coordinator_id', 'created_by', 'updated_by', 'metadata']) {
    assert.ok(!text.includes(forbidden), `discovery leaked ${forbidden}`);
  }
});
