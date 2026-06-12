import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReferralEngineService } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService, CHANNEL_GATEWAY_EVENT_TYPES, extractReferralCode, normalizeChannel } from '../services/referral/referralChannelGatewayService.js';
import { REFERRAL_TABLES } from '../services/referral/referralEngineRepository.js';
import { REFERRAL_CODE_TYPES } from '../constants/referral/referralConstants.js';
import { ValidationError, ForbiddenError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/referralRoutes.js', import.meta.url), 'utf8');
const channelServiceFile = readFileSync(new URL('../services/referral/referralChannelGatewayService.js', import.meta.url), 'utf8');

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
  return { repository, referralService, agentGateway, channelGateway };
}

const channelActor = Object.freeze({ actor_user_id: 'channel-user-1', actor_role: 'agent', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'whatsapp', session_id: 'session-channel' });
const operatorActor = Object.freeze({ actor_user_id: 'seller-1', actor_role: 'seller', actor_tenant_id: 'tenant-1', actor_type: 'agent', gateway_trusted: true, surface: 'web', session_id: 'session-seller' });

test('Phase 3 routes expose channel inbound, webhook, and share-kit endpoints', () => {
  for (const marker of [
    "router.post('/channels/:channel/inbound'",
    "router.post('/channels/:channel/share-kit'",
    "router.post('/channels/whatsapp/webhook'",
    "router.post('/channels/telegram/webhook'",
    "router.post('/channels/web-chat/message'",
    "router.post('/channels/mobile-chat/message'",
    'CARUP_CHANNEL_WEBHOOK_SECRET',
    'ReferralChannelGatewayService',
  ]) assert.equal(routeFile.includes(marker), true, `${marker} should exist`);
});

test('channel service supports required channels and rejects unsupported channels', () => {
  assert.equal(normalizeChannel('wa'), 'whatsapp');
  assert.equal(normalizeChannel('telegram'), 'telegram');
  assert.equal(normalizeChannel('web chat'), 'web_chat');
  assert.equal(normalizeChannel('mobile-chat'), 'mobile_chat');
  assert.throws(() => normalizeChannel('fax'), ValidationError);
  assert.equal(channelServiceFile.includes('CHANNEL_GATEWAY_EVENT_TYPES'), true);
});

test('referral code extraction supports WhatsApp text, Telegram start payloads, links, and direct codes', () => {
  assert.equal(extractReferralCode({ text: 'Use code phase3-wa-001 for discount' }), 'PHASE3-WA-001');
  assert.equal(extractReferralCode({ start_payload: '/start phase3-tg-002' }), 'PHASE3-TG-002');
  assert.equal(extractReferralCode({ url: 'https://carup.test/r/phase3-web-003?utm_source=web' }), 'PHASE3-WEB-003');
  assert.equal(extractReferralCode({ code: 'phase3-direct-004' }), 'PHASE3-DIRECT-004');
});

test('WhatsApp inbound flows through Agent Gateway and attaches attribution when a code exists', async () => {
  const { repository, referralService, channelGateway } = createHarness();
  const campaign = await referralService.createCampaign({ name: 'WhatsApp Parts Campaign', status: 'ACTIVE' }, operatorActor);
  const code = await referralService.createReferralCode({ campaign_id: campaign.id, owner_user_id: 'seller-1', code: 'phase3-wa-code', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);
  const response = await channelGateway.processInbound('whatsapp', { text: 'Hello, code phase3-wa-code for parts please', sender_id: '263771000000', conversation_id: 'wa-thread-1', message_id: 'wa-msg-1', consent: { opted_in: true } }, channelActor);
  assert.equal(response.success, true);
  assert.equal(response.channel, 'whatsapp');
  assert.equal(response.extracted_referral_code, 'PHASE3-WA-CODE');
  assert.equal(response.attribution.campaign_id, campaign.id);
  assert.equal(response.reply.includes('valid'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === CHANNEL_GATEWAY_EVENT_TYPES.INBOUND_RECEIVED && event.channel === 'whatsapp'), true);
  assert.equal(events.some((event) => event.event_type === CHANNEL_GATEWAY_EVENT_TYPES.ATTRIBUTION_ATTACHED && event.code_id === code.id), true);
});

test('Telegram inbound handles /start payloads and preserves conversation metadata', async () => {
  const { repository, referralService, channelGateway } = createHarness();
  await referralService.createReferralCode({ owner_user_id: 'ambassador-1', code: 'phase3-tg-code', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'telegram' }, operatorActor);
  const response = await channelGateway.processInbound('telegram', { text: '/start phase3-tg-code', sender_id: 'tg-user-1', thread_id: 'tg-thread-1', message_id: 'tg-msg-1', payload: { update_id: 'u1' } }, { ...channelActor, surface: 'telegram' });
  assert.equal(response.channel, 'telegram');
  assert.equal(response.extracted_referral_code, 'PHASE3-TG-CODE');
  assert.equal(response.metadata.conversation_id, 'tg-thread-1');
  const inbound = (await repository.list(REFERRAL_TABLES.events)).find((event) => event.event_type === CHANNEL_GATEWAY_EVENT_TYPES.INBOUND_RECEIVED);
  assert.equal(inbound.metadata.sender_id, 'tg-user-1');
  assert.equal(inbound.metadata.message_id, 'tg-msg-1');
});

test('web and mobile chat channels map to referral channels while keeping normalized channel metadata', async () => {
  const { repository, channelGateway } = createHarness();
  const webResponse = await channelGateway.processInbound('web_chat', { message: 'I need help importing a car', session_id: 'web-session-1', sender_id: 'web-user-1' }, { ...channelActor, surface: 'web_chat' });
  const mobileResponse = await channelGateway.processInbound('mobile_chat', { message: 'I need a parts referral code', session_id: 'mobile-session-1', sender_id: 'mobile-user-1' }, { ...channelActor, surface: 'mobile_chat' });
  assert.equal(webResponse.channel, 'web_chat');
  assert.equal(mobileResponse.channel, 'mobile_chat');
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.channel === 'web' && event.metadata.normalized_channel === 'web_chat'), true);
  assert.equal(events.some((event) => event.channel === 'mobile' && event.metadata.normalized_channel === 'mobile_chat'), true);
});

test('channel share-kit preparation builds channel-specific copy without manual URL copying', async () => {
  const { repository, referralService, channelGateway } = createHarness();
  await referralService.createReferralCode({ owner_user_id: 'seller-1', code: 'phase3-share-code', code_type: REFERRAL_CODE_TYPES.MEMBER, channel: 'whatsapp' }, operatorActor);
  const response = await channelGateway.prepareShareKit('whatsapp', { code: 'phase3-share-code', campaign_name: 'Japan to Zimbabwe Parts', route_origin: 'Japan', route_destination: 'Zimbabwe' }, operatorActor);
  assert.equal(response.success, true);
  assert.equal(response.channel, 'whatsapp');
  assert.equal(response.copy.message.includes('PHASE3-SHARE-CODE'), true);
  assert.equal(response.copy.link.includes('wa.me'), true);
  assert.equal(response.share_kit.short_referral_url.includes('/r/PHASE3-SHARE-CODE'), true);
  const events = await repository.list(REFERRAL_TABLES.events);
  assert.equal(events.some((event) => event.event_type === CHANNEL_GATEWAY_EVENT_TYPES.SHARE_KIT_PREPARED), true);
});

test('webhook-style channels are designed to require a webhook or gateway secret in routes', () => {
  assert.equal(routeFile.includes('Channel webhook requires a valid webhook secret.'), true);
  assert.equal(routeFile.includes('x-channel-webhook-secret'), true);
  assert.equal(routeFile.includes('x-carup-channel-secret'), true);
});

test('channel gateway refuses unsupported channel processing', async () => {
  const { channelGateway } = createHarness();
  await assert.rejects(() => channelGateway.processInbound('fax', { message: 'hello' }, channelActor), ValidationError);
});
