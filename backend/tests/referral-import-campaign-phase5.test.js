import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import {
  IMPORT_CAMPAIGN_EVENT_TYPES,
  IMPORT_CAPACITY_STATUSES,
  IMPORT_FLOW_TYPES,
  IMPORT_PARTICIPANT_TYPES,
  ReferralImportCampaignService,
} from '../services/referral/referralImportCampaignService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { COUPON_DISCOUNT_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const roadmapFile = readFileSync(new URL('../../docs/referral-ai-engine/12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md', import.meta.url), 'utf8');
const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const importServiceFile = readFileSync(new URL('../services/referral/referralImportCampaignService.js', import.meta.url), 'utf8');

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
  const importCampaign = new ReferralImportCampaignService({ referralService, channelGateway, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, channelGateway, importCampaign };
}

const operatorActor = Object.freeze({ actor_user_id: 'route-agent-1', actor_role: 'route_agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const buyerActor = Object.freeze({ actor_user_id: 'import-buyer-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });

test('Phase 5 roadmap and routes cover import campaigns, route pages, and capacity status', () => {
  assert.equal(roadmapFile.includes('Enable vehicle import, parts import, and container-space campaign flows with route pages and capacity status.'), true);
  for (const marker of [
    "router.get('/import-campaigns/rules'",
    "router.post('/import-campaigns/routes'",
    "router.get('/import-campaigns/routes/:routeKey/status'",
    "router.post('/import-campaigns/routes/:routeKey/capacity'",
    "router.post('/import-campaigns/referral-bundles'",
    "router.post('/import-campaigns/leads'",
    "router.post('/import-campaigns/leads/:leadEventId/qualify'",
    "router.post('/import-campaigns/share-kit'",
    // The router wires the benchmark subclass (which extends ReferralImportCampaignService).
    'ReferralImportCampaignBenchmarkService',
  ]) assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
});

test('rule catalog exposes vehicle, parts, container, capacity, and import reward safeguards', () => {
  const { importCampaign } = createHarness();
  const rules = importCampaign.getRuleCatalog();
  for (const flow of ['vehicle_import', 'parts_import', 'container_space']) assert.equal(rules.flow_types.includes(flow), true);
  for (const participant of ['import_buyer', 'parts_supplier', 'space_booker', 'route_agent', 'general_referrer']) assert.equal(rules.participant_types.includes(participant), true);
  for (const status of ['planned', 'open', 'limited', 'full', 'closed']) assert.equal(rules.capacity_statuses.includes(status), true);
  assert.equal(rules.rewardable_milestones.includes('container_space_paid'), true);
  assert.equal(rules.safety.priority_scope, 'IMPORT');
  assert.equal(importServiceFile.includes('duplicate_reward_policy'), true);
});

test('intent classification detects vehicle imports, parts imports, and container-space requests', () => {
  const { importCampaign } = createHarness();
  assert.equal(importCampaign.classifyImportIntent({ message: 'I want to import a Toyota Aqua from Japan', route_origin: 'Japan', route_destination: 'Zimbabwe' }).flow_type, IMPORT_FLOW_TYPES.VEHICLE_IMPORT);
  assert.equal(importCampaign.classifyImportIntent({ message: 'Need engine spare parts from South Africa', route_origin: 'South Africa' }).flow_type, IMPORT_FLOW_TYPES.PARTS_IMPORT);
  const containerIntent = importCampaign.classifyImportIntent({ message: 'Book container space this month', route_origin: 'Japan', route_destination: 'Zimbabwe' });
  assert.equal(containerIntent.flow_type, IMPORT_FLOW_TYPES.CONTAINER_SPACE);
  assert.equal(containerIntent.participant_type, IMPORT_PARTICIPANT_TYPES.SPACE_BOOKER);
});

test('operator can create import route pages, update capacity, and read route status', async () => {
  const { repository, importCampaign } = createHarness();
  const route = await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 30, booked_cbm: 10, unit_label: 'CBM', cutoff_date: '2026-07-01' }, operatorActor);
  assert.equal(route.success, true);
  assert.equal(route.route.route_key, 'japan-zimbabwe-container-space');
  assert.equal(route.route.capacity_status, IMPORT_CAPACITY_STATUSES.OPEN);

  const capacity = await importCampaign.updateCapacity({ route_key: route.route.route_key, flow_type: 'container_space', total_cbm: 30, booked_cbm: 25, unit_label: 'CBM' }, operatorActor);
  assert.equal(capacity.capacity.capacity_status, IMPORT_CAPACITY_STATUSES.LIMITED);
  assert.equal(capacity.capacity.available_capacity_units, 5);

  const status = await importCampaign.getRouteStatus(route.route.route_key);
  assert.equal(status.success, true);
  assert.equal(status.capacity.capacity_status, IMPORT_CAPACITY_STATUSES.LIMITED);
  assert.equal(status.history_count, 2);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.ROUTE_PAGE_CREATED), true);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.CAPACITY_UPDATED), true);
});

test('capacity update rejects overbooking and missing routes fail safely', async () => {
  const { importCampaign } = createHarness();
  await assert.rejects(() => importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', total_cbm: 10, booked_cbm: 11 }, operatorActor), ValidationError);
  await assert.rejects(() => importCampaign.getRouteStatus('missing-route'), NotFoundError);
});

test('operator can create vehicle, parts, and container referral bundles with import priority', async () => {
  const { importCampaign } = createHarness();
  const vehicle = await importCampaign.createReferralBundle({ flow_type: 'vehicle_import', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'vehicle-referrer', code: 'import-car-001' }, operatorActor);
  const parts = await importCampaign.createReferralBundle({ flow_type: 'parts_import', route_origin: 'South Africa', route_destination: 'Zimbabwe', owner_user_id: 'parts-referrer', code: 'import-parts-001' }, operatorActor);
  const container = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'space-referrer', code: 'import-space-001', create_coupon: true, coupon_code: 'space-discount-5', discount_type: COUPON_DISCOUNT_TYPES.FIXED, discount_value: 5 }, operatorActor);
  assert.equal(vehicle.campaign.campaign_type, 'IMPORT_VEHICLE');
  assert.equal(parts.campaign.campaign_type, 'IMPORT_PARTS');
  assert.equal(container.campaign.campaign_type, 'CONTAINER_SPACE');
  assert.equal(container.campaign.priority_scope, 'IMPORT');
  assert.equal(container.coupon.code, 'SPACE-DISCOUNT-5');
  assert.equal(container.shareAsset.payload.short_referral_url.includes('/r/IMPORT-SPACE-001'), true);
});

test('full import route blocks active leads but permits waitlist mode', async () => {
  const { importCampaign } = createHarness();
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 10 }, operatorActor);
  await assert.rejects(() => importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', session_id: 'blocked-full-route' }, buyerActor), ValidationError);
  const waitlist = await importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', session_id: 'waitlist-full-route', allow_waitlist: true }, buyerActor);
  assert.equal(waitlist.lead.waitlisted, true);
  assert.equal(waitlist.lead.capacity_status, IMPORT_CAPACITY_STATUSES.FULL);
});

test('import lead creation preserves attribution and applies coupon estimate', async () => {
  const { repository, importCampaign } = createHarness();
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 20, booked_cbm: 5 }, operatorActor);
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'space-referrer-2', code: 'import-space-lead-1', create_coupon: true, coupon_code: 'space-coupon-5', discount_type: COUPON_DISCOUNT_TYPES.FIXED, discount_value: 5 }, operatorActor);
  const lead = await importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', referral_code: bundle.code.code, coupon_code: bundle.coupon.code, requested_cbm: 2, estimated_order_amount: 200, contact: { user_id: 'buyer-space-1' }, consent: { opted_in: true }, session_id: 'space-lead-1' }, buyerActor);
  assert.equal(lead.success, true);
  assert.equal(lead.attribution.owner_user_id, 'space-referrer-2');
  assert.equal(lead.coupon.applied, true);
  assert.equal(lead.coupon.discount_amount, 5);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.IMPORT_LEAD_CREATED && event.code_id === bundle.code.id), true);
});

test('rewardable import milestone creates one pending reward and blocks duplicates', async () => {
  const { repository, referralService, importCampaign } = createHarness();
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'vehicle_import', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'vehicle-ambassador', code: 'vehicle-reward-001' }, operatorActor);
  const lead = await importCampaign.createLead({ flow_type: 'vehicle_import', route_origin: 'Japan', route_destination: 'Zimbabwe', referral_code: bundle.code.code, session_id: 'vehicle-lead-1', contact: { user_id: 'vehicle-buyer' } }, buyerActor);
  const qualified = await importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'vehicle_purchased', result_reference: 'auction-123', referred_user_id: 'vehicle-buyer' }, operatorActor);
  assert.equal(qualified.reward_created, true);
  assert.equal(qualified.reward.status, WALLET_TRANSACTION_STATUSES.PENDING);
  assert.equal(qualified.reward.amount, 25);
  const wallet = await referralService.getWallet('vehicle-ambassador');
  assert.equal(wallet.wallet.pending_balance, 25);
  await assert.rejects(() => importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'vehicle_purchased', referred_user_id: 'vehicle-buyer' }, operatorActor), ValidationError);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 1);
});

test('non-rewardable import milestone records qualification without wallet mutation', async () => {
  const { repository, importCampaign } = createHarness();
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'parts_import', owner_user_id: 'parts-ambassador', code: 'parts-nonreward-001' }, operatorActor);
  const lead = await importCampaign.createLead({ flow_type: 'parts_import', referral_code: bundle.code.code, session_id: 'parts-lead-nonreward', contact: { user_id: 'parts-buyer' } }, buyerActor);
  const qualified = await importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'contact_verified', referred_user_id: 'parts-buyer' }, operatorActor);
  assert.equal(qualified.reward_created, false);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.MILESTONE_QUALIFIED), true);
});

test('self-referral import milestone is blocked before qualification or wallet side effects', async () => {
  const { repository, importCampaign } = createHarness();
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'container_space', owner_user_id: 'self-importer', code: 'self-import-001' }, { ...operatorActor, actor_user_id: 'self-importer' });
  const lead = await importCampaign.createLead({ flow_type: 'container_space', referral_code: bundle.code.code, session_id: 'self-import-lead', contact: { user_id: 'self-importer' } }, buyerActor);
  await assert.rejects(() => importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'container_space_paid', referred_user_id: 'self-importer' }, { ...operatorActor, actor_user_id: 'self-importer' }), ForbiddenError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.MILESTONE_QUALIFIED), false);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED), false);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});

test('import share kit delegates to channel gateway and records import share event', async () => {
  const { repository, importCampaign } = createHarness();
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'space-share-referrer', code: 'space-share-001', channel: 'whatsapp' }, operatorActor);
  const share = await importCampaign.prepareShareKit({ code: bundle.code.code, channel: 'whatsapp', route_key: bundle.route_key, flow_type: 'container_space', campaign_name: 'Japan to Zimbabwe container space' }, operatorActor);
  assert.equal(share.success, true);
  assert.equal(share.import_campaign, true);
  assert.equal(share.copy.message.includes('SPACE-SHARE-001'), true);
  assert.equal(share.copy.link.includes('wa.me'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.SHARE_KIT_PREPARED), true);
});
