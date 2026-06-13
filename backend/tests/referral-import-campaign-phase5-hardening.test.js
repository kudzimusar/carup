import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralImportCampaignHardenedService } from '../services/referral/referralImportCampaignHardenedService.js';
import { IMPORT_CAMPAIGN_EVENT_TYPES } from '../services/referral/referralImportCampaignService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
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
  const importCampaign = new ReferralImportCampaignHardenedService({ referralService, channelGateway, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, importCampaign };
}

const operatorActor = Object.freeze({ actor_user_id: 'route-agent-hardening', actor_role: 'route_agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const buyerActor = Object.freeze({ actor_user_id: 'import-buyer-hardening', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });

test('Phase 5 routes use the hardened import campaign service wrapper', () => {
  assert.equal(routeFile.includes('ReferralImportCampaignHardenedService'), true);
  assert.equal(routeFile.includes('referralImportCampaignHardenedService.js'), true);
  assert.equal(hardenedServiceFile.includes('preflightMilestoneQualification'), true);
  assert.equal(hardenedServiceFile.includes('preflightCapacity'), true);
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
