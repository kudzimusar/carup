import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { listMarketplaceListings } from '../services/marketplace/listingSummaryService.js';
import { getMarketplaceNavCoverage } from '../services/marketplace/navCoverageService.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import {
  compareListings,
  getMarketplaceRecommendations,
  getMarketplaceCategories,
} from '../services/marketplace/marketplaceDiscoveryService.js';
import { createInquiry, listInquiriesForSeller } from '../services/marketplace/marketplaceInquiryService.js';
import { saveListing, unsaveListing, listSavedListings } from '../services/marketplace/marketplaceSavedService.js';
import { marketplaceReferralBridge } from '../services/marketplace/marketplaceReferralBridgeService.js';
import {
  listingDraft,
  buyerAssistant,
  priceEstimate,
  shareCopy,
} from '../services/marketplace/marketplaceAiAssistantService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const aiLimiter = rateLimiter({ max: 20, windowMs: 60 * 1000, isSensitive: true });
const inquiryLimiter = rateLimiter({ max: 15, windowMs: 60 * 1000, isSensitive: true });

/** Extract referral attribution from query/body without trusting it for anything but attribution. */
function referralContextFromReq(req) {
  const q = req.query || {};
  const b = req.body || {};
  return {
    referralCode: b.referral_code || q.referral_code || q.ref || undefined,
    campaignCode: b.campaign_code || q.campaign_code || q.campaign || undefined,
    sourceChannel: b.source_channel || q.source || undefined,
  };
}

// ---- Public discovery ------------------------------------------------------

router.get('/api/marketplace/listings', asyncHandler(async (req, res) => {
  res.json(await listMarketplaceListings(supabase, req.query));
}));

router.get('/api/marketplace/nav-coverage', asyncHandler(async (req, res) => {
  res.json(await getMarketplaceNavCoverage(supabase));
}));

router.get('/api/marketplace/categories', asyncHandler(async (_req, res) => {
  res.json(getMarketplaceCategories());
}));

router.get('/api/marketplace/recommendations', asyncHandler(async (req, res) => {
  res.json(await getMarketplaceRecommendations(supabase, req.query.vin, { limit: req.query.limit }));
}));

router.post('/api/marketplace/compare', asyncHandler(async (req, res) => {
  res.json(await compareListings(supabase, req.body?.vins || []));
}));

// Listing detail (public). Emits a best-effort referral "listing_viewed" event.
router.get('/api/marketplace/listings/:id', optionalAuth(), asyncHandler(async (req, res) => {
  const detail = await getMarketplaceListingDetail(supabase, req.params.id, { audience: 'public' });
  const { referralCode, campaignCode, sourceChannel } = referralContextFromReq(req);
  if (referralCode || campaignCode) {
    marketplaceReferralBridge
      .emitMarketplaceReferralEvent({
        eventType: 'marketplace_listing_viewed',
        listingId: detail.vin,
        referralCode,
        campaignCode,
        sourceChannel,
        actor: req.userContext ? { actor_user_id: req.userContext.id, id: req.userContext.id } : {},
      })
      .catch(() => {});
  }
  res.json(detail);
}));

// ---- Inquiries (guest-allowed; rate-limited) -------------------------------

router.post('/api/marketplace/inquiries', inquiryLimiter, optionalAuth(), asyncHandler(async (req, res) => {
  const { referralCode, campaignCode, sourceChannel } = referralContextFromReq(req);
  const payload = {
    ...req.body,
    referral_code: req.body?.referral_code || referralCode,
    campaign_code: req.body?.campaign_code || campaignCode,
    source_channel: req.body?.source_channel || sourceChannel,
  };
  const inquiry = await createInquiry(supabase, payload, req.userContext || null);
  res.status(201).json({ inquiry });
}));

// ---- Saved listings (authenticated) ----------------------------------------

router.get('/api/marketplace/saved', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await listSavedListings(supabase, req.userContext));
}));

router.post('/api/marketplace/listings/:id/save', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await saveListing(supabase, req.params.id, req.userContext));
}));

router.delete('/api/marketplace/listings/:id/save', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await unsaveListing(supabase, req.params.id, req.userContext));
}));

// ---- Seller inquiry inbox --------------------------------------------------

router.get('/api/marketplace/my-listings/inquiries', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json({ inquiries: await listInquiriesForSeller(supabase, req.userContext) });
}));

// ---- AI advisory endpoints (deterministic fallback; never fail on AI) ------

async function resolveSummaryForAi(body) {
  if (body?.listingSummary) return body.listingSummary;
  if (body?.vin) {
    const detail = await getMarketplaceListingDetail(supabase, body.vin, { audience: 'public' });
    return detail;
  }
  return body || {};
}

router.post('/api/marketplace/ai/listing-draft', aiLimiter, asyncHandler(async (req, res) => {
  res.json(await listingDraft(req.body || {}));
}));

router.post('/api/marketplace/ai/buyer-assistant', aiLimiter, asyncHandler(async (req, res) => {
  res.json(await buyerAssistant(req.body || {}));
}));

router.post('/api/marketplace/ai/price-estimate', aiLimiter, asyncHandler(async (req, res) => {
  const listingSummary = await resolveSummaryForAi(req.body);
  res.json(await priceEstimate({ listingSummary, listingType: req.body?.listingType || 'vehicle' }));
}));

router.post('/api/marketplace/ai/share-copy', aiLimiter, asyncHandler(async (req, res) => {
  res.json(await shareCopy(req.body || {}));
}));

export default router;
