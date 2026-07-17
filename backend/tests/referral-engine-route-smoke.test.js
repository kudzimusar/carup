// Route-level smoke verification for the CarUp Referral Engine router.
//
// Mounts the real Express router (createReferralRouter) with in-memory services
// and proves: (1) every documented route is registered, and (2) representative
// routes return the expected auth behaviour (public vs operator-protected vs
// webhook-secret-gated) over real HTTP rather than crashing. No live Supabase.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createReferralRouter } from '../routes/referralRoutes.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { ReferralImportCampaignBenchmarkService } from '../services/referral/referralImportCampaignBenchmarkService.js';
import { ReferralMarketingSeoBenchmarkService } from '../services/referral/referralMarketingSeoBenchmarkService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES } from '../constants/referral/referralConstants.js';

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

const operatorActor = { actor_user_id: 'smoke-operator', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', surface: 'web' };
const SECRETS = { CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'tg-smoke-secret', CARUP_CHANNEL_WEBHOOK_SECRET: 'chan-smoke-secret' };

let server;
let baseUrl;
let referralRouter;

before(async () => {
  for (const [key, value] of Object.entries(SECRETS)) process.env[key] = value;
  const now = () => new Date('2026-06-12T00:00:00.000Z');
  const shareOptions = { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' };
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now, shareOptions });
  const agentGateway = new ReferralAgentGatewayService({ referralService, now, shareOptions });
  const channelGateway = new ReferralChannelGatewayService({ agentGateway, referralService, now });
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, channelGateway, now });
  const importCampaign = new ReferralImportCampaignBenchmarkService({ referralService, channelGateway, now });
  const marketingSeo = new ReferralMarketingSeoBenchmarkService({ referralService, now });
  const trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now });
  referralRouter = createReferralRouter({ service: referralService, agentGateway, channelGateway, localMarketplace, importCampaign, marketingSeo, trustReview });

  const app = express();
  app.use(express.json());
  app.use('/api/referrals', referralRouter);
  app.use((err, req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));

  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Seed a valid public code so the public validate route returns 200.
  const campaign = await referralService.createCampaign({ name: 'Smoke Campaign', status: 'ACTIVE' }, operatorActor);
  await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'smoke-owner', code: 'smoke-001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'web' }, operatorActor);
});

after(() => {
  server?.close();
  for (const key of Object.keys(SECRETS)) delete process.env[key];
});

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const DOCUMENTED_ROUTES = [
  'POST /campaigns', 'GET /campaigns', 'PATCH /campaigns/:id', 'POST /codes', 'POST /validate',
  'GET /codes/:code', 'POST /events', 'POST /share-assets', 'POST /coupons', 'POST /coupons/apply',
  'POST /coupons/redeem', 'GET /wallets/:userId', 'POST /wallets/transactions',
  'PATCH /wallets/transactions/:id/status', 'GET /admin/events',
  'GET /agent/tools', 'POST /agent/triage', 'POST /agent/execute',
  'POST /channels/:channel/inbound', 'POST /channels/:channel/share-kit',
  'GET /channels/whatsapp/webhook', 'GET /channels/facebook/webhook', 'GET /channels/instagram/webhook',
  'POST /channels/whatsapp/webhook', 'POST /channels/telegram/webhook', 'POST /channels/facebook/webhook',
  'POST /channels/instagram/webhook', 'POST /channels/web-chat/message', 'POST /channels/mobile-chat/message',
  'GET /local-marketplace/rules', 'POST /local-marketplace/intent', 'POST /local-marketplace/leads',
  'POST /local-marketplace/referral-bundles', 'POST /local-marketplace/leads/:leadEventId/qualify',
  'POST /local-marketplace/share-kit',
  'GET /import-campaigns/rules', 'POST /import-campaigns/routes', 'GET /import-campaigns/routes/:routeKey/status',
  'POST /import-campaigns/routes/:routeKey/capacity', 'POST /import-campaigns/referral-bundles',
  'POST /import-campaigns/leads', 'POST /import-campaigns/leads/:leadEventId/qualify', 'POST /import-campaigns/share-kit',
  'GET /marketing/rules', 'POST /marketing/campaign-kits', 'POST /marketing/seo-pages', 'POST /marketing/channel-messages',
  'POST /marketing/proof-stories', 'POST /marketing/faqs', 'GET /marketing/assets',
  'PATCH /marketing/assets/:assetId/status', 'POST /marketing/analytics/suggestions',
  'GET /trust/rules', 'POST /trust/risk-checks', 'POST /trust/review-cases', 'GET /trust/review-cases',
  'PATCH /trust/review-cases/:caseEventId/decision', 'POST /trust/wallet-transactions/:transactionId/hold',
  'GET /trust/benefits/:transactionId/explain', 'POST /trust/disputes', 'PATCH /trust/disputes/:disputeEventId/resolve',
  'GET /trust/audit-export',
  // Phase E additive read/list endpoints
  'GET /codes', 'GET /coupons', 'GET /local-marketplace/leads', 'GET /import-campaigns/routes', 'GET /trust/disputes',
  // Stage-4 remediation B: owner-scoped dispute read
  'GET /trust/disputes/mine',
];

test('every documented referral route is registered on the mounted router', () => {
  const registered = new Set();
  for (const layer of referralRouter.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (layer.route.methods[method]) registered.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  const missing = DOCUMENTED_ROUTES.filter((route) => !registered.has(route));
  assert.deepEqual(missing, [], `missing routes: ${missing.join(', ')}`);
});

test('operator-protected route rejects unauthenticated requests with 401', async () => {
  const res = await call('POST', '/api/referrals/campaigns', { body: { name: 'Should not be created' } });
  assert.equal(res.status, 401);
});

test('admin-only timeline rejects unauthenticated requests with 401', async () => {
  const res = await call('GET', '/api/referrals/admin/events');
  assert.equal(res.status, 401);
});

test('Phase E list endpoints reject unauthenticated requests with 401', async () => {
  for (const path of ['/api/referrals/codes', '/api/referrals/coupons', '/api/referrals/local-marketplace/leads', '/api/referrals/import-campaigns/routes', '/api/referrals/trust/disputes']) {
    const res = await call('GET', path);
    assert.equal(res.status, 401, `${path} should require auth`);
  }
});

test('public rule catalogs are reachable without auth', async () => {
  for (const path of ['/api/referrals/local-marketplace/rules', '/api/referrals/import-campaigns/rules', '/api/referrals/marketing/rules']) {
    const res = await call('GET', path);
    assert.equal(res.status, 200, `${path} should be public`);
  }
});

test('public code validation returns 200 for a valid seeded code', async () => {
  const res = await call('POST', '/api/referrals/validate', { body: { code: 'smoke-001', channel: 'web' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.valid, true);
});

test('telegram webhook without a secret is rejected with 403', async () => {
  const res = await call('POST', '/api/referrals/channels/telegram/webhook', { body: { update_id: 1, message: { message_id: 1, text: 'hi', from: { id: 'u' }, chat: { id: 'c' } } } });
  assert.equal(res.status, 403);
});

test('telegram webhook with a valid secret token is accepted', async () => {
  const res = await call('POST', '/api/referrals/channels/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': SECRETS.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN },
    body: { update_id: 2, message: { message_id: 2, text: 'hello', from: { id: 'u2' }, chat: { id: 'c2' } } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
});

test('unknown channel inbound is safely rejected with 400 rather than crashing', async () => {
  const res = await call('POST', '/api/referrals/channels/fax/inbound', { headers: { 'x-carup-channel-secret': SECRETS.CARUP_CHANNEL_WEBHOOK_SECRET }, body: { message: 'hello' } });
  assert.equal(res.status, 400);
});
