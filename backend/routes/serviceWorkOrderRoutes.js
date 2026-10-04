import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
import {
  assignMechanic,
  createWorkOrderForCase,
  getWorkOrderAssignment,
  unassignMechanic,
  updateWorkOrderStatus,
} from '../services/serviceNetwork/workOrderAssignmentService.js';

/**
 * Service Network S4 routes — work-order convergence and mechanic assignment.
 *
 * These sit ALONGSIDE the existing /api/mechanic/work-orders routes, which keep
 * working unchanged for legacy clients. They add the Service-Case-linked intake,
 * the durable assignment authority and the guarded status transition — none of
 * which the legacy route can express.
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

router.post('/api/service-cases/:caseId/work-order', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  const result = await createWorkOrderForCase(supabase, req.userContext, req.params.caseId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.get('/api/service-work-orders/:workOrderId/assignment', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getWorkOrderAssignment(supabase, req.userContext, req.params.workOrderId));
}));

router.post('/api/service-work-orders/:workOrderId/assign', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await assignMechanic(supabase, req.userContext, req.params.workOrderId, req.body);
  res.status(result.created ? 201 : 200).json({ success: true, ...result });
}));

router.post('/api/service-work-orders/:workOrderId/unassign', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await unassignMechanic(supabase, req.userContext, req.params.workOrderId, req.body)) });
}));

router.patch('/api/service-work-orders/:workOrderId/status', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await updateWorkOrderStatus(supabase, req.userContext, req.params.workOrderId, req.body)) });
}));

export default router;
