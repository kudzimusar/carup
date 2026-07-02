/**
 * Fraud + Duplicate Detection routes — Workstream A.
 *
 *   POST  /api/vehicles/:vin/fraud/evaluate   run the fraud engine, persist signals + case (admin/reviewer)
 *   GET   /api/fraud/cases                     investigation queue, filterable (admin/government/reviewer)
 *   GET   /api/fraud/cases/:id                 one case + its signals + append-only event trail
 *   PATCH /api/fraud/cases/:id/resolve         record a governed resolution (writes resolution + event)
 *
 * All endpoints are privileged. The evaluate trigger is admin/reviewer; the queue and case
 * actions are admin/government/reviewer. Buyers/dealers never touch fraud internals here.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { evaluateAndPersist } from '../services/fraud/fraudEngine.js';
import { listOpenCases, getCase, resolveCase } from '../services/fraud/fraudCaseService.js';

const router = express.Router();

const QUEUE_ROLES = ['admin', 'government', 'reviewer'];
const EVALUATE_ROLES = ['admin', 'reviewer'];

router.post('/api/vehicles/:vin/fraud/evaluate', authorizeRole(EVALUATE_ROLES), async (req, res, next) => {
  try {
    const result = await evaluateAndPersist(req.params.vin, {
      actorId: req.userContext?.userId,
      actorRole: req.userContext?.role,
      reason: req.body?.reason,
    });
    res.json({
      case: result.case,
      signals: result.signals,
      block: result.block,
    });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.get('/api/fraud/cases', authorizeRole(QUEUE_ROLES), async (req, res, next) => {
  try {
    const cases = await listOpenCases({
      severity: req.query.severity,
      status: req.query.status,
      tenant_id: req.query.tenant_id,
    });
    res.json({ cases });
  } catch (err) {
    next(err);
  }
});

router.get('/api/fraud/cases/:id', authorizeRole(QUEUE_ROLES), async (req, res, next) => {
  try {
    const theCase = await getCase(req.params.id);
    if (!theCase) return res.status(404).json({ error: `Fraud case not found: ${req.params.id}` });
    res.json({ case: theCase });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/fraud/cases/:id/resolve', authorizeRole(QUEUE_ROLES), async (req, res, next) => {
  try {
    const result = await resolveCase(
      req.params.id,
      { resolution: req.body?.resolution, reason: req.body?.reason },
      { id: req.userContext?.userId, role: req.userContext?.role },
    );
    res.json({ case: result.case, resolution: result.resolution });
  } catch (err) {
    if (/Fraud case not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/resolution must be|authenticated actor/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
