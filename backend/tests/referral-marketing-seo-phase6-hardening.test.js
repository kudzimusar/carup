import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import {
  MARKETING_ASSET_TYPES,
  MARKETING_EVENT_TYPES,
} from '../services/referral/referralMarketingSeoService.js';
import { ReferralMarketingSeoBenchmarkService } from '../services/referral/referralMarketingSeoBenchmarkService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CAMPAIGN_TYPES, REFERRAL_CODE_TYPES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const benchmarkServiceFile = readFileSync(new URL('../services/referral/referralMarketingSeoBenchmarkService.js', import.meta.url), 'utf8');

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
  const marketingSeo = new ReferralMarketingSeoBenchmarkService({ referralService, now: () => new Date('2026-06-12T00:00:00.000Z') });
  return { repository, referralService, marketingSeo };
}

async function seedCampaign(referralService) {
  const campaign = await referralService.createCampaign({
    name: 'Japan to Zimbabwe Container Space',
    slug: 'japan-zimbabwe-container-space',
    campaign_type: REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE,
    priority_scope: 'IMPORT',
    route_origin: 'Japan',
    route_destination: 'Zimbabwe',
    category: 'container_space',
    status: 'ACTIVE',
    metadata: { route_key: 'japan-zimbabwe-container-space', campaign_name: 'Japan to Zimbabwe Container Space' },
  }, publisherActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'ambassador-1', code: 'phase6-hardening-001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, publisherActor);
  return { campaign, code };
}

const publisherActor = Object.freeze({ actor_user_id: 'marketing-publisher-1', actor_role: 'marketing_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: false, surface: 'web', session_id: 'publisher-session' });
const sellerActor = Object.freeze({ actor_user_id: 'seller-1', actor_role: 'seller', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'seller-session' });

test('Phase 6 routes use the benchmark marketing SEO service wrapper', () => {
  assert.equal(routeFile.includes('ReferralMarketingSeoBenchmarkService'), true);
  assert.equal(routeFile.includes('referralMarketingSeoBenchmarkService.js'), true);
  assert.equal(benchmarkServiceFile.includes('preserveAttribution'), true);
  assert.equal(benchmarkServiceFile.includes('assertValidBaseUrl'), true);
  assert.equal(benchmarkServiceFile.includes('Unsupported marketing channel'), true);
});

test('campaign kits preserve referral-code attribution when campaign_id and referral_code are both supplied', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign, code } = await seedCampaign(referralService);
  const kit = await marketingSeo.createCampaignKit({ campaign_id: campaign.id, referral_code: code.code, base_url: 'https://carup.test' }, publisherActor);
  assert.equal(kit.success, true);
  assert.equal(kit.assets.every((asset) => asset.seo.attribution.referral_code === 'PHASE6-HARDENING-001'), true);
  assert.equal(kit.assets.every((asset) => asset.seo.attribution.code_id === code.id), true);
  assert.equal(kit.assets.every((asset) => asset.event.code_id === code.id), true);
});

test('mismatched campaign and referral code are rejected before marketing draft events', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const first = await seedCampaign(referralService);
  const secondCampaign = await referralService.createCampaign({ name: 'Other Campaign', slug: 'other-campaign', campaign_type: REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE, priority_scope: 'LOCAL', status: 'ACTIVE' }, publisherActor);
  await assert.rejects(() => marketingSeo.draftSeoPage({ campaign_id: secondCampaign.id, referral_code: first.code.code, asset_type: 'corridor_landing_page' }, publisherActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === MARKETING_EVENT_TYPES.ASSET_DRAFTED), false);
});

test('mixed-case social channel names normalize safely and unsupported channels are rejected', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const drafts = await marketingSeo.draftChannelMessages({ campaign_id: campaign.id, channels: ['WhatsApp', 'TELEGRAM', 'Facebook', 'instagram'] }, publisherActor);
  assert.deepEqual(drafts.assets.map((asset) => asset.asset_type).sort(), ['facebook_caption', 'instagram_caption', 'telegram_post', 'whatsapp_message']);
  await assert.rejects(() => marketingSeo.draftChannelMessages({ campaign_id: campaign.id, channels: ['TikTok'] }, publisherActor), ValidationError);
});

test('invalid base URLs are rejected before asset draft side effects', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  await assert.rejects(() => marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'javascript:alert(1)' }, publisherActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === MARKETING_EVENT_TYPES.ASSET_DRAFTED), false);
});

test('only marketing publisher roles can approve, schedule, or publish assets', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const draft = await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'https://carup.test' }, publisherActor);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'approved' }, sellerActor), ForbiddenError);
  const approved = await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'approved' }, publisherActor);
  assert.equal(approved.asset.metadata.status, 'approved');
});

test('unsafe patches cannot replace status, SEO attribution, or remove disclosure', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const draft = await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'https://carup.test' }, publisherActor);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'review', patch: { status: 'published' } }, publisherActor), ValidationError);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'review', patch: { seo: { attribution: {} } } }, publisherActor), ValidationError);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'review', patch: { disclosure: '' } }, publisherActor), ValidationError);
});

test('negative analytics metrics are rejected before analytics suggestion side effects', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  await assert.rejects(() => marketingSeo.createAnalyticsSuggestion({ campaign_id: campaign.id, metrics: { views: -1 } }, publisherActor), ValidationError);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === MARKETING_EVENT_TYPES.ANALYTICS_SUGGESTION_CREATED), false);
});
