/**
 * Visual & disclosure intelligence routes — Milestone 3 (master plan §7-§9, §15).
 *
 *   POST /api/evidence/:evidenceId/analyze           run a typed analysis task [admin/government]
 *   GET  /api/vehicles/:vin/temporal-findings        component-change findings (role-scoped, public-safe)
 *   POST /api/vehicles/:vin/disclosure-scan          extract claims + classify conflicts [admin]
 *   GET  /api/vehicles/:vin/disclosure-conflicts     disclosure conflicts (role-scoped, public-safe)
 *   POST /api/disclosure-conflicts/:id/seller-response  seller response [owner/dealer/admin]
 *
 * Public output is strictly allowlisted: anonymous/non-privileged callers receive only
 * reviewer-CONFIRMED findings with a neutral public_summary; raw model output, internal
 * explanations, and pending findings never leak (master plan §8.9, §9.6).
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { analyzeEvidence } from '../services/ai/analysisJobService.js';
import { listTemporalFindings } from '../services/intelligence/temporalComparison.js';
import { extractClaims, classifyConflict, persistClaims, persistConflict, applySellerResponse } from '../services/intelligence/disclosureConflict.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const PRIVILEGED = ['admin', 'government', 'reviewer'];

function publicSafeFinding(f) {
  return {
    finding_type: f.finding_type, component: f.component,
    earlier_date: f.earlier_date, later_date: f.later_date,
    severity: f.severity, public_summary: f.public_summary, reviewer_state: f.reviewer_state,
  };
}
function publicSafeConflict(c) {
  return {
    conflict_type: c.conflict_type, classification: c.classification,
    severity: c.severity, public_summary: c.public_summary, reviewer_state: c.reviewer_state,
    seller_response: c.seller_response || null,
  };
}

router.post('/api/evidence/:evidenceId/analyze', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const taskType = req.body.task_type || req.body.taskType;
  if (!taskType) throw new ValidationError('task_type is required');
  const job = await analyzeEvidence(supabase, {
    evidenceId: req.params.evidenceId, vin: req.body.vin || null, taskType,
    ctx: { metadata: req.body.metadata || {} },
  });
  res.status(202).json(job);
}));

// These two reads back public Marketplace. They must not produce a 401 for an
// anonymous buyer. optionalAuth preserves privileged projections for signed-in
// reviewers/admins while allowing the deliberately allowlisted public projection.
router.get('/api/vehicles/:vin/temporal-findings', optionalAuth(), asyncHandler(async (req, res) => {
  const role = req.userContext?.role;
  const all = await listTemporalFindings(supabase, req.params.vin);
  if (PRIVILEGED.includes(role)) return res.json({ findings: all });
  const safe = all.filter((f) => f.reviewer_state === 'confirmed' && f.public_summary).map(publicSafeFinding);
  res.json({ findings: safe });
}));

router.post('/api/vehicles/:vin/disclosure-scan', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const snapshot = req.body.snapshot;
  if (!snapshot || !snapshot.id) throw new ValidationError('snapshot {id,...} is required');
  const evidenceContext = req.body.evidence_context || {};
  const claims = await persistClaims(supabase, extractClaims({ ...snapshot, vin: req.params.vin }));
  const conflicts = [];
  for (const claim of claims) {
    const c = classifyConflict(claim, evidenceContext);
    if (c) conflicts.push(await persistConflict(supabase, c));
  }
  res.status(201).json({ claims_extracted: claims.length, conflicts });
}));

router.get('/api/vehicles/:vin/disclosure-conflicts', optionalAuth(), asyncHandler(async (req, res) => {
  const role = req.userContext?.role;
  const { data } = await supabase.from('disclosure_conflicts').select('*').eq('vin', req.params.vin).order('created_at', { ascending: false });
  const all = data || [];
  if (PRIVILEGED.includes(role)) return res.json({ conflicts: all });
  const safe = all.filter((c) => c.reviewer_state === 'confirmed' && c.public_summary).map(publicSafeConflict);
  res.json({ conflicts: safe });
}));

router.post('/api/disclosure-conflicts/:id/seller-response', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const response = req.body.response;
  if (!response) throw new ValidationError('response is required');
  let updated;
  try {
    updated = await applySellerResponse(supabase, req.params.id, { response, actorId: req.userContext?.id || null });
  } catch (err) {
    throw new NotFoundError(err.message);
  }
  res.json({ id: updated.id, seller_response: updated.seller_response, correction_history: updated.correction_history });
}));

export default router;
