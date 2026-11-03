/**
 * CARUP-DEALER-ONB-001: research/publication and prospective claim routes.
 * Research is NOT a self-service dealer-approval service. Claims grant NO roles.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import {
  getPublicResearch,
  listPublicResearch,
  reviewResearchSeed,
  submitResearchClaim,
  listOwnResearchClaims,
} from '../services/dealer/dealerResearchService.js';

const router = express.Router();
const publicReadLimit = rateLimiter({ max: 40, windowMs: 60 * 1000, isSensitive: false });
const claimWriteLimit = rateLimiter({ max: 4, windowMs: 60 * 60 * 1000, isSensitive: true });
const reviewWriteLimit = rateLimiter({ max: 15, windowMs: 60 * 60 * 1000, isSensitive: true });
const session = authorizeSessionRole([]);
const reviewer = authorizeSessionRole(['admin','reviewer']);

function errorResponse(res, next, error) {
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  next(error);
}

// Only reviewed, unsuppressed, non-disputed research publications appear here.
router.get('/api/dealership/research', publicReadLimit, async (req,res,next) => {
  try {
    const output = await listPublicResearch({
      q: req.query.q, city: req.query.city, page: req.query.page, limit: req.query.limit,
    });
    res.set('Cache-Control','no-store').json(output);
  } catch (error) { errorResponse(res,next,error); }
});

router.get('/api/dealership/research/:seedId', publicReadLimit, async (req,res,next) => {
  try {
    const profile = await getPublicResearch(req.params.seedId);
    if (!profile) return res.status(404).json({ error:'Research listing not published' });
    res.set('Cache-Control','no-store').json({ profile });
  } catch (error) { errorResponse(res,next,error); }
});

// A signed-in representative can signal a claim and start evidence review.
// NO tenant/role/verified status or access to a private prefilled workbook.
router.post('/api/dealership/research/:seedId/claim', claimWriteLimit, session, async (req,res,next) => {
  try {
    const claim = await submitResearchClaim(req.params.seedId,req.userContext,req.body || {});
    res.set('Cache-Control','no-store').status(202).json({ claim });
  } catch (error) { errorResponse(res,next,error); }
});
router.get('/api/dealership/claims/mine', session, async (req,res,next) => {
  try {
    res.set('Cache-Control','no-store').json({ claims: await listOwnResearchClaims(req.userContext) });
  } catch (error) { errorResponse(res,next,error); }
});

// Research source eligibility must be independently reviewed with a valid session,
// verified platform reviewer role and per-source, documented case reasons. DB RPC
// appends immutable decision and writes safe public projection in one transaction.
router.post('/api/admin/dealership/research/:seedId/review', reviewWriteLimit, reviewer, async (req,res,next) => {
  try {
    const review = await reviewResearchSeed(req.params.seedId,req.userContext,req.body || {});
    res.set('Cache-Control','no-store').status(201).json({ review });
  } catch (error) { errorResponse(res,next,error); }
});

export default router;
