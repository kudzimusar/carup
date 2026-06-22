/**
 * Governance, disputes & corrections routes — Milestone 5 (master plan §11).
 *
 *   GET  /api/governance/review-queue              unified review queue [admin/government/reviewer]
 *   POST /api/governance/decisions                 apply a governed decision [admin/government/reviewer]
 *   POST /api/governance/disputes                  raise a dispute [owner/dealer/admin]
 *   POST /api/governance/disputes/:id/respond      seller/owner response [auth]
 *   POST /api/governance/disputes/:id/assign       assign independent reviewer [admin/government/reviewer]
 *   POST /api/governance/disputes/:id/resolve      resolve (may supersede) [admin/government/reviewer]
 *   POST /api/governance/disputes/:id/appeal       appeal a resolved dispute [owner/dealer/admin]
 *   GET  /api/vehicles/:vin/disputes               disputes for a VIN [auth; public-safe for non-privileged]
 *
 * authorizeRole enforces authority server-side. A governed decision NEVER changes a trust
 * score (master plan §11.2) — trust changes flow only through recordGovernedTrustChange.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import { listReviewQueue, applyDecision, publicSafeDisputeState } from '../services/governance/governanceService.js';
import {
  submitDispute,
  respondToDispute,
  assignIndependentReviewer,
  resolveDispute,
  appealDispute,
} from '../services/governance/disputeService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const REVIEWER_ROLES = ['admin', 'government', 'reviewer'];
const RAISE_ROLES = ['owner', 'dealer', 'admin'];
const PRIVILEGED = new Set(['admin', 'government', 'reviewer']);

router.get(
  '/api/governance/review-queue',
  authorizeRole(REVIEWER_ROLES),
  asyncHandler(async (req, res) => {
    const queue = await listReviewQueue(supabase, { taskType: req.query.taskType });
    res.json({ queue, total: queue.length });
  })
);

router.post(
  '/api/governance/decisions',
  authorizeRole(REVIEWER_ROLES),
  asyncHandler(async (req, res) => {
    const { targetType, targetId, vin, decision, notes, policyVersion, reviewTaskId } = req.body || {};
    if (!targetType || !targetId || !decision) {
      throw new ValidationError('targetType, targetId and decision are required.');
    }
    const result = await applyDecision(supabase, {
      targetType,
      targetId,
      vin,
      decision,
      reviewer: req.userContext,
      notes,
      policyVersion,
      reviewTaskId: reviewTaskId || null,
      correlationId: req.correlationId || null,
    });
    res.status(201).json({ success: true, decision: result });
  })
);

router.post(
  '/api/governance/disputes',
  authorizeRole(RAISE_ROLES),
  asyncHandler(async (req, res) => {
    const { vin, subjectType, subjectId, reason } = req.body || {};
    const dispute = await submitDispute(supabase, req.userContext, { vin, subjectType, subjectId, reason });
    res.status(201).json({ success: true, dispute });
  })
);

router.post(
  '/api/governance/disputes/:id/respond',
  authorizeRole([...RAISE_ROLES, ...REVIEWER_ROLES]),
  asyncHandler(async (req, res) => {
    const dispute = await respondToDispute(supabase, req.userContext, req.params.id, { response: req.body?.response });
    res.json({ success: true, dispute });
  })
);

router.post(
  '/api/governance/disputes/:id/assign',
  authorizeRole(REVIEWER_ROLES),
  asyncHandler(async (req, res) => {
    const dispute = await assignIndependentReviewer(supabase, req.userContext, req.params.id, { reviewerId: req.body?.reviewerId });
    res.json({ success: true, dispute });
  })
);

router.post(
  '/api/governance/disputes/:id/resolve',
  authorizeRole(REVIEWER_ROLES),
  asyncHandler(async (req, res) => {
    const { resolution, outcome, targetType, targetId, policyVersion } = req.body || {};
    const dispute = await resolveDispute(supabase, req.userContext, req.params.id, {
      resolution,
      outcome,
      targetType,
      targetId,
      policyVersion,
    });
    res.json({ success: true, dispute });
  })
);

router.post(
  '/api/governance/disputes/:id/appeal',
  authorizeRole(RAISE_ROLES),
  asyncHandler(async (req, res) => {
    const dispute = await appealDispute(supabase, req.userContext, req.params.id, { reason: req.body?.reason });
    res.json({ success: true, dispute });
  })
);

router.get(
  '/api/vehicles/:vin/disputes',
  authorizeRole(['owner', 'dealer', 'admin', 'government', 'reviewer', 'buyer', 'member']),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('disputes')
      .select('*')
      .eq('vin', req.params.vin)
      .order('created_at', { ascending: false });
    if (error) {
      throw new ValidationError(`Failed to load disputes: ${error.message}`);
    }

    const role = String(req.userContext?.role || '').toLowerCase();
    const rows = data || [];

    if (PRIVILEGED.has(role)) {
      return res.json({ vin: req.params.vin, disputes: rows, total: rows.length });
    }

    // Non-privileged callers get a public-safe projection only.
    const disputes = rows.map((row) => ({
      subject_type: row.subject_type,
      status: row.status,
      created_at: row.created_at,
      ...publicSafeDisputeState({ ...row, reviewer_state: row.status }),
    }));
    res.json({ vin: req.params.vin, disputes, total: disputes.length });
  })
);

export default router;
