import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
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
 * verified by authorizeRole), never from a client-supplied parameter, and a case
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

const REQUESTER_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];
const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

// ── requester side ──
router.post('/api/service-cases', authorizeRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  const result = await requestServiceCase(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.get('/api/service-cases/mine', authorizeRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMyServiceCases(supabase, req.userContext));
}));

// ── garage side ──
router.get('/api/garage/service-cases', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await listGarageServiceCases(supabase, req.userContext, req.query));
}));

router.post('/api/service-cases/:caseId/accept', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await acceptServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/decline', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await declineServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

router.post('/api/service-cases/:caseId/start', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await startServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

router.post('/api/service-cases/:caseId/complete', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await completeServiceCase(supabase, req.userContext, req.params.caseId)) });
}));

// ── either participant ──
router.get('/api/service-cases/:caseId', authorizeRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json(await getServiceCase(supabase, req.userContext, req.params.caseId));
}));

router.post('/api/service-cases/:caseId/cancel', authorizeRole(REQUESTER_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await cancelServiceCase(supabase, req.userContext, req.params.caseId, req.body)) });
}));

export default router;
