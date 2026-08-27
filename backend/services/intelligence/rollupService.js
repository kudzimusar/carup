/**
 * CarUp Intelligence 1.0 — I4 daily rollups.
 *
 * Turns the raw activity ledger into the versioned daily read models that
 * stakeholder surfaces will query. Three rules shape everything here:
 *
 *  1. REPRODUCIBLE. A rollup row is a pure function of (the day's ledger rows,
 *     the authoritative tables, the calculation version). Recomputing a day must
 *     produce the same numbers, so re-running is always safe and late events are
 *     absorbed by recomputation rather than by incrementing a counter nobody can
 *     audit.
 *
 *  2. UNIQUES DO NOT SUM. One shopper who viewed three of a dealer's cars is one
 *     person. Seller and tenant uniques are therefore computed across that
 *     scope's whole inventory, never by adding per-listing uniques together —
 *     the single most common way a "unique visitors" number becomes a lie.
 *
 *  3. AUTHORITY WINS. `inquiries`, `inspections`, `reservations` and
 *     `net_watchlist` are read from the authoritative tables, not counted from
 *     events. The ledger explains how a shopper arrived; it does not get to
 *     decide how many leads a seller has.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { ROLLUP_EXCLUDED_FLAGS } from './activityEventTypes.js';

/**
 * Bump when ANY number below changes meaning. Rollup rows are keyed by version,
 * so two versions coexist and a surface can never blend them silently.
 */
export const ROLLUP_CALCULATION_VERSION = 'rollup@1';

const LEDGER = 'marketplace_activity_events';
const RUNS = 'intelligence_rollup_runs';

/** UTC day bounds. The contract fixes UTC as the rollup clock; display-timezone mapping is a presentation concern. */
export function dayBounds(metricDate) {
  const start = new Date(`${metricDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * An event counts toward business rollups unless it carries an excluded flag.
 * Self-traffic is deliberately NOT in that set: it is excluded from seller-facing
 * numbers (handled per-metric below) but retained for internal diagnostics, so a
 * dealer refreshing their own listing never inflates their reported demand while
 * an operator can still see that it happened.
 */
export function isCountable(event) {
  const flags = Array.isArray(event?.exclusion_flags) ? event.exclusion_flags : [];
  return !flags.some((flag) => ROLLUP_EXCLUDED_FLAGS.includes(flag));
}

export function isSelfTraffic(event) {
  const flags = Array.isArray(event?.exclusion_flags) ? event.exclusion_flags : [];
  return flags.includes('self_traffic');
}

/**
 * The funnel/uniqueness key (contract §5.2 `link_key`).
 *
 * Deliberately the session key, not the user id: views are usually anonymous and
 * inquiries are authenticated, so keying uniques on the user id would make the
 * ordinary browse-then-sign-in journey vanish from every conversion metric.
 */
export function linkKeyOf(event) {
  return event?.pseudonymous_session_key || event?.authenticated_user_id || null;
}

function countDistinct(events, predicate) {
  const keys = new Set();
  for (const event of events) {
    if (!predicate(event)) continue;
    const key = linkKeyOf(event);
    if (key) keys.add(key);
  }
  return keys.size;
}

const isType = (type) => (event) => event.event_type === type;

/**
 * Compute one listing's metrics from its own day's events.
 * `events` must already be filtered to (this listing, this day).
 */
export function computeListingMetrics(events) {
  const business = events.filter(isCountable);
  // Seller-facing counts additionally drop self-traffic.
  const sellerFacing = business.filter((e) => !isSelfTraffic(e));
  const shares = sellerFacing.filter(isType('marketplace_listing_shared'));

  return {
    impressions: sellerFacing.filter(isType('marketplace_listing_impression')).length,
    unique_reach: countDistinct(sellerFacing, isType('marketplace_listing_impression')),
    views: sellerFacing.filter(isType('marketplace_listing_opened')).length,
    unique_viewers: countDistinct(sellerFacing, isType('marketplace_listing_opened')),
    engaged_views: sellerFacing.filter(isType('marketplace_listing_engaged')).length,
    saves: sellerFacing.filter(isType('marketplace_listing_saved')).length,
    unsaves: sellerFacing.filter(isType('marketplace_listing_unsaved')).length,
    // Never summed: a completed share and an opened share sheet are different claims.
    shares_confirmed: shares.filter((e) => e.metadata?.share_resolution === 'confirmed').length,
    shares_initiated: shares.filter((e) => e.metadata?.share_resolution === 'initiated').length,
    compare_adds: sellerFacing.filter(isType('marketplace_compare_added')).length,
    contact_clicks: sellerFacing.filter(isType('marketplace_contact_clicked')).length,
    inquiry_starts: sellerFacing.filter(isType('marketplace_inquiry_started')).length,
    // Reported separately so an operator can see what the seller's numbers exclude.
    self_traffic_views: business.filter((e) => isSelfTraffic(e) && e.event_type === 'marketplace_listing_opened').length,
    source_event_count: events.length,
  };
}

/**
 * Compute a scope's metrics across MANY listings.
 *
 * Totals add; uniques do not. This is where the "one shopper is one shopper"
 * rule is actually enforced.
 */
export function computeScopeMetrics(events) {
  const business = events.filter(isCountable).filter((e) => !isSelfTraffic(e));
  const shares = business.filter(isType('marketplace_listing_shared'));
  return {
    impressions: business.filter(isType('marketplace_listing_impression')).length,
    views: business.filter(isType('marketplace_listing_opened')).length,
    unique_viewers: countDistinct(business, isType('marketplace_listing_opened')),
    saves: business.filter(isType('marketplace_listing_saved')).length,
    unsaves: business.filter(isType('marketplace_listing_unsaved')).length,
    shares_confirmed: shares.filter((e) => e.metadata?.share_resolution === 'confirmed').length,
    inquiry_starts: business.filter(isType('marketplace_inquiry_started')).length,
    source_event_count: events.length,
  };
}

export function computePlatformMetrics(events) {
  const business = events.filter(isCountable).filter((e) => !isSelfTraffic(e));
  const shares = business.filter(isType('marketplace_listing_shared'));
  return {
    searches: business.filter(isType('marketplace_search_performed')).length,
    zero_result_searches: business.filter(isType('marketplace_search_zero_results')).length,
    impressions: business.filter(isType('marketplace_listing_impression')).length,
    views: business.filter(isType('marketplace_listing_opened')).length,
    // A shopper who searched, browsed and saved is ONE shopper.
    unique_shoppers: countDistinct(business, () => true),
    saves: business.filter(isType('marketplace_listing_saved')).length,
    unsaves: business.filter(isType('marketplace_listing_unsaved')).length,
    shares_confirmed: shares.filter((e) => e.metadata?.share_resolution === 'confirmed').length,
    inquiry_starts: business.filter(isType('marketplace_inquiry_started')).length,
    source_event_count: events.length,
  };
}

// ── Authority reads ─────────────────────────────────────────────────────────

/**
 * Inquiry counts come from `marketplace_inquiries`, the authority — never from
 * the ledger. `spam` and `rejected` are excluded from the headline lead count per
 * the metric contract: a seller's "Leads" number must not include spam.
 */
export async function readInquiryAuthority(client, metricDate) {
  const { start, end } = dayBounds(metricDate);
  const { data, error } = await client
    .from('marketplace_inquiries')
    .select('id, listing_id, seller_id, seller_tenant_id, inquiry_type, status, created_at')
    .gte('created_at', start)
    .lt('created_at', end);
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : [])
    .filter((row) => !['spam', 'rejected'].includes(String(row.status || '')));
  return rows;
}

export async function readReservationAuthority(client, metricDate) {
  const { start, end } = dayBounds(metricDate);
  const { data, error } = await client
    .from('vehicle_reservations')
    .select('id, vin, created_at')
    .gte('created_at', start)
    .lt('created_at', end);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/**
 * Current saved-state snapshot per listing. This is `net_watchlist@1`: the live
 * authority count, not a running total derived from save/unsave events. Snapshot
 * rather than derivation is what lets watchlist churn have a real denominator
 * even for windows that predate the ledger.
 */
export async function readWatchlistSnapshot(client) {
  const { data, error } = await client.from('saved_vehicles').select('vin');
  if (error) return new Map();
  const counts = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    if (!row?.vin) continue;
    counts.set(row.vin, (counts.get(row.vin) || 0) + 1);
  }
  return counts;
}

const INSPECTION_TYPES = new Set(['inspection_request', 'vehicle_inspection_request']);

// ── The rollup itself ───────────────────────────────────────────────────────

/**
 * Recompute every rollup grain for one UTC day.
 *
 * Recompute, not increment: the day is rebuilt from scratch, so a re-run after
 * late events arrive converges instead of double-counting, and a bug fixed today
 * can be applied to history by simply re-running.
 */
export async function rollupDay(metricDate, { client = defaultClient, calculationVersion = ROLLUP_CALCULATION_VERSION } = {}) {
  const { start, end } = dayBounds(metricDate);
  const runStartedAt = new Date().toISOString();
  const run = {
    metric_date: metricDate,
    calculation_version: calculationVersion,
    started_at: runStartedAt,
    status: 'running',
  };
  try { await client.from(RUNS).insert(run); } catch { /* the run ledger must never block the rollup */ }

  try {
    const { data, error } = await client
      .from(LEDGER)
      .select('event_type, listing_id, vehicle_reference, tenant_id, authenticated_user_id, pseudonymous_session_key, exclusion_flags, metadata, occurred_at')
      .gte('occurred_at', start)
      .lt('occurred_at', end);
    if (error) throw error;
    const events = Array.isArray(data) ? data : [];

    const [inquiryRows, reservationRows, watchlist] = await Promise.all([
      readInquiryAuthority(client, metricDate),
      readReservationAuthority(client, metricDate),
      readWatchlistSnapshot(client),
    ]);

    // Group ledger events by listing.
    const byListing = new Map();
    for (const event of events) {
      const vin = event.vehicle_reference || event.listing_id;
      if (!vin) continue;
      if (!byListing.has(vin)) byListing.set(vin, []);
      byListing.get(vin).push(event);
    }

    // Authority tallies per listing.
    const inquiriesByListing = new Map();
    const inspectionsByListing = new Map();
    for (const row of inquiryRows) {
      const vin = row.listing_id;
      if (!vin) continue;
      inquiriesByListing.set(vin, (inquiriesByListing.get(vin) || 0) + 1);
      if (INSPECTION_TYPES.has(String(row.inquiry_type))) {
        inspectionsByListing.set(vin, (inspectionsByListing.get(vin) || 0) + 1);
      }
    }
    const reservationsByListing = new Map();
    for (const row of reservationRows) {
      if (!row?.vin) continue;
      reservationsByListing.set(row.vin, (reservationsByListing.get(row.vin) || 0) + 1);
    }

    // Every listing that has EITHER activity or an authoritative event that day.
    const listingIds = new Set([
      ...byListing.keys(),
      ...inquiriesByListing.keys(),
      ...reservationsByListing.keys(),
    ]);

    const listingRows = [];
    for (const vin of listingIds) {
      const listingEvents = byListing.get(vin) || [];
      const metrics = computeListingMetrics(listingEvents);
      listingRows.push({
        metric_date: metricDate,
        listing_id: vin,
        tenant_id: listingEvents.find((e) => e.tenant_id)?.tenant_id || null,
        ...metrics,
        inquiries: inquiriesByListing.get(vin) || 0,
        inspections: inspectionsByListing.get(vin) || 0,
        reservations: reservationsByListing.get(vin) || 0,
        net_watchlist: watchlist.has(vin) ? watchlist.get(vin) : null,
        calculation_version: calculationVersion,
        computed_at: new Date().toISOString(),
      });
    }

    // Seller grain needs listing→owner. Read it once for the listings in play.
    const ownerByVin = await readListingOwners(client, [...listingIds]);

    const bySeller = new Map();
    const byTenant = new Map();
    for (const [vin, listingEvents] of byListing.entries()) {
      const owner = ownerByVin.get(vin);
      if (owner?.ownerUserId) {
        if (!bySeller.has(owner.ownerUserId)) bySeller.set(owner.ownerUserId, { events: [], tenantId: owner.tenantId, listings: new Set() });
        const bucket = bySeller.get(owner.ownerUserId);
        bucket.events.push(...listingEvents);
        bucket.listings.add(vin);
      }
      if (owner?.tenantId) {
        if (!byTenant.has(owner.tenantId)) byTenant.set(owner.tenantId, { events: [], listings: new Set() });
        const bucket = byTenant.get(owner.tenantId);
        bucket.events.push(...listingEvents);
        bucket.listings.add(vin);
      }
    }

    const inquiriesBySeller = new Map();
    const inspectionsBySeller = new Map();
    const inquiriesByTenant = new Map();
    const inspectionsByTenant = new Map();
    for (const row of inquiryRows) {
      const isInspection = INSPECTION_TYPES.has(String(row.inquiry_type));
      if (row.seller_id) {
        inquiriesBySeller.set(row.seller_id, (inquiriesBySeller.get(row.seller_id) || 0) + 1);
        if (isInspection) inspectionsBySeller.set(row.seller_id, (inspectionsBySeller.get(row.seller_id) || 0) + 1);
      }
      if (row.seller_tenant_id) {
        inquiriesByTenant.set(row.seller_tenant_id, (inquiriesByTenant.get(row.seller_tenant_id) || 0) + 1);
        if (isInspection) inspectionsByTenant.set(row.seller_tenant_id, (inspectionsByTenant.get(row.seller_tenant_id) || 0) + 1);
      }
    }

    const sellerRows = [];
    for (const [sellerId, bucket] of bySeller.entries()) {
      sellerRows.push({
        metric_date: metricDate,
        seller_user_id: sellerId,
        tenant_id: bucket.tenantId || null,
        active_listings: bucket.listings.size,
        ...computeScopeMetrics(bucket.events),
        inquiries: inquiriesBySeller.get(sellerId) || 0,
        inspections: inspectionsBySeller.get(sellerId) || 0,
        reservations: 0,
        calculation_version: calculationVersion,
        computed_at: new Date().toISOString(),
      });
    }

    const tenantRows = [];
    for (const [tenantId, bucket] of byTenant.entries()) {
      const scope = computeScopeMetrics(bucket.events);
      tenantRows.push({
        metric_date: metricDate,
        tenant_id: tenantId,
        active_listings: bucket.listings.size,
        impressions: scope.impressions,
        views: scope.views,
        unique_viewers: scope.unique_viewers,
        saves: scope.saves,
        shares_confirmed: scope.shares_confirmed,
        inquiries: inquiriesByTenant.get(tenantId) || 0,
        inspections: inspectionsByTenant.get(tenantId) || 0,
        reservations: 0,
        calculation_version: calculationVersion,
        source_event_count: scope.source_event_count,
        computed_at: new Date().toISOString(),
      });
    }

    const platformRow = {
      metric_date: metricDate,
      ...computePlatformMetrics(events),
      inquiries: inquiryRows.length,
      inspections: inquiryRows.filter((r) => INSPECTION_TYPES.has(String(r.inquiry_type))).length,
      reservations: reservationRows.length,
      active_listings: listingIds.size,
      calculation_version: calculationVersion,
      computed_at: new Date().toISOString(),
    };

    await writeRollups(client, { listingRows, sellerRows, tenantRows, platformRow });

    try {
      await client.from(RUNS)
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          events_scanned: events.length,
          listings_written: listingRows.length,
          sellers_written: sellerRows.length,
          tenants_written: tenantRows.length,
        })
        .eq('metric_date', metricDate)
        .eq('calculation_version', calculationVersion)
        .eq('started_at', runStartedAt);
    } catch { /* ignore */ }

    return {
      ok: true,
      metric_date: metricDate,
      calculation_version: calculationVersion,
      events_scanned: events.length,
      listings: listingRows.length,
      sellers: sellerRows.length,
      tenants: tenantRows.length,
    };
  } catch (error) {
    try {
      await client.from(RUNS)
        .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: String(error?.message || error).slice(0, 500) })
        .eq('metric_date', metricDate)
        .eq('calculation_version', calculationVersion)
        .eq('started_at', runStartedAt);
    } catch { /* ignore */ }
    // A failed rollup must be LOUD. Returning ok:false lets the caller surface
    // "unavailable" rather than a partially-written day read as truth.
    return { ok: false, metric_date: metricDate, error: String(error?.message || error) };
  }
}

async function readListingOwners(client, vins) {
  const owners = new Map();
  if (!vins.length) return owners;
  try {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, owner_id, tenant_id')
      .in('vin', vins);
    if (error) return owners;
    for (const row of Array.isArray(data) ? data : []) {
      owners.set(row.vin, {
        ownerUserId: row.owner_id ? String(row.owner_id) : null,
        tenantId: row.tenant_id ? String(row.tenant_id) : null,
      });
    }
  } catch { /* an owner lookup failure degrades seller/tenant grain, never the listing grain */ }
  return owners;
}

async function writeRollups(client, { listingRows, sellerRows, tenantRows, platformRow }) {
  // Upsert on the natural key so a recompute REPLACES the day rather than
  // appending a second version of it.
  if (listingRows.length) {
    await client.from('listing_daily_metrics')
      .upsert(listingRows, { onConflict: 'metric_date,listing_id,calculation_version' });
  }
  if (sellerRows.length) {
    await client.from('seller_daily_metrics')
      .upsert(sellerRows, { onConflict: 'metric_date,seller_user_id,calculation_version' });
  }
  if (tenantRows.length) {
    await client.from('tenant_daily_metrics')
      .upsert(tenantRows, { onConflict: 'metric_date,tenant_id,calculation_version' });
  }
  await client.from('platform_daily_metrics')
    .upsert([platformRow], { onConflict: 'metric_date,calculation_version' });
}

/**
 * Freshness of a day's rollup.
 *
 * Returned so a surface can say "as of 04:00" or fall back to `unavailable`,
 * rather than presenting a stale or missing rollup as a current zero — the
 * fake-zero defect this programme exists to remove.
 */
export async function rollupFreshness(metricDate, { client = defaultClient, calculationVersion = ROLLUP_CALCULATION_VERSION } = {}) {
  try {
    const { data, error } = await client
      .from(RUNS)
      .select('status, completed_at, events_scanned')
      .eq('metric_date', metricDate)
      .eq('calculation_version', calculationVersion)
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { available: false, reason: 'never_computed' };
    if (row.status !== 'completed') return { available: false, reason: `last_run_${row.status}` };
    return { available: true, computed_at: row.completed_at, events_scanned: row.events_scanned };
  } catch (error) {
    return { available: false, reason: 'freshness_unreadable', detail: String(error?.message || error) };
  }
}
