import express from 'express';
import { supabase } from '../db/supabase.js';
import { listMarketplaceListings } from '../services/marketplace/listingSummaryService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/api/marketplace/listings', asyncHandler(async (req, res) => {
  const result = await listMarketplaceListings(supabase, req.query);
  res.json(result);
}));

export default router;
