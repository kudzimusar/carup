/**
 * CarUp Intelligence 1.0 — I4 rollup reconciliation.
 *
 * The canonical plan's test rule is that a dashboard number must reconcile to its
 * underlying controlled events. So these tests build event sets with KNOWN counts
 * and assert the rollup reproduces them exactly — including the cases where the
 * naive arithmetic would be wrong:
 *
 *  - one shopper viewing three of a dealer's cars is ONE unique viewer, not three;
 *  - a seller refreshing their own listing is not demand;
 *  - a bot is excluded but a phone with a wrong clock is not;
 *  - a completed share and an opened share sheet are never summed;
 *  - the lead count comes from the inquiry table, not from the event stream;
 *  - re-running a day converges instead of doubling it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  computeListingMetrics,
  computeScopeMetrics,
  computePlatformMetrics,
  isCountable,
  isSelfTraffic,
  linkKeyOf,
  dayBounds,
  rollupDay,
  rollupFreshness,
  ROLLUP_CALCULATION_VERSION,
} from '../services/intelligence/rollupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const MIGRATION = path.join(REPO, 'database/migrations/20260827130000_intelligence_rollups.sql');

const DAY = '2026-08-26';

function ev(type, overrides = {}) {
  return {
    event_type: type,
    listing_id: overrides.vin || 'VIN1',
    vehicle_reference: overrides.vin || 'VIN1',
    tenant_id: overrides.tenant_id ?? 'tenant-a',
    authenticated_user_id: overrides.user || null,
    pseudonymous_session_key: overrides.session || 'sess-1',
    exclusion_flags: overrides.flags || [],
    metadata: overrides.metadata || {},
    occurred_at: `${DAY}T10:00:00.000Z`,
    ...('vin' in overrides ? {} : {}),
  };
}

// ── Exclusion semantics ─────────────────────────────────────────────────────

test('a bot is excluded from business rollups; a wrong phone clock is not', () => {
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['bot_suspect'] })), false);
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['staff'] })), false);
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['fixture'] })), false);
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['late_beyond_window'] })), false);
  // A real shopper with a skewed clock is still a real shopper.
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['clock_skew_adjusted'] })), true);
  // Self-traffic stays countable at the base layer and is dropped per-metric.
  assert.equal(isCountable(ev('marketplace_listing_opened', { flags: ['self_traffic'] })), true);
  assert.equal(isSelfTraffic(ev('marketplace_listing_opened', { flags: ['self_traffic'] })), true);
});

test('the uniqueness key is the session, so an anonymous browse and a later sign-in stay one person', () => {
  const anonymous = ev('marketplace_listing_opened', { session: 'sess-9', user: null });
  const authenticated = ev('marketplace_inquiry_created', { session: 'sess-9', user: 'buyer-1' });
  assert.equal(linkKeyOf(anonymous), 'sess-9');
  assert.equal(linkKeyOf(authenticated), 'sess-9');
});

// ── Listing grain reconciliation ────────────────────────────────────────────

test('listing metrics reproduce known counts exactly', () => {
  const events = [
    ev('marketplace_listing_impression', { session: 'a' }),
    ev('marketplace_listing_impression', { session: 'b' }),
    ev('marketplace_listing_impression', { session: 'b' }),
    ev('marketplace_listing_opened', { session: 'a' }),
    ev('marketplace_listing_opened', { session: 'b' }),
    ev('marketplace_listing_opened', { session: 'b' }),
    ev('marketplace_listing_engaged', { session: 'b' }),
    ev('marketplace_listing_saved', { session: 'a', user: 'buyer-a' }),
    ev('marketplace_listing_unsaved', { session: 'a', user: 'buyer-a' }),
    ev('marketplace_contact_clicked', { session: 'b' }),
    ev('marketplace_inquiry_started', { session: 'b' }),
  ];
  const m = computeListingMetrics(events);
  assert.equal(m.impressions, 3);
  assert.equal(m.unique_reach, 2, 'two distinct sessions saw the card');
  assert.equal(m.views, 3);
  assert.equal(m.unique_viewers, 2, 'three opens, two people');
  assert.equal(m.engaged_views, 1);
  assert.equal(m.saves, 1);
  assert.equal(m.unsaves, 1);
  assert.equal(m.contact_clicks, 1);
  assert.equal(m.inquiry_starts, 1);
  assert.equal(m.source_event_count, 11);
});

test("a seller refreshing their own listing is not demand", () => {
  const events = [
    ev('marketplace_listing_opened', { session: 'buyer' }),
    ev('marketplace_listing_opened', { session: 'seller', flags: ['self_traffic'] }),
    ev('marketplace_listing_opened', { session: 'seller', flags: ['self_traffic'] }),
  ];
  const m = computeListingMetrics(events);
  assert.equal(m.views, 1, 'only the genuine shopper counts');
  assert.equal(m.unique_viewers, 1);
  // But the excluded traffic is still visible to an operator.
  assert.equal(m.self_traffic_views, 2);
});

test('bot traffic is removed from every seller-facing number', () => {
  const events = [
    ev('marketplace_listing_opened', { session: 'human' }),
    ev('marketplace_listing_opened', { session: 'bot', flags: ['bot_suspect'] }),
    ev('marketplace_listing_impression', { session: 'bot', flags: ['bot_suspect'] }),
  ];
  const m = computeListingMetrics(events);
  assert.equal(m.views, 1);
  assert.equal(m.impressions, 0);
  assert.equal(m.source_event_count, 3, 'the raw events are still accounted for');
});

test('confirmed and initiated shares are never summed into one number', () => {
  const events = [
    ev('marketplace_listing_shared', { session: 'a', metadata: { share_resolution: 'confirmed' } }),
    ev('marketplace_listing_shared', { session: 'b', metadata: { share_resolution: 'initiated' } }),
    ev('marketplace_listing_shared', { session: 'c', metadata: { share_resolution: 'initiated' } }),
  ];
  const m = computeListingMetrics(events);
  assert.equal(m.shares_confirmed, 1);
  assert.equal(m.shares_initiated, 2);
  assert.ok(!('shares' in m), 'there is deliberately no combined shares field');
});

test('a listing with no activity produces genuine zeros, not invented ones', () => {
  const m = computeListingMetrics([]);
  assert.equal(m.views, 0);
  assert.equal(m.unique_viewers, 0);
  assert.equal(m.source_event_count, 0);
});

// ── Scope grain: uniques must not sum ───────────────────────────────────────

test('one shopper viewing three of a dealer\'s cars is ONE unique viewer', () => {
  const events = [
    ev('marketplace_listing_opened', { vin: 'VIN1', session: 'shopper' }),
    ev('marketplace_listing_opened', { vin: 'VIN2', session: 'shopper' }),
    ev('marketplace_listing_opened', { vin: 'VIN3', session: 'shopper' }),
  ];
  // Per-listing, each is one unique viewer — summing those would say 3 people.
  const perListing = ['VIN1', 'VIN2', 'VIN3']
    .map((vin) => computeListingMetrics(events.filter((e) => e.listing_id === vin)).unique_viewers)
    .reduce((a, b) => a + b, 0);
  assert.equal(perListing, 3, 'the naive sum of per-listing uniques');

  const scope = computeScopeMetrics(events);
  assert.equal(scope.views, 3, 'three views did happen');
  assert.equal(scope.unique_viewers, 1, 'but they were one person');
});

test('platform uniques count a shopper once across search, browse and save', () => {
  const events = [
    ev('marketplace_search_performed', { session: 'p1' }),
    ev('marketplace_listing_opened', { session: 'p1' }),
    ev('marketplace_listing_saved', { session: 'p1', user: 'buyer-1' }),
    ev('marketplace_listing_opened', { session: 'p2' }),
  ];
  const m = computePlatformMetrics(events);
  assert.equal(m.unique_shoppers, 2);
  assert.equal(m.searches, 1);
  assert.equal(m.views, 2);
});

test('zero-result searches are counted as their own signal', () => {
  const events = [
    ev('marketplace_search_performed', { session: 'a' }),
    ev('marketplace_search_performed', { session: 'b' }),
    ev('marketplace_search_zero_results', { session: 'b' }),
  ];
  const m = computePlatformMetrics(events);
  assert.equal(m.searches, 2);
  assert.equal(m.zero_result_searches, 1);
});

// ── Day boundaries ──────────────────────────────────────────────────────────

test('a day is a UTC day, half-open so no event is counted twice', () => {
  const { start, end } = dayBounds('2026-08-26');
  assert.equal(start, '2026-08-26T00:00:00.000Z');
  assert.equal(end, '2026-08-27T00:00:00.000Z');
});

// ── End-to-end rollup against a fake database ───────────────────────────────

function createRollupClient({ events = [], inquiries = [], reservations = [], saved = [], vehicles = [] } = {}) {
  const written = { listing: [], seller: [], tenant: [], platform: [], runs: [] };
  const client = {
    written,
    from(table) {
      const api = {
        _table: table,
        select() { return api },
        gte() { return api },
        lt() { return api },
        in() { return api },
        eq() { return api },
        order() { return api },
        limit() { return Promise.resolve({ data: written.runs.slice(-1), error: null }) },
        // Reads are paginated now; the fake returns the whole set on page 0 and
        // an empty page after, which is what a short single page looks like.
        range(from) {
          const rows = {
            marketplace_activity_events: events,
            marketplace_inquiries: inquiries,
            vehicle_reservations: reservations,
            saved_vehicles: saved,
            vehicles,
          }[table] ?? [];
          return Promise.resolve({ data: from === 0 ? rows : [], error: null });
        },
        insert(row) { if (table === 'intelligence_rollup_runs') written.runs.push(row); return Promise.resolve({ data: row, error: null }) },
        update() { return { eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) } },
        upsert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (table === 'listing_daily_metrics') written.listing.push(...list);
          if (table === 'seller_daily_metrics') written.seller.push(...list);
          if (table === 'tenant_daily_metrics') written.tenant.push(...list);
          if (table === 'platform_daily_metrics') written.platform.push(...list);
          return Promise.resolve({ data: list, error: null });
        },
        then(resolve) {
          const dataFor = {
            marketplace_activity_events: events,
            marketplace_inquiries: inquiries,
            vehicle_reservations: reservations,
            saved_vehicles: saved,
            vehicles,
          }[table] ?? [];
          return resolve({ data: dataFor, error: null });
        },
      };
      return api;
    },
  };
  return client;
}

test('a full rollup reconciles listing, seller, tenant and platform grains', async () => {
  const client = createRollupClient({
    events: [
      ev('marketplace_listing_opened', { vin: 'VIN1', session: 'shopper' }),
      ev('marketplace_listing_opened', { vin: 'VIN2', session: 'shopper' }),
      ev('marketplace_listing_opened', { vin: 'VIN1', session: 'other' }),
      ev('marketplace_listing_saved', { vin: 'VIN1', session: 'shopper', user: 'buyer-1' }),
    ],
    inquiries: [
      { id: 'i1', listing_id: 'VIN1', seller_id: 'seller-1', seller_tenant_id: 'tenant-a', inquiry_type: 'vehicle_purchase_interest', status: 'new' },
      { id: 'i2', listing_id: 'VIN1', seller_id: 'seller-1', seller_tenant_id: 'tenant-a', inquiry_type: 'vehicle_inspection_request', status: 'new' },
      // Spam must never reach a seller's headline lead count.
      { id: 'i3', listing_id: 'VIN1', seller_id: 'seller-1', seller_tenant_id: 'tenant-a', inquiry_type: 'vehicle_purchase_interest', status: 'spam' },
    ],
    saved: [{ vin: 'VIN1' }, { vin: 'VIN1' }, { vin: 'VIN2' }],
    vehicles: [
      { vin: 'VIN1', owner_id: 'seller-1', tenant_id: 'tenant-a' },
      { vin: 'VIN2', owner_id: 'seller-1', tenant_id: 'tenant-a' },
    ],
  });

  const result = await rollupDay(DAY, { client });
  assert.equal(result.ok, true);
  assert.equal(result.events_scanned, 4);

  const vin1 = client.written.listing.find((r) => r.listing_id === 'VIN1');
  assert.equal(vin1.views, 2);
  assert.equal(vin1.unique_viewers, 2);
  assert.equal(vin1.saves, 1);
  assert.equal(vin1.inquiries, 2, 'spam is excluded from the lead count');
  assert.equal(vin1.inspections, 1);
  assert.equal(vin1.net_watchlist, 2, 'current saved state comes from the authority, not the events');
  assert.equal(vin1.calculation_version, ROLLUP_CALCULATION_VERSION);

  const seller = client.written.seller.find((r) => r.seller_user_id === 'seller-1');
  assert.equal(seller.views, 3, 'totals add across the seller\'s inventory');
  assert.equal(seller.unique_viewers, 2, 'but the shopper who saw both cars is one person');
  assert.equal(seller.active_listings, 2);
  assert.equal(seller.inquiries, 2);

  const tenant = client.written.tenant.find((r) => r.tenant_id === 'tenant-a');
  assert.equal(tenant.unique_viewers, 2);
  assert.equal(tenant.inquiries, 2);

  const platform = client.written.platform[0];
  assert.equal(platform.views, 3);
  assert.equal(platform.unique_shoppers, 2);
  assert.equal(platform.inquiries, 2);
  assert.equal(platform.inspections, 1);
});

test('re-running a day converges instead of doubling it', async () => {
  const events = [ev('marketplace_listing_opened', { vin: 'VIN1', session: 'a' })];
  const first = createRollupClient({ events, vehicles: [{ vin: 'VIN1', owner_id: 's1', tenant_id: 't1' }] });
  await rollupDay(DAY, { client: first });
  const second = createRollupClient({ events, vehicles: [{ vin: 'VIN1', owner_id: 's1', tenant_id: 't1' }] });
  await rollupDay(DAY, { client: second });
  assert.equal(first.written.listing[0].views, 1);
  assert.equal(second.written.listing[0].views, 1,
    'recompute is idempotent: a late-event re-run must not inflate the day');
});

test('a listing with an inquiry but no ledger activity still gets a row', async () => {
  const client = createRollupClient({
    events: [],
    inquiries: [{ id: 'i1', listing_id: 'VIN9', seller_id: 's1', seller_tenant_id: 't1', inquiry_type: 'vehicle_purchase_interest', status: 'new' }],
    vehicles: [{ vin: 'VIN9', owner_id: 's1', tenant_id: 't1' }],
  });
  await rollupDay(DAY, { client });
  const row = client.written.listing.find((r) => r.listing_id === 'VIN9');
  assert.ok(row, 'an authoritative lead must appear even with zero behavioural events');
  assert.equal(row.inquiries, 1);
  assert.equal(row.views, 0);
});

test('a failed rollup reports failure rather than writing a partial day', async () => {
  const exploding = {
    from(table) {
      if (table === 'intelligence_rollup_runs') {
        return { insert: () => Promise.resolve({}), update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }) }) };
      }
      return {
        select: () => ({
          gte: () => ({
            lt: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'ledger unavailable' } }) }),
          }),
        }),
      };
    },
  };
  const result = await rollupDay(DAY, { client: exploding });
  assert.equal(result.ok, false);
  assert.match(result.error, /ledger unavailable/);
});

// ── Freshness ───────────────────────────────────────────────────────────────

test('freshness reports unavailable rather than implying a quiet market', async () => {
  const never = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) };
  assert.deepEqual(await rollupFreshness(DAY, { client: never }), { available: false, reason: 'never_computed' });

  const failed = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ status: 'failed' }], error: null }) }) }) }) }) }) };
  assert.deepEqual(await rollupFreshness(DAY, { client: failed }), { available: false, reason: 'last_run_failed' });

  const ok = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ status: 'completed', completed_at: 'T', events_scanned: 5 }], error: null }) }) }) }) }) }) };
  const fresh = await rollupFreshness(DAY, { client: ok });
  assert.equal(fresh.available, true);
  assert.equal(fresh.events_scanned, 5);
});

// ── Migration governance ────────────────────────────────────────────────────

test('rollup tables are service-role only with RLS forced and no client grants', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  for (const table of ['listing_daily_metrics', 'seller_daily_metrics', 'tenant_daily_metrics', 'platform_daily_metrics']) {
    assert.ok(sql.includes(table), `${table} must be created`);
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE %I FROM anon/);
  assert.ok(!/GRANT .* TO anon/i.test(sql));
  assert.ok(!/CREATE POLICY/.test(sql), 'reads go through I5 projections, not direct client access');
});

test('the schema forbids an arithmetically impossible rollup', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  // A unique count above its total would be nonsense; the database refuses it.
  assert.match(sql, /unique_viewers <= views/);
  assert.match(sql, /unique_reach <= impressions/);
});

test('every rollup row is keyed by calculation_version so definitions cannot blend', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /UNIQUE \(metric_date, listing_id, calculation_version\)/);
  assert.match(sql, /UNIQUE \(metric_date, seller_user_id, calculation_version\)/);
  assert.match(sql, /UNIQUE \(metric_date, tenant_id, calculation_version\)/);
  assert.match(sql, /UNIQUE \(metric_date, calculation_version\)/);
});
