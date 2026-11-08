/**
 * CARUP-DEALER-ONB-001-LR01-R5 (T22 + Issue #164 Phase 5 + Mandatory Shared PostgreSQL Ticket Custody):
 * Real tenant-scoped dealership photo/media gallery, safe uploads/rights review,
 * thumbnails/accessibility (mandatory alt_text + caption), and zero OEM/logo rights invention.
 *
 * Security & Multi-Instance Architecture:
 * - `media_id` is strictly an OUTBOUND-ONLY attribute on returned gallery/queue items.
 * - No route, handler, or service accepts `media_id` / `mediaId` / `image_id` / `photo_id` inbound.
 * - Independent reviewer preview and disposition operate on the dealership `:seedId` scope using
 *   short-lived, single-use, server-issued, AES-256-GCM authenticated review tickets
 *   (`preview_ticket` and `decision_ticket`) bound to `(reviewerId, seedDealerId, operation, exp)`.
 * - Mandatory governed shared secret & authoritative PostgreSQL custody:
 *   1) Requires an explicit governed `DEALER_MEDIA_REVIEW_TICKET_SECRET` (>= 32 chars); never falls
 *      back to unrelated application secrets or random process-local keys. Missing/short secret
 *      fails closed with 503 `DEALER_MEDIA_TICKET_SECRET_UNCONFIGURED`.
 *   2) Invalid envelopes, raw UUIDs, tampered ciphertexts, expired tickets, cross-dealership,
 *      cross-reviewer, and cross-operation tickets are refused in memory BEFORE any DB query runs
 *      (403 `STOREFRONT_MEDIA_REVIEW_TICKET_INVALID`).
 *   3) Authoritative PostgreSQL RPCs `dealer_issue_storefront_media_review_ticket` and
 *      `dealer_consume_storefront_media_review_ticket` are mandatory: missing or unavailable RPCs
 *      fail closed with 503 `STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE` (zero fail-open fallback).
 */
import crypto from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import {
  requireIndependentReviewer,
  requireReviewerPassword,
  scanClaimBytesWithClamAv,
} from './dealerClaimApplicationService.js';
import { requireApprovedOwnerWorkspace } from './dealerVerifiedWorkspaceService.js';
import { mapDealerSqlRefusal } from './dealerSqlRefusalMapper.js';
import { loadReviewerConflicts } from './dealerReviewerConflicts.js';

const SEED_RE = /^ZW-DEAL-\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_ENVELOPE_RE = /^rt1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{24,1024})\.([A-Za-z0-9_-]{22})$/;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const DEFAULT_TICKET_TTL_MS = 10 * 60 * 1000;
const MIN_TICKET_SECRET_LENGTH = 32;
const MEDIA_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * R6 security review #3 — bounded anonymous media delivery.
 * The public gallery JSON carries METADATA ONLY (never bytes, storage paths or internal ids):
 * at most PUBLIC_MEDIA_MAX_ITEMS approved items, each with an `image_path` relative to the API
 * base that addresses one image by its content SHA-256 under its seed. Each image is fetched
 * separately (one object, <= 4 MiB, integrity-checked against its SHA-256) with a short public
 * cache lifetime and an ETag, so one anonymous request can never amplify into many megabytes.
 * Authorization (approved + current storefront + current dealer authority) is re-evaluated on
 * EVERY image request against dealer_public_storefront_media_current; only the bytes are cached
 * in-process (bounded LRU), so a withdrawn item stops being served immediately by this instance
 * and at most PUBLIC_MEDIA_CACHE_SECONDS later by a browser that already held it.
 */
export const PUBLIC_MEDIA_MAX_ITEMS = 12;
export const PUBLIC_MEDIA_CACHE_SECONDS = 60;
export const PUBLIC_MEDIA_BYTE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const PUBLIC_MEDIA_BYTE_CACHE_TTL_MS = 5 * 60 * 1000;
/** R6 #8b: the reviewer queue issues tickets for at most one page of this many items per call. */
export const MEDIA_REVIEW_QUEUE_PAGE_SIZE = 24;

const publicMediaByteCache = new Map();
let publicMediaByteCacheBytes = 0;

export function clearPublicMediaByteCacheForTest() {
  publicMediaByteCache.clear();
  publicMediaByteCacheBytes = 0;
}

function cacheGet(key, now) {
  const hit = publicMediaByteCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    publicMediaByteCache.delete(key);
    publicMediaByteCacheBytes -= hit.bytes.length;
    return null;
  }
  publicMediaByteCache.delete(key);
  publicMediaByteCache.set(key, hit); // refresh LRU position
  return hit.bytes;
}

function cachePut(key, bytes, now) {
  if (bytes.length > PUBLIC_MEDIA_BYTE_CACHE_MAX_BYTES) return;
  const prior = publicMediaByteCache.get(key);
  if (prior) {
    publicMediaByteCache.delete(key);
    publicMediaByteCacheBytes -= prior.bytes.length;
  }
  while (publicMediaByteCacheBytes + bytes.length > PUBLIC_MEDIA_BYTE_CACHE_MAX_BYTES && publicMediaByteCache.size) {
    const [oldestKey, oldest] = publicMediaByteCache.entries().next().value;
    publicMediaByteCache.delete(oldestKey);
    publicMediaByteCacheBytes -= oldest.bytes.length;
  }
  publicMediaByteCache.set(key, { bytes, expiresAt: now + PUBLIC_MEDIA_BYTE_CACHE_TTL_MS });
  publicMediaByteCacheBytes += bytes.length;
}

const consumedTicketJtis = new Set();
const inFlightTicketJtis = new Set();

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const DEALER_MEDIA_CATEGORIES = Object.freeze([
  'SHOWROOM_EXTERIOR',
  'SHOWROOM_INTERIOR',
  'BRANCH_FACILITY',
  'SERVICE_BAY',
  // UAT-R1: the dealer-owned company profile image (square avatar) and cover/hero image. Media, never
  // legal evidence; public only after the same independent T22 review, withdrawn with the storefront.
  'COMPANY_PROFILE_IMAGE',
  'COMPANY_COVER_IMAGE',
]);
export const DEALER_COMPANY_IMAGE_CATEGORIES = Object.freeze(['COMPANY_PROFILE_IMAGE', 'COMPANY_COVER_IMAGE']);
export const DEALER_MEDIA_RIGHTS_ATTESTATION = 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO';
export const DEALER_MEDIA_REVIEW_DECISIONS = Object.freeze([
  'APPROVED_PUBLIC_DISPLAY',
  'REJECTED',
  'RETRACTED',
]);
export const DEALER_MEDIA_TICKET_OPERATIONS = Object.freeze({
  PREVIEW: 'STOREFRONT_MEDIA_PREVIEW',
  DECISION: 'STOREFRONT_MEDIA_DECISION',
});

function refuse(code, status = 400) {
  return Object.assign(new Error(code), { statusCode: status, code });
}

function refuseInvalidTicket() {
  return refuse('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID', 403);
}

/**
 * Derive the 256-bit AES-GCM key exclusively from the governed shared secret
 * (`DEALER_MEDIA_REVIEW_TICKET_SECRET`, or explicit `secretOverride` in unit tests).
 * Never falls back to unrelated application secrets or random process-local keys.
 */
export function deriveTicketKey(secretOverride = null) {
  const configured = secretOverride !== null && secretOverride !== undefined
    ? secretOverride
    : process.env.DEALER_MEDIA_REVIEW_TICKET_SECRET;
  if (typeof configured !== 'string' || configured.trim().length < MIN_TICKET_SECRET_LENGTH) {
    throw refuse('DEALER_MEDIA_TICKET_SECRET_UNCONFIGURED', 503);
  }
  return crypto.createHmac('sha256', 'CARUP_DEALER_R5_MEDIA_REVIEW_TICKET_KEY_V1')
    .update(configured.trim(), 'utf8')
    .digest();
}

/**
 * Test-only helper that wipes process-local fast-path replay sets to simulate a backend
 * process restart or routing a request to a fresh backend instance with empty memory.
 */
export function simulateProcessRestartForTest() {
  consumedTicketJtis.clear();
  inFlightTicketJtis.clear();
}

export function buildStorefrontMediaReviewTicketEnvelope({
  reviewerId,
  seedDealerId,
  tenantId = null,
  targetRowId,
  contentSha256 = null,
  operation,
  ttlMs = DEFAULT_TICKET_TTL_MS,
  now = Date.now(),
  secret = null,
}) {
  if (typeof reviewerId !== 'string' || !reviewerId.trim()
      || typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)
      || typeof targetRowId !== 'string' || !UUID_RE.test(targetRowId)
      || !Object.values(DEALER_MEDIA_TICKET_OPERATIONS).includes(operation)
      || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw refuse('INVALID_MEDIA_REVIEW_TICKET_GRANT', 400);
  }
  const key = deriveTicketKey(secret);
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(now + ttlMs);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${reviewerId}|${seedDealerId}|${operation}`, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const plaintext = JSON.stringify({
    v: 1,
    jti,
    reviewer_id: reviewerId,
    seed_dealer_id: seedDealerId,
    tenant_id: tenantId,
    target_row_id: targetRowId,
    content_sha256: contentSha256,
    op: operation,
    exp: expiresAt,
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = `rt1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
  const tokenSha256 = sha256Hex(Buffer.from(token, 'utf8'));
  return Object.freeze({
    jti,
    token,
    tokenSha256,
    expiresAt,
  });
}

export async function issueAndPersistStorefrontMediaReviewTicket({
  db = supabase,
  reviewerId,
  seedDealerId,
  tenantId = null,
  targetRowId,
  contentSha256 = null,
  operation,
  ttlMs = DEFAULT_TICKET_TTL_MS,
  now = Date.now(),
  secret = null,
}) {
  const envelope = buildStorefrontMediaReviewTicketEnvelope({
    reviewerId,
    seedDealerId,
    tenantId,
    targetRowId,
    contentSha256,
    operation,
    ttlMs,
    now,
    secret,
  });
  if (!db || typeof db.rpc !== 'function') {
    throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
  }
  const { data, error } = await db.rpc('dealer_issue_storefront_media_review_ticket', {
    p_ticket_jti: envelope.jti,
    p_token_sha256: envelope.tokenSha256,
    p_reviewer_id: reviewerId,
    p_seed_dealer_id: seedDealerId,
    p_target_row_id: targetRowId,
    p_operation: operation,
    p_expires_at: new Date(envelope.expiresAt).toISOString(),
  });
  if (error) {
    const msg = String(error.message || error.details || '');
    const code = String(error.code || '');
    if (code === 'PGRST202' || /function .* does not exist|Could not find the function|PGRST202/i.test(msg)) {
      throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
    }
    const mapped = mapDealerSqlRefusal(error, 'storefront media ticket grant', 503);
    if (mapped.code === 'DEALER_SERVICE_UNAVAILABLE') {
      throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
    }
    throw mapped;
  }
  if (!data || typeof data !== 'object' || data.ticket_jti !== envelope.jti) {
    throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
  }
  return envelope.token;
}

export async function verifyAndConsumeStorefrontMediaReviewTicket(rawTicket, {
  reviewerId,
  seedDealerId,
  expectedOperation,
  now = Date.now(),
  db = supabase,
  secret = null,
}) {
  const key = deriveTicketKey(secret);
  if (typeof rawTicket !== 'string'
      || typeof reviewerId !== 'string' || !reviewerId.trim()
      || typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)
      || !Object.values(DEALER_MEDIA_TICKET_OPERATIONS).includes(expectedOperation)) {
    throw refuseInvalidTicket();
  }
  const trimmed = rawTicket.trim();
  const match = TICKET_ENVELOPE_RE.exec(trimmed);
  if (!match) {
    throw refuseInvalidTicket();
  }
  let parsed;
  try {
    const iv = Buffer.from(match[1], 'base64url');
    const encrypted = Buffer.from(match[2], 'base64url');
    const tag = Buffer.from(match[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('bad_iv_or_tag');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${reviewerId}|${seedDealerId}|${expectedOperation}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    parsed = JSON.parse(decrypted);
  } catch {
    throw refuseInvalidTicket();
  }

  if (!parsed
      || typeof parsed.jti !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.jti)
      || typeof parsed.target_row_id !== 'string' || !UUID_RE.test(parsed.target_row_id)
      || parsed.reviewer_id !== reviewerId
      || parsed.seed_dealer_id !== seedDealerId
      || parsed.op !== expectedOperation
      || !Number.isFinite(parsed.exp)
      || now > parsed.exp) {
    throw refuseInvalidTicket();
  }

  // Fast-path local single-use & parallel concurrency guard (zero DB queries on same-instance replay)
  if (consumedTicketJtis.has(parsed.jti) || inFlightTicketJtis.has(parsed.jti)) {
    throw refuseInvalidTicket();
  }
  if (!db || typeof db.rpc !== 'function') {
    throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
  }

  inFlightTicketJtis.add(parsed.jti);
  const tokenSha256 = sha256Hex(Buffer.from(trimmed, 'utf8'));
  try {
    const { data: sharedConsumed, error: rpcErr } = await db.rpc(
      'dealer_consume_storefront_media_review_ticket',
      {
        p_ticket_jti: parsed.jti,
        p_token_sha256: tokenSha256,
        p_reviewer_id: reviewerId,
        p_seed_dealer_id: seedDealerId,
        p_expected_operation: expectedOperation,
        // R6 #8c: no app-supplied clock; the database judges expiry on its own clock.
      },
    );
    if (rpcErr) {
      const msg = String(rpcErr.message || rpcErr.details || '');
      if (msg.includes('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID')) {
        consumedTicketJtis.add(parsed.jti);
        throw refuseInvalidTicket();
      }
      throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
    }
    if (!sharedConsumed
        || typeof sharedConsumed !== 'object'
        || sharedConsumed.ticket_jti !== parsed.jti
        || sharedConsumed.target_row_id !== parsed.target_row_id) {
      throw refuse('STOREFRONT_MEDIA_TICKET_CUSTODY_UNAVAILABLE', 503);
    }
    consumedTicketJtis.add(parsed.jti);
    return Object.freeze({
      jti: sharedConsumed.ticket_jti,
      reviewerId: sharedConsumed.reviewer_id,
      seedDealerId: sharedConsumed.seed_dealer_id,
      tenantId: sharedConsumed.tenant_id || parsed.tenant_id || null,
      targetRowId: sharedConsumed.target_row_id,
      contentSha256: sharedConsumed.content_sha256 || parsed.content_sha256 || null,
      operation: sharedConsumed.operation,
      expiresAt: parsed.exp,
    });
  } finally {
    inFlightTicketJtis.delete(parsed.jti);
  }
}

function cleanText(value, min = 5, max = 240) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || /<\s*[/!a-zA-Z]/.test(trimmed)) return null;
  return trimmed;
}

export function decodeStorefrontMediaImage(dataUri, mimeType) {
  if (typeof dataUri !== 'string' || typeof mimeType !== 'string'
      || !['image/jpeg', 'image/png'].includes(mimeType)) {
    throw refuse('INVALID_DEALER_MEDIA_FORMAT', 400);
  }
  const match = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  if (!match || match[1] !== mimeType || match[2].length > MAX_MEDIA_BYTES * 1.38 + 8) {
    throw refuse('INVALID_DEALER_MEDIA_ENVELOPE', 400);
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 32 || bytes.length > MAX_MEDIA_BYTES
      || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    throw refuse('INVALID_DEALER_MEDIA_BYTES', 400);
  }
  const head = bytes.subarray(0, 8);
  const validMagic = mimeType === 'image/jpeg'
    ? head[0] === 0xff && head[1] === 0xd8 && bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
    : head.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!validMagic) {
    throw refuse('DEALER_MEDIA_MAGIC_MISMATCH', 400);
  }
  return bytes;
}

export async function listMyStorefrontMedia(actor, {
  db = supabase,
  resolveOwner = requireApprovedOwnerWorkspace,
} = {}) {
  const owner = await resolveOwner(actor);
  const { data, error } = await db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,branch_id,mime_type,file_bytes,media_category,caption,alt_text,rights_attestation,logo_rights_approved,review_status,created_at,updated_at')
    .eq('tenant_id', owner.tenant_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) {
    throw refuse('DEALER_STOREFRONT_MEDIA_READ_UNAVAILABLE', 503);
  }
  return Object.freeze({
    seed_dealer_id: owner.seed_dealer_id,
    tenant_id: owner.tenant_id,
    items: Object.freeze(data.map((row) => Object.freeze({
      media_id: row.media_id,
      seed_dealer_id: row.seed_dealer_id,
      branch_id: row.branch_id || null,
      mime_type: row.mime_type,
      file_bytes: row.file_bytes,
      media_category: row.media_category,
      caption: row.caption,
      alt_text: row.alt_text,
      rights_attestation: row.rights_attestation,
      logo_rights_approved: false,
      review_status: row.review_status,
      public_display_approved: row.review_status === 'APPROVED_PUBLIC_DISPLAY',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))),
    categories: DEALER_MEDIA_CATEGORIES,
    required_rights_attestation: DEALER_MEDIA_RIGHTS_ATTESTATION,
    oem_or_brand_logo_uploads_permitted: false,
  });
}

/**
 * UAT-R1: the approved owner's PRIVATE preview of their own current company image ('profile' = the
 * square COMPANY_PROFILE_IMAGE, 'cover' = COMPANY_COVER_IMAGE) — the newest one that is pending or
 * approved. Addressed by KIND within the owner's own tenant, never by a media identity from the
 * request (Issue #164 Phase 5: a media id is an answer, never a question). Current owner authority is
 * re-checked; the bytes are never cached and never become a public URL.
 */
const COMPANY_IMAGE_KINDS = Object.freeze({ profile: 'COMPANY_PROFILE_IMAGE', cover: 'COMPANY_COVER_IMAGE' });
export async function readMyCompanyImage(actor, kind, {
  db = supabase,
  resolveOwner = requireApprovedOwnerWorkspace,
} = {}) {
  const category = COMPANY_IMAGE_KINDS[kind];
  if (!category) throw refuse('INVALID_COMPANY_IMAGE_KIND', 400);
  const owner = await resolveOwner(actor);
  const { data: items, error } = await db.from('dealer_storefront_media_items')
    .select('storage_bucket,storage_path,mime_type,review_status,created_at')
    .eq('tenant_id', owner.tenant_id).eq('media_category', category)
    .in('review_status', ['PENDING_INDEPENDENT_REVIEW', 'APPROVED_PUBLIC_DISPLAY'])
    .order('created_at', { ascending: false }).limit(1);
  if (error || !Array.isArray(items)) throw refuse('DEALER_STOREFRONT_MEDIA_READ_UNAVAILABLE', 503);
  const item = items[0];
  if (!item || item.storage_bucket !== 'ocr-documents' || !String(item.storage_path || '').startsWith('dealership-media/')) {
    throw refuse('COMPANY_IMAGE_NOT_UPLOADED', 404);
  }
  const { data: blob, error: downloadError } = await db.storage.from('ocr-documents').download(item.storage_path);
  if (downloadError || !blob) throw refuse('DEALER_STOREFRONT_MEDIA_READ_UNAVAILABLE', 503);
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length < 32 || bytes.length > 4194304) throw refuse('DEALER_STOREFRONT_MEDIA_READ_UNAVAILABLE', 503);
  return { bytes, mime_type: item.mime_type, review_status: item.review_status };
}

export async function uploadMyStorefrontMedia(actor, payload = {}, {
  db = supabase,
  resolveOwner = requireApprovedOwnerWorkspace,
  scan = scanClaimBytesWithClamAv,
} = {}) {
  const owner = await resolveOwner(actor);
  if (payload?.oem_or_brand_logo_claimed === true
      || payload?.rights_attestation !== DEALER_MEDIA_RIGHTS_ATTESTATION) {
    throw refuse('OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED', 422);
  }
  const category = typeof payload?.media_category === 'string' ? payload.media_category.trim() : '';
  if (!DEALER_MEDIA_CATEGORIES.includes(category)) {
    throw refuse('INVALID_DEALER_MEDIA_CATEGORY', 400);
  }
  const caption = cleanText(payload?.caption, 5, 240);
  const altText = cleanText(payload?.alt_text, 5, 240);
  if (!caption || !altText) {
    throw refuse('ACCESSIBLE_CAPTION_AND_ALT_TEXT_REQUIRED', 400);
  }
  let branchId = null;
  if (payload?.branch_id !== undefined && payload?.branch_id !== null && payload?.branch_id !== '') {
    if (typeof payload.branch_id !== 'string' || !UUID_RE.test(payload.branch_id)) {
      throw refuse('INVALID_MEDIA_BRANCH_ID', 400);
    }
    branchId = payload.branch_id;
  }
  if (branchId && DEALER_COMPANY_IMAGE_CATEGORIES.includes(category)) {
    throw refuse('COMPANY_IMAGE_IS_NOT_BRANCH_MEDIA', 400);
  }
  const bytes = decodeStorefrontMediaImage(payload?.image_data_url, payload?.mime_type);
  const digest = sha256Hex(bytes);

  const { data: existing, error: existingErr } = await db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,branch_id,media_category,caption,alt_text,review_status,created_at')
    .eq('tenant_id', owner.tenant_id)
    .eq('content_sha256', digest)
    .maybeSingle();
  if (existingErr) throw refuse('DEALER_MEDIA_LOOKUP_UNAVAILABLE', 503);
  if (existing) {
    return Object.freeze({
      ...existing,
      duplicate: true,
      logo_rights_approved: false,
      public_display_approved: existing.review_status === 'APPROVED_PUBLIC_DISPLAY',
    });
  }

  if (!(await scan(bytes))) {
    throw refuse('MALWARE_SCANNER_UNAVAILABLE', 503);
  }

  const ext = payload.mime_type === 'image/jpeg' ? 'jpg' : 'png';
  const objectPath = `dealership-media/${owner.tenant_id}/${crypto.randomUUID()}.${ext}`;
  const { error: storageErr } = await db.storage.from('ocr-documents')
    .upload(objectPath, bytes, { contentType: payload.mime_type, upsert: false });
  if (storageErr) {
    throw refuse('PRIVATE_MEDIA_STORAGE_FAILED', 503);
  }

  const { data: recorded, error: rpcErr } = await db.rpc('dealer_record_storefront_media_upload', {
    p_actor_id: owner.actor_id,
    p_tenant_id: owner.tenant_id,
    p_branch_id: branchId,
    p_storage_path: objectPath,
    p_content_sha256: digest,
    p_mime_type: payload.mime_type,
    p_file_bytes: bytes.length,
    p_media_category: category,
    p_caption: caption,
    p_alt_text: altText,
    p_rights_attestation: DEALER_MEDIA_RIGHTS_ATTESTATION,
    p_oem_logo_claimed: false,
  });
  if (rpcErr) {
    await db.storage.from('ocr-documents').remove([objectPath]).catch(() => {});
    throw mapDealerSqlRefusal(rpcErr, 'storefront media upload');
  }
  return Object.freeze({
    ...recorded,
    caption,
    alt_text: altText,
    duplicate: false,
  });
}

export async function listStorefrontMediaReviewQueue(actor, {
  db = supabase,
  independent = requireIndependentReviewer,
  seedDealerId = null,
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  now = Date.now(),
  secret = null,
} = {}) {
  independent(actor, '');
  deriveTicketKey(secret);
  let query = db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,tenant_id,branch_id,uploaded_by,content_sha256,mime_type,file_bytes,media_category,caption,alt_text,rights_attestation,review_status,created_at,updated_at');
  if (seedDealerId !== null && seedDealerId !== undefined && seedDealerId !== '') {
    if (typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)) {
      throw refuse('INVALID_DEALER_PROFILE', 400);
    }
    query = query.eq('seed_dealer_id', seedDealerId);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(MEDIA_REVIEW_QUEUE_PAGE_SIZE);
  if (error || !Array.isArray(data)) {
    throw refuse('STOREFRONT_MEDIA_REVIEW_QUEUE_UNAVAILABLE', 503);
  }
  // R6 closure (final security verification of 8ef077e6): conflicts are known UP FRONT from the
  // shared read rule, not inferred from a ticket-grant error — otherwise an exhausted grant
  // budget (MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT) left a conflicted row unredacted.
  const conflicts = await loadReviewerConflicts(actor, { db });
  const out = [];
  let ticketBudgetExhausted = false;
  for (const row of data.slice(0, MEDIA_REVIEW_QUEUE_PAGE_SIZE)) {
    let conflictOfInterest = conflicts.conflicted(row.seed_dealer_id)
      || (typeof row.tenant_id === 'string' && conflicts.tenants.has(row.tenant_id));
    let canReviewIndependently = row.uploaded_by !== actor.userId && !conflictOfInterest;
    const expiresAtMs = Math.floor(now + ticketTtlMs);
    let previewTicket = null;
    let decisionTicket = null;
    if (canReviewIndependently && !ticketBudgetExhausted) {
      try {
        previewTicket = await issueAndPersistStorefrontMediaReviewTicket({
          db,
          reviewerId: actor.userId,
          seedDealerId: row.seed_dealer_id,
          tenantId: row.tenant_id || null,
          targetRowId: row.media_id,
          contentSha256: row.content_sha256 || null,
          operation: DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW,
          ttlMs: ticketTtlMs,
          now,
          secret,
        });
        decisionTicket = await issueAndPersistStorefrontMediaReviewTicket({
          db,
          reviewerId: actor.userId,
          seedDealerId: row.seed_dealer_id,
          tenantId: row.tenant_id || null,
          targetRowId: row.media_id,
          contentSha256: row.content_sha256 || null,
          operation: DEALER_MEDIA_TICKET_OPERATIONS.DECISION,
          ttlMs: ticketTtlMs,
          now,
          secret,
        });
      } catch (grantError) {
        // R6 #7: a reviewer who has a claim on this dealer or belongs to its tenant gets no tickets
        // for that row (instead of the whole queue failing). R6 #8b: once the per-reviewer
        // outstanding-ticket budget is reached, the remaining rows are listed without tickets.
        if (grantError?.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST'
            || grantError?.code === 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED') {
          canReviewIndependently = false;
          conflictOfInterest = true;
          previewTicket = null;
          decisionTicket = null;
        } else if (grantError?.code === 'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT') {
          ticketBudgetExhausted = true;
          previewTicket = null;
          decisionTicket = null;
        } else {
          throw grantError;
        }
      }
    }
    const ticketsIssued = Boolean(previewTicket && decisionTicket);
    out.push(Object.freeze({
      media_id: row.media_id,
      seed_dealer_id: row.seed_dealer_id,
      branch_id: row.branch_id || null,
      mime_type: row.mime_type,
      file_bytes: row.file_bytes,
      media_category: row.media_category,
      // R6 closure: a conflicted reviewer's row carries no tickets AND no non-public content.
      caption: conflictOfInterest ? null : row.caption,
      alt_text: conflictOfInterest ? null : row.alt_text,
      rights_attestation: conflictOfInterest ? null : row.rights_attestation,
      review_status: row.review_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      independent_reviewer_required: canReviewIndependently,
      conflict_of_interest: conflictOfInterest,
      ticket_issuance_deferred: canReviewIndependently && !ticketsIssued,
      preview_ticket: ticketsIssued ? previewTicket : null,
      decision_ticket: ticketsIssued ? decisionTicket : null,
      ticket_expires_at: ticketsIssued ? new Date(expiresAtMs).toISOString() : null,
      logo_rights_approved: false,
    }));
  }
  return out;
}

export async function previewStorefrontMediaItem(seedId, actor, payload = {}, {
  db = supabase,
  independent = requireIndependentReviewer,
  stepUp = requireReviewerPassword,
  now = Date.now(),
  secret = null,
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  independent(actor, '');
  const ticket = await verifyAndConsumeStorefrontMediaReviewTicket(payload?.review_ticket, {
    reviewerId: actor.userId,
    seedDealerId: seedId,
    expectedOperation: DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW,
    now,
    db,
    secret,
  });

  let query = db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,tenant_id,uploaded_by,storage_bucket,storage_path,content_sha256,mime_type,media_category,caption,alt_text,rights_attestation,review_status')
    .eq('seed_dealer_id', seedId);
  if (ticket.contentSha256) {
    query = query.eq('content_sha256', ticket.contentSha256);
  }
  const { data: rows, error } = await query;
  if (error) throw refuse('STOREFRONT_MEDIA_LOOKUP_UNAVAILABLE', 503);
  const candidates = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  const item = candidates.find((r) => r.media_id === ticket.targetRowId);
  if (!item) throw refuseInvalidTicket();

  independent(actor, item.uploaded_by);
  await stepUp(actor, { claimant_user_id: item.uploaded_by }, payload?.reviewer_password);

  const { data: downloaded, error: dlErr } = await db.storage
    .from(item.storage_bucket || 'ocr-documents')
    .download(item.storage_path);
  let previewDataUrl = null;
  if (!dlErr && downloaded) {
    const ab = typeof downloaded.arrayBuffer === 'function'
      ? await downloaded.arrayBuffer()
      : downloaded;
    const buf = Buffer.isBuffer(ab) ? ab : Buffer.from(ab);
    previewDataUrl = `data:${item.mime_type};base64,${buf.toString('base64')}`;
  } else {
    const { data: link, error: urlErr } = await db.storage
      .from(item.storage_bucket || 'ocr-documents')
      .createSignedUrl(item.storage_path, 60);
    if (urlErr || !link?.signedUrl) {
      throw refuse('STOREFRONT_MEDIA_PREVIEW_UNAVAILABLE', 503);
    }
    previewDataUrl = link.signedUrl;
  }

  return Object.freeze({
    media_id: item.media_id,
    seed_dealer_id: item.seed_dealer_id,
    mime_type: item.mime_type,
    media_category: item.media_category,
    caption: item.caption,
    alt_text: item.alt_text,
    rights_attestation: item.rights_attestation,
    review_status: item.review_status,
    sha256: item.content_sha256,
    expires_seconds: 60,
    signed_url: previewDataUrl,
    logo_rights_approved: false,
  });
}

export async function reviewStorefrontMediaItem(seedId, actor, payload = {}, {
  db = supabase,
  independent = requireIndependentReviewer,
  stepUp = requireReviewerPassword,
  now = Date.now(),
  secret = null,
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  const decision = typeof payload?.decision === 'string' ? payload.decision.trim() : '';
  if (!DEALER_MEDIA_REVIEW_DECISIONS.includes(decision)) {
    throw refuse('INVALID_STOREFRONT_MEDIA_REVIEW', 400);
  }
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
  if (reason.length < 40 || reason.length > 3000) {
    throw refuse('STOREFRONT_MEDIA_REVIEW_REASON_REQUIRED', 400);
  }
  independent(actor, '');
  const ticket = await verifyAndConsumeStorefrontMediaReviewTicket(payload?.review_ticket, {
    reviewerId: actor.userId,
    seedDealerId: seedId,
    expectedOperation: DEALER_MEDIA_TICKET_OPERATIONS.DECISION,
    now,
    db,
    secret,
  });

  let query = db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,uploaded_by,content_sha256')
    .eq('seed_dealer_id', seedId);
  if (ticket.contentSha256) {
    query = query.eq('content_sha256', ticket.contentSha256);
  }
  const { data: rows, error: lookupErr } = await query;
  if (lookupErr) throw refuse('STOREFRONT_MEDIA_LOOKUP_UNAVAILABLE', 503);
  const candidates = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  const item = candidates.find((r) => r.media_id === ticket.targetRowId);
  if (!item) throw refuseInvalidTicket();

  independent(actor, item.uploaded_by);
  await stepUp(actor, { claimant_user_id: item.uploaded_by }, payload?.reviewer_password);

  const { data, error } = await db.rpc('dealer_review_storefront_media_item', {
    p_media_id: item.media_id,
    p_reviewer_id: actor.userId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) {
    throw mapDealerSqlRefusal(error, 'storefront media review');
  }
  return Object.freeze(data);
}

function publicMediaImagePath(seedId, contentSha256) {
  return `/dealership/research/${encodeURIComponent(seedId)}/media/${contentSha256}`;
}

export async function getPublicDealerStorefrontMedia(seedId, {
  db = supabase,
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  const { data, error } = await db.from('dealer_public_storefront_media_current')
    .select('seed_dealer_id,branch_name,content_sha256,mime_type,media_category,caption,alt_text,rights_attestation,logo_rights_approved,approved_at')
    .eq('seed_dealer_id', seedId)
    .order('approved_at', { ascending: false })
    .limit(PUBLIC_MEDIA_MAX_ITEMS);
  if (error || !Array.isArray(data)) {
    throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
  }
  const items = [];
  const seen = new Set();
  for (const row of data.slice(0, PUBLIC_MEDIA_MAX_ITEMS)) {
    if (!row?.alt_text || !row?.caption || row.logo_rights_approved !== false) continue;
    if (row.seed_dealer_id !== seedId || typeof row.content_sha256 !== 'string'
        || !MEDIA_KEY_RE.test(row.content_sha256) || seen.has(row.content_sha256)
        || !['image/jpeg', 'image/png'].includes(row.mime_type)) continue;
    seen.add(row.content_sha256);
    items.push(Object.freeze({
      // Content-addressed public key: the SHA-256 of an image that is itself public. It is not an
      // internal row id, a storage path or a signed storage URL, and it cannot be enumerated.
      media_key: row.content_sha256,
      seed_dealer_id: seedId,
      branch_name: row.branch_name || null,
      mime_type: row.mime_type,
      media_category: row.media_category,
      caption: row.caption,
      alt_text: row.alt_text,
      image_path: publicMediaImagePath(seedId, row.content_sha256),
      rights_attestation: row.rights_attestation,
      logo_rights_approved: false,
      approved_at: row.approved_at,
    }));
  }
  return Object.freeze({
    seed_dealer_id: seedId,
    items: Object.freeze(items),
    count: items.length,
    max_items: PUBLIC_MEDIA_MAX_ITEMS,
    max_image_bytes: MAX_MEDIA_BYTES,
    logo_rights_approved: false,
    oem_badges_or_logos_shown: false,
    requires_current_full_storefront_and_dealer_authority: true,
  });
}

/**
 * One approved image per request (R6 #3). Re-authorizes against the current public view on every
 * call; serves bytes only when they are <= 4 MiB and hash to the requested content key.
 */
export async function getPublicDealerStorefrontMediaImage(seedId, mediaKey, {
  db = supabase,
  now = Date.now(),
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  if (typeof mediaKey !== 'string' || !MEDIA_KEY_RE.test(mediaKey)) {
    throw refuse('PUBLIC_STOREFRONT_MEDIA_NOT_FOUND', 404);
  }
  const { data, error } = await db.from('dealer_public_storefront_media_current')
    .select('seed_dealer_id,storage_bucket,storage_path,content_sha256,mime_type,caption,alt_text,logo_rights_approved')
    .eq('seed_dealer_id', seedId)
    .eq('content_sha256', mediaKey)
    .limit(1);
  if (error || !Array.isArray(data)) {
    throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
  }
  const row = data.find((r) => r?.seed_dealer_id === seedId && r?.content_sha256 === mediaKey);
  if (!row || !row.alt_text || !row.caption || row.logo_rights_approved !== false
      || !['image/jpeg', 'image/png'].includes(row.mime_type)
      || typeof row.storage_path !== 'string' || !row.storage_path.startsWith('dealership-media/')) {
    throw refuse('PUBLIC_STOREFRONT_MEDIA_NOT_FOUND', 404);
  }
  const bucket = row.storage_bucket || 'ocr-documents';
  const cacheKey = `${bucket}:${row.storage_path}:${mediaKey}`;
  let bytes = cacheGet(cacheKey, now);
  if (!bytes) {
    const { data: downloaded, error: dlErr } = await db.storage.from(bucket).download(row.storage_path);
    if (dlErr || !downloaded) {
      throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
    }
    const ab = typeof downloaded.arrayBuffer === 'function' ? await downloaded.arrayBuffer() : downloaded;
    const buf = Buffer.isBuffer(ab) ? ab : Buffer.from(ab);
    if (buf.length < 32 || buf.length > MAX_MEDIA_BYTES || sha256Hex(buf) !== mediaKey) {
      throw refuse('PUBLIC_STOREFRONT_MEDIA_INTEGRITY_FAILED', 503);
    }
    bytes = buf;
    cachePut(cacheKey, bytes, now);
  }
  return Object.freeze({
    bytes,
    mime_type: row.mime_type,
    etag: `"${mediaKey}"`,
    cache_seconds: PUBLIC_MEDIA_CACHE_SECONDS,
  });
}
