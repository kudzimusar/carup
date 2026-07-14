import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  approvePartSentryReviewRequest,
  clearPartSentrySuspicion,
  createPartSentryReviewRequest,
  flagPartSentrySuspicion,
  getPartSentryLogForReview,
  getPartSentryReviewAuditTrail,
  listPartSentryReviewQueue,
  rejectPartSentryReviewRequest,
  revokePartSentryReviewRequest,
} from '../services/trustGovernance/partsentryReviewService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function requestContext(req, sourceRoute) {
  return { req, sourceRoute };
}

router.post('/api/verification/partsentry/:logId/requests', authorizeRole(['mechanic', 'owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const result = await createPartSentryReviewRequest(
    supabase,
    req.userContext,
    req.params.logId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:logId/requests')
  );
  res.status(201).json(result);
}));

router.get('/api/verification/partsentry/review-queue', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const requests = await listPartSentryReviewQueue(supabase, req.userContext, req.query);
  res.json({ requests, total: requests.length });
}));

router.patch('/api/verification/partsentry/:requestId/approve', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const result = await approvePartSentryReviewRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:requestId/approve')
  );
  res.json({ success: true, ...result });
}));

router.patch('/api/verification/partsentry/:requestId/reject', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const request = await rejectPartSentryReviewRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:requestId/reject')
  );
  res.json({ success: true, request });
}));

router.patch('/api/verification/partsentry/:requestId/revoke', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const request = await revokePartSentryReviewRequest(
    supabase,
    req.userContext,
    req.params.requestId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:requestId/revoke')
  );
  res.json({ success: true, request });
}));

router.patch('/api/verification/partsentry/:logId/flag-suspicion', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const result = await flagPartSentrySuspicion(
    supabase,
    req.userContext,
    req.params.logId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:logId/flag-suspicion')
  );
  res.json({ success: true, ...result });
}));

router.patch('/api/verification/partsentry/:logId/clear-suspicion', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const result = await clearPartSentrySuspicion(
    supabase,
    req.userContext,
    req.params.logId,
    req.body,
    requestContext(req, '/api/verification/partsentry/:logId/clear-suspicion')
  );
  res.json({ success: true, ...result });
}));

router.get('/api/verification/partsentry/audit-trail/:vin', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const events = await getPartSentryReviewAuditTrail(supabase, req.userContext, req.params.vin);
  res.json({ vin: req.params.vin, events, total: events.length });
}));

router.get('/api/verification/partsentry/logs/:logId', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const log = await getPartSentryLogForReview(supabase, req.userContext, req.params.logId);
  res.json({ log });
}));

export default router;
