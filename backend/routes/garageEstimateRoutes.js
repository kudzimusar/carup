import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import {
  GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES,
} from '../services/serviceNetwork/serviceAuthority.js';
import {
  cancelEstimate,
  createEstimateForCase,
  decideMyEstimate,
  getGarageEstimate,
  listCaseEstimates,
  listMyEstimates,
  reviseEstimate,
  sendEstimate,
  updateEstimateDraft,
} from '../services/garageOperations/garageEstimateService.js';

/**
 * GARAGE-1.0 OPS04 — estimates (garage side) and the customer's decision (customer side).
 *
 * The garage side is the verified, active Garage tenant (authorizeSessionRole + requireActiveTenant);
 * mutations are admin-only, reads are admin/mechanic. The customer side is a session-bound person who
 * must additionally be the vehicle's custodian to DECIDE (resolved inside the service, not here).
 */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const GARAGE_WORKSPACE = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES }),
];
const GARAGE_ADMIN = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES }),
];
// Same role set as the canonical work-order authorization route: the custodian is a vehicle owner,
// a governed dealer, or a platform admin; the service proves WHICH.
const CUSTOMER_ROLES = ['owner', 'dealer', 'admin'];

router.get('/api/garage/cases/:caseId/estimates', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await listCaseEstimates(supabase, req.userContext, req.params.caseId));
}));

router.post('/api/garage/cases/:caseId/estimates', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json({ estimate: await createEstimateForCase(supabase, req.userContext, req.params.caseId, req.body || {}) });
}));

router.get('/api/garage/estimates/:estimateId', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json({ estimate: await getGarageEstimate(supabase, req.userContext, req.params.estimateId) });
}));

router.put('/api/garage/estimates/:estimateId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json({ estimate: await updateEstimateDraft(supabase, req.userContext, req.params.estimateId, req.body || {}) });
}));

router.post('/api/garage/estimates/:estimateId/send', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json({ estimate: await sendEstimate(supabase, req.userContext, req.params.estimateId) });
}));

router.post('/api/garage/estimates/:estimateId/revise', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json({ estimate: await reviseEstimate(supabase, req.userContext, req.params.estimateId) });
}));

router.post('/api/garage/estimates/:estimateId/cancel', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json({ estimate: await cancelEstimate(supabase, req.userContext, req.params.estimateId, req.body || {}) });
}));

// Customer side — never exposes a draft or an internal note.
router.get('/api/service-estimates/mine', authorizeSessionRole(CUSTOMER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMyEstimates(supabase, req.userContext));
}));

router.post('/api/service-estimates/:estimateId/decision', authorizeSessionRole(CUSTOMER_ROLES), asyncHandler(async (req, res) => {
  res.json(await decideMyEstimate(supabase, req.userContext, req.params.estimateId, req.body || {}));
}));

export default router;
