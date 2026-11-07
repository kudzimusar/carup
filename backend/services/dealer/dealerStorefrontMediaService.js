/**
 * CARUP-DEALER-ONB-001-LR01-R5 (T22 + Issue #164 Phase 5 + Multi-Instance Ticket Custody):
 * Real tenant-scoped dealership photo/media gallery, safe uploads/rights review,
 * thumbnails/accessibility (mandatory alt_text + caption), and zero OEM/logo rights invention.
 *
 * Security & Multi-Instance Architecture:
 * - `media_id` is strictly an OUTBOUND-ONLY attribute on returned gallery/queue items.
 * - No route, handler, or service accepts `media_id` / `mediaId` / `image_id` / `photo_id` inbound.
 * - Independent reviewer preview and disposition operate on the dealership `:seedId` scope using
 *   short-lived, single-use, server-issued, AES-256-GCM authenticated review tickets
 *   (`preview_ticket` and `decision_ticket`) bound to `(reviewerId, seedDealerId, operation, exp)`.
 * - Multi-instance & process-restart resilience:
 *   1) The 256-bit AES-GCM key is derived deterministically via HMAC-SHA256 from the shared server
 *      secret (`DEALER_MEDIA_REVIEW_TICKET_SECRET` / `CARUP_SESSION_SECRET` / `JWT_SECRET` /
 *      `SUPABASE_SERVICE_ROLE_KEY`), so any backend instance or restarted process can verify the
 *      cryptographic envelope and AAD (`reviewerId|seedDealerId|operation`).
 *   2) Invalid envelopes, raw UUIDs, tampered ciphertexts, expired tickets, cross-dealership,
 *      cross-reviewer, and cross-operation tickets are refused in memory BEFORE any DB query runs.
 *   3) Shared single-use custody is persisted in PostgreSQL (`dealer_storefront_media_review_tickets`)
 *      and atomically consumed via `dealer_consume_storefront_media_review_ticket` (`UPDATE ... WHERE
 *      consumed_at IS NULL RETURNING ...`), guaranteeing atomic single-use semantics across parallel
 *      requests, multiple backend instances, and process restarts.
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
const PROCESS_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

const issuedMediaReviewTickets = new Map();
const consumedTicketJtis = new Set();
const inFlightTicketJtis = new Set();

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

function deriveTicketKey(secretOverride = null) {
  const material = (typeof secretOverride === 'string' && secretOverride.trim().length >= 16)
    ? secretOverride.trim()
    : (process.env.DEALER_MEDIA_REVIEW_TICKET_SECRET
      || process.env.CARUP_SESSION_SECRET
      || process.env.JWT_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || PROCESS_FALLBACK_SECRET);
  return crypto.createHmac('sha256', 'CARUP_DEALER_R5_MEDIA_REVIEW_TICKET_KEY_V1')
    .update(String(material), 'utf8')
    .digest();
}

function pruneLocalTicketCache(now) {
  if (issuedMediaReviewTickets.size < 500) return;
  for (const [jti, record] of issuedMediaReviewTickets.entries()) {
    if (record.consumed || now > record.expiresAt + 60_000) {
      issuedMediaReviewTickets.delete(jti);
    }
  }
}

/**
 * Test-only helper that wipes process-local ticket state to simulate a backend process restart
 * or routing a request to a fresh backend instance that has zero in-memory state.
 */
export function simulateProcessRestartForTest() {
  issuedMediaReviewTickets.clear();
  consumedTicketJtis.clear();
  inFlightTicketJtis.clear();
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
  secret = null,
}) {
  if (typeof reviewerId !== 'string' || !reviewerId.trim()
      || typeof seedDealerId !== 'string' || !SEED_RE.test(seedDealerId)
      || typeof targetRowId !== 'string' || !UUID_RE.test(targetRowId)
      || !Object.values(DEALER_MEDIA_TICKET_OPERATIONS).includes(operation)
      || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw refuse('INVALID_MEDIA_REVIEW_TICKET_GRANT', 400);
  }
  pruneLocalTicketCache(now);
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(now + ttlMs);
  const iv = crypto.randomBytes(12);
  const key = deriveTicketKey(secret);
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

  issuedMediaReviewTickets.set(jti, {
    jti,
    tokenSha256,
    reviewerId,
    seedDealerId,
    tenantId,
    targetRowId,
    contentSha256,
    operation,
    expiresAt,
    consumed: false,
  });

  return token;
}

export async function verifyAndConsumeStorefrontMediaReviewTicket(rawTicket, {
  reviewerId,
  seedDealerId,
  expectedOperation,
  now = Date.now(),
  db = null,
  secret = null,
}) {
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
    const key = deriveTicketKey(secret);
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

  // Fast-path local single-use & parallel concurrency guard (zero DB queries on local replay)
  if (consumedTicketJtis.has(parsed.jti) || inFlightTicketJtis.has(parsed.jti)) {
    throw refuseInvalidTicket();
  }
  const localRecord = issuedMediaReviewTickets.get(parsed.jti);
  if (localRecord && (localRecord.consumed || now > localRecord.expiresAt)) {
    throw refuseInvalidTicket();
  }

  inFlightTicketJtis.add(parsed.jti);
  const tokenSha256 = sha256Hex(Buffer.from(trimmed, 'utf8'));
  try {
    if (db && typeof db.rpc === 'function') {
      const { data: sharedConsumed, error: rpcErr } = await db.rpc(
        'dealer_consume_storefront_media_review_ticket',
        {
          p_ticket_jti: parsed.jti,
          p_token_sha256: tokenSha256,
          p_reviewer_id: reviewerId,
          p_seed_dealer_id: seedDealerId,
          p_expected_operation: expectedOperation,
          p_now: new Date(now).toISOString(),
        },
      );
      if (rpcErr) {
        const msg = String(rpcErr.message || rpcErr.details || '');
        if (msg.includes('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID')) {
          consumedTicketJtis.add(parsed.jti);
          if (localRecord) localRecord.consumed = true;
          throw refuseInvalidTicket();
        }
        if (!/function .* does not exist|PGRST202/i.test(msg)) {
          throw refuse('STOREFRONT_MEDIA_LOOKUP_UNAVAILABLE', 503);
        }
      } else if (sharedConsumed && typeof sharedConsumed === 'object' && sharedConsumed.ticket_jti === parsed.jti) {
        consumedTicketJtis.add(parsed.jti);
        if (localRecord) localRecord.consumed = true;
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
      }
    }

    // Fallback when running against a lightweight mock DB without the shared ticket RPC
    if (!localRecord
        || localRecord.consumed
        || now > localRecord.expiresAt
        || localRecord.tokenSha256 !== tokenSha256
        || localRecord.reviewerId !== reviewerId
        || localRecord.seedDealerId !== seedDealerId
        || localRecord.operation !== expectedOperation
        || localRecord.targetRowId !== parsed.target_row_id) {
      throw refuseInvalidTicket();
    }
    localRecord.consumed = true;
    consumedTicketJtis.add(parsed.jti);
    return Object.freeze({
      jti: localRecord.jti,
      reviewerId: localRecord.reviewerId,
      seedDealerId: localRecord.seedDealerId,
      tenantId: localRecord.tenantId,
      targetRowId: localRecord.targetRowId,
      contentSha256: localRecord.contentSha256,
      operation: localRecord.operation,
      expiresAt: localRecord.expiresAt,
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

async function persistIssuedTicketIfSupported(db, rawTicket, {
  reviewerId,
  seedDealerId,
  targetRowId,
  operation,
  expiresAtMs,
}) {
  if (!db || typeof db.rpc !== 'function') return;
  const match = TICKET_ENVELOPE_RE.exec(rawTicket);
  if (!match) return;
  const tokenSha256 = sha256Hex(Buffer.from(rawTicket, 'utf8'));
  let foundJti = null;
  for (const [jti, rec] of issuedMediaReviewTickets.entries()) {
    if (rec.tokenSha256 === tokenSha256) {
      foundJti = jti;
      break;
    }
  }
  if (!foundJti) return;
  const { error } = await db.rpc('dealer_issue_storefront_media_review_ticket', {
    p_ticket_jti: foundJti,
    p_token_sha256: tokenSha256,
    p_reviewer_id: reviewerId,
    p_seed_dealer_id: seedDealerId,
    p_target_row_id: targetRowId,
    p_operation: operation,
    p_expires_at: new Date(expiresAtMs).toISOString(),
  });
  if (error) {
    const msg = String(error.message || error.details || '');
    if (!/function .* does not exist|PGRST202/i.test(msg)) {
      throw mapDealerSqlRefusal(error, 'storefront media ticket grant');
    }
  }
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
  const out = [];
  for (const row of data) {
    const canReviewIndependently = row.uploaded_by !== actor.userId;
    const expiresAtMs = Math.floor(now + ticketTtlMs);
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
        secret,
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
        secret,
      })
      : null;
    if (canReviewIndependently && previewTicket && decisionTicket) {
      await persistIssuedTicketIfSupported(db, previewTicket, {
        reviewerId: actor.userId,
        seedDealerId: row.seed_dealer_id,
        targetRowId: row.media_id,
        operation: DEALER_MEDIA_TICKET_OPERATIONS.PREVIEW,
        expiresAtMs,
      });
      await persistIssuedTicketIfSupported(db, decisionTicket, {
        reviewerId: actor.userId,
        seedDealerId: row.seed_dealer_id,
        targetRowId: row.media_id,
        operation: DEALER_MEDIA_TICKET_OPERATIONS.DECISION,
        expiresAtMs,
      });
    }
    out.push(Object.freeze({
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
      ticket_expires_at: canReviewIndependently ? new Date(expiresAtMs).toISOString() : null,
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
