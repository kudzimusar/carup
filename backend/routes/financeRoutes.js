import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Fetch CBZ Bank / Finance Applications list
router.get('/api/finance/applications', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  const { data: list, error } = await supabase
    .from('finance_applications')
    .select(`
      *,
      users!finance_applications_user_id_fkey(name),
      vehicles!inner(make, model, year, price, trust_score)
    `)
    .order('created_at', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  
  // Flatten relational joins for frontend mapping compatibility
  const flattened = list.map(app => ({
    ...app,
    user_name: app.users?.name || 'Applicant',
    make: app.vehicles?.make || 'Vehicle',
    model: app.vehicles?.model || '',
    year: app.vehicles?.year || '',
    trust_score: app.vehicles?.trust_score || 50
  }));
  
  res.json(flattened);
}));

// Update financing application status (Loan States)
router.post('/api/finance/applications/:id/update', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { error } = await supabase
    .from('finance_applications')
    .update({ status })
    .eq('id', id);
  if (error) throw new DatabaseError(error.message);
  res.json({ success: true, status });
}));

export default router;
