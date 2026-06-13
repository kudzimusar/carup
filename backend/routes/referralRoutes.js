import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole, isUserIdFallbackAllowed } from '../middleware/authMiddleware.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
import { ACTOR_TYPES } from '../constants/referral/referralConstants.js';
import { ReferralEngineService, buildActorContext } from '../services/referral/referralEngineService.js';
import { ReferralAgentGatewayService } from '../services/referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService, normalizeChannel } from '../services/referral/referralChannelGatewayService.js';
import { isValidTelegramWebhookSecret, processParsedChannelMessages, verifyMetaWebhookChallenge } from '../services/referral/referralChannelPayloadParsers.js';

const ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin'];
const OPERATOR_ROLES = ['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager'];
const WEBHOOK_CHANNELS = new Set(['whatsapp', 'telegram', 'facebook', 'instagram']);

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function isPlatformAdmin(ctx = {}) {
  return ADMIN_ROLES.includes(String(ctx.platformRole || ctx.role || '').toLowerCase());
}

function createActor(req, fallbackType = ACTOR_TYPES.USER) {
  return { ...buildActorContext(req), actor_type: req.headers['x-actor-type'] || fallbackType };
}

function assertSelfOrAdmin(req, userId) {
  if (req.userContext?.id === userId || isPlatformAdmin(req.userContext)) return;
  throw new ForbiddenError('You cannot access another user wallet.');
}

function getAgentGatewayKey(req) {
  return req.headers['x-agent-gateway-key'] || req.headers['x-carup-agent-key'] || req.headers['x-agent-key'];
}

function isValidAgentGatewayKey(req) {
  const configured = process.env.CARUP_AGENT_GATEWAY_SECRET;
  const supplied = getAgentGatewayKey(req);
  return Boolean(configured && supplied && supplied === configured);
}

function getChannelWebhookKey(req) {
  return req.headers['x-channel-webhook-secret'] || req.headers['x-carup-channel-secret'] || req.headers['x-webhook-secret'];
}

function isValidChannelWebhookKey(req) {
  const configured = process.env.CARUP_CHANNEL_WEBHOOK_SECRET;
  const supplied = getChannelWebhookKey(req);
  return Boolean(configured && supplied && supplied === configured);
}

function assertAgentGatewayAccess(req) {
  if (isValidAgentGatewayKey(req)) return;
  if (req.userContext?.id) return;
  if (isUserIdFallbackAllowed(process.env) && req.headers['x-user-id']) return;
  throw new ForbiddenError('Agent gateway requires a trusted gateway key or authenticated user context.');
}

function assertChannelAccess(req, channel) {
  const normalized = normalizeChannel(channel);
  if (normalized === 'telegram' && isValidTelegramWebhookSecret(req.headers, process.env)) return;
  if (isValidAgentGatewayKey(req) || isValidChannelWebhookKey(req) || req.userContext?.id) return;
  if (isUserIdFallbackAllowed(process.env) && req.headers['x-user-id']) return;
  if (WEBHOOK_CHANNELS.has(normalized)) throw new ForbiddenError('Channel webhook requires a valid webhook secret.');
  throw new ForbiddenError('Channel access requires trusted gateway, webhook, or user context.');
}

function createAgentGatewayActor(req) {
  const bodyContext = req.body?.context || {};
  const bodyInput = req.body?.input || {};
  const fallbackUserId = req.headers['x-user-id'] || bodyContext.user_id || bodyInput.user_id || null;
  const surface = req.headers['x-agent-surface'] || bodyContext.surface || bodyInput.surface || 'web';
  return {
    ...createActor(req, ACTOR_TYPES.AGENT),
    actor_user_id: req.userContext?.id || fallbackUserId,
    actor_role: req.userContext?.effectiveRole || req.userContext?.role || req.headers['x-stakeholder-role'] || req.headers['x-agent-role'] || 'agent',
    actor_tenant_id: req.userContext?.tenantId || req.headers['x-tenant-id'] || bodyContext.tenant_id || bodyInput.tenant_id || 'platform',
    actor_type: ACTOR_TYPES.AGENT,
    gateway_trusted: isValidAgentGatewayKey(req) || isValidChannelWebhookKey(req) || isValidTelegramWebhookSecret(req.headers, process.env),
    surface,
    session_id: req.headers['x-agent-session-id'] || bodyContext.session_id || bodyInput.session_id || null,
  };
}

function createChannelActor(req, channel) {
  const actor = createAgentGatewayActor(req);
  return { ...actor, surface: normalizeChannel(channel), session_id: req.headers['x-channel-session-id'] || req.body?.conversation_id || req.body?.thread_id || req.body?.session_id || actor.session_id };
}

function handleMetaVerification(req, res) {
  const challenge = verifyMetaWebhookChallenge(req.query, process.env);
  res.status(200).send(challenge);
}

export function createReferralRouter({ client = supabase, service = null, agentGateway = null, channelGateway = null } = {}) {
  const router = express.Router();
  const referralService = service || new ReferralEngineService({ client });
  const gatewayService = agentGateway || new ReferralAgentGatewayService({ referralService });
  const channelService = channelGateway || new ReferralChannelGatewayService({ agentGateway: gatewayService, referralService });

  router.post('/campaigns', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const campaign = await referralService.createCampaign(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, campaign });
  }));

  router.get('/campaigns', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const filters = { tenant_id: req.query.tenant_id || req.userContext?.tenantId || undefined, status: req.query.status || undefined, campaign_type: req.query.campaign_type || undefined, priority_scope: req.query.priority_scope || undefined };
    const campaigns = await referralService.listCampaigns(filters);
    res.json({ success: true, campaigns });
  }));

  router.patch('/campaigns/:id', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const campaign = await referralService.updateCampaign(req.params.id, req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.json({ success: true, campaign });
  }));

  router.post('/codes', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const code = await referralService.createReferralCode(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, code });
  }));

  router.post('/validate', asyncHandler(async (req, res) => {
    const result = await referralService.validateReferralCode(req.body, createActor(req, req.headers['x-actor-type'] || ACTOR_TYPES.USER));
    res.status(result.valid ? 200 : 422).json({ success: result.valid, ...result });
  }));

  router.get('/codes/:code', asyncHandler(async (req, res) => {
    const result = await referralService.validateReferralCode({ code: req.params.code, channel: req.query.channel, source: req.query.source, session_id: req.query.session_id }, createActor(req, ACTOR_TYPES.USER));
    res.status(result.valid ? 200 : 422).json({ success: result.valid, ...result });
  }));

  router.post('/events', asyncHandler(async (req, res) => {
    const event = await referralService.recordReferralEvent(req.body, createActor(req, req.headers['x-actor-type'] || ACTOR_TYPES.USER));
    res.status(201).json({ success: true, event });
  }));

  router.get('/agent/tools', asyncHandler(async (req, res) => {
    const actor = createAgentGatewayActor({ ...req, body: { context: req.query, input: {} } });
    res.json({ success: true, tools: gatewayService.getToolCatalog(actor) });
  }));

  router.post('/agent/triage', asyncHandler(async (req, res) => {
    assertAgentGatewayAccess(req);
    const actor = createAgentGatewayActor(req);
    const response = await gatewayService.executeTool({ tool: 'triage', input: req.body || {}, context: req.body?.context || {} }, actor);
    res.json(response);
  }));

  router.post('/agent/execute', asyncHandler(async (req, res) => {
    assertAgentGatewayAccess(req);
    if (!req.body?.tool) throw new ValidationError('tool is required.');
    const actor = createAgentGatewayActor(req);
    const response = await gatewayService.executeTool({ tool: req.body.tool, input: req.body.input || {}, context: req.body.context || {} }, actor);
    res.json(response);
  }));

  router.post('/channels/:channel/inbound', asyncHandler(async (req, res) => {
    assertChannelAccess(req, req.params.channel);
    const actor = createChannelActor(req, req.params.channel);
    const response = await channelService.processInbound(req.params.channel, req.body || {}, actor);
    res.json(response);
  }));

  router.post('/channels/:channel/share-kit', asyncHandler(async (req, res) => {
    assertChannelAccess(req, req.params.channel);
    const actor = createChannelActor(req, req.params.channel);
    const response = await channelService.prepareShareKit(req.params.channel, req.body || {}, actor);
    res.json(response);
  }));

  router.get('/channels/whatsapp/webhook', asyncHandler(handleMetaVerification));
  router.get('/channels/facebook/webhook', asyncHandler(handleMetaVerification));
  router.get('/channels/instagram/webhook', asyncHandler(handleMetaVerification));

  router.post('/channels/whatsapp/webhook', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'whatsapp');
    const response = await processParsedChannelMessages('whatsapp', req.body || {}, channelService, createChannelActor(req, 'whatsapp'));
    res.json(response);
  }));

  router.post('/channels/telegram/webhook', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'telegram');
    const response = await processParsedChannelMessages('telegram', req.body || {}, channelService, createChannelActor(req, 'telegram'));
    res.json(response);
  }));

  router.post('/channels/facebook/webhook', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'facebook');
    const response = await processParsedChannelMessages('facebook', req.body || {}, channelService, createChannelActor(req, 'facebook'));
    res.json(response);
  }));

  router.post('/channels/instagram/webhook', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'instagram');
    const response = await processParsedChannelMessages('instagram', req.body || {}, channelService, createChannelActor(req, 'instagram'));
    res.json(response);
  }));

  router.post('/channels/web-chat/message', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'web_chat');
    const response = await processParsedChannelMessages('web_chat', req.body || {}, channelService, createChannelActor(req, 'web_chat'));
    res.json(response);
  }));

  router.post('/channels/mobile-chat/message', asyncHandler(async (req, res) => {
    assertChannelAccess(req, 'mobile_chat');
    const response = await processParsedChannelMessages('mobile_chat', req.body || {}, channelService, createChannelActor(req, 'mobile_chat'));
    res.json(response);
  }));

  router.post('/share-assets', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    if (!req.body?.code) throw new ValidationError('code is required.');
    const shareAsset = await referralService.createShareAssets(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, shareAsset });
  }));

  router.post('/coupons', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const coupon = await referralService.createCoupon(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, coupon });
  }));

  router.post('/coupons/apply', asyncHandler(async (req, res) => {
    const result = await referralService.applyCoupon(req.body, createActor(req, req.headers['x-actor-type'] || ACTOR_TYPES.USER));
    res.status(result.applied ? 200 : 422).json({ success: result.applied, ...result });
  }));

  router.post('/coupons/redeem', authorizeRole(), asyncHandler(async (req, res) => {
    const actor = createActor(req, ACTOR_TYPES.USER);
    const redeemerUserId = req.body.redeemer_user_id || req.userContext?.id;
    if (redeemerUserId !== req.userContext?.id && !isPlatformAdmin(req.userContext)) throw new ForbiddenError('You cannot redeem a coupon for another user.');
    const result = await referralService.redeemCoupon({ ...req.body, redeemer_user_id: redeemerUserId }, actor);
    res.status(result.redeemed ? 201 : 422).json({ success: Boolean(result.redeemed), ...result });
  }));

  router.get('/wallets/:userId', authorizeRole(), asyncHandler(async (req, res) => {
    assertSelfOrAdmin(req, req.params.userId);
    const wallet = await referralService.getWallet(req.params.userId);
    res.json({ success: true, ...wallet });
  }));

  router.post('/wallets/transactions', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const transaction = await referralService.createWalletTransaction(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, transaction });
  }));

  router.patch('/wallets/transactions/:id/status', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const transaction = await referralService.transitionWalletTransaction(req.params.id, req.body.status, createActor(req, ACTOR_TYPES.ADMIN));
    res.json({ success: true, transaction });
  }));

  router.get('/admin/events', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const events = await referralService.getAdminTimeline({ tenant_id: req.query.tenant_id || req.userContext?.tenantId || undefined, campaign_id: req.query.campaign_id || undefined, code_id: req.query.code_id || undefined, event_type: req.query.event_type || undefined, limit: Number(req.query.limit || 200) });
    res.json({ success: true, events });
  }));

  return router;
}

export default createReferralRouter();
