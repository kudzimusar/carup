import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError, UnauthorizedError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- MECHANIC: WORK ORDERS ---
router.get('/api/mechanic/work-orders', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');
  
  const { data, error } = await supabase.from('mechanic_work_orders').select('*').eq('tenant_id', orgId);
  if (error) throw new DatabaseError(error.message);
  
  res.json(data || []);
}));

router.post('/api/mechanic/work-orders', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');
  
  const { vin, customer_name, issue_description } = req.body;
  const { data, error } = await supabase.from('mechanic_work_orders').insert({
    tenant_id: orgId, vin, description: issue_description, status: 'In Progress'
  }).select().single();
  if (error) throw new DatabaseError(error.message);
  
  res.json({ success: true, workOrder: data });
}));

export default router;
