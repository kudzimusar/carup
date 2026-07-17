import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralAgentGatewayService, AGENT_GATEWAY_EVENT_TYPES, AGENT_TOOL_NAMES } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES, WALLET_TRANSACTION_STATUSES } from '../constants/referral/referralConstants.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const gatewayFile = readFileSync(new URL('../services/referral/referralAgentGatewayServiceSafe.js', import.meta.url), 'utf8');

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
  const gateway = new ReferralAgentGatewayService({ referralService, now: () => new Date('2026-06-12T00:00:00.000Z'), shareOptions: { baseUrl: 'https://carup.test', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' } });
  return { repository, referralService, gateway };
}

const agentActor = Object.freeze({ actor_user_id: 'agent-user-1', actor_role: 'agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'whatsapp', session_id: 'session-1' });
const buyerActor = Object.freeze({ actor_user_id: 'buyer-1', actor_role: 'member', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'mobile', session_id: 'session-buyer' });
const operatorActor = Object.freeze({ actor_user_id: 'seller-1', actor_role: 'seller', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'session-seller' });
const shareOverrideTampering = Object.freeze({
  baseUrl: 'https://carup.app',
  base_url: 'https://carup.app',
  publicAppUrl: 'https://carup.app',
  public_app_url: 'https://carup.app',
  PUBLIC_APP_URL: 'https://carup.app',
  VITE_PUBLIC_APP_URL: 'https://carup.app',
  CARUP_PUBLIC_BASE_URL: 'https://carup.app',
  CARUP_PUBLIC_APP_URL: 'https://carup.app',
  env: { PUBLIC_APP_URL: 'https://carup.app' },
});

test('Phase 2 routes expose a single secured agent gateway entrypoint', () => {
  for (const marker of ["router.get('/agent/tools'", "router.post('/agent/triage'", "router.post('/agent/execute'", 'CARUP_AGENT_GATEWAY_SECRET', 'isUserIdFallbackAllowed', 'referralAgentGatewayServiceSafe']) {
    assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
  }
});

test('gateway catalog exposes Phase 2 tools without wallet mutation tools', () => {
  const { gateway } = createHarness();
  const catalog = gateway.getToolCatalog(agentActor);
  const names = catalog.map((tool) => tool.name);
  for (const requiredTool of Object.values(AGENT_TOOL_NAMES)) assert.equal(names.includes(requiredTool), true, `${requiredTool} should be in catalog`);
  assert.equal(gatewayFile.includes('transitionWalletTransaction'), false);
  assert.equal(gatewayFile.includes('createWalletTransaction'), false);
});

test('triage classifies campaign/share requests and writes an agent audit trail', async () => {
  const { repository, gateway } = createHarness();
  const response = await gateway.executeTool({ tool: 'triage', input: { message: 'I need a container campaign and share kit for Japan to Zimbabwe', channel: 'whatsapp' } }, agentActor);
  assert.equal(response.success, true);
  assert.equal(response.result.intent, 'campaign_or_share');
  assert.equal(response.result.suggested_tools.includes(AGENT_TOOL_NAMES.GENERATE_SHARE_KIT), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === AGENT_GATEWAY_EVENT_TYPES.TRIAGE_COMPLETED), true);
  assert.equal(events.some((event) => event.event_type === AGENT_GATEWAY_EVENT_TYPES.TOOL_EXECUTED && event.actor_type === 'agent'), true);
});

test('agent validation uses the same referral engine attribution path', async () => {
  const { repository, referralService, gateway } = createHarness();
  const campaign = await referralService.createCampaign({ name: 'Harare Parts Agent Campaign', status: 'ACTIVE' }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'seller-1', code: 'phase2-hre-agent', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);
  const response = await gateway.executeTool({ tool: 'validate_referral_code', input: { code: 'phase2-hre-agent', channel: 'whatsapp', subject_id: 'lead-42' } }, agentActor);
  assert.equal(response.success, true);
  assert.equal(response.result.valid, true);
  assert.equal(response.result.attribution.campaign_id, campaign.id);
  assert.equal(response.result.next_actions.includes(AGENT_TOOL_NAMES.GENERATE_SHARE_KIT), true);
  const events = await repository.list(REFERRAL_TABLES.events, { code_id: code.id });
  assert.equal(events.some((event) => event.event_type === 'referral.code_validated' && event.actor_type === 'agent'), true);
});

test('campaign drafting is dry-run by default and context-level persist cannot bypass operator permission', async () => {
  const { repository, gateway } = createHarness();
  const dryRun = await gateway.executeTool({ tool: 'draft_campaign', input: { name: 'Japan Zimbabwe Container July', route_origin: 'Japan', route_destination: 'Zimbabwe' } }, buyerActor);
  assert.equal(dryRun.result.persisted, false);
  assert.equal(dryRun.result.draft.status, 'DRAFT');
  assert.equal((await repository.list(REFERRAL_TABLES.campaigns)).length, 0);

  await assert.rejects(() => gateway.executeTool({ tool: 'draft_campaign', context: { persist: true }, input: { name: 'Hidden Persist Attempt' } }, buyerActor), ForbiddenError);

  const persisted = await gateway.executeTool({ tool: 'draft_campaign', input: { persist: true, name: 'Seller Container Campaign', route_origin: 'Japan', route_destination: 'Zimbabwe' } }, operatorActor);
  assert.equal(persisted.result.persisted, true);
  assert.equal(persisted.result.campaign.status, 'DRAFT');
});

test('share-kit generation supports dry-run and operator-persisted assets', async () => {
  const { repository, referralService, gateway } = createHarness();
  await referralService.createReferralCode({ owner_user_id: 'seller-1', code: 'share-phase2-code', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'telegram' }, operatorActor);
  const dryRun = await gateway.executeTool({ tool: 'generate_share_kit', input: { code: 'share-phase2-code', channel: 'telegram' } }, agentActor);
  assert.equal(dryRun.result.persisted, false);
  assert.equal(dryRun.result.share_kit.short_referral_url.includes('/r/SHARE-PHASE2-CODE'), true);
  assert.equal((await repository.list(REFERRAL_TABLES.shareAssets)).length, 0);
  await assert.rejects(() => gateway.executeTool({ tool: 'generate_share_kit', input: { code: 'share-phase2-code', persist: true } }, buyerActor), ForbiddenError);
  const persisted = await gateway.executeTool({ tool: 'generate_share_kit', input: { code: 'share-phase2-code', persist: true } }, operatorActor);
  assert.equal(persisted.result.persisted, true);
  assert.equal((await repository.list(REFERRAL_TABLES.shareAssets)).length, 1);
});

test('share-kit generation ignores caller-supplied public origins in dry-run and persisted paths', async () => {
  const { repository, referralService, gateway } = createHarness();
  referralService.shareOptions = { baseUrl: 'https://carup-staging.vercel.app', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' };
  gateway.shareOptions = { baseUrl: 'https://carup-staging.vercel.app', whatsappNumber: '263771000000', telegramBot: 'CarUpBot' };
  await referralService.createReferralCode({ owner_user_id: 'seller-1', code: 'gateway-stage-safe', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'web' }, operatorActor);

  const dryRun = await gateway.executeTool({
    tool: 'generate_share_kit',
    input: { code: 'gateway-stage-safe', channel: 'web', options: shareOverrideTampering },
  }, agentActor);
  assert.equal(dryRun.result.persisted, false);
  assert.equal(dryRun.result.share_kit.short_referral_url, 'https://carup-staging.vercel.app/r/GATEWAY-STAGE-SAFE');
  assert.equal(dryRun.result.share_kit.short_referral_url.startsWith('https://carup.app/'), false);
  assert.equal(dryRun.result.share_kit.short_referral_url.startsWith('http://localhost'), false);

  const persisted = await gateway.executeTool({
    tool: 'generate_share_kit',
    input: { code: 'gateway-stage-safe', channel: 'web', persist: true, options: shareOverrideTampering },
  }, operatorActor);
  assert.equal(persisted.result.persisted, true);
  const shareAssets = await repository.list(REFERRAL_TABLES.shareAssets);
  assert.equal(shareAssets.length, 1);
  assert.equal(shareAssets[0].payload.short_referral_url, 'https://carup-staging.vercel.app/r/GATEWAY-STAGE-SAFE');
  assert.equal(shareAssets[0].payload.short_referral_url.startsWith('https://carup.app/'), false);
  assert.equal(shareAssets[0].payload.short_referral_url.startsWith('http://localhost'), false);
});

test('wallet explanation is read-only and scoped to self or admin', async () => {
  const { referralService, gateway } = createHarness();
  await referralService.createWalletTransaction({ user_id: 'buyer-1', amount: 12, source_event_type: 'order.paid', status: WALLET_TRANSACTION_STATUSES.PENDING }, operatorActor);
  const response = await gateway.executeTool({ tool: 'explain_wallet', input: { user_id: 'buyer-1' } }, buyerActor);
  assert.equal(response.result.balances.pending, 12);
  assert.equal(response.result.safety_note.includes('cannot approve'), true);
  await assert.rejects(() => gateway.executeTool({ tool: 'explain_wallet', input: { user_id: 'buyer-1' } }, { ...buyerActor, actor_user_id: 'another-user' }), ForbiddenError);
});

test('support handoff creates a reviewable event without creating a financial transaction', async () => {
  const { repository, gateway } = createHarness();
  const response = await gateway.executeTool({ tool: 'support_handoff', input: { message: 'The referral code failed on WhatsApp', user_id: 'buyer-1', channel: 'whatsapp', priority: 'normal' } }, buyerActor);
  assert.equal(response.result.handoff_opened, true);
  assert.equal(response.result.status, 'queued_for_human_review');
  assert.equal((await repository.list(REFERRAL_TABLES.walletTransactions)).length, 0);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === AGENT_GATEWAY_EVENT_TYPES.SUPPORT_HANDOFF_OPENED), true);
});

test('unknown tools fail with structured validation errors', async () => {
  const { gateway } = createHarness();
  await assert.rejects(() => gateway.executeTool({ tool: 'approve_wallet_reward', input: { user_id: 'buyer-1', amount: 100 } }, agentActor), ValidationError);
});
