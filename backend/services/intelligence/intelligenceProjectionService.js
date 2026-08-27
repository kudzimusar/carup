/**
 * CarUp Intelligence 1.0 — I5 authorization and privacy projections.
 *
 * Every read of Intelligence data goes through this module. Its job is to answer
 * "what may THIS caller see?" before anything is returned, and to answer it from
 * server-derived facts rather than from anything the request asserted.
 *
 * Four rules:
 *
 *  1. SCOPE IS PROVEN, NEVER ASSERTED. A seller's listings are resolved by
 *     querying which listings they actually own; a dealer's tenant comes from
 *     verified membership. A caller cannot name the seller or tenant they want
 *     to read — the I0 audit found exactly that pattern elsewhere in the codebase
 *     (client-supplied tenant_id preferred over the verified one) and it is the
 *     shape of every cross-tenant analytics leak.
 *
 *  2. AGGREGATES, NOT IDENTITIES. A seller may learn that 822 unique shoppers
 *     viewed their listing. They may not learn who. Identity becomes visible only
 *     through a declared lead, which `marketplace_inquiries` already models — so
 *     these projections never return an actor id, session key, or any row-level
 *     behavioural record.
 *
 *  3. UNAVAILABLE IS NOT ZERO. When a rollup has not been computed, or a read
 *     fails, the projection says so. It never returns zeros that read as "nobody
 *     came" — the fake-zero defect catalogued across a dozen existing surfaces in
 *     I0 §3.
 *
 *  4. GOVERNMENT IS NOT A SUPER-ADMIN. Institutional access is purpose-limited
 *     and is deliberately NOT the commercial marketplace projection. The existing
 *     `authorizeRole(['admin','government'])` on marketplace admin analytics
 *     (gap G5) is not reproduced here.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { ROLLUP_CALCULATION_VERSION, rollupFreshness } from './rollupService.js';

/** Minimum denominator before a conversion rate is reported at all (contract §7). */
export const MIN_CONVERSION_DENOMINATOR = 20;
/** Minimum comparable cohort before any benchmark is shown (contract §6). */
export const MIN_BENCHMARK_COHORT = 8;

export const AVAILABILITY = Object.freeze({
  VALUE: 'value',
  INSUFFICIENT_DATA: 'insufficient_data',
  UNAVAILABLE: 'unavailable',
  NOT_APPLICABLE: 'not_applicable',
});

class AuthorizationError extends Error {
  constructor(message) { super(message); this.name = 'AuthorizationError'; this.status = 403; }
}
class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; this.status = 404; }
}
export { AuthorizationError, NotFoundError };

// ── Date helpers ────────────────────────────────────────────────────────────

export function windowDates(days, today = new Date()) {
  const dates = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.reverse();
}

export function resolveWindowDays(raw) {
  const n = Number(raw);
  // 7/30/90 only: an arbitrary window would silently change what a number means
  // while still calling itself the same metric.
  return [7, 30, 90].includes(n) ? n : 7;
}

// ── Availability envelope ───────────────────────────────────────────────────

/**
 * Wrap a number in its availability state.
 *
 * Every metric leaves this module inside one of these envelopes, so a surface
 * cannot accidentally render an unavailable metric as 0 — it has to look at
 * `availability` to get at `value` at all.
 */
export function metric(value, { availability = AVAILABILITY.VALUE, reason = null, unit = 'count' } = {}) {
  if (availability !== AVAILABILITY.VALUE) return { availability, reason, value: null, unit };
  return { availability, value, unit };
}

export function unavailable(reason) {
  return { availability: AVAILABILITY.UNAVAILABLE, reason, value: null };
}

/**
 * A rate is only reported when its denominator is large enough to mean anything.
 * Below the floor it is `insufficient_data` — never a headline percentage
 * computed from three visits.
 */
export function rate(numerator, denominator, { min = MIN_CONVERSION_DENOMINATOR } = {}) {
  if (!Number.isFinite(denominator) || denominator < min) {
    return { availability: AVAILABILITY.INSUFFICIENT_DATA, reason: `denominator_below_${min}`, value: null, unit: 'percent' };
  }
  return { availability: AVAILABILITY.VALUE, value: Math.round((numerator / denominator) * 1000) / 10, unit: 'percent' };
}

function sumRows(rows, field) {
  return rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
}

/**
 * Uniques across a multi-day window cannot be summed either: the same shopper
 * returning on three days is one person, and daily rollups cannot tell us that.
 * Rather than publish an inflated number, the window-level unique is reported as
 * the largest single day with an explicit note about what it means.
 */
function windowUnique(rows, field) {
  if (!rows.length) return metric(0);
  const best = Math.max(...rows.map((row) => Number(row?.[field]) || 0));
  return { availability: AVAILABILITY.VALUE, value: best, unit: 'count', basis: 'peak_day' };
}

// ── Ownership / scope proof ─────────────────────────────────────────────────

/**
 * Resolve the listings a caller actually owns. This is the authorization
 * boundary for every seller-facing projection: it is a query, not a claim.
 */
export async function resolveOwnedListings(client, actor) {
  const userId = actor?.id ? String(actor.id) : null;
  if (!userId) throw new AuthorizationError('Authentication required.');
  const { data, error } = await client
    .from('vehicles')
    .select('vin, owner_id, tenant_id')
    .eq('owner_id', userId);
  if (error) throw new Error('listing_ownership_unreadable');
  return (Array.isArray(data) ? data : []).map((row) => ({
    vin: row.vin,
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
  }));
}

/**
 * Prove this caller owns this listing before ANY metric for it is read.
 *
 * Ownership failure is deliberately reported as not-found rather than forbidden:
 * a distinct 403 would confirm that a VIN exists and belongs to someone else,
 * turning the analytics endpoint into an ownership oracle.
 */
export async function assertListingOwnership(client, actor, vin) {
  const userId = actor?.id ? String(actor.id) : null;
  if (!userId) throw new AuthorizationError('Authentication required.');
  if (!vin) throw new NotFoundError('Listing not found.');
  const { data, error } = await client
    .from('vehicles')
    .select('vin, owner_id, tenant_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error('listing_lookup_unreadable');
  if (!data) throw new NotFoundError('Listing not found.');
  const ownsDirectly = data.owner_id && String(data.owner_id) === userId;
  const sameTenant = data.tenant_id && actor?.tenantId && String(data.tenant_id) === String(actor.tenantId);
  if (!ownsDirectly && !sameTenant) throw new NotFoundError('Listing not found.');
  return { vin: data.vin, tenantId: data.tenant_id ? String(data.tenant_id) : null };
}

/**
 * A dealer's tenant comes from the verified membership on the session, never
 * from a query parameter.
 */
export function requireVerifiedTenant(actor) {
  const tenantId = actor?.tenantId ? String(actor.tenantId) : null;
  if (!tenantId) {
    throw new AuthorizationError('A verified tenant context is required for dealer intelligence.');
  }
  return tenantId;
}

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

export function requirePlatformAdmin(actor) {
  const role = actor?.platformRole || actor?.role || null;
  if (!PLATFORM_ADMIN_ROLES.has(String(role))) {
    throw new AuthorizationError('Platform admin role required.');
  }
  return role;
}

// ── Rollup reads ────────────────────────────────────────────────────────────

async function readListingRollups(client, vins, dates) {
  if (!vins.length) return [];
  const { data, error } = await client
    .from('listing_daily_metrics')
    .select('*')
    .in('listing_id', vins)
    .in('metric_date', dates)
    .eq('calculation_version', ROLLUP_CALCULATION_VERSION);
  if (error) throw new Error('rollup_unreadable');
  return Array.isArray(data) ? data : [];
}

async function readTenantRollups(client, tenantId, dates) {
  const { data, error } = await client
    .from('tenant_daily_metrics')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('metric_date', dates)
    .eq('calculation_version', ROLLUP_CALCULATION_VERSION);
  if (error) throw new Error('rollup_unreadable');
  return Array.isArray(data) ? data : [];
}

async function readPlatformRollups(client, dates) {
  const { data, error } = await client
    .from('platform_daily_metrics')
    .select('*')
    .in('metric_date', dates)
    .eq('calculation_version', ROLLUP_CALCULATION_VERSION);
  if (error) throw new Error('rollup_unreadable');
  return Array.isArray(data) ? data : [];
}

/**
 * Freshness across the window's most recent day. A surface uses this to say
 * "as of …" or to fall back to unavailable — never to present a stale or missing
 * rollup as a current zero.
 */
async function windowFreshness(client, dates) {
  const latest = dates[dates.length - 1];
  return rollupFreshness(latest, { client });
}

function emptyWindowEnvelope(reason) {
  return {
    availability: AVAILABILITY.UNAVAILABLE,
    reason,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    message: 'Intelligence for this period could not be read. These figures are NOT zero.',
  };
}

// ── Seller / owner projections ──────────────────────────────────────────────

/**
 * One listing's insights for its owner.
 *
 * Returns aggregates only. No viewer identity, no session key, no per-event row
 * ever leaves this function — a seller learns how many people came, never who.
 */
export async function getListingInsights(client, actor, vin, { windowDays = 7 } = {}) {
  const listing = await assertListingOwnership(client, actor, vin);
  const dates = windowDates(windowDays);
  let rows;
  let freshness;
  try {
    [rows, freshness] = await Promise.all([
      readListingRollups(client, [listing.vin], dates),
      windowFreshness(client, dates),
    ]);
  } catch (error) {
    return { listing_id: listing.vin, window_days: windowDays, ...emptyWindowEnvelope(String(error?.message || 'rollup_unreadable')) };
  }

  if (!freshness?.available) {
    return { listing_id: listing.vin, window_days: windowDays, ...emptyWindowEnvelope(freshness?.reason || 'not_computed') };
  }

  const views = sumRows(rows, 'views');
  const impressions = sumRows(rows, 'impressions');
  const saves = sumRows(rows, 'saves');
  const inquiries = sumRows(rows, 'inquiries');
  const latest = rows.slice().sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date))).at(-1);

  return {
    listing_id: listing.vin,
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    as_of: freshness.computed_at,
    metrics: {
      impressions: metric(impressions),
      unique_reach: windowUnique(rows, 'unique_reach'),
      views: metric(views),
      unique_viewers: windowUnique(rows, 'unique_viewers'),
      engaged_views: metric(sumRows(rows, 'engaged_views')),
      saves: metric(saves),
      unsaves: metric(sumRows(rows, 'unsaves')),
      // Never combined: the two mean different things.
      shares_confirmed: metric(sumRows(rows, 'shares_confirmed')),
      shares_initiated: metric(sumRows(rows, 'shares_initiated')),
      inquiry_starts: metric(sumRows(rows, 'inquiry_starts')),
      inquiries: metric(inquiries),
      inspections: metric(sumRows(rows, 'inspections')),
      // Current watchlist state is an authority read, so it is the latest value,
      // not a sum of daily snapshots.
      net_watchlist: latest && latest.net_watchlist !== null && latest.net_watchlist !== undefined
        ? metric(Number(latest.net_watchlist))
        : { availability: AVAILABILITY.NOT_APPLICABLE, reason: 'no_current_saves', value: null },
    },
    conversion: {
      view_to_save: rate(saves, views),
      view_to_inquiry: rate(inquiries, views),
      impression_to_view: rate(views, impressions),
    },
    // Stated so a seller can tell an honest zero from a gap in measurement.
    coverage: { days_with_data: rows.length, days_requested: windowDays },
  };
}

/**
 * The seller's own cross-listing pulse.
 *
 * Uniques are read from the seller grain rather than summed from listings,
 * because one shopper browsing three of their cars is one person.
 */
export async function getSellerPulse(client, actor, { windowDays = 7 } = {}) {
  const owned = await resolveOwnedListings(client, actor);
  const dates = windowDates(windowDays);

  if (!owned.length) {
    return {
      window_days: windowDays,
      availability: AVAILABILITY.NOT_APPLICABLE,
      reason: 'no_listings',
      message: 'Publish a vehicle to start receiving Marketplace insights.',
      calculation_version: ROLLUP_CALCULATION_VERSION,
    };
  }

  let sellerRows;
  let freshness;
  try {
    const { data, error } = await client
      .from('seller_daily_metrics')
      .select('*')
      .eq('seller_user_id', String(actor.id))
      .in('metric_date', dates)
      .eq('calculation_version', ROLLUP_CALCULATION_VERSION);
    if (error) throw new Error('rollup_unreadable');
    sellerRows = Array.isArray(data) ? data : [];
    freshness = await windowFreshness(client, dates);
  } catch (error) {
    return { window_days: windowDays, ...emptyWindowEnvelope(String(error?.message || 'rollup_unreadable')) };
  }

  if (!freshness?.available) {
    return { window_days: windowDays, ...emptyWindowEnvelope(freshness?.reason || 'not_computed') };
  }

  const views = sumRows(sellerRows, 'views');
  const saves = sumRows(sellerRows, 'saves');
  const inquiries = sumRows(sellerRows, 'inquiries');

  return {
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    as_of: freshness.computed_at,
    listings_owned: owned.length,
    metrics: {
      impressions: metric(sumRows(sellerRows, 'impressions')),
      views: metric(views),
      unique_viewers: windowUnique(sellerRows, 'unique_viewers'),
      saves: metric(saves),
      shares_confirmed: metric(sumRows(sellerRows, 'shares_confirmed')),
      inquiries: metric(inquiries),
      inspections: metric(sumRows(sellerRows, 'inspections')),
    },
    conversion: {
      view_to_save: rate(saves, views),
      view_to_inquiry: rate(inquiries, views),
    },
    coverage: { days_with_data: sellerRows.length, days_requested: windowDays },
  };
}

// ── Dealer / tenant projection ──────────────────────────────────────────────

/**
 * Tenant-scoped dealer intelligence. The tenant is taken from verified session
 * membership; there is intentionally no parameter for it.
 */
export async function getDealerIntelligence(client, actor, { windowDays = 7 } = {}) {
  const tenantId = requireVerifiedTenant(actor);
  const dates = windowDates(windowDays);
  let rows;
  let freshness;
  try {
    [rows, freshness] = await Promise.all([
      readTenantRollups(client, tenantId, dates),
      windowFreshness(client, dates),
    ]);
  } catch (error) {
    return { window_days: windowDays, ...emptyWindowEnvelope(String(error?.message || 'rollup_unreadable')) };
  }
  if (!freshness?.available) {
    return { window_days: windowDays, ...emptyWindowEnvelope(freshness?.reason || 'not_computed') };
  }

  const views = sumRows(rows, 'views');
  const inquiries = sumRows(rows, 'inquiries');

  return {
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    as_of: freshness.computed_at,
    metrics: {
      impressions: metric(sumRows(rows, 'impressions')),
      views: metric(views),
      unique_viewers: windowUnique(rows, 'unique_viewers'),
      saves: metric(sumRows(rows, 'saves')),
      shares_confirmed: metric(sumRows(rows, 'shares_confirmed')),
      inquiries: metric(inquiries),
      inspections: metric(sumRows(rows, 'inspections')),
      active_listings: rows.length ? metric(Math.max(...rows.map((r) => Number(r.active_listings) || 0))) : metric(0),
    },
    conversion: { view_to_inquiry: rate(inquiries, views) },
    coverage: { days_with_data: rows.length, days_requested: windowDays },
  };
}

// ── Admin projection ────────────────────────────────────────────────────────

export async function getAdminIntelligence(client, actor, { windowDays = 7 } = {}) {
  requirePlatformAdmin(actor);
  const dates = windowDates(windowDays);
  let rows;
  let freshness;
  try {
    [rows, freshness] = await Promise.all([
      readPlatformRollups(client, dates),
      windowFreshness(client, dates),
    ]);
  } catch (error) {
    return { window_days: windowDays, ...emptyWindowEnvelope(String(error?.message || 'rollup_unreadable')) };
  }
  if (!freshness?.available) {
    return { window_days: windowDays, ...emptyWindowEnvelope(freshness?.reason || 'not_computed') };
  }

  const searches = sumRows(rows, 'searches');
  const views = sumRows(rows, 'views');
  const inquiries = sumRows(rows, 'inquiries');

  return {
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    as_of: freshness.computed_at,
    metrics: {
      searches: metric(searches),
      zero_result_searches: metric(sumRows(rows, 'zero_result_searches')),
      impressions: metric(sumRows(rows, 'impressions')),
      views: metric(views),
      unique_shoppers: windowUnique(rows, 'unique_shoppers'),
      saves: metric(sumRows(rows, 'saves')),
      inquiry_starts: metric(sumRows(rows, 'inquiry_starts')),
      inquiries: metric(inquiries),
      inspections: metric(sumRows(rows, 'inspections')),
      reservations: metric(sumRows(rows, 'reservations')),
      active_listings: rows.length ? metric(Math.max(...rows.map((r) => Number(r.active_listings) || 0))) : metric(0),
    },
    conversion: { view_to_inquiry: rate(inquiries, views) },
    // Unmet demand is an opportunity signal, so it is surfaced explicitly rather
    // than buried inside the search total.
    supply_signal: {
      zero_result_rate: rate(sumRows(rows, 'zero_result_searches'), searches),
    },
    coverage: { days_with_data: rows.length, days_requested: windowDays },
  };
}

/**
 * Government / institutional projection.
 *
 * Deliberately NOT the commercial marketplace view. The canonical plan is
 * explicit that government is not a universal super-admin and must not receive
 * shopper behaviour; the I0 audit found the existing marketplace admin analytics
 * endpoint gated `['admin','government']`, which is gap G5. Nothing here exposes
 * views, saves, searches or any behavioural aggregate.
 *
 * Until a governed institutional contract and a real registry integration exist
 * (I15, and integrations that I0 classified BUILT-BUT-INACTIVE), the honest
 * answer is that there is nothing to show — stated as such, never as zeros.
 */
export async function getGovernmentIntelligence(client, actor) {
  const role = actor?.platformRole || actor?.role || null;
  if (String(role) !== 'government' && !PLATFORM_ADMIN_ROLES.has(String(role))) {
    throw new AuthorizationError('Institutional role required.');
  }
  return {
    availability: AVAILABILITY.NOT_APPLICABLE,
    reason: 'institutional_contract_not_established',
    message:
      'Institutional intelligence is purpose-limited and requires a governed data-sharing contract and an active authoritative integration. No commercial marketplace behaviour is available to institutional roles.',
    commercial_behaviour_access: false,
    calculation_version: ROLLUP_CALCULATION_VERSION,
  };
}
