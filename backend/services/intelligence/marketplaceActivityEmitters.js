/**
 * CarUp Intelligence 1.0 — I3 server-side marketplace instrumentation.
 *
 * One module holds every server-emitted marketplace observation, so the anchoring
 * rules live in a single reviewable place instead of being scattered through the
 * routes and services they observe.
 *
 * Every function here is BEST-EFFORT and never throws: the domain write is the
 * authority and must succeed whether or not its observation lands. What is NOT
 * best-effort is honesty about failure — a dropped event increments a counter
 * (see intelligence_ingestion_stats) rather than disappearing.
 *
 * Anchoring rule (contract §4.2): idempotency material comes from the AUTHORITY —
 * the created row's id, or the post-commit timestamp of the transition — never
 * from request-time values. That is what makes a retry a no-op instead of a
 * second "sale".
 */
import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import {
  recordServerEvent,
  recordIngestionStats,
} from './activityLedgerService.js';

const OPAQUE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function opaqueKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return OPAQUE_KEY_RE.test(trimmed) ? trimmed : null;
}

/**
 * The client context a server-emitted, user-originated event needs.
 *
 * `marketplace_listing_opened` is server-emitted but session-scoped: without a
 * session key we cannot say whether two opens are one shopper or two, so counting
 * it would corrupt unique-viewer metrics. We therefore skip the event and COUNT
 * the skip, which is an honest bounded undercount rather than a silent lie.
 */
export function clientContextFrom(req) {
  const headers = req?.headers || {};
  return {
    sessionKey: opaqueKey(headers['x-carup-session-key']),
    pageViewId: opaqueKey(headers['x-carup-page-view']),
    platform: (() => {
      const p = typeof headers['x-carup-platform'] === 'string' ? headers['x-carup-platform'].trim().toLowerCase() : '';
      return p === 'ios' || p === 'android' ? p : 'web';
    })(),
    userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : '',
    prefetch: isPrefetch(headers),
  };
}

/**
 * A prefetch is the browser guessing, not a person looking. Counting it as a view
 * would inflate every listing's numbers by however aggressively the browser
 * speculates.
 */
export function isPrefetch(headers = {}) {
  const secPurpose = headers['sec-purpose'] || headers['purpose'] || '';
  if (typeof secPurpose === 'string' && /prefetch|prerender/i.test(secPurpose)) return true;
  return headers['x-carup-prefetch'] === '1';
}

function actorFrom(req, platform) {
  const ctx = req?.userContext || null;
  return {
    userId: ctx?.id ? String(ctx.id) : null,
    role: ctx?.platformRole || ctx?.role || null,
    tenantId: ctx?.tenantId ? String(ctx.tenantId) : null,
    platform: platform || 'server',
  };
}

function referralFrom(req) {
  const q = req?.query || {};
  const b = req?.body || {};
  return {
    referralCode: b.referral_code || q.referral_code || q.ref || null,
    campaignCode: b.campaign_code || q.campaign_code || q.campaign || null,
    sourceChannel: b.source_channel || q.source || null,
  };
}

/** Count a skipped open so the undercount is measurable rather than invisible. */
async function countOpenedWithoutContext(client) {
  try {
    await recordIngestionStats(client, { opened_without_context: 1 }, new Date());
  } catch { /* counters must never break a page load */ }
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Normalize the marketplace filter set to bounded CATALOGUE values.
 *
 * Values (not just keys) are retained for the structured filters because Lost
 * Opportunity (I6) must later answer "which searches could this listing have
 * matched if a field were filled in" — a question a hash cannot answer. The
 * free-text query is hashed instead: it can be a person's words, so it is
 * grouped, never stored.
 */
export function normalizeSearchFilters(query = {}) {
  const filters = {};
  const put = (key, value, max = 48) => {
    if (value === undefined || value === null) return;
    const str = String(value).trim();
    if (!str || str.length > max) return;
    filters[key] = str;
  };
  put('make', query.make);
  put('condition', query.condition);
  put('category', query.category);
  put('sort', query.sort, 32);
  const num = (key, value) => {
    const n = Number(value);
    if (Number.isFinite(n)) filters[key] = n;
  };
  if (query.minPrice !== undefined) num('minPrice', query.minPrice);
  if (query.maxPrice !== undefined) num('maxPrice', query.maxPrice);
  if (query.tag !== undefined) {
    const tags = String(query.tag).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8).sort();
    if (tags.length) filters.tag = tags.join(',');
  }
  return filters;
}

export function hashQueryText(q) {
  if (typeof q !== 'string' || !q.trim()) return null;
  return crypto.createHash('sha256').update(q.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Record a search and, when it returned nothing, the zero-result signal that the
 * plan treats as a supply opportunity rather than a failure.
 */
export async function emitSearchPerformed(req, { query, resultCount, client = defaultClient } = {}) {
  try {
    const ctx = clientContextFrom(req);
    if (!ctx.sessionKey) return { recorded: false, reason: 'no_session_key' };
    const filters = normalizeSearchFilters(query || {});
    const queryHash = hashQueryText(query?.q);
    const filterKeys = Object.keys(filters).sort();
    // A bare listing fetch with no query and no filters is browsing, not searching.
    if (!queryHash && filterKeys.length === 0) return { recorded: false, reason: 'not_a_search' };

    const actor = actorFrom(req, ctx.platform);
    const referral = referralFrom(req);
    const material = [ctx.sessionKey, queryHash || '', filterKeys.join(','), JSON.stringify(filters), ctx.pageViewId || ''];
    const common = {
      objectType: 'search',
      objectId: null,
      actor,
      scope: { tenantId: null, organizationId: null },
      sourceSurface: 'search',
      sessionKey: ctx.sessionKey,
      pageViewId: ctx.pageViewId,
      referralCode: referral.referralCode,
      campaignCode: referral.campaignCode,
      sourceChannel: referral.sourceChannel,
      client,
    };

    const result = await recordServerEvent({
      ...common,
      eventType: 'marketplace_search_performed',
      idempotencyMaterial: material,
      metadata: {
        normalized_query_hash: queryHash,
        filter_keys: filterKeys,
        filters,
        result_count: Number.isFinite(resultCount) ? resultCount : 0,
      },
    });

    if (resultCount === 0) {
      await recordServerEvent({
        ...common,
        eventType: 'marketplace_search_zero_results',
        idempotencyMaterial: [...material, 'zero'],
        metadata: { normalized_query_hash: queryHash, filter_keys: filterKeys, filters },
      });
    }
    return result;
  } catch {
    return { recorded: false, reason: 'emit_failed' };
  }
}

/**
 * Record an organic listing view.
 *
 * This closes the single largest gap I0 found: before this, a listing view left a
 * trace ONLY when a referral or campaign code happened to be on the URL, so the
 * ordinary case — someone finding a car and opening it — was recorded nowhere.
 */
export async function emitListingOpened(req, { vin, scope = null, client = defaultClient } = {}) {
  try {
    if (!vin) return { recorded: false, reason: 'no_vin' };
    const ctx = clientContextFrom(req);
    if (ctx.prefetch) return { recorded: false, reason: 'prefetch' };
    if (!ctx.sessionKey || !ctx.pageViewId) {
      await countOpenedWithoutContext(client);
      return { recorded: false, reason: 'no_client_context' };
    }
    const actor = actorFrom(req, ctx.platform);
    const referral = referralFrom(req);
    return await recordServerEvent({
      eventType: 'marketplace_listing_opened',
      vin,
      listingId: vin,
      idempotencyMaterial: [ctx.sessionKey, vin, ctx.pageViewId],
      actor,
      scope,
      sourceSurface: 'marketplace_detail',
      sessionKey: ctx.sessionKey,
      pageViewId: ctx.pageViewId,
      referralCode: referral.referralCode,
      campaignCode: referral.campaignCode,
      sourceChannel: referral.sourceChannel,
      metadata: { attributed: Boolean(referral.referralCode || referral.campaignCode) },
      client,
    });
  } catch {
    return { recorded: false, reason: 'emit_failed' };
  }
}

// ── Authoritative-action observations ───────────────────────────────────────

/**
 * Record a save. `savedAt` is the authority row's created_at: a repeated save of
 * an already-saved listing is a no-op in `saved_vehicles`, and passing that row's
 * original timestamp keeps the observation a no-op too.
 */
export async function emitListingSaved({ userId, vin, savedAt, req = null, client = defaultClient } = {}) {
  try {
    if (!userId || !vin || !savedAt) return { recorded: false, reason: 'missing_authority_material' };
    const ctx = req ? clientContextFrom(req) : { sessionKey: null, pageViewId: null, platform: 'server' };
    return await recordServerEvent({
      eventType: 'marketplace_listing_saved',
      vin,
      listingId: vin,
      idempotencyMaterial: [userId, vin, 'saved', savedAt],
      actor: { userId, platform: ctx.platform },
      sessionKey: ctx.sessionKey,
      pageViewId: ctx.pageViewId,
      client,
    });
  } catch {
    return { recorded: false, reason: 'emit_failed' };
  }
}

/**
 * Record an unsave, keyed on the DELETED row's created_at.
 *
 * This event has no reconciliation path by construction — once the row is gone
 * there is nothing left to sweep against — so the delete must return its row or
 * the observation is lost. That is why `unsaveListing` deletes with a returning
 * clause rather than blind.
 */
export async function emitListingUnsaved({ userId, vin, savedAt, req = null, client = defaultClient } = {}) {
  try {
    if (!userId || !vin || !savedAt) return { recorded: false, reason: 'missing_authority_material' };
    const ctx = req ? clientContextFrom(req) : { sessionKey: null, pageViewId: null, platform: 'server' };
    return await recordServerEvent({
      eventType: 'marketplace_listing_unsaved',
      vin,
      listingId: vin,
      idempotencyMaterial: [userId, vin, 'unsaved', savedAt],
      actor: { userId, platform: ctx.platform },
      sessionKey: ctx.sessionKey,
      pageViewId: ctx.pageViewId,
      client,
    });
  } catch {
    return { recorded: false, reason: 'emit_failed' };
  }
}

/**
 * Inquiry types that ARE an inspection request, per the authoritative inquiry
 * taxonomy. An inspection is a distinct funnel stage, not a relabelled lead.
 */
const INSPECTION_INQUIRY_TYPES = new Set(['inspection_request', 'vehicle_inspection_request']);

/**
 * Record an inquiry. The inquiry row itself remains the authority for the count
 * shown to a seller (`inquiries@1` reads the authority, not this event); the
 * event exists so the inquiry can be stage-linked to the views and saves that
 * preceded it.
 */
export async function emitInquiryCreated(inquiry, { req = null, client = defaultClient } = {}) {
  try {
    const inquiryId = inquiry?.id ? String(inquiry.id) : null;
    if (!inquiryId) return { recorded: false, reason: 'missing_inquiry_id' };
    const vin = inquiry.listing_id ? String(inquiry.listing_id) : null;
    const ctx = req ? clientContextFrom(req) : { sessionKey: null, pageViewId: null, platform: 'server' };
    const actor = req ? actorFrom(req, ctx.platform) : { userId: inquiry.buyer_id || null, platform: 'server' };
    // Scope is known from the authority row itself — the inquiry already carries
    // the seller's tenant, so no extra read is needed and no guess is possible.
    const scope = {
      tenantId: inquiry.seller_tenant_id ? String(inquiry.seller_tenant_id) : null,
      organizationId: null,
    };
    const shared = {
      vin,
      listingId: vin,
      objectType: 'inquiry',
      objectId: inquiryId,
      actor,
      scope,
      sessionKey: ctx.sessionKey,
      pageViewId: ctx.pageViewId,
      sourceChannel: inquiry.source_channel || null,
      referralCode: inquiry.referral_code || null,
      campaignCode: inquiry.campaign_code || null,
      client,
    };

    const result = await recordServerEvent({
      ...shared,
      eventType: 'marketplace_inquiry_created',
      idempotencyMaterial: [inquiryId],
      metadata: { inquiry_type: inquiry.inquiry_type || null, inquiry_status: inquiry.status || null },
    });

    if (inquiry.inquiry_type && INSPECTION_INQUIRY_TYPES.has(String(inquiry.inquiry_type))) {
      await recordServerEvent({
        ...shared,
        eventType: 'marketplace_inspection_requested',
        idempotencyMaterial: [inquiryId, 'inspection'],
        metadata: { inquiry_type: inquiry.inquiry_type },
      });
    }
    return result;
  } catch {
    return { recorded: false, reason: 'emit_failed' };
  }
}
