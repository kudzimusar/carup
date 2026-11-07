/**
 * CARUP-DEALER-ONB-001-LR01-R5 (T22):
 * Real tenant-scoped dealership photo/media gallery, safe uploads/rights review,
 * thumbnails/accessibility (mandatory alt_text + caption), and zero OEM/logo rights invention.
 *
 * - Uploads are restricted to the active, approved legal owner of the dealership tenant.
 * - Only JPEG and PNG binaries (32B–4MB) with verified magic bytes and a clean ClamAV scan
 *   are stored in the private `ocr-documents` bucket under `dealership-media/<tenant_id>/...`.
 * - Every upload requires `rights_attestation = 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO'`
 *   and `oem_or_brand_logo_claimed = false`; OEM/franchise logos are refused (422).
 * - Public display requires an independent verified reviewer decision with password step-up
 *   (`APPROVED_PUBLIC_DISPLAY`) and automatically withdraws when the dealership is suspended,
 *   withdrawn, or its full storefront is retracted (`dealer_public_storefront_media_current`).
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
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
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

function refuse(code, status = 400) {
  return Object.assign(new Error(code), { statusCode: status, code });
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
} = {}) {
  independent(actor, '');
  const { data, error } = await db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,branch_id,uploaded_by,mime_type,file_bytes,media_category,caption,alt_text,rights_attestation,review_status,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !Array.isArray(data)) {
    throw refuse('STOREFRONT_MEDIA_REVIEW_QUEUE_UNAVAILABLE', 503);
  }
  return data.map((row) => Object.freeze({
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
    independent_reviewer_required: row.uploaded_by !== actor.userId,
    logo_rights_approved: false,
  }));
}

export async function previewStorefrontMediaItem(mediaId, actor, password, {
  db = supabase,
  independent = requireIndependentReviewer,
  stepUp = requireReviewerPassword,
} = {}) {
  if (typeof mediaId !== 'string' || !UUID_RE.test(mediaId)) {
    throw refuse('INVALID_STOREFRONT_MEDIA_ID', 400);
  }
  independent(actor, '');
  const { data: item, error } = await db.from('dealer_storefront_media_items')
    .select('media_id,seed_dealer_id,uploaded_by,storage_bucket,storage_path,content_sha256,mime_type,media_category,caption,alt_text,rights_attestation,review_status')
    .eq('media_id', mediaId)
    .maybeSingle();
  if (error) throw refuse('STOREFRONT_MEDIA_LOOKUP_UNAVAILABLE', 503);
  if (!item) throw refuse('STOREFRONT_MEDIA_NOT_FOUND', 404);
  independent(actor, item.uploaded_by);
  await stepUp(actor, { claimant_user_id: item.uploaded_by }, password);
  const { data: link, error: urlErr } = await db.storage.from(item.storage_bucket || 'ocr-documents')
    .createSignedUrl(item.storage_path, 60);
  if (urlErr || !link?.signedUrl) {
    throw refuse('STOREFRONT_MEDIA_PREVIEW_UNAVAILABLE', 503);
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
    signed_url: link.signedUrl,
    logo_rights_approved: false,
  });
}

export async function reviewStorefrontMediaItem(mediaId, actor, payload = {}, {
  db = supabase,
  independent = requireIndependentReviewer,
  stepUp = requireReviewerPassword,
} = {}) {
  if (typeof mediaId !== 'string' || !UUID_RE.test(mediaId)) {
    throw refuse('INVALID_STOREFRONT_MEDIA_ID', 400);
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
  const { data: item, error: lookupErr } = await db.from('dealer_storefront_media_items')
    .select('media_id,uploaded_by')
    .eq('media_id', mediaId)
    .maybeSingle();
  if (lookupErr) throw refuse('STOREFRONT_MEDIA_LOOKUP_UNAVAILABLE', 503);
  if (!item) throw refuse('STOREFRONT_MEDIA_NOT_FOUND', 404);
  independent(actor, item.uploaded_by);
  await stepUp(actor, { claimant_user_id: item.uploaded_by }, payload?.reviewer_password);

  const { data, error } = await db.rpc('dealer_review_storefront_media_item', {
    p_media_id: mediaId,
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
    const { data: signed, error: signErr } = await db.storage
      .from(row.storage_bucket || 'ocr-documents')
      .createSignedUrl(row.storage_path, 120);
    if (signErr || !signed?.signedUrl) {
      throw refuse('PUBLIC_STOREFRONT_MEDIA_UNAVAILABLE', 503);
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
      image_url: signed.signedUrl,
      thumbnail_url: signed.signedUrl,
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
