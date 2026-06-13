import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import {
  MARKETING_ASSET_STATUSES,
  MARKETING_ASSET_TYPES,
  MARKETING_EVENT_TYPES,
  ReferralMarketingSeoService,
} from '../services/referral/referralMarketingSeoService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CAMPAIGN_TYPES, REFERRAL_CODE_TYPES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const roadmapFile = readFileSync(new URL('../../docs/referral-ai-engine/12_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md', import.meta.url), 'utf8');
const trdFile = readFileSync(new URL('../../docs/referral-ai-engine/09_AI_MARKETING_SEO_AUTOMATION_TRD.md', import.meta.url), 'utf8');
const aiLayerFile = readFileSync(new URL('../../docs/referral-ai-engine/07_AI_LAYER_TRD.md', import.meta.url), 'utf8');
const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const serviceFile = readFileSync(new URL('../services/referral/referralMarketingSeoService.js', import.meta.url), 'utf8');

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
  const marketingSeo = new ReferralMarketingSeoService({ referralService, now: () => new Date('2026-06-12T00:00:00.000Z') });
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
  }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'ambassador-1', code: 'phase6-market-001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);
  return { campaign, code };
}

const operatorActor = Object.freeze({ actor_user_id: 'marketing-operator-1', actor_role: 'marketing_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'marketing-session' });
const memberActor = Object.freeze({ actor_user_id: 'member-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'member-session' });

test('Phase 6 docs, routes, and service cover AI marketing and SEO requirements', () => {
  assert.equal(roadmapFile.includes('Generate campaign pages, share kits, proof stories, FAQ drafts, and channel messages from campaign data.'), true);
  assert.equal(trdFile.includes('Corridor landing page'), true);
  assert.equal(trdFile.includes('Published pages and links preserve campaign attribution'), true);
  assert.equal(aiLayerFile.includes('Campaign: draft campaign assets and share kits'), true);
  for (const marker of [
    "router.get('/marketing/rules'",
    "router.post('/marketing/campaign-kits'",
    "router.post('/marketing/seo-pages'",
    "router.post('/marketing/channel-messages'",
    "router.post('/marketing/proof-stories'",
    "router.post('/marketing/faqs'",
    "router.get('/marketing/assets'",
    "router.patch('/marketing/assets/:assetId/status'",
    "router.post('/marketing/analytics/suggestions'",
    // The router wires the benchmark subclass (which extends ReferralMarketingSeoService).
    'ReferralMarketingSeoBenchmarkService',
  ]) assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
});

test('rule catalog exposes required content objects, SEO metadata, disclosure, and review workflow', () => {
  const { marketingSeo } = createHarness();
  const rules = marketingSeo.getRuleCatalog();
  for (const assetType of ['corridor_landing_page', 'local_city_page', 'vehicle_import_page', 'parts_request_page', 'container_campaign_page', 'ambassador_share_kit', 'proof_story', 'faq_page', 'whatsapp_message', 'telegram_post', 'facebook_caption', 'instagram_caption']) {
    assert.equal(rules.asset_types.includes(assetType), true);
  }
  for (const field of ['clean_url', 'canonical_url', 'canonical_tag', 'structured_metadata', 'internal_links', 'utm']) assert.equal(rules.required_seo.includes(field), true);
  assert.equal(rules.required_disclosure.includes('promoter or referrer may receive a benefit'), true);
  assert.equal(rules.safety.publication, 'stored_before_publication');
  assert.equal(serviceFile.includes('DISCLOSURE'), true);
});

test('campaign kit creates stored draft assets with SEO, UTM, canonical, internal links, and disclosure', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const { campaign, code } = await seedCampaign(referralService);
  const kit = await marketingSeo.createCampaignKit({ campaign_id: campaign.id, referral_code: code.code, base_url: 'https://carup.test' }, operatorActor);
  assert.equal(kit.success, true);
  assert.equal(kit.assets.length >= 8, true);
  assert.equal(kit.assets.every((asset) => asset.status === MARKETING_ASSET_STATUSES.DRAFT), true);
  const landing = kit.assets.find((asset) => asset.asset_type === MARKETING_ASSET_TYPES.CORRIDOR_LANDING_PAGE);
  assert.equal(landing.seo.canonical_url.startsWith('https://carup.test/'), true);
  assert.equal(landing.seo.canonical_tag.includes('rel="canonical"'), true);
  assert.equal(landing.seo.tracked_url.includes('utm_campaign='), true);
  assert.equal(landing.seo.internal_links.includes('/referrals'), true);
  assert.equal(landing.disclosure.includes('promoter or referrer may receive a benefit'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === MARKETING_EVENT_TYPES.KIT_CREATED), true);
  assert.equal(events.filter((event) => event.event_type === MARKETING_EVENT_TYPES.ASSET_DRAFTED).length, kit.assets.length);
});

test('SEO page draft can be generated from referral code context and preserves attribution', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { code } = await seedCampaign(referralService);
  const response = await marketingSeo.draftSeoPage({ referral_code: code.code, asset_type: 'container_campaign_page', base_url: 'https://carup.test' }, operatorActor);
  assert.equal(response.success, true);
  assert.equal(response.asset.seo.attribution.referral_code, 'PHASE6-MARKET-001');
  assert.equal(response.asset.seo.clean_url.includes('/referrals/import/container-space/'), true);
  assert.equal(response.asset.review.requires_human_review, true);
});

test('channel message drafts include WhatsApp, Telegram, Facebook, Instagram variants and disclosure', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const response = await marketingSeo.draftChannelMessages({ campaign_id: campaign.id, channels: ['whatsapp', 'telegram', 'facebook', 'instagram'], call_to_action: 'Reserve your space today.' }, operatorActor);
  assert.equal(response.success, true);
  assert.deepEqual(response.assets.map((asset) => asset.asset_type).sort(), ['facebook_caption', 'instagram_caption', 'telegram_post', 'whatsapp_message']);
  assert.equal(response.assets.every((asset) => asset.body.message.includes('Disclosure:')), true);
  assert.equal(response.assets.every((asset) => asset.seo.utm.utm_medium === 'social'), true);
});

test('proof story and FAQ drafts are review-safe and evidence-driven', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const proof = await marketingSeo.draftProofStory({ campaign_id: campaign.id }, operatorActor);
  const faq = await marketingSeo.draftFaq({ campaign_id: campaign.id }, operatorActor);
  assert.equal(proof.asset.body.evidence_required.includes('operator confirmation'), true);
  assert.equal(faq.asset.body.questions.length >= 4, true);
  assert.equal(proof.asset.review.requires_human_review, true);
  assert.equal(faq.asset.seo.structured_metadata['@type'], 'WebPage');
});

test('asset status workflow enforces approval, scheduling, publication, and attribution-preserving links', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const draft = await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'https://carup.test' }, operatorActor);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'published' }, memberActor), ForbiddenError);
  const approved = await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'approved', reason: 'copy verified' }, operatorActor);
  assert.equal(approved.asset.metadata.status, 'approved');
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'scheduled' }, operatorActor), ValidationError);
  const scheduled = await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'scheduled', scheduled_at: '2026-07-01T09:00:00.000Z' }, operatorActor);
  assert.equal(scheduled.asset.metadata.scheduled_at, '2026-07-01T09:00:00.000Z');
  const published = await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'published' }, operatorActor);
  assert.equal(published.asset.metadata.status, 'published');
  assert.equal(published.asset.metadata.public_url.includes('utm_campaign='), true);
  const statusEvents = (await repository.list(REFERRAL_TABLES.events)).filter((event) => event.event_type === MARKETING_EVENT_TYPES.STATUS_CHANGED);
  assert.equal(statusEvents.length, 3);
});

test('asset listing filters by campaign, status, and type', async () => {
  const { referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page' }, operatorActor);
  await marketingSeo.draftFaq({ campaign_id: campaign.id }, operatorActor);
  const drafts = await marketingSeo.listAssets({ campaign_id: campaign.id, status: 'draft' });
  assert.equal(drafts.length, 2);
  const faqOnly = await marketingSeo.listAssets({ campaign_id: campaign.id, asset_type: 'faq_page' });
  assert.equal(faqOnly.length, 1);
});

test('analytics suggestions are generated and stored for operator review', async () => {
  const { repository, referralService, marketingSeo } = createHarness();
  const { campaign } = await seedCampaign(referralService);
  const response = await marketingSeo.createAnalyticsSuggestion({ campaign_id: campaign.id, metrics: { views: 1000, clicks: 10, lead_starts: 0, verified_milestones: 0 } }, operatorActor);
  assert.equal(response.success, true);
  assert.equal(response.suggestion.suggestions.some((item) => item.includes('click-through')), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === MARKETING_EVENT_TYPES.ANALYTICS_SUGGESTION_CREATED), true);
});

test('non-operator users cannot draft marketing assets or analytics suggestions', async () => {
  const { marketingSeo } = createHarness();
  await assert.rejects(() => marketingSeo.draftSeoPage({ asset_type: 'corridor_landing_page' }, memberActor), ForbiddenError);
  await assert.rejects(() => marketingSeo.createAnalyticsSuggestion({ metrics: {} }, memberActor), ForbiddenError);
});
