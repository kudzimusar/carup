/**
 * Marketplace inquiry service — the single buyer-intent capture path.
 *
 * Every buyer action (purchase interest, quote, inspection, import/container interest, diaspora request)
 * becomes a structured marketplace_inquiries row. Captures referral attribution and emits a referral
 * event (best-effort) but NEVER mints rewards. Diaspora/import/container inquiries store ONLY the
 * inquiry intent + contact — never shipment/container sensitive data (honors PR #58 boundary).
 *
 * Privacy: public/guest responses expose NO guest contact, seller id, or risk metadata. Seller/admin
 * projections expose only what the authorized role needs to follow up.
 */

import { randomUUID } from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { ValidationError, NotFoundError, ForbiddenError, DatabaseError } from '../../utils/errors.js';
import {
  MARKETPLACE_INQUIRY_TYPES,
  MARKETPLACE_INQUIRY_STATUSES,
  MARKETPLACE_SOURCE_CHANNELS,
  INQUIRY_TYPE_TO_REFERRAL_EVENT,
  DIASPORA_INQUIRY_TYPES,
} from './marketplaceEventTypes.js';
import { marketplaceReferralBridge } from './marketplaceReferralBridgeService.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

const TABLE = 'marketplace_inquiries';
const MAX_MESSAGE_LEN = 2000;
const MAX_NAME_LEN = 160;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9 ()-]{6,20}$/;

/** Vehicle-bound inquiry types whose listing_id must resolve to a real, visible vehicle VIN. */
const VEHICLE_BOUND_TYPES = new Set([
  'vehicle_purchase_interest',
  'vehicle_inspection_request',
  'dealer_stock_request',
  'trade_in_request',
]);

function clampStr(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// Only these keys are persisted from the client metadata blob. Everything else (including any
// shipment/container fields a diaspora inquiry might try to smuggle in, or extra PII) is dropped, so
// the PR #58 boundary and the no-PII-leak invariant hold at-rest, not just at the column level.
const ALLOWED_METADATA_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'source_page', 'referrer', 'preferred_contact'];
function sanitizeInquiryMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    const v = metadata[key];
    if (v === undefined || v === null) continue;
    out[key] = String(v).slice(0, 200);
  }
  return out;
}

/** Lightweight, public-safe risk heuristic. Off-platform payment pushes -> watch. */
export function assessInquiryRisk(message) {
  const text = String(message || '').toLowerCase();
  const offPlatform = ['western union', 'moneygram', 'pay outside', 'bitcoin', 'crypto wallet', 'gift card', 'send money to'];
  if (offPlatform.some((needle) => text.includes(needle))) return 'watch';
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount >= 2) return 'watch';
  return 'clear';
}

function toPublicInquiry(row) {
  return {
    id: row.id,
    listing_id: row.listing_id || null,
    inquiry_type: row.inquiry_type,
    status: row.status,
    source_channel: row.source_channel,
    referral_attributed: Boolean(row.referral_code),
    created_at: row.created_at,
  };
}

function toSellerInquiry(row) {
  return {
    id: row.id,
    listing_id: row.listing_id || null,
    inquiry_type: row.inquiry_type,
    status: row.status,
    source_channel: row.source_channel,
    message: row.message || null,
    contact_name: row.guest_name || null,
    contact_email: row.guest_email || null,
    contact_phone: row.guest_phone || null,
    referral_attributed: Boolean(row.referral_code),
    created_at: row.created_at,
  };
}

function toAdminInquiry(row) {
  return {
    ...toSellerInquiry(row),
    buyer_id: row.buyer_id || null,
    seller_id: row.seller_id || null,
    assigned_operator: row.assigned_operator || null,
    risk_status: row.risk_status || 'clear',
    referral_code: row.referral_code || null,
    campaign_code: row.campaign_code || null,
    country: row.country || null,
    updated_at: row.updated_at || row.created_at,
  };
}

/** Look up a buyer's consented contact (name/email/phone) for seller reply. Best-effort; never throws. */
async function lookupUserContact(client, userId) {
  try {
    const { data, error } = await client.from('users').select('name, email, phone').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (error) {
    console.warn('[marketplace-inquiry] buyer contact enrichment skipped:', error.message);
    return null;
  }
}

async function resolveListingSeller(client, vin) {
  try {
    const { data, error } = await client.from('vehicles').select('vin, owner_id, tenant_id, status').eq('vin', vin);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  } catch (error) {
    console.warn('[marketplace-inquiry] seller lookup skipped:', error.message);
    return null;
  }
}

/**
 * Create an inquiry. Guests allowed (capture contact); authenticated buyers attach buyer_id.
 * @param {object} client supabase client
 * @param {object} payload MarketplaceInquiryInput
 * @param {object} [actor] req.userContext (optional; guest if absent)
 * @param {object} [deps] { referralBridge }
 */
export async function createInquiry(client, payload = {}, actor = null, deps = {}) {
  const referralBridge = deps.referralBridge || marketplaceReferralBridge;
  const persistDomainEvent = deps.emitDomainEvent || emitDomainEvent;
  const persistCommunicationEvent = deps.emitCommunicationEvent || emitDomainEvent;

  const inquiryType = String(payload.inquiry_type || '').trim();
  if (!MARKETPLACE_INQUIRY_TYPES.includes(inquiryType)) {
    throw new ValidationError('Unsupported inquiry_type.', { inquiry_type: inquiryType });
  }

  const sourceChannel = MARKETPLACE_SOURCE_CHANNELS.includes(payload.source_channel) ? payload.source_channel : 'web';
  const listingId = clampStr(payload.listing_id, 64);
  const message = clampStr(payload.message, MAX_MESSAGE_LEN);

  const guestName = clampStr(payload.guest_name, MAX_NAME_LEN);
  const guestEmail = clampStr(payload.guest_email, MAX_NAME_LEN);
  const guestPhone = clampStr(payload.guest_phone, 40);

  // Authenticated buyers needn't supply contact; guests must give a reachable contact.
  const buyerId = actor?.id || actor?.userId || null;
  if (!buyerId) {
    if (!guestEmail && !guestPhone) {
      throw new ValidationError('Provide an email or phone so the seller can respond.');
    }
  }
  if (guestEmail && !EMAIL_RE.test(guestEmail)) throw new ValidationError('Invalid email address.');
  if (guestPhone && !PHONE_RE.test(guestPhone)) throw new ValidationError('Invalid phone number.');

  // Contact-for-this-inquiry: preserve what the buyer submitted; for an AUTHENTICATED buyer, enrich any
  // missing field from their profile so the seller ALWAYS has a reply channel (the mobile Express
  // Interest flow sends no contact at all, and the web modal may submit a partial prefill). Stored on
  // the inquiry (service-role table) and surfaced ONLY to the owning seller / admin — never publicly.
  let contactName = guestName;
  let contactEmail = guestEmail;
  let contactPhone = guestPhone;
  if (buyerId && (!contactName || !contactEmail || !contactPhone)) {
    const profile = await lookupUserContact(client, buyerId);
    contactName = contactName || profile?.name || null;
    contactEmail = contactEmail || profile?.email || null;
    contactPhone = contactPhone || profile?.phone || null;
  }

  // Vehicle-bound inquiries must point at a real, visible vehicle; capture seller routing fields.
  let sellerId = null;
  let sellerTenantId = null;
  if (listingId && VEHICLE_BOUND_TYPES.has(inquiryType)) {
    const sellerRow = await resolveListingSeller(client, listingId);
    if (!sellerRow) throw new NotFoundError('Listing not found for inquiry.');
    sellerId = sellerRow.owner_id || null;
    sellerTenantId = sellerRow.tenant_id || null;
  }

  const isDiaspora = DIASPORA_INQUIRY_TYPES.includes(inquiryType);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    listing_id: listingId,
    listing_type: isDiaspora ? 'diaspora_request' : 'vehicle',
    buyer_id: buyerId,
    guest_name: contactName,
    guest_email: contactEmail,
    guest_phone: contactPhone,
    seller_id: sellerId,
    seller_tenant_id: sellerTenantId,
    inquiry_type: inquiryType,
    // Diaspora inquiries intentionally carry NO shipment/container fields — message + intent only.
    message,
    referral_code: clampStr(payload.referral_code, 64),
    campaign_code: clampStr(payload.campaign_code, 64),
    source_channel: sourceChannel,
    status: 'new',
    risk_status: assessInquiryRisk(message),
    assigned_operator: null,
    country: clampStr(payload.country, 80),
    metadata: sanitizeInquiryMetadata(payload.metadata),
    created_at: now,
    updated_at: now,
  };

  let inserted;
  try {
    const { data, error } = await client.from(TABLE).insert(row).select().single();
    if (error) throw error;
    inserted = data || row;
  } catch (error) {
    throw new DatabaseError('Failed to record inquiry.', { reason: error.message });
  }

  // Referral V1 Stage-4 invariant: a valid referral-attributed inquiry must bridge
  // to exactly one qualifiable lead before this request succeeds. The outbox row is
  // written first as an idempotent recovery path; the synchronous bridge gives the
  // caller the lead id immediately and prevents "successful inquiry, lost lead".
  let referralLeadEventId = null;
  let referralBridgeResult = null;
  if (row.referral_code) {
    try {
      await persistDomainEvent(null, 'marketplace.inquiry.referral_bridge_requested', {
        inquiry: inserted,
        actor: buyerId ? { actor_user_id: buyerId, id: buyerId, actor_type: 'user' } : {},
      }, sellerTenantId || null);
      referralBridgeResult = await referralBridge.bridgeInquiryToReferralLead({
        inquiry: inserted,
        actor: buyerId ? { actor_user_id: buyerId, id: buyerId, actor_type: 'user' } : {},
      });
      referralLeadEventId = referralBridgeResult?.lead_event_id || null;
    } catch (error) {
      throw new DatabaseError('Failed to create referral lead for attributed inquiry.', { reason: error.message, inquiry_id: inserted.id });
    }
  }

  // Best-effort referral event emission — never blocks or fails a non-referral inquiry.
  // For referral-coded inquiries this reuses the bridge validation result, so one
  // inquiry produces one code-validation event rather than bridge + emission duplicates.
  const eventType = INQUIRY_TYPE_TO_REFERRAL_EVENT[inquiryType] || 'marketplace_inquiry_created';
  await referralBridge.emitMarketplaceReferralEvent({
    eventType,
    listingId: listingId || undefined,
    inquiryId: inserted.id,
    referralCode: row.referral_code || undefined,
    campaignCode: row.campaign_code || undefined,
    sourceChannel,
    actor: buyerId ? { actor_user_id: buyerId, id: buyerId, actor_type: 'user' } : {},
    metadata: { inquiry_type: inquiryType },
    validation: referralBridgeResult?.validation || null,
  });

  // Best-effort bridge into the canonical communication fabric. Marketplace
  // remains the source of truth; communication only creates threads/alerts.
  persistCommunicationEvent(null, 'marketplace.inquiry.created', {
    inquiryId: inserted.id,
    listingId: listingId || null,
    inquiry_type: inquiryType,
    recipientUserId: sellerId || buyerId || null,
    buyerId,
    sellerId,
    source_channel: sourceChannel,
    referral_code: row.referral_code || null,
    campaign_code: row.campaign_code || null,
  }, sellerTenantId || null).catch(() => {});

  // Additive: expose the bridged referral lead id (null when no valid code) without changing the
  // existing public inquiry shape.
  return { ...toPublicInquiry(inserted), referral_lead_event_id: referralLeadEventId };
}

// Values embedded in a PostgREST .or() expression tree. Actor ids are
// server-derived (session/user context, never request input), but an id
// containing , ( ) . could still change the expression shape — such an id
// falls back to the unfiltered fetch, where the in-memory filter still scopes.
const SAFE_OR_VALUE = /^[A-Za-z0-9_:@-]+$/;

/** Seller/dealer view of inquiries they own (by seller_id or tenant). */
export async function listInquiriesForSeller(client, actor) {
  if (!actor?.id) throw new ForbiddenError('Authentication required.');
  // Push the ownership predicate into the database: other sellers' guest PII
  // never leaves the DB and the read stays index-friendly instead of scanning
  // the whole table. Only include the tenant leg when the actor has a tenant.
  const legs = [`seller_id.eq.${actor.id}`];
  if (actor.tenantId) legs.push(`seller_tenant_id.eq.${actor.tenantId}`);
  const canPushDown =
    SAFE_OR_VALUE.test(String(actor.id)) && (!actor.tenantId || SAFE_OR_VALUE.test(String(actor.tenantId)));
  const rows = await fetchInquiries(client, canPushDown ? (query) => query.or(legs.join(',')) : undefined);
  // Defense-in-depth: re-apply the scope in memory so a client that ignores
  // .or() (or the fallback path above) can never widen the seller view.
  const mine = rows.filter(
    (r) => (r.seller_id && r.seller_id === actor.id) || (actor.tenantId && r.seller_tenant_id === actor.tenantId)
  );
  return mine.map(toSellerInquiry);
}

/** Admin/operator view with optional status/type filters. Re-checks reviewer authority server-side. */
export async function listInquiriesForAdmin(client, filters = {}, actor = filters.actor) {
  assertReviewer(actor);
  const rows = await fetchInquiries(client);
  let out = rows;
  if (filters.status && MARKETPLACE_INQUIRY_STATUSES.includes(filters.status)) {
    out = out.filter((r) => r.status === filters.status);
  }
  if (filters.inquiry_type && MARKETPLACE_INQUIRY_TYPES.includes(filters.inquiry_type)) {
    out = out.filter((r) => r.inquiry_type === filters.inquiry_type);
  }
  if (filters.risk_status) out = out.filter((r) => (r.risk_status || 'clear') === filters.risk_status);
  return out.map(toAdminInquiry);
}

async function fetchInquiries(client, refine) {
  try {
    let query = client.from(TABLE).select('*');
    if (refine) query = refine(query);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw new DatabaseError('Failed to read inquiries.', { reason: error.message });
  }
}

/** Admin/operator: assign an inquiry to an operator. */
export async function assignInquiry(client, inquiryId, operatorId, actor) {
  assertReviewer(actor);
  return patchInquiry(client, inquiryId, { assigned_operator: operatorId || null, status: 'assigned' });
}

/** Admin/operator: change inquiry status. */
export async function updateInquiryStatus(client, inquiryId, status, actor) {
  assertReviewer(actor);
  if (!MARKETPLACE_INQUIRY_STATUSES.includes(status)) throw new ValidationError('Invalid inquiry status.');
  return patchInquiry(client, inquiryId, { status });
}

// Canonical platform-level reviewer set, identical to marketplace moderation, so the route guard and
// the service re-check agree. Keyed on the PLATFORM/base role only (never the header-derived effective
// role) so a tenant-scoped elevation cannot grant cross-tenant inquiry management over guest PII.
const MARKETPLACE_REVIEWER_ROLES = ['admin', 'platform_admin', 'super_admin', 'government'];
function assertReviewer(actor) {
  const role = String(actor?.platformRole || actor?.baseRole || '').toLowerCase();
  if (!MARKETPLACE_REVIEWER_ROLES.includes(role)) {
    throw new ForbiddenError('Platform admin or government role required.');
  }
}

async function patchInquiry(client, inquiryId, patch) {
  if (!inquiryId) throw new ValidationError('inquiry id is required.');
  try {
    // maybeSingle(): a zero-row update resolves to { data: null, error: null } on real Supabase, so the
    // intended 404 (below) is reachable rather than being rewrapped as a 500 DatabaseError.
    const { data, error } = await client
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', inquiryId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('Inquiry not found.');
    return toAdminInquiry(data);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('Failed to update inquiry.', { reason: error.message });
  }
}

export const __inquiryProjections = { toPublicInquiry, toSellerInquiry, toAdminInquiry };
