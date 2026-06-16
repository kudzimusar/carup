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
    guest_name: buyerId ? null : guestName,
    guest_email: buyerId ? null : guestEmail,
    guest_phone: buyerId ? null : guestPhone,
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
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
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

  // Best-effort referral emission — never blocks or fails the inquiry.
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
  });

  return toPublicInquiry(inserted);
}

/** Seller/dealer view of inquiries they own (by seller_id or tenant). */
export async function listInquiriesForSeller(client, actor) {
  if (!actor?.id) throw new ForbiddenError('Authentication required.');
  const rows = await fetchInquiries(client);
  const mine = rows.filter(
    (r) => (r.seller_id && r.seller_id === actor.id) || (actor.tenantId && r.seller_tenant_id === actor.tenantId)
  );
  return mine.map(toSellerInquiry);
}

/** Admin/operator view with optional status/type filters. */
export async function listInquiriesForAdmin(client, filters = {}) {
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

async function fetchInquiries(client) {
  try {
    const { data, error } = await client.from(TABLE).select('*');
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

function assertReviewer(actor) {
  const role = String(actor?.role || actor?.platformRole || '').toLowerCase();
  if (!['admin', 'platform_admin', 'super_admin', 'operator'].includes(role)) {
    throw new ForbiddenError('Operator or admin role required.');
  }
}

async function patchInquiry(client, inquiryId, patch) {
  if (!inquiryId) throw new ValidationError('inquiry id is required.');
  try {
    const { data, error } = await client
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', inquiryId)
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new NotFoundError('Inquiry not found.');
    return toAdminInquiry(data);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('Failed to update inquiry.', { reason: error.message });
  }
}

export const __inquiryProjections = { toPublicInquiry, toSellerInquiry, toAdminInquiry };
