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
import { supabase } from '../db/supabase.js';
import { summarizeProvenance } from '../services/provenance/recordProvenance.js';
import { loadProvenanceIndex } from '../services/provenance/provenanceContext.js';

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
    // PC01-K2B: the queue is operational truth by default. A case raised on a certification / UAT
    // vehicle is set aside and counted by class, never deleted or hidden from existence.
    const index = await loadProvenanceIndex(supabase, { vins: cases.map((c) => c.vin) });
    const classified = cases.map((c) => ({ c, provenance: index.vehicle(c.vin) || { class: 'unknown_requires_review', operational: false } }));
    const showAll = req.query.view === 'all';
    res.json({
      cases: classified
        .filter((x) => showAll || x.provenance.operational)
        .map((x) => (showAll ? { ...x.c, provenance_class: x.provenance.class } : x.c)),
      provenance: { ...summarizeProvenance(classified.map((x) => x.provenance)), view: showAll ? 'all_records' : 'operational_only' },
    });
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
