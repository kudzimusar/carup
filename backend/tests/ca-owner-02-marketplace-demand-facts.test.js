/**
 * CA-OWNER-02 (A, D) — Marketplace position and demand facts from the REAL sources, with K2B applied where the record has a
 * principal, against the in-memory Supabase world.
 *
 * Proven here:
 *   · published listings / listings awaiting review use the ONE Admin publication projection (status AND publication_status)
 *     over the K2B-classified listing base — UAT / automation listings are set aside and reported per class, never counted;
 *   · open and recent inquiries, live reservations, accounts, trade orders, logistics requests and service requests count
 *     K2B-operational records only; UNKNOWN (an unverified guest) is reported apart, never as operational;
 *   · recorded searches use the rollup's own countable-event rule (excluded flags and self-traffic removed), inside a stated
 *     window; navigation is recorded route renders, not users;
 *   · one failed source degrades only the facts that depend on it; a truncated base read degrades — never a smaller number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { readMarketplaceDemandFacts } = await import('../services/corporate/management/marketplaceDemandFacts.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ahead = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const REAL_SELLER = 'u_aaaaaaaaaaaaaaaa';
const REAL_BUYER = 'u_bbbbbbbbbbbbbbbb';
const UAT_USER = 'u_cccccccccccccccc';

function world(overrides = {}) {
  return createSupabaseWorld({
    users: [
      { id: REAL_SELLER, email: 'tendai@gmail.com', name: 'Tendai Moyo' },
      { id: REAL_BUYER, email: 'rudo@gmail.com', name: 'Rudo Banda' },
      { id: UAT_USER, email: 'uat@carup-staging.test', name: 'UAT seller' },
    ],
    vehicles: [
      { vin: 'JTDBR32E520000001', owner_id: REAL_SELLER, make: 'Toyota', status: 'Available', publication_status: 'published', created_at: ago(20) },
      { vin: 'JTDBR32E520000002', owner_id: REAL_SELLER, make: 'Toyota', status: 'Pending', publication_status: 'review_pending', created_at: ago(3) },
      { vin: 'JTDBR32E520000003', owner_id: UAT_USER, make: 'Toyota', status: 'Available', publication_status: 'published', created_at: ago(2) },
      { vin: 'JTDBR32E520000004', owner_id: REAL_SELLER, make: 'Honda', status: 'Available', publication_status: 'publishable', created_at: ago(1) },
    ],
    marketplace_inquiries: [
      { id: 'i1', buyer_id: REAL_BUYER, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'new', created_at: ago(2) },
      { id: 'i2', buyer_id: REAL_BUYER, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'closed', created_at: ago(30) },
      { id: 'i3', buyer_id: UAT_USER, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'new', created_at: ago(1) },
      { id: 'i4', buyer_id: null, guest_email: 'someone@gmail.com', guest_name: 'Someone', listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'contacted', created_at: ago(10) },
    ],
    vehicle_reservations: [
      { id: 'r1', vin: 'JTDBR32E520000001', inquiry_id: 'i1', status: 'active', expires_at: ahead(1), reserved_at: ago(1) },
      { id: 'r2', vin: 'JTDBR32E520000001', inquiry_id: 'i3', status: 'active', expires_at: ahead(1), reserved_at: ago(1) },
      { id: 'r3', vin: 'JTDBR32E520000001', inquiry_id: 'i1', status: 'active', expires_at: ago(1), reserved_at: ago(3) },
    ],
    marketplace_activity_events: [
      { id: 'e1', event_type: 'marketplace_search_performed', exclusion_flags: [], occurred_at: ago(1) },
      { id: 'e2', event_type: 'marketplace_search_performed', exclusion_flags: ['bot_suspect'], occurred_at: ago(1) },
      { id: 'e3', event_type: 'marketplace_search_performed', exclusion_flags: ['self_traffic'], occurred_at: ago(1) },
      { id: 'e4', event_type: 'marketplace_search_zero_results', exclusion_flags: [], occurred_at: ago(2) },
      { id: 'e5', event_type: 'marketplace_search_performed', exclusion_flags: [], occurred_at: ago(30) },
    ],
    navigation_analytics_events: [
      { id: 'n1', event_type: 'navigation_destination_rendered', occurred_at: ago(1) },
      { id: 'n2', event_type: 'navigation_destination_rendered', occurred_at: ago(2) },
      { id: 'n3', event_type: 'navigation_item_selected', occurred_at: ago(1) },
      { id: 'n4', event_type: 'navigation_destination_rendered', occurred_at: ago(9) },
    ],
    diaspora_import_orders: [
      { id: 'o1', buyer_id: REAL_BUYER, created_by: REAL_BUYER, status: 'IMPORT_REQUESTED', created_at: ago(2), deleted_at: null },
      { id: 'o2', buyer_id: REAL_BUYER, created_by: REAL_BUYER, status: 'COMPLETED', created_at: ago(40), deleted_at: null },
      { id: 'o3', buyer_id: UAT_USER, created_by: UAT_USER, status: 'IMPORT_REQUESTED', created_at: ago(1), deleted_at: null },
      { id: 'o4', buyer_id: REAL_BUYER, created_by: REAL_BUYER, status: 'IMPORT_REQUESTED', created_at: ago(1), deleted_at: ago(0.5) },
    ],
    diaspora_logistics_requests: [
      { id: 'l1', requester_id: REAL_BUYER, status: 'OPEN_FOR_QUOTES', created_at: ago(3) },
      { id: 'l2', requester_id: UAT_USER, status: 'OPEN_FOR_QUOTES', created_at: ago(3) },
      { id: 'l3', requester_id: REAL_BUYER, status: 'DRAFT', created_at: ago(3) },
    ],
    service_cases: [
      { id: 's1', requester_user_id: REAL_BUYER, status: 'requested', requested_at: ago(2), created_at: ago(2) },
      { id: 's2', requester_user_id: REAL_BUYER, status: 'completed', requested_at: ago(20), created_at: ago(20) },
      { id: 's3', requester_user_id: UAT_USER, status: 'accepted', requested_at: ago(1), created_at: ago(1) },
    ],
    ...overrides,
  });
}

const factsOf = async (client) => {
  const { facts } = await readMarketplaceDemandFacts(client, { now: NOW, windowDays: 7 });
  return Object.fromEntries(facts.map((f) => [f.id, f]));
};

test('published listings and listings awaiting review use the Admin publication projection over the K2B listing base', async () => {
  const f = await factsOf(world().client);
  assert.equal(f['marketplace.listing.public'].value, 1, 'the UAT-owned published listing is set aside; publishable is not public');
  assert.equal(f['marketplace.listing.public'].state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f['marketplace.listing.public'].provenance.raw, 2);
  assert.equal(f['marketplace.listing.public'].provenance.excluded_non_operational, 1);
  assert.equal(f['marketplace.listing.pending_review'].value, 1);
});

test('inquiries, reservations and accounts count K2B-operational records only; an unverified guest is reported apart', async () => {
  const f = await factsOf(world().client);
  assert.equal(f['marketplace.inquiry.open'].value, 1, 'i1 only: i3 is UAT, i4 is an unverified guest (needs review), i2 is closed');
  assert.equal(f['marketplace.inquiry.open'].provenance.unknown_requires_review, 1);
  assert.equal(f['marketplace.inquiry.recent'].value, 1);
  assert.deepEqual(f['marketplace.inquiry.recent'].window.kind, 'rolling');
  assert.equal(f['marketplace.reservation.active'].value, 1, 'r1 only: r2 rests on a UAT inquiry, r3 has expired');
  assert.equal(f['growth.account.operational'].value, 2);
  assert.equal(f['growth.account.operational'].provenance.raw, 3);
  // Source-accurate names travel with the figure: an inquiry is not a sale, an account is not a customer.
  assert.equal(f['marketplace.inquiry.open'].label, 'Open Marketplace inquiries (not sales)');
  assert.equal(f['marketplace.inquiry.recent'].label, 'Marketplace inquiries received — 7 days (not sales)');
  assert.equal(f['growth.account.operational'].label, 'Operational accounts (not customers)');
});

test('searches use the rollup countable rule inside the window; navigation counts recorded route renders', async () => {
  const f = await factsOf(world().client);
  assert.equal(f['growth.search.recorded'].value, 1, 'bot and self-traffic are removed; the 30-day-old search is outside the window');
  assert.equal(f['growth.search.zero_result'].value, 1);
  assert.equal(f['growth.navigation.route_render'].value, 2);
  assert.equal(f['growth.navigation.route_render'].kind, 'technical');
});

test('trade orders, logistics requests and service requests count K2B-operational, open records', async () => {
  const f = await factsOf(world().client);
  assert.equal(f['trade.order.open'].value, 1, 'o1 only: o2 completed, o3 UAT, o4 deleted');
  assert.equal(f['trade.order.recent'].value, 1);
  assert.equal(f['trade.logistics.open_for_quotes'].value, 1);
  assert.equal(f['service.case.open'].value, 1);
  assert.equal(f['service.case.recent'].value, 1);
});

test('one failed source degrades only the facts that depend on it', async () => {
  const w = world();
  const client = { from: (t) => (t === 'vehicles' ? { select: () => ({ then: (ok) => ok({ data: null, error: { message: 'down' } }) }) } : w.client.from(t)) };
  const f = await factsOf(client);
  assert.equal(f['marketplace.listing.public'].state, 'DEGRADED');
  assert.equal(f['marketplace.listing.public'].value, null);
  assert.equal(f['marketplace.inquiry.open'].state, 'DEGRADED', 'inquiries are judged against the listing base');
  assert.equal(f['service.case.open'].state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f['growth.account.operational'].state, 'TECHNICAL_OPERATIONAL');
});

test('a listing base shorter than the exact table count is degraded — never a smaller number', async () => {
  const w = world();
  const client = {
    from(t) {
      const q = w.client.from(t);
      if (t !== 'vehicles') return q;
      const select = q.select.bind(q);
      q.select = (cols, opts) => (opts?.head ? Object.assign(select(cols, opts), { then: (ok) => ok({ data: null, count: 99, error: null }) }) : select(cols, opts));
      return q;
    },
  };
  const f = await factsOf(client);
  assert.equal(f['marketplace.listing.public'].state, 'DEGRADED');
  assert.match(f['marketplace.listing.public'].reason, /incomplete/i);
});
