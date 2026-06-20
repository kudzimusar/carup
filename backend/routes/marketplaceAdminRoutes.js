import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import {
  listListingsForAdmin,
  approveListing,
  rejectListing,
  suppressListing,
  requestListingEvidence,
  flagListingRisk,
  clearListingRisk,
} from '../services/marketplace/marketplaceModerationService.js';
import {
  listInquiriesForAdmin,
  assignInquiry,
  updateInquiryStatus,
} from '../services/marketplace/marketplaceInquiryService.js';
import { getMarketplaceAnalytics } from '../services/marketplace/marketplaceAnalyticsService.js';
import { moderationSummary } from '../services/marketplace/marketplaceAiAssistantService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Platform-level reviewer roles. authorizeRole additionally bypasses for platform_admin/super_admin.
// The service layer independently re-checks the PLATFORM/base role (assertModerator / assertReviewer),
// so a tenant-scoped x-stakeholder-role elevation that slips past the route guard still fails closed.
const REVIEWER_ROLES = ['admin', 'government'];

// ---- Listing moderation ----------------------------------------------------

router.get('/api/admin/marketplace/listings', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listListingsForAdmin(supabase, { ...req.query, actor: req.userContext }));
}));

router.get('/api/admin/marketplace/listings/:id', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json(await getMarketplaceListingDetail(supabase, req.params.id, { audience: 'admin' }));
}));

const moderationAction = (handler) =>
  asyncHandler(async (req, res) => {
    res.json(await handler(supabase, req.params.id, req.body || {}, req.userContext));
  });

router.patch('/api/admin/marketplace/listings/:id/approve', authorizeRole(REVIEWER_ROLES), moderationAction(approveListing));
router.patch('/api/admin/marketplace/listings/:id/reject', authorizeRole(REVIEWER_ROLES), moderationAction(rejectListing));
router.patch('/api/admin/marketplace/listings/:id/suppress', authorizeRole(REVIEWER_ROLES), moderationAction(suppressListing));
router.patch('/api/admin/marketplace/listings/:id/request-evidence', authorizeRole(REVIEWER_ROLES), moderationAction(requestListingEvidence));
router.patch('/api/admin/marketplace/listings/:id/flag-risk', authorizeRole(REVIEWER_ROLES), moderationAction(flagListingRisk));
router.patch('/api/admin/marketplace/listings/:id/clear-risk', authorizeRole(REVIEWER_ROLES), moderationAction(clearListingRisk));

// ---- Inquiry management ----------------------------------------------------

router.get('/api/admin/marketplace/inquiries', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json({ inquiries: await listInquiriesForAdmin(supabase, req.query, req.userContext) });
}));

router.patch('/api/admin/marketplace/inquiries/:id/assign', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json(await assignInquiry(supabase, req.params.id, req.body?.operator_id, req.userContext));
}));

router.patch('/api/admin/marketplace/inquiries/:id/status', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json(await updateInquiryStatus(supabase, req.params.id, req.body?.status, req.userContext));
}));

// ---- Analytics + moderation AI summary ------------------------------------

router.get('/api/admin/marketplace/analytics', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  res.json(await getMarketplaceAnalytics(supabase, req.userContext));
}));

router.post('/api/admin/marketplace/ai/moderation-summary', authorizeRole(REVIEWER_ROLES), asyncHandler(async (req, res) => {
  let listingSummary = req.body?.listingSummary || {};
  let trustSummary = req.body?.trustSummary || {};
  if (req.body?.vin) {
    const detail = await getMarketplaceListingDetail(supabase, req.body.vin, { audience: 'admin' });
    listingSummary = detail;
    trustSummary = detail.trust_summary;
  }
  res.json(await moderationSummary({ listingSummary, trustSummary }));
}));

export default router;
