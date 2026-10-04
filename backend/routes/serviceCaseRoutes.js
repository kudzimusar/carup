import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
import {
  acceptServiceCase,
  cancelServiceCase,
  completeServiceCase,
  declineServiceCase,
  getServiceCase,
  listGarageServiceCases,
  listMyServiceCases,
  requestServiceCase,
  startServiceCase,
} from '../services/serviceNetwork/serviceCaseService.js';

/**
 * Service Network S2 routes — Canonical Service Case.
 *
 * Every endpoint is session-authenticated; there is no public Service Case surface.
 * Garage-side actions derive the acting tenant from req.userContext (membership
 * verified by authorizeSessionRole), never from a client-supplied parameter, and a case
 * belonging to another tenant reads as 404 rather than 403 so the API is not an
 * existence oracle.
 *
 * Routes validate and delegate: authorization policy, the state machine, history
 * and event emission all live in the service (plan §23).
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
const REQUESTER_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];
const GARAGE_WORKSPACE = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })];
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

// ── requester side ──
router.post('/api/service-cases', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  const result = await requestServiceCase(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.get('/api/service-cases/mine', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMyServiceCases(supabase, req.userContext));
}));

// ── garage side ──
router.get('/api/garage/service-cases', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await listGarageServiceCases(supabase, req.userContext, req.query));
}));

router.post('/api/service-cases/:caseId/accept', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await acceptServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/decline', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await declineServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/start', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await startServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

router.post('/api/service-cases/:caseId/complete', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await completeServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

// ── either participant ── (a session; the service decides: the requester, or the VERIFIED active garage)
router.get('/api/service-cases/:caseId', authorizeSessionRole(), asyncHandler(async (req, res) => {
  res.json(await getServiceCase(supabase, req.userContext, req.params.caseId));
}));

router.post('/api/service-cases/:caseId/cancel', authorizeSessionRole(), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await cancelServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

export default router;
