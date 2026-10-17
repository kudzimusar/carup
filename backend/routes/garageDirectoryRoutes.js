import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
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
// OC-5D — re-gated on the VERIFIED ACTIVE GARAGE. #197 gated these routes on platform role lists
// (GARAGE_ROLES = mechanic/dealer/admin) that a TENANT role could satisfy, with the garage taken from
// the session's guessed or header-asserted tenant. Now every garage-side route is a real session
// (`authorizeSessionRole()` — never the x-user-id fallback) PLUS `requireActiveTenant`: the person
// selected this garage, the membership and the garage's active status are re-verified on this request,
// the organisation is a garage, and their role INSIDE it is in the route's set. The tenant role never
// becomes a platform role, a platform 'dealer' or 'mechanic' without a garage membership is refused,
// and there is no platform-admin bypass. The services re-check the same rule (serviceAuthority).
const GARAGE_WORKSPACE = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })];
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

router.get('/api/garage/profile', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  const result = await getMyGarageProfile(supabase, req.userContext);
  res.json(result);
}));

router.put('/api/garage/profile', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await upsertMyGarageProfile(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/garage/profile/publish', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await publishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/profile/unpublish', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await unpublishMyGarageProfile(supabase, req.userContext);
  res.json({ success: true, ...result });
}));

router.post('/api/garage/branches', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await createMyGarageBranch(supabase, req.userContext, req.body);
  res.status(201).json(result);
}));

router.delete('/api/garage/branches/:branchId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await deactivateMyGarageBranch(supabase, req.userContext, req.params.branchId);
  res.json({ success: true, ...result });
}));

export default router;
