import crypto from 'crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  ACTOR_TYPES,
  COUPON_DISCOUNT_TYPES,
  COUPON_STATUSES,
  REFERRAL_CAMPAIGN_STATUSES,
  REFERRAL_CAMPAIGN_TYPES,
  REFERRAL_CHANNELS,
  REFERRAL_CODE_STATUSES,
  REFERRAL_CODE_TYPES,
  REFERRAL_EVENT_TYPES,
  REFERRAL_PRIORITY_SCOPES,
  WALLET_ALLOWED_TRANSITIONS,
  WALLET_TRANSACTION_STATUSES,
  enumValues,
} from '../../constants/referral/referralConstants.js';
import { REFERRAL_TABLES, createSupabaseReferralRepository } from './referralEngineRepository.js';

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_PLATFORM_TENANT = 'platform';
const SIGNUP_EVENT_TYPES = new Set(['user.signup', 'auth.signup', 'member.registered']);
const RESTRICTED_FINANCIAL_STATES = new Set([
  WALLET_TRANSACTION_STATUSES.ELIGIBLE,
  WALLET_TRANSACTION_STATUSES.APPROVED,
  WALLET_TRANSACTION_STATUSES.PAYABLE,
  WALLET_TRANSACTION_STATUSES.PAID_OR_APPLIED,
]);

export function normalizeReferralCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-');
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function createStructuredError(code, message, details = {}) {
  return { code, message, details };
}

export function buildActorContext(req = {}) {
  const ctx = req.userContext || {};
  return {
    actor_user_id: ctx.id || ctx.userId || req.headers?.['x-user-id'] || null,
    actor_role: ctx.effectiveRole || ctx.role || req.headers?.['x-stakeholder-role'] || null,
    actor_tenant_id: ctx.tenantId || req.headers?.['x-tenant-id'] || DEFAULT_PLATFORM_TENANT,
    actor_type: req.headers?.['x-actor-type'] || ACTOR_TYPES.USER,
  };
}

function assertEnum(value, values, label) {
  if (!values.includes(value)) {
    throw new ValidationError(`${label} is invalid.`, { value, allowed: values });
  }
}

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata;
}

function asIso(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function calculateCouponValue(coupon, amount) {
  const numericAmount = Number(amount || 0);
  const discountValue = Number(coupon.discount_value || 0);
  if (coupon.discount_type === COUPON_DISCOUNT_TYPES.PERCENT) {
    const raw = numericAmount * (discountValue / 100);
    const capped = coupon.max_discount_amount ? Math.min(raw, Number(coupon.max_discount_amount)) : raw;
    return Number(capped.toFixed(2));
  }
  return Number(Math.min(discountValue, numericAmount || discountValue).toFixed(2));
}

function walletBucketForStatus(status) {
  if ([WALLET_TRANSACTION_STATUSES.CREATED, WALLET_TRANSACTION_STATUSES.PENDING, WALLET_TRANSACTION_STATUSES.ELIGIBLE].includes(status)) {
    return 'pending_balance';
  }
  if (status === WALLET_TRANSACTION_STATUSES.APPROVED) return 'approved_balance';
  if (status === WALLET_TRANSACTION_STATUSES.PAYABLE) return 'payable_balance';
  if (status === WALLET_TRANSACTION_STATUSES.PAID_OR_APPLIED) return 'paid_or_applied_balance';
  return null;
}

function emptyWalletBalances() {
  return {
    pending_balance: 0,
    approved_balance: 0,
    payable_balance: 0,
    paid_or_applied_balance: 0,
  };
}

// ── Phase E: safe read/list helpers (additive; no behaviour change) ─────────
const REFERRAL_LIST_DEFAULT_LIMIT = 25;
const REFERRAL_LIST_MAX_LIMIT = 100;

export function clampReferralLimit(limit, fallback = REFERRAL_LIST_DEFAULT_LIMIT, max = REFERRAL_LIST_MAX_LIMIT) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function clampReferralOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function definedFilters(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function referralCreatedKey(row = {}) {
  return String(row.created_at || row.occurred_at || '');
}

/**
 * Deterministic newest-first sort + offset/limit slice. Pagination lives in the
 * service (not the repository) so it behaves identically for the Supabase client
 * and the in-memory repository used by tests. Returns the page plus a pagination
 * descriptor { limit, offset, total, has_more }.
 */
export function paginateReferralRows(rows = [], filters = {}) {
  const limit = clampReferralLimit(filters.limit);
  const offset = clampReferralOffset(filters.offset);
  const sorted = [...rows].sort((a, b) => referralCreatedKey(b).localeCompare(referralCreatedKey(a)));
  const total = sorted.length;
  const page = sorted.slice(offset, offset + limit);
  return { page, pagination: { limit, offset, total, has_more: offset + limit < total } };
}

// Curated read projections — expose stable, non-sensitive list fields only.
export function normalizeReferralCodeRecord(row = {}) {
  return {
    id: row.id,
    code: row.code,
    code_type: row.code_type ?? null,
    status: row.status ?? null,
    campaign_id: row.campaign_id ?? null,
    owner_user_id: row.owner_user_id ?? null,
    channel: row.channel ?? null,
    max_uses: row.max_uses ?? null,
    uses_count: row.uses_count ?? 0,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at ?? null,
  };
}

export function normalizeReferralCouponRecord(row = {}) {
  return {
    id: row.id,
    code: row.code,
    discount_type: row.discount_type ?? null,
    discount_value: row.discount_value ?? null,
    benefit_type: row.benefit_type ?? null,
    status: row.status ?? null,
    campaign_id: row.campaign_id ?? null,
    currency: row.currency ?? null,
    max_redemptions: row.max_redemptions ?? null,
    redemption_count: row.redemption_count ?? row.redeemed_count ?? 0,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at ?? null,
  };
}

function buildCode39BarcodeSvg(code) {
  const value = normalizeReferralCode(code);
  const unit = 2;
  const height = 80;
  const bars = Array.from(value).map((char) => char.charCodeAt(0).toString(2).padStart(8, '0')).join('0');
  let x = 10;
  const rects = [];
  for (const bit of bars) {
    const width = bit === '1' ? unit * 2 : unit;
    if (bit === '1') rects.push(`<rect x="${x}" y="8" width="${width}" height="${height}" />`);
    x += width + unit;
  }
  const width = Math.max(180, x + 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="120" viewBox="0 0 ${width} 120" role="img" aria-label="Referral barcode ${value}"><rect width="100%" height="100%" fill="#fff"/>${rects.join('')}<text x="${width / 2}" y="110" text-anchor="middle" font-family="monospace" font-size="14">${value}</text></svg>`;
}

export function buildReferralShareAssets(codeRecord, campaignRecord = null, options = {}) {
  if (!codeRecord?.code) throw new ValidationError('Referral code is required to build share assets.');
  const code = normalizeReferralCode(codeRecord.code);
  const baseUrl = String(options.baseUrl || process.env.CARUP_PUBLIC_BASE_URL || 'https://carup.app').replace(/\/$/, '');
  const whatsappNumber = options.whatsappNumber || process.env.CARUP_WHATSAPP_NUMBER || '';
  const telegramBot = options.telegramBot || process.env.CARUP_TELEGRAM_BOT || 'CarUpBot';
  const campaignSlug = campaignRecord?.slug || codeRecord.campaign_slug || 'referral';
  const referralUrl = `${baseUrl}/r/${encodeURIComponent(code)}`;
  const utm = {
    utm_source: codeRecord.channel || REFERRAL_CHANNELS.WEB,
    utm_medium: 'referral',
    utm_campaign: campaignSlug,
    utm_content: code,
  };
  const socialParams = new URLSearchParams(utm).toString();
  const shareText = `I use CarUp for local trade, imports, parts, and container bookings. Use my code ${code}.`;
  const whatsappShareUrl = whatsappNumber
    ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(`${shareText} ${referralUrl}`)}`
    : `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralUrl}`)}`;
  return {
    code,
    short_referral_url: referralUrl,
    qr_payload: referralUrl,
    barcode_payload: code,
    barcode_svg: buildCode39BarcodeSvg(code),
    whatsapp_share_url: whatsappShareUrl,
    telegram_start_url: `https://t.me/${telegramBot}?start=${encodeURIComponent(code)}`,
    social_campaign_url: `${referralUrl}?${socialParams}`,
    poster_text: `Scan or use code ${code} to connect with CarUp for local buying, selling, imports, parts, and container space.`,
    utm,
  };
}

function generateReferralCode({ prefix = 'CARUP', seed = '' } = {}) {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const normalizedPrefix = normalizeReferralCode(prefix || 'CARUP').slice(0, 16) || 'CARUP';
  const normalizedSeed = normalizeReferralCode(seed).slice(0, 18);
  return [normalizedPrefix, normalizedSeed, random].filter(Boolean).join('-');
}

export class ReferralEngineService {
  constructor({ repository, client, now = () => new Date(), shareOptions = {} } = {}) {
    this.repository = repository || createSupabaseReferralRepository(client);
    this.now = now;
    this.shareOptions = shareOptions;
  }

  currentIso() {
    return this.now().toISOString();
  }

  async recordReferralEvent(input = {}, actor = {}) {
    if (!input.event_type) throw new ValidationError('event_type is required.');
    const payload = {
      tenant_id: input.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      event_type: input.event_type,
      code_id: input.code_id || null,
      campaign_id: input.campaign_id || null,
      coupon_id: input.coupon_id || null,
      wallet_transaction_id: input.wallet_transaction_id || null,
      subject_type: input.subject_type || null,
      subject_id: input.subject_id || null,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      source: input.source || null,
      session_id: input.session_id || null,
      actor_user_id: actor.actor_user_id || input.actor_user_id || null,
      actor_type: actor.actor_type || input.actor_type || ACTOR_TYPES.SYSTEM,
      metadata: cleanMetadata(input.metadata),
      occurred_at: asIso(input.occurred_at, this.currentIso()),
    };
    return this.repository.insert(REFERRAL_TABLES.events, payload);
  }

  async createCampaign(input = {}, actor = {}) {
    const campaignType = input.campaign_type || REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE;
    const priorityScope = input.priority_scope || (campaignType === REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE ? REFERRAL_PRIORITY_SCOPES.LOCAL : REFERRAL_PRIORITY_SCOPES.IMPORT);
    const status = input.status || REFERRAL_CAMPAIGN_STATUSES.DRAFT;
    assertEnum(campaignType, enumValues(REFERRAL_CAMPAIGN_TYPES), 'campaign_type');
    assertEnum(priorityScope, enumValues(REFERRAL_PRIORITY_SCOPES), 'priority_scope');
    assertEnum(status, enumValues(REFERRAL_CAMPAIGN_STATUSES), 'status');
    if (!input.name) throw new ValidationError('Campaign name is required.');

    const campaign = await this.repository.insert(REFERRAL_TABLES.campaigns, {
      tenant_id: input.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      name: input.name,
      slug: input.slug || slugify(input.name),
      campaign_type: campaignType,
      priority_scope: priorityScope,
      status,
      starts_at: asIso(input.starts_at),
      ends_at: asIso(input.ends_at),
      route_origin: input.route_origin || null,
      route_destination: input.route_destination || null,
      category: input.category || null,
      channel_strategy: cleanMetadata(input.channel_strategy),
      metadata: cleanMetadata(input.metadata),
      created_by: actor.actor_user_id || input.created_by || null,
    });
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.CAMPAIGN_CREATED, campaign_id: campaign.id, metadata: { name: campaign.name } }, actor);
    return campaign;
  }

  async listCampaigns(filters = {}) {
    return this.repository.list(REFERRAL_TABLES.campaigns, filters, { orderBy: 'created_at', ascending: false, limit: 200 });
  }

  // Phase E: additive read endpoints. Tenant-safe, paginated, curated projections.
  async listCodes(filters = {}) {
    const columnFilters = definedFilters({
      tenant_id: filters.tenant_id,
      campaign_id: filters.campaign_id,
      status: filters.status,
      code_type: filters.code_type,
      owner_user_id: filters.owner_user_id,
      channel: filters.channel,
    });
    const rows = await this.repository.list(REFERRAL_TABLES.codes, columnFilters, { orderBy: 'created_at', ascending: false, limit: 1000 });
    const { page, pagination } = paginateReferralRows(rows || [], filters);
    return { codes: page.map(normalizeReferralCodeRecord), pagination };
  }

  async listCoupons(filters = {}) {
    const columnFilters = definedFilters({
      tenant_id: filters.tenant_id,
      campaign_id: filters.campaign_id,
      status: filters.status,
      discount_type: filters.discount_type,
    });
    const rows = await this.repository.list(REFERRAL_TABLES.coupons, columnFilters, { orderBy: 'created_at', ascending: false, limit: 1000 });
    const { page, pagination } = paginateReferralRows(rows || [], filters);
    return { coupons: page.map(normalizeReferralCouponRecord), pagination };
  }

  async updateCampaign(id, patch = {}, actor = {}) {
    if (!id) throw new ValidationError('Campaign id is required.');
    const safePatch = { ...patch, updated_at: this.currentIso(), updated_by: actor.actor_user_id || null };
    return this.repository.updateById(REFERRAL_TABLES.campaigns, id, safePatch);
  }

  async createReferralCode(input = {}, actor = {}) {
    const codeType = input.code_type || REFERRAL_CODE_TYPES.MEMBER;
    const status = input.status || REFERRAL_CODE_STATUSES.ACTIVE;
    assertEnum(codeType, enumValues(REFERRAL_CODE_TYPES), 'code_type');
    assertEnum(status, enumValues(REFERRAL_CODE_STATUSES), 'status');
    const code = normalizeReferralCode(input.code || generateReferralCode({ prefix: input.prefix, seed: input.owner_user_id || input.campaign_id || input.channel }));
    if (!code) throw new ValidationError('Referral code is required.');
    const existing = await this.repository.findOne(REFERRAL_TABLES.codes, { code });
    if (existing) throw new ValidationError('Referral code already exists.', { code });

    const payload = {
      tenant_id: input.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      campaign_id: input.campaign_id || null,
      owner_user_id: input.owner_user_id || actor.actor_user_id || null,
      code,
      code_type: codeType,
      status,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      active_from: asIso(input.active_from, this.currentIso()),
      expires_at: asIso(input.expires_at),
      max_uses: input.max_uses ?? null,
      uses_count: 0,
      location_scope: input.location_scope || [],
      role_scope: input.role_scope || [],
      metadata: cleanMetadata(input.metadata),
      created_by: actor.actor_user_id || input.created_by || null,
      actor_type: actor.actor_type || ACTOR_TYPES.ADMIN,
    };
    if (input.is_permanent) {
      payload.is_permanent = true;
    }
    const created = await this.repository.insert(REFERRAL_TABLES.codes, payload);
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.CODE_CREATED, code_id: created.id, campaign_id: created.campaign_id, channel: created.channel }, actor);
    return created;
  }

  async ensurePermanentMemberCode(authenticatedUserId, tenantId = DEFAULT_PLATFORM_TENANT) {
    if (!authenticatedUserId) throw new ValidationError('Authenticated User ID is required.');
    const codeStr = normalizeReferralCode(generateReferralCode({ seed: authenticatedUserId }));
    const payload = {
      tenant_id: tenantId,
      owner_user_id: authenticatedUserId,
      code: codeStr,
      code_type: REFERRAL_CODE_TYPES.MEMBER,
      status: REFERRAL_CODE_STATUSES.ACTIVE,
      channel: REFERRAL_CHANNELS.WEB,
      active_from: this.currentIso(),
      is_permanent: true,
      uses_count: 0,
      location_scope: [],
      role_scope: [],
      metadata: {},
      created_by: authenticatedUserId,
      actor_type: ACTOR_TYPES.SYSTEM,
    };

    try {
      const created = await this.repository.insert(REFERRAL_TABLES.codes, payload);
      await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.CODE_CREATED, code_id: created.id, channel: created.channel }, { actor_user_id: authenticatedUserId, actor_type: ACTOR_TYPES.SYSTEM, actor_tenant_id: tenantId });
      return created;
    } catch (err) {
      // 23505 is the Postgres code for unique_violation
      if (err.originalError?.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('violates unique constraint')) {
        const existing = await this.repository.findOne(REFERRAL_TABLES.codes, { tenant_id: tenantId, owner_user_id: authenticatedUserId, is_permanent: true });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async validateReferralCode(input = {}, actor = {}) {
    const normalized = normalizeReferralCode(input.code);
    if (!normalized) {
      return { valid: false, reason: 'CODE_REQUIRED', error: createStructuredError('CODE_REQUIRED', 'Referral code is required.') };
    }
    const code = await this.repository.findOne(REFERRAL_TABLES.codes, { code: normalized });
    if (!code) {
      return { valid: false, reason: 'CODE_NOT_FOUND', error: createStructuredError('CODE_NOT_FOUND', 'Referral code was not found.', { code: normalized }) };
    }
    const now = this.now();
    let reason = null;
    if (code.status !== REFERRAL_CODE_STATUSES.ACTIVE) reason = `CODE_${code.status}`;
    if (!reason && code.active_from && new Date(code.active_from) > now) reason = 'CODE_NOT_ACTIVE_YET';
    if (!reason && code.expires_at && new Date(code.expires_at) < now) reason = 'CODE_EXPIRED';
    if (!reason && code.max_uses !== null && code.max_uses !== undefined && Number(code.uses_count || 0) >= Number(code.max_uses)) reason = 'CODE_EXHAUSTED';

    // QR/barcode scans are first-class referral events: when a code is reached
    // through a scan surface, record the scan alongside the validation outcome
    // (reusing the existing event table — no separate scan-tracking system).
    const scanChannel = input.channel || code.channel || null;
    const scanEventType =
      scanChannel === REFERRAL_CHANNELS.QR
        ? REFERRAL_EVENT_TYPES.QR_SCANNED
        : scanChannel === REFERRAL_CHANNELS.BARCODE
          ? REFERRAL_EVENT_TYPES.BARCODE_SCANNED
          : null;
    if (scanEventType) {
      await this.recordReferralEvent({
        event_type: scanEventType,
        code_id: code.id,
        campaign_id: code.campaign_id,
        channel: scanChannel,
        session_id: input.session_id || null,
        subject_type: input.subject_type || null,
        subject_id: input.subject_id || null,
        metadata: { source: input.source || null, scan_context: input.scan_context || null },
      }, actor);
    }

    await this.recordReferralEvent({
      event_type: reason ? REFERRAL_EVENT_TYPES.CODE_FAILED : REFERRAL_EVENT_TYPES.CODE_VALIDATED,
      code_id: code.id,
      campaign_id: code.campaign_id,
      channel: input.channel || code.channel || REFERRAL_CHANNELS.WEB,
      session_id: input.session_id || null,
      subject_type: input.subject_type || null,
      subject_id: input.subject_id || null,
      metadata: { reason, source: input.source || null, context: cleanMetadata(input.metadata) },
    }, actor);

    if (reason) {
      return { valid: false, reason, code, error: createStructuredError(reason, 'Referral code is not currently usable.', { code: normalized }) };
    }
    return {
      valid: true,
      reason: null,
      code,
      attribution: {
        code_id: code.id,
        campaign_id: code.campaign_id,
        owner_user_id: code.owner_user_id,
        code_type: code.code_type,
        channel: input.channel || code.channel,
      },
    };
  }

  async createCoupon(input = {}, actor = {}) {
    const discountType = input.discount_type || COUPON_DISCOUNT_TYPES.FIXED;
    const status = input.status || COUPON_STATUSES.ACTIVE;
    assertEnum(discountType, enumValues(COUPON_DISCOUNT_TYPES), 'discount_type');
    assertEnum(status, enumValues(COUPON_STATUSES), 'status');
    const code = normalizeReferralCode(input.code || generateReferralCode({ prefix: 'COUPON', seed: input.campaign_id || input.benefit_type }));
    if (!code) throw new ValidationError('Coupon code is required.');
    const existing = await this.repository.findOne(REFERRAL_TABLES.coupons, { code });
    if (existing) throw new ValidationError('Coupon already exists.', { code });
    return this.repository.insert(REFERRAL_TABLES.coupons, {
      tenant_id: input.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      campaign_id: input.campaign_id || null,
      code,
      status,
      benefit_type: input.benefit_type || 'buyer_discount',
      discount_type: discountType,
      discount_value: Number(input.discount_value || 0),
      max_discount_amount: input.max_discount_amount ?? null,
      minimum_order_amount: input.minimum_order_amount ?? null,
      currency: input.currency || DEFAULT_CURRENCY,
      max_redemptions: input.max_redemptions ?? null,
      starts_at: asIso(input.starts_at, this.currentIso()),
      expires_at: asIso(input.expires_at),
      metadata: cleanMetadata(input.metadata),
      created_by: actor.actor_user_id || null,
    });
  }

  async applyCoupon(input = {}, actor = {}) {
    const normalized = normalizeReferralCode(input.code);
    const coupon = await this.repository.findOne(REFERRAL_TABLES.coupons, { code: normalized });
    if (!coupon) return { applied: false, reason: 'COUPON_NOT_FOUND', error: createStructuredError('COUPON_NOT_FOUND', 'Coupon was not found.') };
    const now = this.now();
    let reason = null;
    if (coupon.status !== COUPON_STATUSES.ACTIVE) reason = `COUPON_${coupon.status}`;
    if (!reason && coupon.starts_at && new Date(coupon.starts_at) > now) reason = 'COUPON_NOT_ACTIVE_YET';
    if (!reason && coupon.expires_at && new Date(coupon.expires_at) < now) reason = 'COUPON_EXPIRED';
    if (!reason && coupon.minimum_order_amount && Number(input.order_amount || 0) < Number(coupon.minimum_order_amount)) reason = 'MINIMUM_ORDER_NOT_MET';
    const redemptionCount = await this.repository.count(REFERRAL_TABLES.couponRedemptions, { coupon_id: coupon.id });
    if (!reason && coupon.max_redemptions !== null && coupon.max_redemptions !== undefined && redemptionCount >= Number(coupon.max_redemptions)) reason = 'COUPON_EXHAUSTED';
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.COUPON_APPLIED, coupon_id: coupon.id, campaign_id: coupon.campaign_id, metadata: { reason, order_amount: input.order_amount || 0 } }, actor);
    if (reason) return { applied: false, reason, coupon, error: createStructuredError(reason, 'Coupon cannot be applied.', { code: normalized }) };
    return { applied: true, coupon, discount_amount: calculateCouponValue(coupon, input.order_amount), currency: coupon.currency || DEFAULT_CURRENCY };
  }

  async redeemCoupon(input = {}, actor = {}) {
    const application = await this.applyCoupon(input, actor);
    if (!application.applied) return application;
    if (!input.redeemer_user_id) throw new ValidationError('redeemer_user_id is required to redeem a coupon.');
    const existing = await this.repository.findOne(REFERRAL_TABLES.couponRedemptions, { coupon_id: application.coupon.id, redeemer_user_id: input.redeemer_user_id });
    if (existing) throw new ValidationError('Coupon already redeemed by this user.', { coupon_id: application.coupon.id, redeemer_user_id: input.redeemer_user_id });
    const redemption = await this.repository.insert(REFERRAL_TABLES.couponRedemptions, {
      tenant_id: input.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      coupon_id: application.coupon.id,
      redeemer_user_id: input.redeemer_user_id,
      order_reference: input.order_reference || null,
      value_applied: application.discount_amount,
      currency: application.currency,
      redemption_status: 'applied',
      idempotency_key: input.idempotency_key || null,
      metadata: cleanMetadata(input.metadata),
      created_by: actor.actor_user_id || null,
    });
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.COUPON_REDEEMED, coupon_id: application.coupon.id, campaign_id: application.coupon.campaign_id, subject_type: 'coupon_redemption', subject_id: redemption.id }, actor);
    return { redeemed: true, redemption, coupon: application.coupon };
  }

  async getOrCreateWallet(userId, actor = {}) {
    if (!userId) throw new ValidationError('userId is required.');
    const existing = await this.repository.findOne(REFERRAL_TABLES.wallets, { user_id: userId });
    if (existing) return existing;
    return this.repository.insert(REFERRAL_TABLES.wallets, {
      tenant_id: actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      user_id: userId,
      currency: DEFAULT_CURRENCY,
      pending_balance: 0,
      approved_balance: 0,
      payable_balance: 0,
      paid_or_applied_balance: 0,
      metadata: {},
    });
  }

  async getWallet(userId) {
    const wallet = await this.repository.findOne(REFERRAL_TABLES.wallets, { user_id: userId });
    if (!wallet) throw new NotFoundError('Referral wallet not found.', { userId });
    const transactions = await this.repository.list(REFERRAL_TABLES.walletTransactions, { wallet_id: wallet.id }, { orderBy: 'created_at', ascending: false, limit: 100 });
    return { wallet, transactions };
  }

  async recomputeWalletBalances(walletId) {
    if (!walletId) throw new ValidationError('walletId is required.');
    const transactions = await this.repository.list(REFERRAL_TABLES.walletTransactions, { wallet_id: walletId });
    const balances = emptyWalletBalances();
    for (const tx of transactions) {
      const bucket = walletBucketForStatus(tx.status);
      if (!bucket) continue;
      balances[bucket] += Number(tx.amount || 0);
    }
    const rounded = Object.fromEntries(Object.entries(balances).map(([key, value]) => [key, Number(value.toFixed(2))]));
    return this.repository.updateById(REFERRAL_TABLES.wallets, walletId, {
      ...rounded,
      updated_at: this.currentIso(),
    });
  }

  async createWalletTransaction(input = {}, actor = {}) {
    if (!input.user_id) throw new ValidationError('user_id is required.');
    const wallet = await this.getOrCreateWallet(input.user_id, actor);
    const status = input.status || WALLET_TRANSACTION_STATUSES.PENDING;
    assertEnum(status, enumValues(WALLET_TRANSACTION_STATUSES), 'wallet transaction status');
    if (SIGNUP_EVENT_TYPES.has(input.source_event_type) && RESTRICTED_FINANCIAL_STATES.has(status)) {
      throw new ForbiddenError('Signup-only rewards cannot mature into financial benefit states.');
    }
    const tx = await this.repository.insert(REFERRAL_TABLES.walletTransactions, {
      tenant_id: wallet.tenant_id || actor.actor_tenant_id || DEFAULT_PLATFORM_TENANT,
      wallet_id: wallet.id,
      user_id: input.user_id,
      campaign_id: input.campaign_id || null,
      code_id: input.code_id || null,
      source_event_id: input.source_event_id || null,
      source_event_type: input.source_event_type || null,
      transaction_type: input.transaction_type || 'referral_credit',
      status,
      amount: Number(input.amount || 0),
      currency: input.currency || wallet.currency || DEFAULT_CURRENCY,
      reason: input.reason || null,
      metadata: cleanMetadata(input.metadata),
      created_by: actor.actor_user_id || null,
      actor_type: actor.actor_type || ACTOR_TYPES.SYSTEM,
    });
    await this.recomputeWalletBalances(wallet.id);
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.WALLET_TRANSACTION_CREATED, wallet_transaction_id: tx.id, campaign_id: tx.campaign_id, code_id: tx.code_id, subject_type: 'wallet_transaction', subject_id: tx.id }, actor);
    return tx;
  }

  async transitionWalletTransaction(id, nextStatus, actor = {}) {
    if (!id) throw new ValidationError('wallet transaction id is required.');
    assertEnum(nextStatus, enumValues(WALLET_TRANSACTION_STATUSES), 'next wallet transaction status');
    const tx = await this.repository.findOne(REFERRAL_TABLES.walletTransactions, { id });
    if (!tx) throw new NotFoundError('Wallet transaction not found.', { id });
    const allowed = WALLET_ALLOWED_TRANSITIONS[tx.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new ValidationError('Wallet transaction transition is not allowed.', { from: tx.status, to: nextStatus, allowed });
    }
    if (SIGNUP_EVENT_TYPES.has(tx.source_event_type) && RESTRICTED_FINANCIAL_STATES.has(nextStatus)) {
      throw new ForbiddenError('Signup-only rewards cannot mature into financial benefit states.');
    }
    const updated = await this.repository.updateById(REFERRAL_TABLES.walletTransactions, id, {
      status: nextStatus,
      reviewed_by: actor.actor_user_id || null,
      reviewed_at: this.currentIso(),
      updated_at: this.currentIso(),
    });
    await this.recomputeWalletBalances(tx.wallet_id);
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.WALLET_TRANSACTION_STATUS_CHANGED, wallet_transaction_id: id, campaign_id: tx.campaign_id, code_id: tx.code_id, metadata: { from: tx.status, to: nextStatus } }, actor);
    return updated;
  }

  async createShareAssets(input = {}, actor = {}) {
    const code = await this.repository.findOne(REFERRAL_TABLES.codes, { code: normalizeReferralCode(input.code) });
    if (!code) throw new NotFoundError('Referral code not found.', { code: input.code });
    const campaign = code.campaign_id ? await this.repository.findOne(REFERRAL_TABLES.campaigns, { id: code.campaign_id }) : null;
    const assets = buildReferralShareAssets(code, campaign, { ...this.shareOptions, ...input.options });
    return this.repository.insert(REFERRAL_TABLES.shareAssets, {
      tenant_id: code.tenant_id,
      code_id: code.id,
      campaign_id: code.campaign_id,
      asset_type: input.asset_type || 'share_kit',
      channel: input.channel || code.channel || REFERRAL_CHANNELS.WEB,
      payload: assets,
      created_by: actor.actor_user_id || null,
    });
  }

  async ensureAttributionJourney(anonymousId, userId, tenantId = DEFAULT_PLATFORM_TENANT) {
    let journey = null;
    if (userId) {
      journey = await this.repository.findOne(REFERRAL_TABLES.attributionJourneys, { tenant_id: tenantId, user_id: userId, status: 'active' });
    }
    if (!journey && anonymousId) {
      journey = await this.repository.findOne(REFERRAL_TABLES.attributionJourneys, { tenant_id: tenantId, anonymous_journey_id: anonymousId, status: 'active' });
      if (journey && userId && !journey.user_id) {
        journey = await this.repository.updateById(REFERRAL_TABLES.attributionJourneys, journey.id, { user_id: userId });
      }
    }
    if (!journey) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry
      journey = await this.repository.insert(REFERRAL_TABLES.attributionJourneys, {
        tenant_id: tenantId,
        anonymous_journey_id: anonymousId || null,
        user_id: userId || null,
        status: 'active',
        expires_at: expiresAt.toISOString()
      });
    }
    return journey;
  }

  async bindAttributionJourney(anonymousId, userId, tenantId = DEFAULT_PLATFORM_TENANT) {
    if (!anonymousId || !userId) throw new ValidationError('anonymousId and userId are required to bind journey.');
    const journey = await this.repository.findOne(REFERRAL_TABLES.attributionJourneys, { tenant_id: tenantId, anonymous_journey_id: anonymousId, status: 'active' });
    if (!journey) return null; // No active anonymous journey to bind
    if (journey.user_id && journey.user_id !== userId) throw new ValidationError('Journey is already bound to another user.');
    
    // Check self-referral upon claim: if the journey's reward owner is this exact user, abandon or reject it
    if (journey.reward_owner_user_id === userId) {
       await this.repository.updateById(REFERRAL_TABLES.attributionJourneys, journey.id, { 
         status: 'abandoned',
         user_id: userId,
         claimed_at: this.currentIso()
       });
       return null;
    }
    
    return this.repository.updateById(REFERRAL_TABLES.attributionJourneys, journey.id, { 
      user_id: userId,
      claimed_at: this.currentIso()
    });
  }

  async recordAttributionTouch(journeyId, touchKind, input = {}, actor = {}) {
    assertEnum(touchKind, ['first', 'last', 'assisted'], 'touch_kind');
    const journey = await this.repository.findOne(REFERRAL_TABLES.attributionJourneys, { id: journeyId });
    if (!journey) throw new NotFoundError('Attribution journey not found.', { journeyId });

    let code = null;
    if (input.code) {
      code = await this.repository.findOne(REFERRAL_TABLES.codes, { tenant_id: journey.tenant_id, code: normalizeReferralCode(input.code) });
      if (!code) throw new NotFoundError('Referral code not found.', { code: input.code });
    } else if (input.code_id) {
      code = await this.repository.findOne(REFERRAL_TABLES.codes, { tenant_id: journey.tenant_id, id: input.code_id });
    }

    if (code && journey.user_id && code.owner_user_id === journey.user_id) {
      throw new ValidationError('Self-referral is rejected.');
    }

    const idempotencyKey = input.idempotency_key || `${journeyId}-${touchKind}-${code?.id || 'none'}-${this.currentIso()}`;
    
    // Check idempotency (tenant-scoped)
    const existingTouch = await this.repository.findOne(REFERRAL_TABLES.attributionTouches, { tenant_id: journey.tenant_id, idempotency_key: idempotencyKey });
    if (existingTouch) return existingTouch;

    const touchPayload = {
      tenant_id: journey.tenant_id,
      journey_id: journey.id,
      touch_kind: touchKind,
      code_id: code?.id || null,
      campaign_id: code?.campaign_id || input.campaign_id || null,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      source: input.source || null,
      session_id: input.session_id || null,
      subject_type: input.subject_type || null,
      subject_id: input.subject_id || null,
      actor_type: actor.actor_type || ACTOR_TYPES.USER,
      actor_user_id: actor.actor_user_id || null,
      metadata: cleanMetadata(input.metadata),
      idempotency_key: idempotencyKey
    };

    const touch = await this.repository.insert(REFERRAL_TABLES.attributionTouches, touchPayload);
    await this.recordReferralEvent({ event_type: REFERRAL_EVENT_TYPES.ATTRIBUTION_RECORDED, subject_type: 'attribution_touch', subject_id: touch.id, code_id: code?.id, campaign_id: touchPayload.campaign_id, channel: touchPayload.channel }, actor);

    const journeyPatch = {};
    
    // First touch is write-once
    if (!journey.first_touch_id) {
      if (touchKind === 'first' || code) {
        journeyPatch.first_touch_id = touch.id;
      }
    }
    
    // Reward owner code is write-once
    if (code && !journey.reward_owner_code_id) {
      journeyPatch.reward_owner_code_id = code.id;
      journeyPatch.reward_owner_user_id = code.owner_user_id;
      journeyPatch.campaign_id = code.campaign_id;
    }

    // Last touch updates only for an eligible direct subsequent touch
    // Assisted touch must not overwrite last touch automatically
    if (touchKind === 'last' || (touchKind === 'first' && !journey.last_touch_id && code)) {
      journeyPatch.last_touch_id = touch.id;
    }

    if (Object.keys(journeyPatch).length > 0) {
      await this.repository.updateById(REFERRAL_TABLES.attributionJourneys, journey.id, journeyPatch);
    }

    return touch;
  }
  
  async recordAnonymousTouch(input) {
     const { code, journeyToken, channel, source, req } = input;
     const tenantId = DEFAULT_PLATFORM_TENANT;
     const journey = await this.ensureAttributionJourney(journeyToken, null, tenantId);
     
     // Determine touch kind based on existing journey
     const touchKind = journey.first_touch_id ? 'last' : 'first';
     
     return this.recordAttributionTouch(journey.id, touchKind, {
       code,
       channel,
       source,
       session_id: req ? req.headers['x-session-id'] : null,
       metadata: { user_agent: req?.headers['user-agent'] }
     }, { actor_type: ACTOR_TYPES.SYSTEM });
  }

  async getAdminTimeline(filters = {}) {
    // `limit` is a pagination option, not a row filter. Passing it through the
    // column-filter argument makes the Supabase repository emit `.eq('limit', N)`
    // against a non-existent column (and makes in-memory repositories match zero
    // rows), so keep it out of the equality filters and only use it as an option.
    const { limit, ...columnFilters } = filters;
    return this.repository.list(REFERRAL_TABLES.events, columnFilters, { orderBy: 'occurred_at', ascending: false, limit: limit || 200 });
  }
}
