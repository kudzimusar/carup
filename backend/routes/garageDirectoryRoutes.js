import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createMyGarageBranch,
  deactivateMyGarageBranch,
  getMyGarageProfile,
  getPublicGarageDetail,
  getPublicGarageDirectory,
  publishMyGarageProfile,
  unpublishMyGarageProfile,
  upsertMyGarageProfile,
} from '../services/serviceNetwork/garageDirectoryService.js';

/**
 * Service Network S1 routes.
 *
 * Public reads are genuinely unauthenticated (directory + detail) and expose ONLY
 * the published, public-safe projection — never internal tenant ids, never a draft.
 *
 * Garage-side writes are session-verified and tenant-scoped: the service derives the
 * tenant from req.userContext (membership-verified by authorizeRole), never from a
 * client-supplied tenant parameter. Routes validate and delegate — no route here
 * authorizes, mutates five tables, sends email, computes trust or writes Passport
 * (plan §23).
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ── public directory (unauthenticated, published-only) ──
router.get('/api/garage-directory', asyncHandler(async (req, res) => {
  const result = await getPublicGarageDirectory(supabase, req.query);
  res.json(result);
}));

router.get('/api/garage-directory/:slug', asyncHandler(async (req, res) => {
  const result = await getPublicGarageDetail(supabase, req.params.slug);
  res.json(result);
}));

// ── garage-side identity management (session + tenant membership verified) ──
const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.get('/api/garage/profile', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await getMyGarageProfile(supabase, req.userContext);
  res.json(result);
}));

router.put('/api/garage/profile', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await upsertMyGarageProfile(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/garage/profile/publish', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await publishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/profile/unpublish', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await unpublishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/branches', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await createMyGarageBranch(supabase, req.userContext, req.body);
  res.status(201).json(result);
}));

router.delete('/api/garage/branches/:branchId', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await deactivateMyGarageBranch(supabase, req.userContext, req.params.branchId);
  res.json({ success: true, ...result });
}));

export default router;
