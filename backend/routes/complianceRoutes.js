import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- COMPLIANCE: REGISTRY VERIFICATIONS ---
router.get('/api/compliance/registry', authorizeRole(['government', 'admin']), asyncHandler(async (req, res) => {
  const { data: verifications, error } = await supabase
    .from('registry_verifications')
    .select('*, vehicles(make, model)')
    .order('created_at', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json(verifications);
}));

router.post('/api/compliance/registry/:id/update', authorizeRole(['government', 'admin']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const { data, error } = await supabase
    .from('registry_verifications')
    .update({ status, notes, verified_by: req.userContext.userId, verification_date: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  res.json(data);
}));

export default router;
