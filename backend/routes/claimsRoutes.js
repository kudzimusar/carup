import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- INSURANCE: CLAIMS ---
router.get('/api/insurance/claims', authorizeRole(['insurance', 'admin']), asyncHandler(async (req, res) => {
  const { data: claims, error } = await supabase
    .from('insurance_claims')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json(claims);
}));

router.patch('/api/insurance/claims/:id/status', authorizeRole(['insurance', 'admin']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { data: claim, error } = await supabase
    .from('insurance_claims')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  res.json(claim);
}));

export default router;
