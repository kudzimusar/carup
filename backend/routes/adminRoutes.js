import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';
import sessionAccountRouter from './sessionAccountRoutes.js';

const router = express.Router();

// Mounted before the legacy inline server routes so these canonical session-backed handlers are the
// effective account endpoints while the old inline definitions remain unreachable pending cleanup.
router.use(sessionAccountRouter);

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// GET /api/users/management - Super admin user management
router.get('/api/users/management', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new DatabaseError(error.message);
  res.json(data || []);
}));

// GET /api/admin/stats - System wide stats
router.get('/api/admin/stats', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { count: userCount, error: userErr } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: vehicleCount, error: vehicleErr } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  const { count: escrowCount, error: escrowErr } = await supabase.from('safepay_escrows').select('*', { count: 'exact', head: true });
  const { count: claimsCount, error: claimsErr } = await supabase.from('insurance_claims').select('*', { count: 'exact', head: true });

  if (userErr || vehicleErr || escrowErr || claimsErr) {
    throw new DatabaseError('Failed to query system stats');
  }

  res.json({
    totalUsers: userCount || 0,
    totalVehicles: vehicleCount || 0,
    totalEscrows: escrowCount || 0,
    totalClaims: claimsCount || 0,
    systemHealth: 'Optimal',
    aiConfidence: '98.5%'
  });
}));

// POST /api/users/:id/suspend - Suspend a user
router.post('/api/users/:id/suspend', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ role: 'suspended' }) // Simple suspension for now
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new DatabaseError(error.message);
  res.json(data);
}));

// GET /api/admin/health - Server health history
router.get('/api/admin/health', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data: health, error } = await supabase
    .from('server_health')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json(health);
}));

// GET /api/admin/users - Admin users list
router.get('/api/admin/users', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .order('join_date', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json(users);
}));

// PATCH /api/admin/users/:id/suspend - Suspend user (admin view)
router.patch('/api/admin/users/:id/suspend', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data: user, error } = await supabase
    .from('users')
    .update({ status: 'Suspended' })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  res.json(user);
}));

export default router;
