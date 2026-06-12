import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService, buildReferralShareAssets, normalizeReferralCode } from '../services/referral/referralEngineService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import {
  COUPON_DISCOUNT_TYPES,
  REFERRAL_CAMPAIGN_TYPES,
  REFERRAL_CODE_TYPES,
  REFERRAL_EVENT_TYPES,
  WALLET_TRANSACTION_STATUSES,
} from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const migrationFile = readFileSync(new URL('../../database/migrations/016_referral_engine_phase1.sql', import.meta.url), 'utf8');
const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const promotionsRouteFile = readFileSync(new URL('../routes/promotionsRoutes.js', import.meta.url), 'utf8');
const serviceFile = readFileSync(new URL('../services/referral/referralEngineService.js', import.meta.url), 'utf8');

class MemoryReferralRepository {
  constructor() {
    this.counter = 0;
    this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []]));
  }

  nextId(table) {
    this.counter += 1;
    return `${table}-${this.counter}`;
  }

  match(row, filters = {}) {
    return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value);
  }

  async insert(table, payload) {
    const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || '2026-06-12T00:00:00.000Z', ...payload };
    this.tables.get(table).push(row);
    return row;
  }

  async findOne(table, filters = {}) {
    return this.tables.get(table).find((row) => this.match(row, filters)) || null;
  }

  async list(table, filters = {}) {
    return this.tables.get(table).filter((row) => this.match(row, filters));
  }

  async updateById(table, id, patch) {
    const rows = this.tables.get(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch };
    return rows[index];
  }

  async count(table, filters = {}) {
    return (await this.list(table, filters)).length;
  }
}

function createService() {
  const repository = new MemoryReferralRepository();
  const service = new ReferralEngineService({
    repository,
    now: () => new Date('2026-06-12T00:00:00.000Z'),
    shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpTestBot' },
  });
  return { repository, service };
}

const adminActor = Object.freeze({ actor_user_id: 'admin-1', actor_role: 'admin', actor_tenant_id: 'tenant-1', actor_type: 'admin' });

test('Phase 1 migration contains all required foundation tables with RLS enabled', () => {
  for (const table of [
    'referral_campaigns',
    'referral_codes',
    'referral_events',
    'referral_coupons',
    'referral_coupon_redemptions',
    'referral_wallets',
    'referral_wallet_transactions',
    'referral_share_assets',
    'referral_admin_audit_events',
  ]) {
    assert.equal(migrationFile.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `${table} should be created`);
    assert.equal(migrationFile.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`), true, `${table} should enable RLS`);
  }
  assert.equal(migrationFile.includes('referral_signup_only_not_matured'), true);
  assert.equal(migrationFile.includes('idx_referral_codes_code'), true);
  assert.equal(migrationFile.includes('idx_referral_events_campaign'), true);
});

test('Referral API is mounted and exposes Phase 1 endpoints', () => {
  assert.equal(promotionsRouteFile.includes("router.use('/api/referrals', referralRouter)"), true);
  for (const marker of ["router.post('/campaigns'", "router.post('/validate'", "router.post('/coupons/apply'", "router.patch('/wallets/transactions/:id/status'", "router.get('/admin/events'"]) {
    assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
  }
});

test('Referral service is AI-ready with structured actor and event hooks', () => {
  for (const marker of ['actor_type', 'buildActorContext', 'recordReferralEvent', 'REFERRAL_EVENT_TYPES.CODE_VALIDATED', 'REFERRAL_EVENT_TYPES.WALLET_TRANSACTION_STATUS_CHANGED']) {
    assert.equal(serviceFile.includes(marker), true, `${marker} should be present`);
  }
});

test('creates an import-priority campaign and records the event', async () => {
  const { repository, service } = createService();
  const campaign = await service.createCampaign({
    name: 'Japan to Zimbabwe July Container',
    campaign_type: REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE,
    route_origin: 'Japan',
    route_destination: 'Zimbabwe',
    status: 'ACTIVE',
  }, adminActor);
  assert.equal(campaign.priority_scope, 'IMPORT');
  assert.equal(campaign.slug, 'japan-to-zimbabwe-july-container');
  const events = await repository.list(REFERRAL_TABLES.events, { campaign_id: campaign.id });
  assert.equal(events.some((event) => event.event_type === REFERRAL_EVENT_TYPES.CAMPAIGN_CREATED), true);
});

test('creates and validates referral codes with attribution preserved', async () => {
  const { repository, service } = createService();
  const campaign = await service.createCampaign({ name: 'Harare Parts Push', status: 'ACTIVE' }, adminActor);
  const code = await service.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'seller-1', code: 'hre parts tariro 22', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, adminActor);
  assert.equal(code.code, 'HRE-PARTS-TARIRO-22');
  const result = await service.validateReferralCode({ code: 'hre-parts-tariro-22', channel: 'whatsapp', subject_id: 'lead-1' }, { actor_type: 'user' });
  assert.equal(result.valid, true);
  assert.equal(result.attribution.campaign_id, campaign.id);
  assert.equal(result.attribution.owner_user_id, 'seller-1');
  const events = await repository.list(REFERRAL_TABLES.events, { code_id: code.id });
  assert.equal(events.some((event) => event.event_type === REFERRAL_EVENT_TYPES.CODE_CREATED), true);
  assert.equal(events.some((event) => event.event_type === REFERRAL_EVENT_TYPES.CODE_VALIDATED), true);
});

test('invalid, expired, and exhausted codes fail safely', async () => {
  const { service } = createService();
  const missing = await service.validateReferralCode({ code: 'NOPE' });
  assert.equal(missing.valid, false);
  assert.equal(missing.error.code, 'CODE_NOT_FOUND');
  await service.createReferralCode({ code: 'old-code', expires_at: '2026-01-01T00:00:00.000Z' }, adminActor);
  assert.equal((await service.validateReferralCode({ code: 'OLD-CODE' })).reason, 'CODE_EXPIRED');
  await service.createReferralCode({ code: 'maxed-code', max_uses: 0 }, adminActor);
  assert.equal((await service.validateReferralCode({ code: 'MAXED-CODE' })).reason, 'CODE_EXHAUSTED');
});

test('share assets include URL, QR payload, barcode, chat links, social URL, and UTM metadata', () => {
  const assets = buildReferralShareAssets(
    { code: 'CARUP-SHADRECK-8392', channel: 'whatsapp' },
    { slug: 'japan-to-zimbabwe-import' },
    { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' },
  );
  assert.equal(assets.short_referral_url, 'https://carup.test/r/CARUP-SHADRECK-8392');
  assert.equal(assets.qr_payload, assets.short_referral_url);
  assert.equal(assets.barcode_svg.includes('<svg'), true);
  assert.equal(assets.whatsapp_share_url.includes('wa.me'), true);
  assert.equal(assets.telegram_start_url.includes('CarUpBot'), true);
  assert.equal(assets.social_campaign_url.includes('utm_campaign=japan-to-zimbabwe-import'), true);
});

test('coupon application calculates discounts and duplicate redemptions are blocked', async () => {
  const { service } = createService();
  const coupon = await service.createCoupon({ code: 'zim-buyer-10', discount_type: COUPON_DISCOUNT_TYPES.PERCENT, discount_value: 10, max_discount_amount: 25, minimum_order_amount: 100 }, adminActor);
  assert.equal(coupon.code, 'ZIM-BUYER-10');
  const applied = await service.applyCoupon({ code: 'zim-buyer-10', order_amount: 300 });
  assert.equal(applied.applied, true);
  assert.equal(applied.discount_amount, 25);
  assert.equal((await service.redeemCoupon({ code: 'zim-buyer-10', order_amount: 300, redeemer_user_id: 'buyer-1', order_reference: 'order-1' }, { actor_user_id: 'buyer-1', actor_type: 'user' })).redeemed, true);
  await assert.rejects(() => service.redeemCoupon({ code: 'zim-buyer-10', order_amount: 300, redeemer_user_id: 'buyer-1', order_reference: 'order-2' }, { actor_user_id: 'buyer-1', actor_type: 'user' }), ValidationError);
});

test('wallet transactions follow milestone-safe state transitions and block signup-only maturation', async () => {
  const { service } = createService();
  const tx = await service.createWalletTransaction({ user_id: 'referrer-1', amount: 15, source_event_type: 'order.paid', reason: 'Successful parts order referral' }, adminActor);
  assert.equal(tx.status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal((await service.transitionWalletTransaction(tx.id, WALLET_TRANSACTION_STATUSES.ELIGIBLE, adminActor)).status, WALLET_TRANSACTION_STATUSES.ELIGIBLE);
  assert.equal((await service.transitionWalletTransaction(tx.id, WALLET_TRANSACTION_STATUSES.APPROVED, adminActor)).status, WALLET_TRANSACTION_STATUSES.APPROVED);
  const signupTx = await service.createWalletTransaction({ user_id: 'referrer-2', amount: 10, source_event_type: 'user.signup', reason: 'Registration only' }, adminActor);
  await assert.rejects(() => service.transitionWalletTransaction(signupTx.id, WALLET_TRANSACTION_STATUSES.ELIGIBLE, adminActor), ForbiddenError);
});

test('normalizes referral codes consistently for offline, social, and chat channels', () => {
  assert.equal(normalizeReferralCode(' boxspace july26 byo 09 '), 'BOXSPACE-JULY26-BYO-09');
  assert.equal(normalizeReferralCode('wa_group_ukzim_7781'), 'WA-GROUP-UKZIM-7781');
});
