import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- DEALER: LEADS ---
router.get('/api/leads', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId || 'org_1';
  const { data: leads, error } = await supabase.from('dealer_leads').select('*').eq('organization_id', orgId);
  
  // Suppress error if table doesn't exist yet for local dev
  if (error && error.code === '42P01') return res.json([]);
  if (error) throw new DatabaseError(error.message);
  
  res.json(leads || []);
}));

export default router;
