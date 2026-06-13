import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { LOCAL_MARKETPLACE_EVENT_TYPES } from '../services/referral/referralLocalMarketplaceService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const hardenedServiceFile = readFileSync(new URL('../services/referral/referralLocalMarketplaceHardenedService.js', import.meta.url), 'utf8');

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
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, channelGateway, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, localMarketplace };
}

const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'seller', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const buyerActor = Object.freeze({ actor_user_id: 'buyer-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });

test('Phase 4 routes use the hardened local marketplace service wrapper', () => {
  assert.equal(routeFile.includes('ReferralLocalMarketplaceHardenedService'), true);
  assert.equal(routeFile.includes('referralLocalMarketplaceHardenedService.js'), true);
  assert.equal(hardenedServiceFile.includes('preflightQualification'), true);
  assert.equal(hardenedServiceFile.includes('assertNoDuplicateRewardEligibility'), true);
});

test('generated local bundle slugs are monotonic even when time is fixed', async () => {
  const { localMarketplace } = createHarness();
  const first = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'ambassador-1' }, operatorActor);
  const second = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'ambassador-1' }, operatorActor);
  assert.notEqual(first.campaign.slug, second.campaign.slug);
});

test('self-referral reward qualification is blocked before qualification or reward events are recorded', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'sell_vehicle', owner_user_id: 'seller-self', code: 'phase4-self-hardening' }, { ...operatorActor, actor_user_id: 'seller-self' });
  const lead = await localMarketplace.createLead({ flow_type: 'sell_vehicle', referral_code: bundle.code.code, session_id: 'self-hardening', contact: { user_id: 'seller-self' } }, buyerActor);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'listing_paid', referred_user_id: 'seller-self' }, { ...operatorActor, actor_user_id: 'seller-self' }), ForbiddenError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_QUALIFIED), false);
  assert.equal(events.some((event) => event.event_type === LOCAL_MARKETPLACE_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED), false);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});

test('duplicate reward qualification for the same lead and milestone is blocked', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'ambassador-dup', code: 'phase4-dup-hardening' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: bundle.code.code, session_id: 'dup-hardening', contact: { user_id: 'buyer-dup' } }, buyerActor);
  const first = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referred_user_id: 'buyer-dup' }, operatorActor);
  assert.equal(first.reward_created, true);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referred_user_id: 'buyer-dup' }, operatorActor), ValidationError);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 1);
});

test('non-positive manual reward override is rejected before wallet mutation', async () => {
  const { repository, localMarketplace } = createHarness();
  const bundle = await localMarketplace.createReferralBundle({ flow_type: 'find_parts', owner_user_id: 'ambassador-amount', code: 'phase4-amount-hardening' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'find_parts', referral_code: bundle.code.code, session_id: 'amount-hardening', contact: { user_id: 'buyer-amount' } }, buyerActor);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'quote_accepted', reward_amount: 0, referred_user_id: 'buyer-amount' }, operatorActor), ValidationError);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});
