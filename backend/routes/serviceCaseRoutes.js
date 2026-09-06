import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, authorizeTenantRole } from '../middleware/authMiddleware.js';
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

// Service Network auth hardening: every consequential route below composes `authorizeSessionRole`,
// NOT `authorizeRole`. The difference is `allowUserIdFallback: false` — a spoofable `x-user-id`
// header can never stand in for a real session on a route that creates a case, moves work, assigns a
// mechanic, reads a garage's private customer list, or mints/redeems/revokes a capability.
// `isUserIdFallbackAllowed()` already closes that header in production deployments, but a private
// garage workspace must not depend on one environment variable being right; the route states its own
// requirement. The public directory reads and the anonymous service-link resolver deliberately keep
// their weaker gates — see the comments at those routes.
const REQUESTER_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];
// GMO-5: these routes are TENANT-scoped — `admin` here means "an administrator of this garage",
// never a CarUp administrator. `authorizeTenantRole` therefore also accepts a verified
// `tenant_users` membership in one of these roles, which is what lets a garage founder (platform
// `owner`, tenant `admin`) open the garage they were just given. It is opt-in precisely because
// applying it to routes where 'admin' means PLATFORM admin was demonstrated to be exploitable.
const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

// ── requester side ──
router.post('/api/service-cases', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  const result = await requestServiceCase(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.get('/api/service-cases/mine', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMyServiceCases(supabase, req.userContext));
}));

// ── garage side ──
router.get('/api/garage/service-cases', authorizeTenantRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await listGarageServiceCases(supabase, req.userContext, req.query));
}));

router.post('/api/service-cases/:caseId/accept', authorizeTenantRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await acceptServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/decline', authorizeTenantRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await declineServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/start', authorizeTenantRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await startServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

router.post('/api/service-cases/:caseId/complete', authorizeTenantRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await completeServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

// ── either participant ──
router.get('/api/service-cases/:caseId', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json(await getServiceCase(supabase, req.userContext, req.params.caseId));
}));

router.post('/api/service-cases/:caseId/cancel', authorizeSessionRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await cancelServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

export default router;
