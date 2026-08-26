// End-to-end stack test for the CarUp Referral Engine (phases 1-7).
//
// These flows exercise the production service wiring (hardened/benchmark
// subclasses, the same ones the HTTP router instantiates) against an in-memory
// repository, so the full attribution -> reward -> trust -> audit chain is
// verified deterministically without a live Supabase. It complements the
// per-phase unit tests and the route-level smoke test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService, AGENT_TOOL_NAMES } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../services/referral/referralChannelGatewayService.js';
import { ReferralLocalMarketplaceHardenedService } from '../services/referral/referralLocalMarketplaceHardenedService.js';
import { ReferralImportCampaignBenchmarkService } from '../services/referral/referralImportCampaignBenchmarkService.js';
import { ReferralMarketingSeoBenchmarkService } from '../services/referral/referralMarketingSeoBenchmarkService.js';
import { ReferralTrustReviewBenchmarkService } from '../services/referral/referralTrustReviewBenchmarkService.js';
import { LOCAL_MARKETPLACE_EVENT_TYPES } from '../services/referral/referralLocalMarketplaceService.js';
import { TRUST_EVENT_TYPES } from '../services/referral/referralTrustReviewService.js';
import { MARKETING_ASSET_TYPES } from '../services/referral/referralMarketingSeoService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CAMPAIGN_TYPES, REFERRAL_CODE_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

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

function createStack() {
  const now = () => new Date('2026-06-12T00:00:00.000Z');
  const shareOptions = { baseUrl: 'https://staging.carup.dev', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' };
  const repository = new MemoryReferralRepository();
  const referralService = new ReferralEngineService({ repository, now, shareOptions });
  const agentGateway = new ReferralAgentGatewayService({ referralService, now, shareOptions });
  const channelGateway = new ReferralChannelGatewayService({ agentGateway, referralService, now });
  const localMarketplace = new ReferralLocalMarketplaceHardenedService({ referralService, channelGateway, now });
  const importCampaign = new ReferralImportCampaignBenchmarkService({ referralService, channelGateway, now });
  const marketingSeo = new ReferralMarketingSeoBenchmarkService({ referralService, now });
  const trustReview = new ReferralTrustReviewBenchmarkService({ referralService, now });
  return { repository, referralService, agentGateway, channelGateway, localMarketplace, importCampaign, marketingSeo, trustReview };
}

const operatorActor = Object.freeze({ actor_user_id: 'operator-1', actor_role: 'operator', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'operator-session' });
const routeAgentActor = Object.freeze({ actor_user_id: 'route-agent-1', actor_role: 'route_agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'route-agent-session' });
const buyerActor = Object.freeze({ actor_user_id: 'e2e-buyer', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'buyer-session' });
const channelActor = Object.freeze({ actor_user_id: 'channel-user-1', actor_role: 'agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web_chat', session_id: 'channel-session' });
const marketingActor = Object.freeze({ actor_user_id: 'marketing-1', actor_role: 'marketing_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'marketing-session' });
const memberActor = Object.freeze({ actor_user_id: 'random-member', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', gateway_trusted: false, surface: 'web', session_id: 'member-session' });
const trustActor = Object.freeze({ actor_user_id: 'trust-1', actor_role: 'trust_manager', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'admin', session_id: 'trust-session' });

/**
 * G12 reclassification: `base_url` was `https://carup.test` — an arbitrary external host — and these
 * tests asserted the generated public URL started with it. That encoded the defect G12 closed: a
 * caller-supplied host being published verbatim in a durable, forwardable marketing link.
 *
 * `resolveOutboundShareOrigin` now honours a supplied origin ONLY when it is already a canonical
 * CarUp origin, so the fixture uses the governed staging origin. Every other assertion here — kit
 * creation, SEO/UTM structure, canonical tag, internal links, disclosure — is unchanged, and the
 * rejection of a non-canonical host is proven in email-experience-public-prerequisites.test.js.
 */

test('Flow A: local marketplace referral chain preserves attribution, blocks self-referral and duplicate rewards', async () => {
  const { repository, referralService, channelGateway, localMarketplace } = createStack();

  // 1-3. Operator creates campaign + code + share assets in one bundle.
  const bundle = await localMarketplace.createReferralBundle({
    flow_type: 'buy_vehicle', participant_type: 'buyer', owner_user_id: 'e2e-ambassador',
    campaign_name: 'E2E Harare buyer campaign', code: 'e2e-local-001', channel: 'web_chat',
  }, operatorActor);
  assert.equal(bundle.success, true);
  assert.equal(bundle.code.code, 'E2E-LOCAL-001');
  assert.ok(bundle.shareAsset, 'share assets should be generated');

  // 4-5. Inbound web-chat carrying the code routes through the channel gateway and attaches attribution.
  const inbound = await channelGateway.processInbound('web_chat', { message: 'Hi, please use code e2e-local-001 to help me buy a Toyota Aqua', sender_id: 'web-buyer-1', session_id: 'web-thread-1' }, channelActor);
  assert.equal(inbound.extracted_referral_code, 'E2E-LOCAL-001');
  assert.equal(inbound.attribution.campaign_id, bundle.campaign.id);

  // 6. Lead creation preserves attribution.
  const lead = await localMarketplace.createLead({
    flow_type: 'buy_vehicle', referral_code: bundle.code.code, estimated_order_amount: 500,
    make: 'Toyota', model: 'Aqua', channel: 'web', session_id: 'lead-session-1', contact: { user_id: 'e2e-buyer' }, consent: { opted_in: true },
  }, buyerActor);
  assert.equal(lead.lead.status, 'attributed');
  assert.equal(lead.attribution.owner_user_id, 'e2e-ambassador');

  // 7-8. Qualifying a rewardable milestone creates only a pending wallet benefit.
  const qualified = await localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', order_amount: 1000, referred_user_id: 'e2e-buyer' }, operatorActor);
  assert.equal(qualified.reward_created, true);
  assert.equal(qualified.reward.status, WALLET_TRANSACTION_STATUSES.PENDING);
  const wallet = await referralService.getWallet('e2e-ambassador');
  assert.equal(wallet.wallet.pending_balance, 5);
  assert.equal(wallet.wallet.approved_balance, 0);

  // 10. Duplicate reward for the same lead + milestone is blocked.
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: lead.event_id, milestone: 'order_paid', referred_user_id: 'e2e-buyer' }, operatorActor), ValidationError);

  // 9. Self-referral cannot create reward eligibility.
  const selfBundle = await localMarketplace.createReferralBundle({ flow_type: 'sell_vehicle', participant_type: 'seller', owner_user_id: 'e2e-self', code: 'e2e-local-self' }, { ...operatorActor, actor_user_id: 'e2e-self' });
  const selfLead = await localMarketplace.createLead({ flow_type: 'sell_vehicle', referral_code: selfBundle.code.code, session_id: 'self-lead-1', contact: { user_id: 'e2e-self' } }, buyerActor);
  await assert.rejects(() => localMarketplace.qualifyLead({ lead_event_id: selfLead.event_id, milestone: 'listing_paid', referred_user_id: 'e2e-self' }, { ...operatorActor, actor_user_id: 'e2e-self' }), ForbiddenError);

  // 11. The admin event trail contains the full chain.
  const timeline = await referralService.getAdminTimeline({});
  const types = new Set(timeline.map((event) => event.event_type));
  for (const expected of [
    LOCAL_MARKETPLACE_EVENT_TYPES.REFERRAL_BUNDLE_CREATED,
    LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED,
    LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_QUALIFIED,
    LOCAL_MARKETPLACE_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED,
  ]) assert.equal(types.has(expected), true, `${expected} should be in admin trail`);

  // Exactly one rewardable wallet transaction was created (no duplicate / self-referral leak).
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 1);
});

test('Flow B: import/container-space referral enforces capacity, then trust hold/dispute/audit', async () => {
  const { referralService, importCampaign, trustReview } = createStack();

  // 1-2. Route page + capacity update.
  await importCampaign.createRoutePage({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', total_cbm: 10, booked_cbm: 2 }, routeAgentActor);
  // 3. Container-space referral bundle.
  const bundle = await importCampaign.createReferralBundle({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: 'import-ambassador', code: 'e2e-import-001' }, routeAgentActor);
  await importCampaign.updateCapacity({ route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', total_cbm: 10, booked_cbm: 6 }, routeAgentActor);

  // 4. Channel share kit.
  const shareKit = await importCampaign.prepareShareKit({ code: bundle.code.code, channel: 'telegram', route_key: 'japan-zimbabwe-container-space', flow_type: 'container_space', campaign_name: 'Japan to Zimbabwe container space' }, routeAgentActor);
  assert.equal(shareKit.success, true);

  // 5. Lead within available capacity (10 total, 6 booked -> 4 available, request 3).
  const lead = await importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', referral_code: bundle.code.code, requested_cbm: 3, session_id: 'import-lead-1', contact: { user_id: 'import-buyer' } }, buyerActor);
  assert.equal(lead.success, true);

  // 6. Over-capacity lead is rejected before side effects (request 5 > 4 available).
  await assert.rejects(() => importCampaign.createLead({ flow_type: 'container_space', route_origin: 'Japan', route_destination: 'Zimbabwe', referral_code: bundle.code.code, requested_cbm: 5, session_id: 'import-over-1' }, buyerActor), ValidationError);

  // 7-8. Qualify a commercial milestone -> pending wallet benefit.
  const qualified = await importCampaign.qualifyMilestone({ lead_event_id: lead.event_id, milestone: 'container_space_paid', referred_user_id: 'import-buyer' }, routeAgentActor);
  assert.equal(qualified.reward_created, true);
  assert.equal(qualified.reward.status, WALLET_TRANSACTION_STATUSES.PENDING);
  const transactionId = qualified.reward.id;

  // 9-10. Risk check + human review case.
  const risk = await trustReview.runRiskCheck({ wallet_transaction_id: transactionId, duplicate_account: true }, trustActor);
  const reviewCase = await trustReview.createReviewCase({ risk_check_event_id: risk.risk_check.id, wallet_transaction_id: transactionId, reason: 'Duplicate account signal needs review.' }, trustActor);
  assert.equal(reviewCase.success, true);

  // 11. Apply a wallet hold (only trust operators can).
  const hold = await trustReview.applyWalletHold(transactionId, { reason: 'Hold pending duplicate-account review.', review_case_event_id: reviewCase.review_case.id }, trustActor);
  assert.equal(hold.transaction.status, WALLET_TRANSACTION_STATUSES.HELD);

  // 12. Owner can read their own benefit explanation; an unrelated member cannot.
  const ownerActor = { actor_user_id: 'import-ambassador', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'user', surface: 'web', session_id: 'owner-session' };
  const explanation = await trustReview.explainBenefitStatus(transactionId, ownerActor);
  assert.equal(explanation.status, WALLET_TRANSACTION_STATUSES.HELD);
  await assert.rejects(() => trustReview.explainBenefitStatus(transactionId, memberActor), ForbiddenError);

  // 13-14. Dispute open + resolution (owner opens, trust resolves).
  const dispute = await trustReview.createDispute({ wallet_transaction_id: transactionId, reason: 'I completed a real container booking.' }, ownerActor);
  const resolved = await trustReview.resolveDispute(dispute.dispute.id, { status: 'resolved_upheld', reason: 'Booking evidence confirmed.' }, trustActor);
  assert.equal(resolved.dispute.metadata.status, 'resolved_upheld');

  // 15. Audit export returns a checksum, records itself, and enforces a sane limit.
  const audit = await trustReview.exportAuditTrail({ limit: 100 }, trustActor);
  assert.equal(typeof audit.export.checksum, 'string');
  assert.equal(audit.export.count >= 2, true);
  await assert.rejects(() => trustReview.exportAuditTrail({ limit: 5000 }, trustActor), ValidationError);
});

test('Flow C: AI marketing kit is review-safe and disclosure/attribution cannot be stripped', async () => {
  const { referralService, marketingSeo } = createStack();
  const campaign = await referralService.createCampaign({
    name: 'E2E Japan to Zimbabwe Container Space', slug: 'e2e-japan-zimbabwe-container-space',
    campaign_type: REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE, priority_scope: 'IMPORT', route_origin: 'Japan', route_destination: 'Zimbabwe', category: 'container_space', status: 'ACTIVE',
    metadata: { route_key: 'e2e-japan-zimbabwe-container-space' },
  }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'ambassador-1', code: 'e2e-market-001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);

  // 1-2. Campaign kit -> stored draft assets with SEO, UTM, canonical, internal links, disclosure.
  const kit = await marketingSeo.createCampaignKit({ campaign_id: campaign.id, referral_code: code.code, base_url: 'https://staging.carup.dev' }, marketingActor);
  assert.equal(kit.assets.length >= 8, true);
  const landing = kit.assets.find((asset) => asset.asset_type === MARKETING_ASSET_TYPES.CORRIDOR_LANDING_PAGE);
  assert.equal(landing.seo.canonical_url.startsWith('https://staging.carup.dev/'), true);
  assert.equal(landing.seo.tracked_url.includes('utm_campaign='), true);
  assert.equal(landing.seo.internal_links.includes('/referrals'), true);
  assert.equal(landing.disclosure.includes('promoter or referrer may receive a benefit'), true);

  // 3. Channel copy for WhatsApp/Telegram/Facebook/Instagram, each carrying disclosure.
  const channelMessages = await marketingSeo.draftChannelMessages({ campaign_id: campaign.id, channels: ['whatsapp', 'telegram', 'facebook', 'instagram'], call_to_action: 'Reserve your space today.' }, marketingActor);
  assert.deepEqual(channelMessages.assets.map((asset) => asset.asset_type).sort(), ['facebook_caption', 'instagram_caption', 'telegram_post', 'whatsapp_message']);
  assert.equal(channelMessages.assets.every((asset) => asset.body.message.includes('Disclosure:')), true);

  // 4. Approve -> schedule -> publish as a marketing manager.
  const draft = await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'https://staging.carup.dev' }, marketingActor);
  await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'approved', reason: 'copy verified' }, marketingActor);
  await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'scheduled', scheduled_at: '2026-07-01T09:00:00.000Z' }, marketingActor);
  const published = await marketingSeo.transitionAssetStatus(draft.asset.id, { status: 'published' }, marketingActor);
  assert.equal(published.asset.metadata.status, 'published');
  assert.equal(published.asset.metadata.public_url.includes('utm_campaign='), true);

  // 5. A non-marketing actor cannot publish.
  const draft2 = await marketingSeo.draftSeoPage({ campaign_id: campaign.id, asset_type: 'corridor_landing_page', base_url: 'https://staging.carup.dev' }, marketingActor);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft2.asset.id, { status: 'published' }, memberActor), ForbiddenError);

  // 6. Unsafe patches cannot replace status / SEO attribution or remove disclosure.
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft2.asset.id, { status: 'review', patch: { status: 'published' } }, marketingActor), ValidationError);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft2.asset.id, { status: 'review', patch: { seo: { attribution: {} } } }, marketingActor), ValidationError);
  await assert.rejects(() => marketingSeo.transitionAssetStatus(draft2.asset.id, { status: 'review', patch: { disclosure: '' } }, marketingActor), ValidationError);
});

test('Flow D: agent gateway is read/dry-run safe and exposes no wallet-mutation tools', async () => {
  const { referralService, agentGateway } = createStack();

  // 1. Tool catalog never exposes a wallet-mutation tool.
  const catalog = agentGateway.getToolCatalog(channelActor);
  const toolNames = catalog.map((tool) => tool.name);
  assert.equal(toolNames.length > 0, true);
  for (const safeTool of Object.values(AGENT_TOOL_NAMES)) assert.equal(toolNames.includes(safeTool), true);
  for (const forbidden of ['approve_wallet_reward', 'transition_wallet', 'create_wallet_transaction', 'mutate_wallet']) {
    assert.equal(toolNames.includes(forbidden), false, `${forbidden} must not be exposed`);
  }

  // 2. Triage classifies intent and suggests safe tools.
  const triage = await agentGateway.executeTool({ tool: 'triage', input: { message: 'I need a container campaign and share kit for Japan to Zimbabwe', channel: 'whatsapp' } }, channelActor);
  assert.equal(triage.success, true);
  assert.equal(triage.result.suggested_tools.includes(AGENT_TOOL_NAMES.GENERATE_SHARE_KIT), true);

  // 3. Validate code uses the same attribution path.
  const campaign = await referralService.createCampaign({ name: 'E2E Agent Campaign', status: 'ACTIVE' }, operatorActor);
  await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'seller-1', code: 'e2e-agent-001', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);
  const validation = await agentGateway.executeTool({ tool: 'validate_referral_code', input: { code: 'e2e-agent-001', channel: 'whatsapp', subject_id: 'lead-1' } }, channelActor);
  assert.equal(validation.result.valid, true);
  assert.equal(validation.result.attribution.campaign_id, campaign.id);

  // 4. Share-kit generation is dry-run by default (no persisted asset).
  const dryRun = await agentGateway.executeTool({ tool: 'generate_share_kit', input: { code: 'e2e-agent-001', channel: 'telegram' } }, channelActor);
  assert.equal(dryRun.result.persisted, false);

  // 5. A hidden persist flag smuggled through context cannot bypass operator permission.
  await assert.rejects(() => agentGateway.executeTool({ tool: 'draft_campaign', context: { persist: true }, input: { name: 'Hidden Persist Attempt' } }, { ...channelActor, actor_role: 'member' }), ForbiddenError);

  // 6. A wallet-mutation tool name fails as an unknown/forbidden tool.
  await assert.rejects(() => agentGateway.executeTool({ tool: 'approve_wallet_reward', input: { user_id: 'seller-1', amount: 100 } }, channelActor), ValidationError);
});
