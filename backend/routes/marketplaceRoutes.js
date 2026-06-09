import express from 'express';
import { supabase } from '../db/supabase.js';
import { listMarketplaceListings } from '../services/marketplace/listingSummaryService.js';
import { getMarketplaceNavCoverage } from '../services/marketplace/navCoverageService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/api/marketplace/listings', asyncHandler(async (req, res) => {
  const result = await listMarketplaceListings(supabase, req.query);
  res.json(result);
}));

// Read-only nav coverage: per category/tag counts (fixtures hidden, no PII) + active flags.
router.get('/api/marketplace/nav-coverage', asyncHandler(async (req, res) => {
  const result = await getMarketplaceNavCoverage(supabase);
  res.json(result);
}));

export default router;
