import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import {
  LOCAL_FLOW_TYPES,
  LOCAL_MARKETPLACE_EVENT_TYPES,
  LOCAL_PARTICIPANT_TYPES,
  ReferralLocalMarketplaceService,
} from '../services/referral/referralLocalMarketplaceService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { COUPON_DISCOUNT_TYPES, REFERRAL_CODE_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const localServiceFile = readFileSync(new URL('../services/referral/referralLocalMarketplaceService.js', import.meta.url), 'utf8');
const roadmapFile = readFileSync(new URL('../../docs/referral-ai-engine/12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md', import.meta.url), 'utf8');

class MemoryReferralRepository {
  constructor() { this.counter = 0; this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []])); }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) { const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || '2026-06-12T00:00:00.000Z', ...payload }; this.tables.get(table).push(row); return row; }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}) { return this.tables.get(table).filter((row) => this.match(row, filters)); }
  async updateById(table, id, patch) { const rows = this.tables.get(table); const index = rows.findIndex((row) => row.id === id); if (index === -1) return null; rows[index] = { ...rows[index], ...patch }; return rows[index]; }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

function createHarness() {
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now: () => new Date('2026-06-12T00:00:00.000Z'), shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' } });
  const agentGateway = new ReferralAgentGatewayService({ referralService, now: () => new Date('2026-06-12T00:00:00.000Z'), shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' } });
  const channelGateway = new ReferralChannelGatewayService({ agentGateway, referralService, now: () => new Date('2026-06-12T00:00:00.000Z') });
  const localMarketplace = new ReferralLocalMarketplaceService({ referralService, channelGateway, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, agentGateway, channelGateway, localMarketplace };
}

const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'seller', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const buyerActor = Object.freeze({ actor_user_id: 'buyer-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });

test('Phase 4 roadmap and routes cover local marketplace scope', () => {
  assert.equal(roadmapFile.includes('Enable local buyer, seller, parts, supplier, mechanic, and operator referral flows.'), true);
  for (const marker of [
    "router.get('/local-marketplace/rules'",
    "router.post('/local-marketplace/intent'",
    "router.post('/local-marketplace/leads'",
    "router.post('/local-marketplace/referral-bundles'",
    "router.post('/local-marketplace/leads/:leadEventId/qualify'",
    "router.post('/local-marketplace/share-kit'",
    'ReferralLocalMarketplaceService',
  ]) assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
});

test('rule catalog exposes buyer, seller, parts supplier, mechanic, operator, and reward safeguards', () => {
  const { localMarketplace } = createHarness();
  const rules = localMarketplace.getRuleCatalog();
  for (const participant of ['buyer', 'seller', 'parts_supplier', 'mechanic', 'operator', 'general_referrer']) assert.equal(rules.participant_types.includes(participant), true);
  for (const flow of ['buy_vehicle', 'sell_vehicle', 'find_parts', 'supplier_quote', 'mechanic_service']) assert.equal(rules.flow_types.includes(flow), true);
  assert.equal(rules.rewardable_milestones.includes('order_paid'), true);
  assert.equal(rules.safety.self_referral, 'blocked');
  assert.equal(localServiceFile.includes('WALLET_TRANSACTION_STATUSES.PENDING'), true);
});

test('intent classification routes local buyer, seller, parts, supplier, and mechanic messages', () => {
  const { localMarketplace } = createHarness();
  assert.equal(localMarketplace.classifyIntent({ message: 'I want to buy a Toyota Aqua in Harare' }).flow_type, LOCAL_FLOW_TYPES.BUY_VEHICLE);
  assert.equal(localMarketplace.classifyIntent({ message: 'Please help me sell my Honda Fit' }).participant_type, LOCAL_PARTICIPANT_TYPES.SELLER);
  assert.equal(localMarketplace.classifyIntent({ message: 'Need an engine spare part urgently' }).flow_type, LOCAL_FLOW_TYPES.FIND_PARTS);
  assert.equal(localMarketplace.classifyIntent({ message: 'Supplier quote for brake pads in bulk' }).participant_type, LOCAL_PARTICIPANT_TYPES.PARTS_SUPPLIER);
  assert.equal(localMarketplace.classifyIntent({ message: 'Need a mechanic to repair my car' }).participant_type, LOCAL_PARTICIPANT_TYPES.MECHANIC);
});

test('operator can create a local marketplace referral bundle with campaign, code, coupon, share asset, and event trail', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({
    flow_type: 'find_parts',
    participant_type: 'parts_supplier',
    owner_user_id: 'supplier-referrer-1',
    campaign_name: 'Harare parts local referral',
    code: 'local-parts-001',
    channel: 'whatsapp',
    create_coupon: true,
    coupon_code: 'buyer-parts-1',
    discount_type: COUPON_DISCOUNT_TYPES.FIXED,
    discount_value: 1,
  }, operatorActor);

  assert.equal(bundle.success, true);
  assert.equal(bundle.campaign.campaign_type, 'LOCAL_MARKETPLACE');
  assert.equal(bundle.campaign.priority_scope, 'LOCAL');
  assert.equal(bundle.code.code, 'LOCAL-PARTS-001');
  assert.equal(bundle.coupon.code, 'BUYER-PARTS-1');
  assert.equal(bundle.shareAsset.payload.short_referral_url.includes('/r/LOCAL-PARTS-001'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.REFERRAL_BUNDLE_CREATED), true);
});

test('non-operator cannot create local referral bundles or qualify rewards', async () => {
  const { localMarketplace } = createHarness();
  await assert.rejects(() => localMarketplace.createReferralBundle({ owner_user_id: 'x' }, buyerActor), ForbiddenError);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: 'missing', milestone: 'order_paid' }, buyerActor), ForbiddenError);
});

test('buyer lead creation preserves referral attribution, applies coupon estimate, and records a local lead event', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({
    flow_type: 'buy_vehicle',
    participant_type: 'buyer',
    owner_user_id: 'ambassador-1',
    campaign_name: 'Local buyer campaign',
    code: 'local-buyer-001',
    create_coupon: true,
    coupon_code: 'buyer-discount-1',
    discount_type: COUPON_DISCOUNT_TYPES.FIXED,
    discount_value: 1,
  }, operatorActor);

  const lead = await localMarketplace.createLead({
    flow_type: 'buy_vehicle',
    participant_type: 'buyer',
    referral_code: bundle.code.code,
    coupon_code: bundle.coupon.code,
    estimated_order_amount: 500,
    make: 'Toyota',
    model: 'Aqua',
    channel: 'web',
    session_id: 'lead-session-1',
    contact: { phone: '+263771000000', user_id: 'buyer-1' },
    consent: { opted_in: true },
  }, buyerActor);

  assert.equal(lead.success, true);
  assert.equal(lead.lead.status, 'attributed');
  assert.equal(lead.attribution.owner_user_id, 'ambassador-1');
  assert.equal(lead.coupon.applied, true);
  assert.equal(lead.coupon.discount_amount, 1);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED && event.code_id === bundle.code.id), true);
});

test('qualifying a local purchase creates only a pending reward eligibility record and wallet balance', async () => {
  const { repository, localMarketplace, referralService } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', participant_type: 'buyer', owner_user_id: 'ambassador-2', code: 'local-buy-reward-1' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: bundle.code.code, session_id: 'lead-reward-1', contact: { user_id: 'buyer-2' } }, buyerActor);
  const qualified = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', result_reference: 'order-123', order_amount: 1000, referred_user_id: 'buyer-2' }, operatorActor);

  assert.equal(qualified.success, true);
  assert.equal(qualified.reward_created, true);
  assert.equal(qualified.reward.status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal(qualified.reward.amount, 5);
  const wallet = await referralService.getWallet('ambassador-2');
  assert.equal(wallet.wallet.pending_balance, 5);
  assert.equal(wallet.wallet.approved_balance, 0);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED), true);
});

test('non-rewardable local milestone records qualification without creating wallet transaction', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'find_parts', participant_type: 'buyer', owner_user_id: 'ambassador-3', code: 'local-parts-lead-only' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'find_parts', referral_code: bundle.code.code, session_id: 'parts-lead-only' }, buyerActor);
  const qualified = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'contact_verified', result_reference: 'lead-contacted' }, operatorActor);
  assert.equal(qualified.reward_created, false);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});

test('self-referrals are blocked when a rewardable local milestone is qualified', async () => {
  const { localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'sell_vehicle', participant_type: 'seller', owner_user_id: 'seller-self', code: 'local-self-001' }, { ...operatorActor, actor_user_id: 'seller-self' });
  const lead = await localMarketplace.createLead({ flow_type: 'sell_vehicle', referral_code: bundle.code.code, session_id: 'self-lead-1', contact: { user_id: 'seller-self' } }, buyerActor);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'listing_paid', referred_user_id: 'seller-self' }, { ...operatorActor, actor_user_id: 'seller-self' }), ForbiddenError);
});

test('unknown lead qualification fails safely', async () => {
  const { localMarketplace } = createHarness();
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: 'missing-lead', milestone: 'order_paid' }, operatorActor), NotFoundError);
});

test('local share kit delegates to the channel gateway and marks local marketplace context', async () => {
  const { localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'mechanic_service', participant_type: 'mechanic', owner_user_id: 'mechanic-1', code: 'local-mechanic-001', channel: 'telegram' }, operatorActor);
  const share = await localMarketplace.prepareLocalShareKit({ code: bundle.code.code, channel: 'telegram', flow_type: 'mechanic_service', participant_type: 'mechanic', campaign_name: 'Harare mechanic bookings' }, operatorActor);
  assert.equal(share.success, true);
  assert.equal(share.local_marketplace, true);
  assert.equal(share.channel, 'telegram');
  assert.equal(share.copy.message.includes('LOCAL-MECHANIC-001'), true);
});
