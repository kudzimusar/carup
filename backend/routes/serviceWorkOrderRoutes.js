import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
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

const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.post('/api/service-cases/:caseId/work-order', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await createWorkOrderForCase(supabase, req.userContext, req.params.caseId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.get('/api/service-work-orders/:workOrderId/assignment', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getWorkOrderAssignment(supabase, req.userContext, req.params.workOrderId));
}));

router.post('/api/service-work-orders/:workOrderId/assign', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await assignMechanic(supabase, req.userContext, req.params.workOrderId, req.body);
  res.status(result.created ? 201 : 200).json({ success: true, ...result });
}));

router.post('/api/service-work-orders/:workOrderId/unassign', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await unassignMechanic(supabase, req.userContext, req.params.workOrderId, req.body)) });
}));

router.patch('/api/service-work-orders/:workOrderId/status', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await updateWorkOrderStatus(supabase, req.userContext, req.params.workOrderId, req.body)) });
}));

export default router;
