/**
 * CARUP-DEALER-ONB-001-LR01-R5 (T22):
 * Real tenant-scoped dealership photo/media gallery, safe uploads/rights review,
 * thumbnails/accessibility (mandatory alt_text + caption), and zero OEM/logo rights invention.
 *
 * Issue #164 Phase 5 containment compliance:
 * - `media_id` is strictly an OUTBOUND-ONLY attribute on returned gallery/queue items.
 * - No route, handler, or service accepts `media_id` / `mediaId` / `image_id` / `photo_id` inbound.
 * - Independent reviewer preview and disposition operate on the dealership `:seedId` scope using
 *   short-lived, single-use, server-issued, AES-256-GCM authenticated review tickets
 *   (`preview_ticket` and `decision_ticket`) bound to the authenticated reviewer, `seed_dealer_id`,
 *   operation (`STOREFRONT_MEDIA_PREVIEW` vs `STOREFRONT_MEDIA_DECISION`), and expiry.
 * - Invalid, raw-UUID, expired, replayed, or cross-scope tickets are refused uniformly (403
 *   `STOREFRONT_MEDIA_REVIEW_TICKET_INVALID`) before any database query runs.
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

const SEED_RE = /^ZW-DEAL-\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_ENVELOPE_RE = /^rt1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{24,1024})\.([A-Za-z0-9_-]{22})$/;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const DEFAULT_TICKET_TTL_MS = 10 * 60 * 1000;
const TICKET_KEY = crypto.randomBytes(32);
const issuedMediaReviewTickets = new Map();

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const DEALER_MEDIA_CATEGORIES = Object.freeze([
  'SHOWROOM_EXTERIOR',
  'SHOWROOM_INTERIOR',
  'BRANCH_FACILITY',
  'SERVICE_BAY',
]);
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

function pruneExpiredTickets(now) {
  if (issuedMediaReviewTickets.size < 500) return;
  for (const [jti, record] of issuedMediaReviewTickets.entries()) {
    if (record.consumed || now > record.expiresAt + 60_000) {
      issuedMediaReviewTickets.delete(jti);
    }
  }
}

export function issueStorefrontMediaReviewTicket({
  reviewerId,
  seedDealerId,
  tenantId = null,
  targetRowId,
  contentSha256 = null,
  operation,
  ttlMs = DEFAULT_TICKET_TTL_MS,
  now = Date.now(),
}) {
  if (typeof reviewerId !== 'string' || !reviewerId.trim()
      || typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)
      || typeof targetRowId !== 'string' || !UUID_RE.test(targetRowId)
      || !Object.values(DEALER_MEDIA_TICKET_OPERATIONS).includes(operation)
      || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw refuse('INVALID_MEDIA_REVIEW_TICKET_GRANT', 400);
  }
  pruneExpiredTickets(now);
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(now + ttlMs);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${reviewerId}|${seedDealerId}|${operation}`, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', TICKET_KEY, iv);
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

  issuedMediaReviewTickets.set(jti, {
    jti,
    reviewerId,
    seedDealerId,
    tenantId,
    targetRowId,
    contentSha256,
    operation,
    expiresAt,
    consumed: false,
  });

  return `rt1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

export function verifyAndConsumeStorefrontMediaReviewTicket(rawTicket, {
  reviewerId,
  seedDealerId,
  expectedOperation,
  now = Date.now(),
}) {
  if (typeof rawTicket !== 'string'
      || typeof reviewerId !== 'string' || !reviewerId.trim()
      || typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)
      || !Object.values(DEALER_MEDIA_TICKET_OPERATIONS).includes(expectedOperation)) {
    throw refuseInvalidTicket();
  }
  const match = TICKET_ENVELOPE_RE.exec(rawTicket.trim());
  if (!match) {
    throw refuseInvalidTicket();
  }
  let parsed;
  try {
    const iv = Buffer.from(match[1], 'base64url');
    const encrypted = Buffer.from(match[2], 'base64url');
    const tag = Buffer.from(match[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('bad_iv_or_tag');
    const decipher = crypto.createDecipheriv('aes-256-gcm', TICKET_KEY, iv);
    decipher.setAAD(Buffer.from(`${reviewerId}|${seedDealerId}|${expectedOperation}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    parsed = JSON.parse(decrypted);
  } catch {
    throw refuseInvalidTicket();
  }

  const record = parsed?.jti ? issuedMediaReviewTickets.get(parsed.jti) : null;
  if (!record
      || record.consumed
      || now > record.expiresAt
      || parsed.exp !== record.expiresAt
      || record.reviewerId !== reviewerId
      || record.seedDealerId !== seedDealerId
      || record.operation !== expectedOperation
      || parsed.target_row_id !== record.targetRowId) {
    throw refuseInvalidTicket();
  }
  record.consumed = true;
  return Object.freeze({
    jti: record.jti,
    reviewerId: record.reviewerId,
    seedDealerId: record.seedDealerId,
    tenantId: record.tenantId,
    targetRowId: record.targetRowId,
    contentSha256: record.contentSha256,
    operation: record.operation,
    expiresAt: record.expiresAt,
  });
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
} = {}) {
  independent(actor, '');
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
    .limit(100);
  if (error || !Array.isArray(data)) {
    throw refuse('STOREFRONT_MEDIA_REVIEW_QUEUE_UNAVAILABLE', 503);
  }
  return data.map((row) => {
    const canReviewIndependently = row.uploaded_by !== actor.userId;
    const previewTicket = canReviewIndependently
      ? issueStorefrontMediaReviewTicket({
        reviewerId: actor.userId,
        seedDealerId: row.seed_dealer_id,
        tenantId: row.tenant_id || null,
        targetRowId: row.media_id,
        contentSha256: row.content_sha256 || null,
        operation: DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW,
        ttlMs: ticketTtlMs,
        now,
      })
      : null;
    const decisionTicket = canReviewIndependently
      ? issueStorefrontMediaReviewTicket({
        reviewerId: actor.userId,
        seedDealerId: row.seed_dealer_id,
        tenantId: row.tenant_id || null,
        targetRowId: row.media_id,
        contentSha256: row.content_sha256 || null,
        operation: DEALER_MEDIA_TICKET_OPERATIONS.DECISION,
        ttlMs: ticketTtlMs,
        now,
      })
      : null;
    return Object.freeze({
      media_id: row.media_id,
      seed_dealer_id: row.seed_dealer_id,
      branch_id: row.branch_id || null,
      mime_type: row.mime_type,
      file_bytes: row.file_bytes,
      media_category: row.media_category,
      caption: row.caption,
      alt_text: row.alt_text,
      rights_attestation: row.rights_attestation,
      review_status: row.review_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      independent_reviewer_required: canReviewIndependently,
      preview_ticket: previewTicket,
      decision_ticket: decisionTicket,
      ticket_expires_at: canReviewIndependently ? new Date(now + ticketTtlMs).toISOString() : null,
      logo_rights_approved: false,
    });
  });
}

export async function previewStorefrontMediaItem(seedId, actor, payload = {}, {
  db = supabase,
  independent = requireIndependentReviewer,
  stepUp = requireReviewerPassword,
  now = Date.now(),
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  independent(actor, '');
  const ticket = verifyAndConsumeStorefrontMediaReviewTicket(payload?.review_ticket, {
    reviewerId: actor.userId,
    seedDealerId: seedId,
    expectedOperation: DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW,
    now,
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
  const ticket = verifyAndConsumeStorefrontMediaReviewTicket(payload?.review_ticket, {
    reviewerId: actor.userId,
    seedDealerId: seedId,
    expectedOperation: DEALER_MEDIA_TICKET_OPERATIONS.DECISION,
    now,
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

export async function getPublicDealerStorefrontMedia(seedId, {
  db = supabase,
} = {}) {
  if (typeof seedId !== 'string' || !SEED_RE.test(seedId)) {
    throw refuse('INVALID_DEALER_PROFILE', 400);
  }
  const { data, error } = await db.from('dealer_public_storefront_media_current')
    .select('media_id,seed_dealer_id,branch_id,branch_name,storage_bucket,storage_path,mime_type,media_category,caption,alt_text,rights_attestation,logo_rights_approved,approved_at')
    .eq('seed_dealer_id', seedId)
    .order('approved_at', { ascending: false })
    .limit(24);
  if (error || !Array.isArray(data)) {
    throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
  }
  const items = [];
  for (const row of data) {
    if (!row?.alt_text || !row?.caption || row.logo_rights_approved !== false) continue;
    let imageUrl = null;
    const { data: downloaded, error: dlErr } = await db.storage
      .from(row.storage_bucket || 'ocr-documents')
      .download(row.storage_path);
    if (!dlErr && downloaded) {
      const ab = typeof downloaded.arrayBuffer === 'function'
        ? await downloaded.arrayBuffer()
        : downloaded;
      const buf = Buffer.isBuffer(ab) ? ab : Buffer.from(ab);
      imageUrl = `data:${row.mime_type};base64,${buf.toString('base64')}`;
    } else {
      const { data: signed, error: signErr } = await db.storage
        .from(row.storage_bucket || 'ocr-documents')
        .createSignedUrl(row.storage_path, 120);
      if (signErr || !signed?.signedUrl) {
        throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
      }
      imageUrl = signed.signedUrl;
    }
    items.push(Object.freeze({
      media_id: row.media_id,
      seed_dealer_id: row.seed_dealer_id,
      branch_id: row.branch_id || null,
      branch_name: row.branch_name || null,
      mime_type: row.mime_type,
      media_category: row.media_category,
      caption: row.caption,
      alt_text: row.alt_text,
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      rights_attestation: row.rights_attestation,
      logo_rights_approved: false,
      approved_at: row.approved_at,
    }));
  }
  return Object.freeze({
    seed_dealer_id: seedId,
    items: Object.freeze(items),
    count: items.length,
    logo_rights_approved: false,
    oem_badges_or_logos_shown: false,
    requires_current_full_storefront_and_dealer_authority: true,
  });
}
