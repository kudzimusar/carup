import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
import { ACTOR_TYPES } from '../constants/referral/referralConstants.js';
import { ReferralEngineService, buildActorContext } from '../services/referral/referralEngineService.js';

const ADMIN_ROLES = ['admin', 'platform_admin', 'super_admin'];
const OPERATOR_ROLES = ['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager'];

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function isPlatformAdmin(ctx = {}) {
  return ADMIN_ROLES.includes(String(ctx.platformRole || ctx.role || '').toLowerCase());
}

function createActor(req, fallbackType = ACTOR_TYPES.USER) {
  return {
    ...buildActorContext(req),
    actor_type: req.headers['x-actor-type'] || fallbackType,
  };
}

function assertSelfOrAdmin(req, userId) {
  if (req.userContext?.id === userId || isPlatformAdmin(req.userContext)) return;
  throw new ForbiddenError('You cannot access another user wallet.');
}

export function createReferralRouter({ client = supabase, service = null } = {}) {
  const router = express.Router();
  const referralService = service || new ReferralEngineService({ client });

  router.post('/campaigns', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const campaign = await referralService.createCampaign(req.body, createActor(req, ACTOR_TYPES.ADMIN));
    res.status(201).json({ success: true, campaign });
  }));

  router.get('/campaigns', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const filters = {
      tenant_id: req.query.tenant_id || req.userContext?.tenantId || undefined,
      status: req.query.status || undefined,
      campaign_type: req.query.campaign_type || undefined,
      priority_scope: req.query.priority_scope || undefined,
    };
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
    const result = await referralService.validateReferralCode({
      code: req.params.code,
      channel: req.query.channel,
      source: req.query.source,
      session_id: req.query.session_id,
    }, createActor(req, ACTOR_TYPES.USER));
    res.status(result.valid ? 200 : 422).json({ success: result.valid, ...result });
  }));

  router.post('/events', asyncHandler(async (req, res) => {
    const event = await referralService.recordReferralEvent(req.body, createActor(req, req.headers['x-actor-type'] || ACTOR_TYPES.USER));
    res.status(201).json({ success: true, event });
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
    if (redeemerUserId !== req.userContext?.id && !isPlatformAdmin(req.userContext)) {
      throw new ForbiddenError('You cannot redeem a coupon for another user.');
    }
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
    const events = await referralService.getAdminTimeline({
      tenant_id: req.query.tenant_id || req.userContext?.tenantId || undefined,
      campaign_id: req.query.campaign_id || undefined,
      code_id: req.query.code_id || undefined,
      event_type: req.query.event_type || undefined,
      limit: Number(req.query.limit || 200),
    });
    res.json({ success: true, events });
  }));

  return router;
}

export default createReferralRouter();
