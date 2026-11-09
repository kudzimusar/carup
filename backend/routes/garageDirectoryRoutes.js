import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
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
 * tenant from req.userContext (membership-verified by authorizeSessionRole), never from a
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
// Service Network auth hardening: every consequential route below composes `authorizeSessionRole`,
// NOT `authorizeRole`. The difference is `allowUserIdFallback: false` — a spoofable `x-user-id`
// header can never stand in for a real session on a route that creates a case, moves work, assigns a
// mechanic, reads a garage's private customer list, or mints/redeems/revokes a capability.
// `isUserIdFallbackAllowed()` already closes that header in production deployments, but a private
// garage workspace must not depend on one environment variable being right; the route states its own
// requirement. The public directory reads and the anonymous service-link resolver deliberately keep
// their weaker gates — see the comments at those routes.
const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.get('/api/garage/profile', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await getMyGarageProfile(supabase, req.userContext);
  res.json(result);
}));

router.put('/api/garage/profile', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await upsertMyGarageProfile(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/garage/profile/publish', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await publishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/profile/unpublish', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await unpublishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/branches', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await createMyGarageBranch(supabase, req.userContext, req.body);
  res.status(201).json(result);
}));

router.delete('/api/garage/branches/:branchId', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await deactivateMyGarageBranch(supabase, req.userContext, req.params.branchId);
  res.json({ success: true, ...result });
}));

export default router;
