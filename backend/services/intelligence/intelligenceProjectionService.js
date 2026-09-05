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
import { ROLLUP_CALCULATION_VERSION, rollupFreshness, dayBounds } from './rollupService.js';
import {
  computeListingCompleteness,
  computeLostOpportunity,
  nextBestActions,
} from './listingCompletenessService.js';
import { LISTING_SELECT_COLUMNS_WITH_CLAIMS } from '../marketplace/listingSummaryService.js';
import { getCanonicalTrust } from '../trustDecision/canonicalTrustService.js';

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
  // A stage count can legitimately exceed the stage before it: a lead that arrived
  // by WhatsApp or through an operator never passed through a listing view, and a
  // listing opened from a saved list had no preceding impression. Publishing
  // "136% of viewers enquired" would be nonsense, so the ratio is capped and the
  // fact that it was capped is stated rather than hidden.
  const raw = (numerator / denominator) * 100;
  if (raw > 100) {
    return {
      availability: AVAILABILITY.VALUE,
      value: 100,
      unit: 'percent',
      capped: true,
      note: 'More actions were recorded at this stage than at the one before it — some arrived through a channel that skips it.',
    };
  }
  return { availability: AVAILABILITY.VALUE, value: Math.round(raw * 10) / 10, unit: 'percent' };
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
/**
 * A PostgREST `or()` filter is a string the caller's id is interpolated into, so an
 * id containing a comma or parenthesis could rewrite the predicate. Same guard the
 * inquiry service already uses; an id that fails it falls back to two safe reads.
 */
const SAFE_OR_VALUE = /^[A-Za-z0-9_:@-]+$/;

export async function resolveOwnedListings(client, actor) {
  const userId = actor?.id ? String(actor.id) : null;
  if (!userId) throw new AuthorizationError('Authentication required.');

  const toScope = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
    vin: row.vin,
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
  }));

  // Owned OR sold by this user: the two relationships differ for most listings,
  // and checking only one locks the other party out of their own analytics.
  if (SAFE_OR_VALUE.test(userId)) {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, owner_id, current_seller_id, tenant_id')
      .or(`owner_id.eq.${userId},current_seller_id.eq.${userId}`);
    if (error) throw new Error('listing_ownership_unreadable');
    return toScope(data);
  }

  const [owned, sold] = await Promise.all([
    client.from('vehicles').select('vin, owner_id, current_seller_id, tenant_id').eq('owner_id', userId),
    client.from('vehicles').select('vin, owner_id, current_seller_id, tenant_id').eq('current_seller_id', userId),
  ]);
  if (owned?.error || sold?.error) throw new Error('listing_ownership_unreadable');
  const merged = new Map();
  for (const row of [...(owned.data || []), ...(sold.data || [])]) merged.set(row.vin, row);
  return toScope([...merged.values()]);
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
    .select('vin, owner_id, current_seller_id, tenant_id')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error('listing_lookup_unreadable');
  if (!data) throw new NotFoundError('Listing not found.');
  // Either relationship grants access: the owner of the vehicle, or the party
  // actually selling it. These differ for most CarUp listings, and checking only
  // owner_id locked the governed seller out of their own listing's analytics.
  const ownsDirectly = data.owner_id && String(data.owner_id) === userId;
  const sellsDirectly = data.current_seller_id && String(data.current_seller_id) === userId;
  const sameTenant = data.tenant_id && actor?.tenantId && String(data.tenant_id) === String(actor.tenantId);
  if (!ownsDirectly && !sellsDirectly && !sameTenant) throw new NotFoundError('Listing not found.');
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
 * Freshness of the most recent day that could reasonably be complete.
 *
 * Deliberately NOT today: today is still accumulating, so a nightly job that
 * correctly rolled up yesterday would leave today `never_computed` and every
 * seller, dealer and admin request would report `unavailable` every day. The
 * window still INCLUDES today's partial data where it exists; freshness simply
 * does not demand a finished rollup for a day that is not over.
 */
async function windowFreshness(client, dates) {
  const completable = dates.length > 1 ? dates[dates.length - 2] : dates[dates.length - 1];
  const yesterday = await rollupFreshness(completable, { client });
  if (yesterday?.available) return yesterday;
  // Fall back to today: a same-day backfill run is legitimate freshness too.
  return rollupFreshness(dates[dates.length - 1], { client });
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
    // I6: what to improve, and what it has demonstrably cost. Read separately so a
    // metrics failure cannot suppress actionable guidance that needs no metrics.
    ...(await readListingGuidance(client, listing.vin, dates)),
  };
}

/**
 * Completeness, lost opportunity and next-best-action for one listing.
 *
 * Deliberately non-fatal: guidance is computed from the listing's own fields and
 * the day's searches, so it survives a rollup outage. If even this cannot be
 * read, the block reports itself unavailable rather than implying a perfect
 * listing with nothing to improve.
 */
export async function readListingGuidance(client, vin, dates) {
  try {
    const [vehicleRes, imagesRes, evidenceRes, serviceRes] = await Promise.all([
      // The CANONICAL listing projection, not `select('*')`. Issue #164 fixed the
      // number of vehicle column allow-lists at two; reusing one of them means
      // this read cannot pull engine/chassis/plate into memory and cannot become
      // a third place where a private column leaks.
      client.from('vehicles').select(LISTING_SELECT_COLUMNS_WITH_CLAIMS).eq('vin', vin).maybeSingle(),
      client.from('listing_images').select('image_url, is_primary').eq('vin', vin),
      client.from('vehicle_evidence').select('id').eq('vin', vin),
      client.from('partsentry_logs').select('id').eq('vin', vin),
    ]);
    const vehicle = vehicleRes?.data || null;
    if (!vehicle) return { guidance: unavailable('listing_not_readable') };

    // Trust comes from the canonical service, never from the row. The vehicles
    // trust columns are an unversioned cache, and #164 exists because projecting
    // them published `trust_score: 84` beside a report saying `not_evaluated`.
    let trust = { state: 'not_evaluated', band: null, score: null };
    try {
      const canonical = await getCanonicalTrust(vin, { client });
      if (canonical) {
        trust = {
          state: canonical.state ?? canonical.evaluation_state ?? 'not_evaluated',
          band: canonical.band ?? null,
          score: canonical.score ?? null,
        };
      }
    } catch {
      // Unknown stays unknown: a trust read failure must never become a low score.
      trust = { state: 'not_evaluated', band: null, score: null };
    }

    const completeness = computeListingCompleteness({
      vehicle,
      imageRows: imagesRes?.data || [],
      evidenceCount: (evidenceRes?.data || []).length,
      serviceCount: (serviceRes?.data || []).length,
      trust,
    });

    let searchEvents = [];
    try {
      const { start } = dayBounds(dates[0]);
      const { end } = dayBounds(dates[dates.length - 1]);
      const { data } = await client
        .from('marketplace_activity_events')
        .select('metadata')
        .eq('event_type', 'marketplace_search_performed')
        .gte('occurred_at', start)
        .lt('occurred_at', end);
      searchEvents = Array.isArray(data) ? data : [];
    } catch {
      // No searches readable: lost opportunity reports zero considered, which is
      // honest, rather than a fabricated missed-search count.
      searchEvents = [];
    }

    const lostOpportunity = computeLostOpportunity({ vehicle, searchEvents });

    return {
      completeness,
      lost_opportunity: lostOpportunity,
      next_best_actions: nextBestActions({ completeness, lostOpportunity }),
    };
  } catch {
    return { guidance: unavailable('guidance_unreadable') };
  }
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
  const orderedSellerRows = sellerRows
    .slice()
    .sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)));
  const activeListings = orderedSellerRows.length
    ? Math.max(...orderedSellerRows.map((row) => Number(row.active_listings) || 0))
    : 0;

  return {
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: ROLLUP_CALCULATION_VERSION,
    as_of: freshness.computed_at,
    listings_owned: owned.length,
    metrics: {
      active_listings: metric(activeListings),
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
    // Only days that were actually computed are returned. The client must never manufacture
    // missing days as zero; coverage above makes any gap explicit.
    series: orderedSellerRows.map((row) => ({
      date: String(row.metric_date),
      active_listings: Number(row.active_listings) || 0,
      impressions: Number(row.impressions) || 0,
      views: Number(row.views) || 0,
      saves: Number(row.saves) || 0,
      inquiries: Number(row.inquiries) || 0,
      inspections: Number(row.inspections) || 0,
    })),
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
