import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralImportCampaignBenchmarkService } from '../services/referral/referralImportCampaignBenchmarkService.js';
import { IMPORT_CAMPAIGN_EVENT_TYPES } from '../services/referral/referralImportCampaignService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const benchmarkServiceFile = readFileSync(new URL('../services/referral/referralImportCampaignBenchmarkService.js', import.meta.url), 'utf8');
const hardenedServiceFile = readFileSync(new URL('../services/referral/referralImportCampaignHardenedService.js', import.meta.url), 'utf8');

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
  const importCampaign = new ReferralImportCampaignBenchmarkService({ referralService, channelGateway, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, importCampaign };
}

const operatorActor = Object.freeze({ actor_user_id: 'route-agent-hardening', actor_role: 'route_agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const buyerActor = Object.freeze({ actor_user_id: 'import-buyer-hardening', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });

test('Phase 5 routes use the benchmark import campaign service wrapper', () => {
  assert.equal(routeFile.includes('ReferralImportCampaignBenchmarkService'), true);
  assert.equal(routeFile.includes('referralImportCampaignBenchmarkService.js'), true);
  assert.equal(routeFile.includes("'operator'"), true);
  assert.equal(hardenedServiceFile.includes('preflightMilestoneQualification'), true);
  assert.equal(hardenedServiceFile.includes('preflightCapacity'), true);
  assert.equal(benchmarkServiceFile.includes('preflightRequestedCapacity'), true);
  assert.equal(benchmarkServiceFile.includes('orderBy'), true);
});

test('generated import campaign slugs are monotonic even when time is fixed', async () => {
  const { importCampaign } = createHarness();
  const first = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'space-referrer' }, operatorActor);
  const second = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'space-referrer' }, operatorActor);
  assert.notEqual(first.campaign.slug, second.campaign.slug);
});

test('route page creation rejects overbooked capacity before route event side effects', async () => {
  const { repository, importCampaign } = createHarness();
  await assert.rejects(() => importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 11 }, operatorActor), ValidationError);
  assert.equal((await repository.list(REFERRAL_TABLES.events)).some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.ROUTE_PAGE_CREATED), false);
});

test('import lead creation rejects requested space above latest available capacity before lead side effects', async () => {
  const { repository, importCampaign } = createHarness();
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 4 }, operatorActor);
  await importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', total_cbm: 10, booked_cbm: 6 }, operatorActor);
  await assert.rejects(() => importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', requested_cbm: 5, session_id: 'over-capacity-lead' }, buyerActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.IMPORT_LEAD_CREATED), false);
});

test('import lead with allow_waitlist is waitlisted (not rejected) when over available capacity', async () => {
  const { importCampaign } = createHarness();
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 4 }, operatorActor);
  await importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', total_cbm: 10, booked_cbm: 6 }, operatorActor);
  // available = 4; request 5 with waitlist mode must be accepted and flagged waitlisted.
  const lead = await importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', requested_cbm: 5, allow_waitlist: true, session_id: 'waitlist-lead', contact: { user_id: 'wl-buyer' } }, buyerActor);
  assert.equal(lead.success, true);
  assert.equal(lead.lead.waitlisted, true);
});

test('latest route capacity update wins when multiple updates share fixed timestamps', async () => {
  const { importCampaign } = createHarness();
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 2 }, operatorActor);
  await importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', total_cbm: 10, booked_cbm: 3 }, operatorActor);
  await importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', total_cbm: 10, booked_cbm: 7 }, operatorActor);
  const status = await importCampaign.getRouteStatus('japan-zimbabwe-container-space');
  assert.equal(status.capacity.booked_capacity_units, 7);
  assert.equal(status.capacity.available_capacity_units, 3);
});

test('zero manual import reward override is rejected before qualification or wallet mutation', async () => {
  const { repository, importCampaign } = createHarness();
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'vehicle_import', owner_user_id: 'vehicle-hardening-referrer', code: 'vehicle-hardening-001' }, operatorActor);
  const lead = await importCampaign.createLead({ flow_type: 'vehicle_import', referral_code: bundle.code.code, session_id: 'vehicle-hardening-lead', contact: { user_id: 'vehicle-hardening-buyer' } }, buyerActor);
  await assert.rejects(() => importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'vehicle_purchased', reward_amount: 0, referred_user_id: 'vehicle-hardening-buyer' }, operatorActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.MILESTONE_QUALIFIED), false);
  assert.equal(events.some((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED), false);
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
});

test('import reward credits the lead code owner even when a different referral_code is supplied at qualification', async () => {
  const { repository, importCampaign } = createHarness();
  const realBundle = await importCampaign.createReferralBundle({ flow_type: 'vehicle_import', owner_user_id: 'import-real-owner', code: 'import-real-001' }, operatorActor);
  const attackerBundle = await importCampaign.createReferralBundle({ flow_type: 'vehicle_import', owner_user_id: 'import-attacker', code: 'import-attacker-001' }, operatorActor);
  const lead = await importCampaign.createLead({ flow_type: 'vehicle_import', referral_code: realBundle.code.code, session_id: 'import-redirect', contact: { user_id: 'import-buyer-x' } }, buyerActor);
  // Exercise the getAttributionOwner fallback: lead keeps its referral_code but lost code_id/attribution.
  const leadEvent = await repository.findOne(REFERRAL_TABLES.events, { id: lead.event_id });
  const md = { ...leadEvent.metadata }; delete md.attribution;
  await repository.updateById(REFERRAL_TABLES.events, lead.event_id, { code_id: null, metadata: { ...md, referral_code: realBundle.code.code } });
  // Attempt to redirect the credit by passing the attacker code at qualification.
  const result = await importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'vehicle_purchased', referral_code: attackerBundle.code.code, referred_user_id: 'import-buyer-x' }, operatorActor);
  assert.equal(result.reward_created, true);
  const wallets = await repository.list(REFERRAL_TABLES.walletTransactions);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, 'import-real-owner');
  assert.notEqual(wallets[0].user_id, 'import-attacker');
});
