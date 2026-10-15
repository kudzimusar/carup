import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';
import { classifyIdentity, summarizeProvenance } from '../services/provenance/recordProvenance.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// GET /api/users/management - Super admin user management
// The admin user console is allow-listed, never `select('*')`. `users` carries `password_hash`
// (added by 20260613010000_users_password_hash), and a `*` projection served every credential hash
// to the browser for an authenticated admin — a real credential-disclosure defect, not a role gap.
// This column set is exactly the base-schema user shape the frontend `User` type consumes; any
// future credential/secret column added to `users` stays excluded by construction because it is not
// named here.
const ADMIN_USER_COLUMNS =
  'id, name, email, avatar, role, phone, location, is_verified, subscription, join_date, created_at';

router.get('/api/users/management', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(ADMIN_USER_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw new DatabaseError(error.message);
  res.json(data || []);
}));

// GET /api/admin/stats - System wide stats
router.get('/api/admin/stats', authorizeRole(['admin']), asyncHandler(async (_req, res) => {
  const { count: userCount, error: userErr } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: vehicleCount, error: vehicleErr } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  // Issue #164 Phase 6: `totalEscrows` is a compatibility response key, but its source of truth is
  // the canonical transaction/session table. Counting the retired safepay_escrows table would make
  // the admin console report a second transaction universe after the Marketplace cutover.
  const { count: escrowCount, error: escrowErr } = await supabase.from('escrow_trust_sessions').select('*', { count: 'exact', head: true });
  const { count: claimsCount, error: claimsErr } = await supabase.from('insurance_claims').select('*', { count: 'exact', head: true });

  if (userErr || vehicleErr || escrowErr || claimsErr) {
    throw new DatabaseError('Failed to query system stats');
  }

  res.json({
    totalUsers: userCount || 0,
    totalVehicles: vehicleCount || 0,
    totalEscrows: escrowCount || 0,
    totalClaims: claimsCount || 0,
    // `systemHealth: 'Optimal'` and `aiConfidence: '98.5%'` were string literals
    // returned by this endpoint. CarUp measures neither: there is no health check
    // behind the first, and no fraud-interception rate is computed anywhere — the
    // second was rendered to an administrator as "Fraud Intercept Rate 98.5%".
    // A metric with no measurement behind it is not reported at all.
  });
}));

// POST /api/users/:id/suspend — retired (PC01-K2B).
//
// ACCOUNT SUSPENSION — PRODUCT / AUTHORITY GAP. This used to rewrite `users.role` to 'suspended',
// which is not an account lifecycle: it destroys the person's real role and nothing downstream reads
// it as a suspension. Its sibling below wrote `users.status`, a column that does not exist, so the
// Admin "Suspend User" control always failed. Neither is offered as a working control; the governed
// account lifecycle belongs to the People & Access phase. Both answer 501 and change nothing.
const ACCOUNT_SUSPENSION_GAP = Object.freeze({
  error: 'Account suspension is not available yet.',
  code: 'ACCOUNT_SUSPENSION_UNAVAILABLE',
  gap: 'ACCOUNT SUSPENSION — PRODUCT / AUTHORITY GAP',
});

router.post('/api/users/:id/suspend', authorizeRole(['admin']), (_req, res) => {
  res.status(501).json(ACCOUNT_SUSPENSION_GAP);
});

// GET /api/admin/health - Server health history
router.get('/api/admin/health', authorizeRole(['admin']), asyncHandler(async (_req, res) => {
  const { data: health, error } = await supabase
    .from('server_health')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json(health);
}));

// GET /api/admin/users - Admin users list
//
// PC01-K2B: operational accounts by default, classified by the provenance authority; the response
// says how many accounts were set aside and why (UAT, automation, certification, needs review), so
// their existence is stated rather than hidden. `?view=all` returns every account with its class.
router.get('/api/admin/users', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select(ADMIN_USER_COLUMNS)
    .order('join_date', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  const classified = (users || []).map((user) => ({ user, provenance: classifyIdentity(user) }));
  const showAll = String(req.query?.view || '') === 'all';
  res.json({
    users: classified
      .filter((c) => showAll || c.provenance.operational)
      .map((c) => ({ ...c.user, provenance_class: c.provenance.class })),
    provenance: { ...summarizeProvenance(classified.map((c) => c.provenance)), view: showAll ? 'all_records' : 'operational_only' },
  });
}));

// PATCH /api/admin/users/:id/suspend — retired with its sibling above (ACCOUNT SUSPENSION — PRODUCT /
// AUTHORITY GAP). It wrote `users.status`, which does not exist, so every call failed.
router.patch('/api/admin/users/:id/suspend', authorizeRole(['admin']), (_req, res) => {
  res.status(501).json(ACCOUNT_SUSPENSION_GAP);
});

export default router;
