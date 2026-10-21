/**
 * Marketplace inquiry service — the single buyer-intent capture path.
 *
 * Every buyer action becomes a structured marketplace_inquiries row. Vehicle-bound inquiries route
 * to the same governed `current_seller_id` relationship used by Issue #164 Phase 4/6 transaction
 * authority. Ownership (`owner_id`) is deliberately not a seller fallback: an owner may delegate a
 * sale, and a vehicle with no current seller must not silently route buyer intent to somebody else.
 *
 * Privacy: public/guest responses expose no guest contact, seller id, or risk metadata. Seller/admin
 * projections expose only what the authorized role needs to follow up.
 */

import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { ValidationError, NotFoundError, ForbiddenError, DatabaseError, ConflictError } from '../../utils/errors.js';
import {
  MARKETPLACE_INQUIRY_TYPES,
  MARKETPLACE_INQUIRY_STATUSES,
  MARKETPLACE_SOURCE_CHANNELS,
  INQUIRY_TYPE_TO_REFERRAL_EVENT,
  DIASPORA_INQUIRY_TYPES,
} from './marketplaceEventTypes.js';
import { marketplaceReferralBridge } from './marketplaceReferralBridgeService.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { emitInquiryCreated } from '../intelligence/marketplaceActivityEmitters.js';
import { hasGovernedDealerVehicleAuthority } from '../dealer/dealerListingAuthority.js';
import { summarizeProvenance } from '../provenance/recordProvenance.js';
import { loadProvenanceIndex } from '../provenance/provenanceContext.js';

const TABLE = 'marketplace_inquiries';
const MAX_MESSAGE_LEN = 2000;
const MAX_NAME_LEN = 160;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9 ()-]{6,20}$/;

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

// ── CARUP-MVP-STAB-01 F-002: a retried submit is recorded ONCE ───────────────────────────────────────
//
// A caller may send `client_request_id` (the route also accepts an `Idempotency-Key` header). The inquiry
// id then becomes the RFC 4122 v5 UUID of (actor, key) in a fixed CarUp namespace, so a retry of the same
// submit collides on the primary key — the database, not a process-local map, settles even two
// concurrent submits — and is answered with the inquiry already recorded, without re-running a single
// side effect. Without a key nothing changes.

export const INQUIRY_CLIENT_REQUEST_ID_INVALID = 'INQUIRY_CLIENT_REQUEST_ID_INVALID';
export const INQUIRY_IDEMPOTENCY_MISMATCH = 'INQUIRY_IDEMPOTENCY_MISMATCH';

/**
 * The namespace of every idempotent inquiry id (generated once for F-002). It is a constant, never
 * configuration: changing it would re-key every retry that is still in flight.
 */
export const INQUIRY_IDEMPOTENCY_NAMESPACE = 'fbe7f49d-9616-4066-98dd-ce0a630201a6';

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/** 400, with its own machine code: a production-like runtime hides `details`, never `code`. */
export class InquiryClientRequestIdError extends ValidationError {
  constructor(message = 'client_request_id must be 8 to 100 characters, using only letters, digits, "-" and "_".') {
    super(message, { field: 'client_request_id' });
    this.code = INQUIRY_CLIENT_REQUEST_ID_INVALID;
  }
}

/** 409: the key already recorded a DIFFERENT inquiry. Its own code, for the same reason. */
export class InquiryIdempotencyMismatchError extends ConflictError {
  constructor() {
    super(
      'This client_request_id already recorded a different inquiry. Use a new client_request_id for a new inquiry.',
      { field: 'client_request_id' },
    );
    this.code = INQUIRY_IDEMPOTENCY_MISMATCH;
  }
}

/** `undefined`/`null` mean "no key"; anything else must be a well-formed key or the request is refused. */
export function normalizeClientRequestId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(value)) throw new InquiryClientRequestIdError();
  return value;
}

/** RFC 4122 §4.3 name-based UUID, version 5 (SHA-1). */
export function uuidV5(name, namespace) {
  const namespaceBytes = Buffer.from(String(namespace).replace(/-/g, ''), 'hex');
  if (namespaceBytes.length !== 16) throw new Error('uuidV5 needs a UUID namespace.');
  const bytes = createHash('sha1').update(namespaceBytes).update(String(name), 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Whose key it is. A signed-in buyer is their user id; a guest is their email (lowercased) or, without
 * one, the digits of their phone. The same key from two different actors therefore names two different
 * inquiries — one buyer's retry can never return another buyer's inquiry.
 */
export function inquiryIdempotencyActorKey({ buyerId = null, guestEmail = null, guestPhone = null } = {}) {
  if (buyerId) return `user:${buyerId}`;
  const email = String(guestEmail || '').trim().toLowerCase();
  if (email) return `guest:${email}`;
  const digits = String(guestPhone || '').replace(/\D/g, '');
  return digits ? `guest:${digits}` : null;
}

export function deterministicInquiryId(actorKey, clientRequestId) {
  return uuidV5(`${actorKey}:${clientRequestId}`, INQUIRY_IDEMPOTENCY_NAMESPACE);
}

/** The same submit, by what it asks: listing, type and exact message. */
function sameInquiryRequest(existing, row) {
  return (existing.listing_id ?? null) === (row.listing_id ?? null)
    && existing.inquiry_type === row.inquiry_type
    && (existing.message ?? null) === (row.message ?? null);
}

const ALLOWED_METADATA_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'source_page', 'referrer', 'preferred_contact',
  // Explicit product intent — safe operational routing, never payment authorization.
  'buyer_intent', 'safepay_requested',
  // Parts fitment selection. Model-range vocabulary only; no VIN/plate/chassis/PII.
  'fitment_taxonomy_version', 'fitment_make', 'fitment_model', 'fitment_year',
];
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

/**
 * F-002 — the answer to a keyed submit whose id already exists.
 *
 * The same request (listing, type, message) is the inquiry already recorded, in its PUBLIC projection.
 * The same key asking something else is refused: silently returning the first inquiry would discard what
 * the buyer just asked. No row under that id means the collision was some other constraint — not a
 * replay — so the caller reports the original database failure.
 */
async function replayRecordedInquiry(client, row) {
  let existing;
  try {
    const { data, error } = await client.from(TABLE).select('*').eq('id', row.id).maybeSingle();
    if (error) throw error;
    existing = data || null;
  } catch (error) {
    throw new DatabaseError('Failed to read the inquiry this request already recorded.', { reason: error.message });
  }
  if (!existing) return null;
  if (!sameInquiryRequest(existing, row)) throw new InquiryIdempotencyMismatchError();
  return { inquiry: toPublicInquiry(existing), idempotent_replay: true };
}

/**
 * Resolve routing from the governed seller relationship. The query intentionally does not select
 * owner_id, making an ownership fallback impossible in this service rather than merely discouraged.
 */
export async function resolveListingSeller(client, vin) {
  try {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, current_seller_id, tenant_id, status, publication_status')
      .eq('vin', vin);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  } catch (error) {
    console.warn('[marketplace-inquiry] seller lookup skipped:', error.message);
    return null;
  }
}

/**
 * Resolve the target garage for a service request against the governed directory.
 *
 * Returns the PUBLISHED garage's tenant id, or null when the caller named no garage. Throws when a
 * garage was named but does not resolve to a published profile — a named-but-invalid target is a
 * caller error, not a reason to quietly record NULL and let the request look routable.
 */
async function resolveTargetProviderTenant(client, payload = {}) {
  const slug = clampStr(payload.target_garage_slug, 160);
  const assertedTenantId = clampStr(payload.target_provider_tenant_id, 64);
  if (!slug && !assertedTenantId) return null;

  let query = client
    .from('garage_public_profiles')
    .select('tenant_id, publication_status')
    .eq('publication_status', 'published');
  query = slug
    ? query.eq('slug', String(slug).trim().toLowerCase())
    : query.eq('tenant_id', assertedTenantId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new DatabaseError(`Failed to resolve target garage: ${error.message}`);
  if (!data?.tenant_id) {
    throw new ValidationError('The requested garage is not a published garage on CarUp.', {
      target_garage: slug || assertedTenantId,
    });
  }
  return data.tenant_id;
}

export async function createInquiry(client, payload = {}, actor = null, deps = {}) {
  const referralBridge = deps.referralBridge || marketplaceReferralBridge;
  const persistDomainEvent = deps.emitDomainEvent || emitDomainEvent;
  const persistCommunicationEvent = deps.emitCommunicationEvent || persistDomainEvent;
  // F-002: refused before anything is read or written; absent means "behave exactly as before".
  const clientRequestId = normalizeClientRequestId(payload.client_request_id);

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

  const buyerId = actor?.id || actor?.userId || null;
  if (!buyerId && !guestEmail && !guestPhone) {
    throw new ValidationError('Provide an email or phone so the seller can respond.');
  }
  if (guestEmail && !EMAIL_RE.test(guestEmail)) throw new ValidationError('Invalid email address.');
  if (guestPhone && !PHONE_RE.test(guestPhone)) throw new ValidationError('Invalid phone number.');

  // F-002: the key is namespaced by the actor who sent it — the signed-in buyer, else the guest's own
  // email or phone (never the profile enrichment below, which a guest does not have).
  const idempotencyActor = clientRequestId
    ? inquiryIdempotencyActorKey({ buyerId, guestEmail, guestPhone })
    : null;
  if (clientRequestId && !idempotencyActor) {
    throw new InquiryClientRequestIdError('client_request_id needs a signed-in buyer, an email address or a phone number with digits.');
  }

  let contactName = guestName;
  let contactEmail = guestEmail;
  let contactPhone = guestPhone;
  if (buyerId && (!contactName || !contactEmail || !contactPhone)) {
    const profile = await lookupUserContact(client, buyerId);
    contactName = contactName || profile?.name || null;
    contactEmail = contactEmail || profile?.email || null;
    contactPhone = contactPhone || profile?.phone || null;
  }

  // Service Network S3 (O2): which garage was this service request directed to?
  //
  // The answer is resolved from the governed publication projection, never taken from the request.
  // A caller may name a garage by its public slug or by tenant id, but either way the tenant that
  // gets persisted is the one `garage_public_profiles` returns for a PUBLISHED garage. A tenant id
  // the client simply asserts is not evidence of anything, and an unpublished or unknown garage is
  // refused rather than silently recorded.
  //
  // It is deliberately NOT derived from seller ownership: seller_id/seller_tenant_id keep
  // marketplace SELLER semantics and are never overloaded to fake a routing relationship (plan
  // §10.2). A request with no target stays NULL — the S3 bridge already refuses to open a Service
  // Case without one, so nothing is ever routed on a guess.
  const targetProviderTenantId = inquiryType === 'garage_service_request'
    ? await resolveTargetProviderTenant(client, payload)
    : null;

  let sellerId = null;
  let sellerTenantId = null;
  if (listingId && VEHICLE_BOUND_TYPES.has(inquiryType)) {
    const sellerRow = await resolveListingSeller(client, listingId);
    if (!sellerRow) throw new NotFoundError('Listing not found for inquiry.');
    sellerId = clampStr(sellerRow.current_seller_id, 160);
    sellerTenantId = sellerRow.tenant_id || null;
    if (!sellerId) {
      throw new ValidationError('This listing has no governed current seller relationship.');
    }
  }

  const isDiaspora = DIASPORA_INQUIRY_TYPES.includes(inquiryType);
  const now = new Date().toISOString();
  const row = {
    id: clientRequestId ? deterministicInquiryId(idempotencyActor, clientRequestId) : randomUUID(),
    listing_id: listingId,
    listing_type: isDiaspora ? 'diaspora_request' : 'vehicle',
    buyer_id: buyerId,
    guest_name: contactName,
    guest_email: contactEmail,
    guest_phone: contactPhone,
    seller_id: sellerId,
    seller_tenant_id: sellerTenantId,
    // Distinct from the two seller columns above, and only ever set for a service request.
    target_provider_tenant_id: targetProviderTenantId,
    inquiry_type: inquiryType,
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
    // F-002: a keyed submit that collides on its OWN primary key is a retry of an inquiry already
    // recorded. Everything that submit set in motion — the canonical conversation event, the referral
    // lead, the Intelligence observation, the referral event — belongs to it; a replay repeats none of it.
    const replay = clientRequestId && error?.code === '23505'
      ? await replayRecordedInquiry(client, row)
      : null;
    if (replay) return replay;
    throw new DatabaseError('Failed to record inquiry.', { reason: error.message });
  }

  // Communications 2.0 invariant: a successful Marketplace inquiry must have its durable canonical
  // conversation event. The inquiry row may already exist if this outbox write fails, so fail closed
  // and return a recovery id rather than pretending the journey succeeded.
  try {
    await persistCommunicationEvent(null, 'marketplace.inquiry.created', {
      inquiryId: inserted.id,
      listingId: listingId || null,
      inquiry_type: inquiryType,
      recipientUserId: sellerId || buyerId || null,
      buyerId,
      sellerId,
      source_channel: sourceChannel,
      referral_code: row.referral_code || null,
      campaign_code: row.campaign_code || null,
    }, sellerTenantId || null);
  } catch (error) {
    throw new DatabaseError('Failed to enqueue canonical communication for inquiry.', {
      reason: error.message,
      inquiry_id: inserted.id,
      recovery_required: true,
    });
  }

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
      throw new DatabaseError('Failed to create referral lead for attributed inquiry.', {
        reason: error.message,
        inquiry_id: inserted.id,
      });
    }
  }

  // Intelligence observes the durable inquiry; it never owns inquiry truth.
  emitInquiryCreated(inserted, { req: deps.req || null, client }).catch(() => {});

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

  return { ...toPublicInquiry(inserted), referral_lead_event_id: referralLeadEventId };
}

const SAFE_OR_VALUE = /^[A-Za-z0-9_:@-]+$/;

export async function listInquiriesForSeller(client, actor) {
  if (!actor?.id) throw new ForbiddenError('Authentication required.');
  // OC-4D — a tenant's buyer inquiries carry the buyers' names, emails, phones and messages. A
  // validated `x-tenant-id` proves MEMBERSHIP only (any role: a mechanic, a member); it is not the
  // dealership's selling authority. The tenant leg therefore applies only when the canonical
  // Dealer decision (#208 J-3/K-3/L-2, the same primitive listing and lifecycle use) says this
  // actor acts for that dealership. The seller's own `seller_id` leg is unchanged.
  const tenantId = actor.tenantId
    && await hasGovernedDealerVehicleAuthority(client, actor, { tenant_id: actor.tenantId })
    ? actor.tenantId
    : null;
  const legs = [`seller_id.eq.${actor.id}`];
  if (tenantId) legs.push(`seller_tenant_id.eq.${tenantId}`);
  const canPushDown = SAFE_OR_VALUE.test(String(actor.id))
    && (!tenantId || SAFE_OR_VALUE.test(String(tenantId)));
  const rows = await fetchInquiries(client, canPushDown ? (query) => query.or(legs.join(',')) : undefined);
  const mine = rows.filter(
    (r) => (r.seller_id && r.seller_id === actor.id)
      || (tenantId && r.seller_tenant_id === tenantId),
  );
  return mine.map(toSellerInquiry);
}

async function readAdminInquiryRows(client, filters, actor) {
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
  return out;
}

export async function listInquiriesForAdmin(client, filters = {}, actor = filters.actor) {
  return (await readAdminInquiryRows(client, filters, actor)).map(toAdminInquiry);
}

/**
 * PC01-K2B — the Admin inquiry queue as operational truth. Every inquiry is classified by the
 * provenance authority (asker + listing) on its raw row; the queue shows operational ones and reports,
 * by class, how many it set aside — including those that need human review. Nothing is deleted.
 */
export async function listInquiriesForAdminWithProvenance(client, filters = {}, actor = filters.actor) {
  const rows = await readAdminInquiryRows(client, filters, actor);
  const index = await loadProvenanceIndex(client, {
    userIds: rows.map((r) => r.buyer_id),
    vins: rows.map((r) => r.listing_id),
  });
  const classified = rows.map((row) => ({ row, provenance: index.inquiry(row) }));
  return {
    inquiries: classified.filter((c) => c.provenance.operational).map((c) => toAdminInquiry(c.row)),
    provenance: { ...summarizeProvenance(classified.map((c) => c.provenance)), view: 'operational_only' },
  };
}

async function fetchInquiries(client, refine) {
  try {
    // Newest first: callers that cap the list (the seller inbox card slices to the first 8) must
    // see their most RECENT inquiries, not whatever order the database happens to return unsorted.
    let query = client.from(TABLE).select('*').order('created_at', { ascending: false });
    if (refine) query = refine(query);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw new DatabaseError('Failed to read inquiries.', { reason: error.message });
  }
}

export async function assignInquiry(client, inquiryId, operatorId, actor) {
  assertReviewer(actor);
  return patchInquiry(client, inquiryId, { assigned_operator: operatorId || null, status: 'assigned' });
}

export async function updateInquiryStatus(client, inquiryId, status, actor) {
  assertReviewer(actor);
  if (!MARKETPLACE_INQUIRY_STATUSES.includes(status)) throw new ValidationError('Invalid inquiry status.');
  return patchInquiry(client, inquiryId, { status });
}

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

/** The inquiry types routed to a governed seller — the only ones that can have a buyer↔seller conversation. */
export function isVehicleBoundInquiryType(inquiryType) {
  return VEHICLE_BOUND_TYPES.has(String(inquiryType || ''));
}
