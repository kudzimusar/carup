import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
import { getGarageCustomers, getGarageMechanics, getGarageQueue } from '../services/serviceNetwork/garageQueueService.js';

/**
 * Service Network S9 routes — garage queue and customer records.
 *
 * Both are strictly tenant-scoped: the acting tenant comes from the membership-verified
 * session context, never from a client parameter.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

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

router.get('/api/garage/queue', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getGarageQueue(supabase, req.userContext, req.query));
}));

router.get('/api/garage/customers', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getGarageCustomers(supabase, req.userContext));
}));

// The garage's own members, so a mechanic can be picked rather than a UUID typed (R5). Same tenant
// scope and same session gate as every other private garage read on this router.
router.get('/api/garage/mechanics', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getGarageMechanics(supabase, req.userContext));
}));

export default router;
