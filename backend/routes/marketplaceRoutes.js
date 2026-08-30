import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { listMarketplaceListings } from '../services/marketplace/listingSummaryService.js';
import { getMarketplaceNavCoverage } from '../services/marketplace/navCoverageService.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import {
  getPublicReservationProjectionBatch,
  projectListingStatusWithReservation,
} from '../services/reservation/reservationProjectionService.js';
import {
  compareListings,
  getMarketplaceRecommendations,
  getMarketplaceCategories,
} from '../services/marketplace/marketplaceDiscoveryService.js';
import { getPartsListings, getServiceListings } from '../services/marketplace/marketplacePartsService.js';
import { createInquiry, listInquiriesForSeller } from '../services/marketplace/marketplaceInquiryService.js';
import { saveListing, unsaveListing, listSavedListings } from '../services/marketplace/marketplaceSavedService.js';
import { marketplaceReferralBridge } from '../services/marketplace/marketplaceReferralBridgeService.js';
import {
  emitSearchPerformed,
  emitListingOpened,
} from '../services/intelligence/marketplaceActivityEmitters.js';
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

/** Explicit Seller automation fixture scope for PREVIEW/TEST traffic only. */
function sellerAutomationFixtureScope(req) {
  const scope = String(req.query?.fixture_scope ?? '').trim();
  if (!scope || !/^seller-[0-9]+-[0-9]+$/.test(scope)) return null;
  const previewLike = process.env.NODE_ENV === 'test' || process.env.VERCEL_ENV === 'preview';
  return previewLike ? scope : null;
}

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

async function withCanonicalReservationTruth(page) {
  const listings = Array.isArray(page?.listings) ? page.listings : [];
  if (!listings.length) return page;
  const reservations = await getPublicReservationProjectionBatch(
    listings.map((listing) => listing.vin),
    { client: supabase },
  );
  return {
    ...page,
    listings: listings.map((listing) => {
      const reservationSummary = reservations.get(listing.vin) || {
        state: 'unavailable', reserved: null, reserved_at: null, expires_at: null,
        reason: 'reservation_read_unavailable',
      };
      return {
        ...listing,
        status: projectListingStatusWithReservation(listing.status, reservationSummary),
        reservation_summary: reservationSummary,
      };
    }),
  };
}

// ---- Public discovery ------------------------------------------------------

router.get('/api/marketplace/listings', asyncHandler(async (req, res) => {
  const fixtureScope = sellerAutomationFixtureScope(req);
  const page = await listMarketplaceListings(supabase, { ...req.query, __fixtureScope: fixtureScope });
  const body = await withCanonicalReservationTruth(page);
  // Governed search observation (Intelligence I3). Fire-and-forget: a shopper's
  // results must never wait on, or fail because of, analytics. The event carries
  // the result count, so a zero-result search becomes a supply signal rather than
  // an invisible dead end.
  emitSearchPerformed(req, { query: req.query, resultCount: body?.total ?? 0 }).catch(() => {});
  res.json(body);
}));

router.get('/api/marketplace/nav-coverage', asyncHandler(async (req, res) => {
  res.json(await getMarketplaceNavCoverage(supabase));
}));

router.get('/api/marketplace/categories', asyncHandler(async (_req, res) => {
  res.json(getMarketplaceCategories());
}));

// Parts & garage/service marketplace v1 (governed, gated). Public, sanitized, PartSentry-respecting.
router.get('/api/marketplace/parts', asyncHandler(async (req, res) => {
  res.json(await getPartsListings(supabase, req.query));
}));

router.get('/api/marketplace/services', asyncHandler(async (req, res) => {
  res.json(await getServiceListings(supabase, req.query));
}));

router.get('/api/marketplace/recommendations', asyncHandler(async (req, res) => {
  res.json(await getMarketplaceRecommendations(supabase, req.query.vin, { limit: req.query.limit }));
}));

router.post('/api/marketplace/compare', asyncHandler(async (req, res) => {
  res.json(await compareListings(supabase, req.body?.vins || []));
}));

// Listing detail (public). Emits the canonical Intelligence view observation for
// EVERY served detail — organic and attributed alike — plus the pre-existing
// referral-bridge event, which remains the referral engine's own workflow record.
// Before this, an ordinary view (no ref/campaign on the URL) was recorded nowhere.
router.get('/api/marketplace/listings/:id', optionalAuth(), asyncHandler(async (req, res) => {
  const detail = await getMarketplaceListingDetail(supabase, req.params.id, {
    audience: 'public',
    fixtureScope: sellerAutomationFixtureScope(req),
  });
  emitListingOpened(req, { vin: detail?.vin || req.params.id }).catch(() => {});
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
  // `req` reaches the service only so the Intelligence observation can carry the
  // shopper's session/page-view context; the inquiry itself never reads it.
  const inquiry = await createInquiry(supabase, payload, req.userContext || null, { req });
  res.status(201).json({ inquiry });
}));

// ---- Saved listings (authenticated) ----------------------------------------

router.get('/api/marketplace/saved', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await listSavedListings(supabase, req.userContext));
}));

// `req` is threaded through so the observation can carry the shopper's session and
// page-view context — without it a save could not be stage-linked to the view that
// preceded it, and the view→save conversion metric would be uncomputable.
router.post('/api/marketplace/listings/:id/save', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await saveListing(supabase, req.params.id, req.userContext, { req }));
}));

router.delete('/api/marketplace/listings/:id/save', authorizeRole([]), asyncHandler(async (req, res) => {
  res.json(await unsaveListing(supabase, req.params.id, req.userContext, { req }));
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
