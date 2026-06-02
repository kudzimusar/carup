import express from 'express';
import { supabase } from '../db/supabase.js';
import { DatabaseError, ValidationError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- VEHICLE STATUS UPDATE ---
router.patch('/api/vehicles/:vin/status', asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const { status } = req.body;
  if (!status) throw new ValidationError('Status is required');
  const validStatuses = ['available', 'reserved', 'sold', 'pending', 'inspection'];
  if (!validStatuses.includes(status.toLowerCase())) throw new ValidationError('Invalid status');

  const { error } = await supabase.from('vehicles').update({ status: status.toLowerCase() }).eq('vin', vin);
  if (error) throw new DatabaseError(error.message);
  
  res.json({ success: true, vin, status });
}));

export default router;
