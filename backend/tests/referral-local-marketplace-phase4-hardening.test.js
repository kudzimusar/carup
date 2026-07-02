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

test('reward credits the lead code owner even when a different referral_code is supplied at qualification (attribution cannot be redirected)', async () => {
  const { repository, localMarketplace } = createHarness();
  // The lead is driven by the real owner's code; a second (attacker) code exists.
  const realBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'real-owner', code: 'phase4-real-owner' }, operatorActor);
  const attackerBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'attacker-owner', code: 'phase4-attacker' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: realBundle.code.code, session_id: 'attribution-redirect', contact: { user_id: 'buyer-x' } }, buyerActor);
  // Attempt to redirect the credit by passing the attacker's code at qualification time.
  const result = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referral_code: attackerBundle.code.code, referred_user_id: 'buyer-x' }, operatorActor);
  assert.equal(result.reward_created, true);
  const wallets = await repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(wallets.length, 1);
  // The reward MUST belong to the owner of the code that drove the lead.
  assert.equal(wallets[0].user_id, 'real-owner');
  assert.notEqual(wallets[0].user_id, 'attacker-owner');
});

test('attribution precedence: stored lead code_id resolves the authoritative owner when metadata.referral_code is absent', async () => {
  const { repository, localMarketplace } = createHarness();
  const realBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-codeid', code: 'prec-codeid' }, operatorActor);
  const attackerBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-attacker', code: 'prec-attacker-1' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: realBundle.code.code, session_id: 'prec-codeid', contact: { user_id: 'buyer-codeid' } }, buyerActor);
  // Simulate a lead whose metadata lost the referral_code/attribution but still has code_id.
  const leadEvent = await repository.findOne(REFERRAL_TABLES.events, { id: lead.event_id });
  const md = { ...leadEvent.metadata }; delete md.referral_code; delete md.attribution;
  await repository.updateById(REFERRAL_TABLES.events, lead.event_id, { metadata: md });
  const result = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referral_code: attackerBundle.code.code, referred_user_id: 'buyer-codeid' }, operatorActor);
  assert.equal(result.reward_created, true);
  const wallets = await repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, 'owner-codeid'); // resolved via code_id, not the caller code
});

test('attribution precedence: a caller-supplied code is accepted only when the lead has NO stored attribution', async () => {
  const { repository, localMarketplace } = createHarness();
  const lateBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-late', code: 'prec-late' }, operatorActor);
  const realBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-real', code: 'prec-real' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: realBundle.code.code, session_id: 'prec-late', contact: { user_id: 'buyer-late' } }, buyerActor);
  // Strip ALL stored attribution from the lead (no code_id, no metadata code/attribution).
  const leadEvent = await repository.findOne(REFERRAL_TABLES.events, { id: lead.event_id });
  const md = { ...leadEvent.metadata }; delete md.referral_code; delete md.attribution;
  await repository.updateById(REFERRAL_TABLES.events, lead.event_id, { code_id: null, metadata: md });
  // With no stored attribution, a caller code legitimately attributes the (previously orphan) lead.
  const result = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referral_code: lateBundle.code.code, referred_user_id: 'buyer-late' }, operatorActor);
  assert.equal(result.reward_created, true);
  const wallets = await repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, 'owner-late');
});

test('attribution precedence: duplicate qualification cannot mint a second reward even after a code-substitution attempt', async () => {
  const { repository, localMarketplace } = createHarness();
  const realBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-dup2', code: 'prec-dup-real' }, operatorActor);
  const attackerBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-dup-attacker', code: 'prec-dup-attacker' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: realBundle.code.code, session_id: 'prec-dup', contact: { user_id: 'buyer-dup2' } }, buyerActor);
  const first = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referral_code: attackerBundle.code.code, referred_user_id: 'buyer-dup2' }, operatorActor);
  assert.equal(first.reward_created, true);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referral_code: attackerBundle.code.code, referred_user_id: 'buyer-dup2' }, operatorActor), ValidationError);
  const wallets = await repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, 'owner-dup2'); // single reward, to the authoritative owner
});

test('attribution precedence: self-referral is judged against the authoritative lead owner and a caller code cannot bypass it', async () => {
  const { repository, localMarketplace } = createHarness();
  const realBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-self2', code: 'prec-self-real' }, { ...operatorActor, actor_user_id: 'owner-self2' });
  const attackerBundle = await localMarketplace.createReferralBundle({ flow_type: 'buy_vehicle', owner_user_id: 'owner-other', code: 'prec-self-attacker' }, operatorActor);
  const lead = await localMarketplace.createLead({ flow_type: 'buy_vehicle', referral_code: realBundle.code.code, session_id: 'prec-self', contact: { user_id: 'owner-self2' } }, buyerActor);
  // The referred user IS the authoritative (lead) owner -> self-referral; passing a different
  // caller code must NOT let it slip past the guard.
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referred_user_id: 'owner-self2', referral_code: attackerBundle.code.code }, operatorActor), ForbiddenError);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});
