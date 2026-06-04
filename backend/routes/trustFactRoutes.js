import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  approveTrustFactRequest,
  createTrustFactRequest,
  getTrustFactAuditTrail,
  listTrustFactReviewQueue,
  rejectTrustFactRequest,
  revokeTrustFactRequest,
} from '../services/trustGovernance/trustFactWorkflowService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function requestContext(req, sourceRoute) {
  return { req, sourceRoute };
}

router.post('/api/verification/trust-facts/:vin/requests', authorizeRole(['owner', 'dealer', 'admin', 'government']), asyncHandler(async (req, res) => {
  const result = await createTrustFactRequest(
    supabase,
    req.userContext,
    req.params.vin,
    req.body,
    requestContext(req, '/api/verification/trust-facts/:vin/requests')
  );
  res.status(201).json(result);
}));

router.get('/api/verification/review-queue', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const result = await listTrustFactReviewQueue(supabase, req.userContext, req.query);
  res.json({ requests: result, total: result.length });
}));

router.patch('/api/verification/trust-facts/:requestId/approve', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const result = await approveTrustFactRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/trust-facts/:requestId/approve')
  );
  res.json({ success: true, ...result });
}));

router.patch('/api/verification/trust-facts/:requestId/reject', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const result = await rejectTrustFactRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/trust-facts/:requestId/reject')
  );
  res.json({ success: true, request: result });
}));

router.patch('/api/verification/trust-facts/:requestId/revoke', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const result = await revokeTrustFactRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/trust-facts/:requestId/revoke')
  );
  res.json({ success: true, request: result });
}));

router.get('/api/verification/audit-trail/:vin', authorizeRole(['owner', 'dealer', 'admin', 'government']), asyncHandler(async (req, res) => {
  const events = await getTrustFactAuditTrail(supabase, req.userContext, req.params.vin);
  res.json({ vin: req.params.vin, events, total: events.length });
}));

export default router;
