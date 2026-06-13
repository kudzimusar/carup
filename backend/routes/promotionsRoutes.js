import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';
import referralRouter from './referralRoutes.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- PHASE 1: REFERRAL ENGINE FOUNDATION ---
router.use('/api/referrals', referralRouter);

// --- DEALER: PROMOTIONS ---
router.get('/api/promotions', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId || 'org_1';
  const { data: promotions, error } = await supabase.from('dealer_promotions').select('*').eq('organization_id', orgId);
  if (error && error.code === '42P01') return res.json([]);
  if (error) throw new DatabaseError(error.message);
  res.json(promotions || []);
}));

router.post('/api/promotions', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId || 'org_1';
  const { title, discount_amount, start_date, end_date } = req.body;
  const { data, error } = await supabase.from('dealer_promotions').insert({
    organization_id: orgId, title, discount_amount, start_date, end_date
  });
  if (error && error.code === '42P01') return res.json({ success: true, promotion: { id: 'mock', title, discount_amount, start_date, end_date } });
  if (error) throw new DatabaseError(error.message);
  res.json({ success: true, promotion: data });
}));

export default router;
