import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError, UnauthorizedError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- MECHANIC: PARTS ---
router.get('/api/mechanic/parts', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');
  
  const { data, error } = await supabase.from('mechanic_parts').select('*').eq('tenant_id', orgId);
  if (error) throw new DatabaseError(error.message);
  
  res.json(data || []);
}));

router.post('/api/mechanic/parts', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');
  
  const { name, sku, stock_level, unit_price } = req.body;
  const { data, error } = await supabase.from('mechanic_parts').insert({
    tenant_id: orgId, name, sku, stock_level, unit_price
  }).select().single();
  if (error) throw new DatabaseError(error.message);
  
  res.json({ success: true, part: data });
}));

export default router;
