// Phase E: additive referral read/list endpoints.
//
// Verifies the new GET-list service methods (codes, coupons, local leads, import
// routes, disputes) against the in-memory repository: route exposure, tenant
// safety, pagination (limit clamp + offset), filters, and that event-sourced
// lists are normalized from REAL event data without leaking PII.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { ReferralImportCampaignBenchmarkService } from '../services/referral/referralImportCampaignBenchmarkService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');

class MemoryReferralRepository {
  constructor() { this.counter = 0; this.tables = new Map(Object.values(REFERRAL_TABLES).map((table) => [table, []])); }
  nextId(table) { this.counter += 1; return `${table}-${this.counter}`; }
  match(row, filters = {}) { return Object.entries(filters).every(([key, value]) => value === undefined || value === null || row[key] === value); }
  async insert(table, payload) { const row = { id: payload.id || this.nextId(table), created_at: payload.created_at || `2026-06-12T00:00:0${this.counter % 10}.000Z`, ...payload }; this.tables.get(table).push(row); return row; }
  async findOne(table, filters = {}) { return this.tables.get(table).find((row) => this.match(row, filters)) || null; }
  async list(table, filters = {}) { return this.tables.get(table).filter((row) => this.match(row, filters)); }
  async updateById(table, id, patch) { const rows = this.tables.get(table); const index = rows.findIndex((row) => row.id === id); if (index === -1) return null; rows[index] = { ...rows[index], ...patch }; return rows[index]; }
  async count(table, filters = {}) { return (await this.list(table, filters)).length; }
}

function createStack() {
  const now = () => new Date('2026-06-12T00:00:00.000Z');
  const shareOptions = { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' };
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now, shareOptions });
  const agentGateway = new ReferralAgentGatewayService({ referralService, now, shareOptions });
  const channelGateway = new ReferralChannelGatewayService({ agentGateway, referralService, now });
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, channelGateway, now });
  const importCampaign = new ReferralImportCampaignBenchmarkService({ referralService, channelGateway, now });
  const trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now });
  return { repository, referralService, localMarketplace, importCampaign, trustReview };
}

const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'op-session' });
const buyerActor = Object.freeze({ actor_user_id: 'buyer-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });
const trustActor = Object.freeze({ actor_user_id: 'trust-1', actor_role: 'trust_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'trust-session' });

test('Phase E read endpoints are registered on the referral router', () => {
  for (const marker of [
    "router.get('/codes'",
    "router.get('/coupons'",
    "router.get('/local-marketplace/leads'",
    "router.get('/import-campaigns/routes'",
    "router.get('/trust/disputes'",
  ]) {
    assert.equal(routeFile.includes(marker), true, `${marker} should be registered`);
  }
});

test('listCodes is tenant-scoped, paginated, limit-clamped, and curated', async () => {
  const { referralService } = createStack();
  for (const code of ['CODEA', 'CODEB', 'CODEC']) {
    await referralService.createReferralCode({ code, code_type: 'MEMBER', tenant_id: 'tenant-1' }, operatorActor);
  }
  await referralService.createReferralCode({ code: 'OTHERTENANT', code_type: 'MEMBER', tenant_id: 'tenant-2' }, operatorActor);

  const t1 = await referralService.listCodes({ tenant_id: 'tenant-1' });
  assert.equal(t1.codes.length, 3);
  assert.equal(t1.pagination.total, 3);
  // curated projection — no internal audit columns leaked
  assert.equal('updated_by' in t1.codes[0], false);
  assert.equal(typeof t1.codes[0].code, 'string');

  const t2 = await referralService.listCodes({ tenant_id: 'tenant-2' });
  assert.equal(t2.codes.length, 1);

  const clamped = await referralService.listCodes({ tenant_id: 'tenant-1', limit: 500 });
  assert.equal(clamped.pagination.limit, 100);

  const page1 = await referralService.listCodes({ tenant_id: 'tenant-1', limit: 2 });
  assert.equal(page1.codes.length, 2);
  assert.equal(page1.pagination.has_more, true);
  const page2 = await referralService.listCodes({ tenant_id: 'tenant-1', limit: 2, offset: 2 });
  assert.equal(page2.codes.length, 1);
  assert.equal(page2.pagination.has_more, false);
});

test('listCoupons filters by discount_type and is tenant-scoped', async () => {
  const { referralService } = createStack();
  await referralService.createCoupon({ code: 'PCT10', discount_type: 'PERCENT', discount_value: 10, tenant_id: 'tenant-1' }, operatorActor);
  await referralService.createCoupon({ code: 'FIX5', discount_type: 'FIXED', discount_value: 5, tenant_id: 'tenant-1' }, operatorActor);

  const all = await referralService.listCoupons({ tenant_id: 'tenant-1' });
  assert.equal(all.coupons.length, 2);
  const pct = await referralService.listCoupons({ tenant_id: 'tenant-1', discount_type: 'PERCENT' });
  assert.equal(pct.coupons.length, 1);
  assert.equal(pct.coupons[0].discount_type, 'PERCENT');
});

test('listLeads normalizes real lead events and never leaks contact/consent PII', async () => {
  const { localMarketplace } = createStack();
  await localMarketplace.createLead({ make: 'Toyota', model: 'Aqua', message: 'I want to buy a Toyota Aqua', contact: { phone: '263771000000' }, consent: { marketing: true } }, buyerActor);

  const res = await localMarketplace.listLeads({ tenant_id: 'tenant-1' });
  assert.equal(res.leads.length, 1);
  const lead = res.leads[0];
  assert.equal(typeof lead.lead_event_id, 'string');
  assert.equal('contact' in lead, false);
  assert.equal('consent' in lead, false);
  assert.ok(res.pagination);
  // tenant isolation
  const other = await localMarketplace.listLeads({ tenant_id: 'tenant-2' });
  assert.equal(other.leads.length, 0);
});

test('listRoutes derives capacity status from real capacity data', async () => {
  const { importCampaign } = createStack();
  await importCampaign.createRoutePage({ route_origin: 'Japan', route_destination: 'Zimbabwe', flow_type: 'container_space', total_capacity_units: 10, booked_capacity_units: 10 }, operatorActor);
  await importCampaign.createRoutePage({ route_origin: 'UK', route_destination: 'Zimbabwe', flow_type: 'vehicle_import', total_capacity_units: 5, booked_capacity_units: 0 }, operatorActor);

  const res = await importCampaign.listRoutes({ tenant_id: 'tenant-1' });
  assert.equal(res.routes.length, 2);
  const statuses = res.routes.map((r) => r.capacity_status).sort();
  assert.deepEqual(statuses, ['full', 'open']);
  const full = res.routes.find((r) => r.capacity_status === 'full');
  assert.equal(full.available_capacity_units, 0);
});

test('listDisputes normalizes real dispute events and filters by status', async () => {
  const { trustReview } = createStack();
  await trustReview.createDispute({ target_id: 'subject-1', target_type: 'wallet_transaction', reason: 'benefit looks wrong' }, trustActor);

  const res = await trustReview.listDisputes({ tenant_id: 'tenant-1' });
  assert.equal(res.disputes.length, 1);
  const dispute = res.disputes[0];
  assert.equal(typeof dispute.dispute_event_id, 'string');
  assert.equal(dispute.status, 'open');
  assert.equal(dispute.target_id, 'subject-1');

  const open = await trustReview.listDisputes({ tenant_id: 'tenant-1', status: 'open' });
  assert.equal(open.disputes.length, 1);
  const resolved = await trustReview.listDisputes({ tenant_id: 'tenant-1', status: 'resolved_upheld' });
  assert.equal(resolved.disputes.length, 0);
});
