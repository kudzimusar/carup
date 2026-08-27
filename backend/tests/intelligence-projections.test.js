/**
 * CarUp Intelligence 1.0 — I5 authorization and privacy projections.
 *
 * These are the tests that decide whether Intelligence is safe to expose. They
 * assert the boundaries the canonical plan names:
 *
 *   - a seller cannot read another seller's listing;
 *   - a dealer cannot read another tenant;
 *   - no projection ever returns a viewer's identity;
 *   - government is not a super-admin and receives no commercial behaviour;
 *   - unavailable is never rendered as zero;
 *   - a rate is not published from a denominator too small to mean anything.
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
  getListingInsights,
  getSellerPulse,
  getDealerIntelligence,
  getAdminIntelligence,
  getGovernmentIntelligence,
  assertListingOwnership,
  requireVerifiedTenant,
  requirePlatformAdmin,
  resolveWindowDays,
  windowDates,
  metric,
  rate,
  AVAILABILITY,
  AuthorizationError,
  NotFoundError,
  MIN_CONVERSION_DENOMINATOR,
} from '../services/intelligence/intelligenceProjectionService.js';
import { ROLLUP_CALCULATION_VERSION } from '../services/intelligence/rollupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const SELLER = { id: 'seller-1', role: 'owner', tenantId: null };
const OTHER_SELLER = { id: 'seller-2', role: 'owner', tenantId: null };
const DEALER_A = { id: 'dealer-a', role: 'dealer', tenantId: 'tenant-a' };
const DEALER_B = { id: 'dealer-b', role: 'dealer', tenantId: 'tenant-b' };
const ADMIN = { id: 'admin-1', role: 'admin', platformRole: 'admin' };
const GOV = { id: 'gov-1', role: 'government', platformRole: 'government' };

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Fake database. `runs` drives freshness, so tests can model "never computed"
 * and "computed" without touching a real rollup.
 */
function createClient({
  vehicles = [{ vin: 'VIN1', owner_id: 'seller-1', tenant_id: null }],
  listingMetrics = [],
  sellerMetrics = [],
  tenantMetrics = [],
  platformMetrics = [],
  runs = [{ status: 'completed', completed_at: '2026-08-27T04:00:00Z', events_scanned: 10 }],
  failTable = null,
} = {}) {
  const dataFor = {
    vehicles,
    listing_daily_metrics: listingMetrics,
    seller_daily_metrics: sellerMetrics,
    tenant_daily_metrics: tenantMetrics,
    platform_daily_metrics: platformMetrics,
    intelligence_rollup_runs: runs,
  };
  return {
    from(table) {
      const filters = {};
      const api = {
        select() { return api },
        eq(col, val) { filters[col] = val; return api },
        in(col, vals) { filters[col] = vals; return api },
        order() { return api },
        limit() {
          if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
          return Promise.resolve({ data: dataFor[table] || [], error: null });
        },
        maybeSingle() {
          if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
          if (table === 'vehicles') {
            return Promise.resolve({ data: vehicles.find((v) => v.vin === filters.vin) || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (failTable === table) return resolve({ data: null, error: { message: `${table} unavailable` } });
          let rows = dataFor[table] || [];
          if (table === 'vehicles' && filters.owner_id) {
            rows = rows.filter((v) => v.owner_id === filters.owner_id);
          }
          if (filters.tenant_id && table === 'tenant_daily_metrics') {
            rows = rows.filter((r) => r.tenant_id === filters.tenant_id);
          }
          if (filters.seller_user_id) {
            rows = rows.filter((r) => r.seller_user_id === filters.seller_user_id);
          }
          if (filters.listing_id && Array.isArray(filters.listing_id)) {
            rows = rows.filter((r) => filters.listing_id.includes(r.listing_id));
          }
          return resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}

const listingRow = (overrides = {}) => ({
  metric_date: TODAY, listing_id: 'VIN1', tenant_id: null,
  impressions: 100, unique_reach: 40, views: 50, unique_viewers: 30, engaged_views: 12,
  saves: 8, unsaves: 2, shares_confirmed: 3, shares_initiated: 5, compare_adds: 4,
  contact_clicks: 6, inquiry_starts: 7, inquiries: 5, inspections: 1, reservations: 0,
  net_watchlist: 6, self_traffic_views: 9, calculation_version: ROLLUP_CALCULATION_VERSION,
  source_event_count: 200, ...overrides,
});

// ── Ownership boundary ──────────────────────────────────────────────────────

test('a seller reading their OWN listing is allowed', async () => {
  const client = createClient();
  const scope = await assertListingOwnership(client, SELLER, 'VIN1');
  assert.equal(scope.vin, 'VIN1');
});

test("a seller CANNOT read another seller's listing", async () => {
  const client = createClient();
  await assert.rejects(
    () => assertListingOwnership(client, OTHER_SELLER, 'VIN1'),
    (error) => error instanceof NotFoundError,
  );
});

test('the denial is not-found, so the endpoint is not an ownership oracle', async () => {
  const client = createClient();
  // A distinct 403 would confirm the VIN exists and belongs to someone else.
  const missing = await assertListingOwnership(client, OTHER_SELLER, 'VIN-DOES-NOT-EXIST').catch((e) => e);
  const foreign = await assertListingOwnership(client, OTHER_SELLER, 'VIN1').catch((e) => e);
  assert.equal(missing.constructor.name, foreign.constructor.name);
  assert.equal(missing.message, foreign.message);
  assert.equal(missing.status, 404);
});

test('an anonymous caller is refused before any read happens', async () => {
  const client = createClient();
  await assert.rejects(
    () => assertListingOwnership(client, null, 'VIN1'),
    (error) => error instanceof AuthorizationError,
  );
});

test('a tenant colleague may read the tenant\'s listing', async () => {
  const client = createClient({ vehicles: [{ vin: 'VIN1', owner_id: 'someone-else', tenant_id: 'tenant-a' }] });
  const scope = await assertListingOwnership(client, DEALER_A, 'VIN1');
  assert.equal(scope.tenantId, 'tenant-a');
});

test("a dealer from another tenant may NOT read that listing", async () => {
  const client = createClient({ vehicles: [{ vin: 'VIN1', owner_id: 'someone-else', tenant_id: 'tenant-a' }] });
  await assert.rejects(
    () => assertListingOwnership(client, DEALER_B, 'VIN1'),
    (error) => error instanceof NotFoundError,
  );
});

// ── Tenant boundary ─────────────────────────────────────────────────────────

test('dealer intelligence uses the VERIFIED tenant and offers no way to name another', async () => {
  const client = createClient({
    tenantMetrics: [
      { metric_date: TODAY, tenant_id: 'tenant-a', views: 40, unique_viewers: 25, impressions: 90, saves: 5, shares_confirmed: 2, inquiries: 4, inspections: 1, active_listings: 3, calculation_version: ROLLUP_CALCULATION_VERSION },
      { metric_date: TODAY, tenant_id: 'tenant-b', views: 999, unique_viewers: 999, impressions: 999, saves: 999, shares_confirmed: 999, inquiries: 999, inspections: 999, active_listings: 999, calculation_version: ROLLUP_CALCULATION_VERSION },
    ],
  });
  const result = await getDealerIntelligence(client, DEALER_A, { windowDays: 7 });
  assert.equal(result.metrics.views.value, 40, "tenant-b's numbers must never appear");
  assert.notEqual(result.metrics.views.value, 999);
});

test('a dealer with no verified tenant is refused rather than defaulted to platform scope', () => {
  assert.throws(() => requireVerifiedTenant({ id: 'd', role: 'dealer' }), (e) => e instanceof AuthorizationError);
  assert.equal(requireVerifiedTenant(DEALER_A), 'tenant-a');
});

// ── Admin and government boundaries ─────────────────────────────────────────

test('platform admin is required for the admin projection', () => {
  assert.throws(() => requirePlatformAdmin(SELLER), (e) => e instanceof AuthorizationError);
  assert.throws(() => requirePlatformAdmin(DEALER_A), (e) => e instanceof AuthorizationError);
  assert.throws(() => requirePlatformAdmin(GOV), (e) => e instanceof AuthorizationError);
  assert.equal(requirePlatformAdmin(ADMIN), 'admin');
});

test('government receives NO commercial behaviour — gap G5 is not repeated', async () => {
  const client = createClient();
  const result = await getGovernmentIntelligence(client, GOV);
  assert.equal(result.commercial_behaviour_access, false);
  assert.equal(result.availability, AVAILABILITY.NOT_APPLICABLE);
  // Not a single behavioural aggregate may appear in an institutional response.
  const serialized = JSON.stringify(result);
  for (const forbidden of ['views', 'saves', 'searches', 'impressions', 'unique_shoppers', 'shoppers']) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(serialized), `${forbidden} must not reach an institutional role`);
  }
});

test('a seller cannot reach the government projection either', async () => {
  const client = createClient();
  await assert.rejects(() => getGovernmentIntelligence(client, SELLER), (e) => e instanceof AuthorizationError);
});

// ── Privacy: aggregates, never identities ───────────────────────────────────

test('no projection ever returns a viewer identity', async () => {
  const client = createClient({
    listingMetrics: [listingRow()],
    sellerMetrics: [{ metric_date: TODAY, seller_user_id: 'seller-1', views: 50, unique_viewers: 30, impressions: 100, saves: 8, shares_confirmed: 3, inquiry_starts: 7, inquiries: 5, inspections: 1, calculation_version: ROLLUP_CALCULATION_VERSION }],
    platformMetrics: [{ metric_date: TODAY, searches: 20, zero_result_searches: 4, views: 50, unique_shoppers: 30, impressions: 100, saves: 8, inquiry_starts: 7, inquiries: 5, inspections: 1, reservations: 0, active_listings: 3, calculation_version: ROLLUP_CALCULATION_VERSION }],
  });
  const payloads = [
    await getListingInsights(client, SELLER, 'VIN1'),
    await getSellerPulse(client, SELLER),
    await getAdminIntelligence(client, ADMIN),
  ];
  for (const payload of payloads) {
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['pseudonymous_session_key', 'authenticated_user_id', 'session_key', 'buyer_id', 'email', 'phone']) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} must never leave a projection`);
    }
  }
});

// ── Availability: unavailable is never zero ─────────────────────────────────

test('an uncomputed rollup reports unavailable, never zeros', async () => {
  const client = createClient({ runs: [] });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.reason, 'never_computed');
  assert.match(result.message, /NOT zero/);
  assert.ok(!result.metrics, 'no metric block may be present when nothing was computed');
});

test('a failed rollup run reports unavailable with its reason', async () => {
  const client = createClient({ runs: [{ status: 'failed' }] });
  const result = await getSellerPulse(client, SELLER);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.reason, 'last_run_failed');
});

test('an unreadable rollup table reports unavailable rather than throwing to the caller', async () => {
  const client = createClient({ failTable: 'listing_daily_metrics' });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
});

test('a seller with no listings is told to publish, not shown zeros', async () => {
  const client = createClient({ vehicles: [] });
  const result = await getSellerPulse(client, SELLER);
  assert.equal(result.availability, AVAILABILITY.NOT_APPLICABLE);
  assert.equal(result.reason, 'no_listings');
  assert.match(result.message, /Publish a vehicle/);
});

test('a genuine zero is still a value, distinguishable from unavailable', () => {
  const zero = metric(0);
  assert.equal(zero.availability, AVAILABILITY.VALUE);
  assert.equal(zero.value, 0);
});

// ── Rates and small denominators ────────────────────────────────────────────

test('a rate is withheld when the denominator is too small to mean anything', () => {
  const tiny = rate(1, 3);
  assert.equal(tiny.availability, AVAILABILITY.INSUFFICIENT_DATA);
  assert.equal(tiny.value, null);
  assert.match(tiny.reason, new RegExp(String(MIN_CONVERSION_DENOMINATOR)));

  const real = rate(5, 50);
  assert.equal(real.availability, AVAILABILITY.VALUE);
  assert.equal(real.value, 10);
  assert.equal(real.unit, 'percent');
});

test('listing insights withhold conversion when traffic is thin', async () => {
  const client = createClient({ listingMetrics: [listingRow({ views: 4, saves: 1, inquiries: 1, impressions: 5 })] });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.equal(result.conversion.view_to_save.availability, AVAILABILITY.INSUFFICIENT_DATA);
  // The raw counts are still shown; only the ratio is withheld.
  assert.equal(result.metrics.views.value, 4);
});

// ── Aggregation correctness ─────────────────────────────────────────────────

test('window totals add but window uniques do not', async () => {
  const client = createClient({
    listingMetrics: [
      listingRow({ metric_date: '2026-08-25', views: 10, unique_viewers: 8 }),
      listingRow({ metric_date: '2026-08-26', views: 20, unique_viewers: 15 }),
    ],
  });
  const result = await getListingInsights(client, SELLER, 'VIN1', { windowDays: 7 });
  assert.equal(result.metrics.views.value, 30, 'views add');
  // 8 + 15 = 23 would claim more people than the busiest day can support.
  assert.equal(result.metrics.unique_viewers.value, 15);
  assert.equal(result.metrics.unique_viewers.basis, 'peak_day',
    'the basis is stated so the number is not mistaken for a true window unique');
});

test('current watchlist is the latest authority snapshot, not a sum of days', async () => {
  const client = createClient({
    listingMetrics: [
      listingRow({ metric_date: '2026-08-25', net_watchlist: 3 }),
      listingRow({ metric_date: '2026-08-26', net_watchlist: 6 }),
    ],
  });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.equal(result.metrics.net_watchlist.value, 6, 'a sum (9) would invent saves that do not exist');
});

test('confirmed and initiated shares stay separate through the projection', async () => {
  const client = createClient({ listingMetrics: [listingRow()] });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.equal(result.metrics.shares_confirmed.value, 3);
  assert.equal(result.metrics.shares_initiated.value, 5);
  assert.ok(!('shares' in result.metrics));
});

test('self-traffic never appears in a seller-facing payload', async () => {
  const client = createClient({ listingMetrics: [listingRow({ self_traffic_views: 9 })] });
  const result = await getListingInsights(client, SELLER, 'VIN1');
  assert.ok(!JSON.stringify(result).includes('self_traffic'),
    'the seller sees demand, not their own refreshes');
});

test('coverage states how many days actually had data', async () => {
  const client = createClient({ listingMetrics: [listingRow()] });
  const result = await getListingInsights(client, SELLER, 'VIN1', { windowDays: 30 });
  assert.equal(result.coverage.days_requested, 30);
  assert.equal(result.coverage.days_with_data, 1,
    'an honest zero is distinguishable from a gap in measurement');
});

test('admin sees unmet demand as its own signal', async () => {
  const client = createClient({
    platformMetrics: [{ metric_date: TODAY, searches: 100, zero_result_searches: 25, views: 50, unique_shoppers: 30, impressions: 200, saves: 8, inquiry_starts: 7, inquiries: 5, inspections: 1, reservations: 0, active_listings: 3, calculation_version: ROLLUP_CALCULATION_VERSION }],
  });
  const result = await getAdminIntelligence(client, ADMIN);
  assert.equal(result.metrics.zero_result_searches.value, 25);
  assert.equal(result.supply_signal.zero_result_rate.value, 25);
});

// ── Window handling ─────────────────────────────────────────────────────────

test('only 7/30/90 windows are honoured, so a metric cannot silently change meaning', () => {
  assert.equal(resolveWindowDays('30'), 30);
  assert.equal(resolveWindowDays('90'), 90);
  assert.equal(resolveWindowDays('365'), 7);
  assert.equal(resolveWindowDays('abc'), 7);
  assert.equal(resolveWindowDays(undefined), 7);
});

test('window dates are contiguous, ascending and correctly sized', () => {
  const dates = windowDates(7, new Date('2026-08-27T12:00:00Z'));
  assert.equal(dates.length, 7);
  assert.equal(dates[0], '2026-08-21');
  assert.equal(dates[6], '2026-08-27');
});

// ── Wiring and route governance ─────────────────────────────────────────────

test('the projection routes are mounted in the server', () => {
  const server = fs.readFileSync(path.join(REPO, 'backend/server.js'), 'utf8');
  assert.match(server, /import intelligenceProjectionRouter from '\.\/routes\/intelligenceProjectionRoutes\.js'/);
  assert.match(server, /app\.use\(intelligenceProjectionRouter\)/);
});

test('no projection route accepts a seller, tenant or organization parameter', () => {
  const routes = fs.readFileSync(path.join(REPO, 'backend/routes/intelligenceProjectionRoutes.js'), 'utf8');
  // A scope a caller can name is a scope a caller can change.
  assert.ok(!/req\.query\.(tenant_id|tenantId|seller_id|sellerId|organization_id)/.test(routes));
  assert.ok(!/req\.params\.(tenant_id|tenantId|seller_id|sellerId|organization_id)/.test(routes));
  assert.ok(!/req\.body\?\.(tenant_id|seller_id)/.test(routes));
});

test('the admin intelligence route does NOT admit the government role', () => {
  const routes = fs.readFileSync(path.join(REPO, 'backend/routes/intelligenceProjectionRoutes.js'), 'utf8');
  const adminBlock = routes.split("'/api/admin/marketplace/intelligence'")[1].split('router.get')[0];
  assert.match(adminBlock, /authorizeRole\(\['admin'\]\)/);
  assert.ok(!adminBlock.includes('government'),
    'gap G5 (government holding platform-wide commercial analytics) must not be repeated');
});
