import express from 'express';
import { supabase } from '../db/supabase.js';
import { summarizeProvenance } from '../services/provenance/recordProvenance.js';
import { loadProvenanceIndex } from '../services/provenance/provenanceContext.js';
import { authorizeRole, requireProvenIdentity } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import {
  getVerificationSessionForReview,
  getEvidencePreviewUrl,
  listVerificationSessionsForReview,
  reviewVerificationSession,
} from '../services/identity/verificationSessionService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Admin manual-review queue. authorizeRole(['admin']) rejects unauthenticated
// callers (401) and non-admins (403); the service re-checks the role as a
// defensive second gate. Responses never include private storage paths or URLs.
router.get(
  '/api/admin/identity/verification-sessions',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    const sessions = await listVerificationSessionsForReview(undefined, req.userContext, {
      status: req.query.status,
      workflow_phase: req.query.workflow_phase,
    });
    // PC01-K2B: the review queue is operational truth by default — sessions of UAT / automation /
    // certification identities are counted by class, not listed. Nothing is deleted.
    const index = await loadProvenanceIndex(supabase, { userIds: sessions.map((s) => s.user_id) });
    const classified = sessions.map((s) => ({ s, provenance: index.identity(s.user_id) || { class: 'unknown_requires_review', operational: false } }));
    const showAll = req.query.view === 'all';
    res.json({
      success: true,
      sessions: classified
        .filter((x) => showAll || x.provenance.operational)
        .map((x) => (showAll ? { ...x.s, provenance_class: x.provenance.class } : x.s)),
      provenance: { ...summarizeProvenance(classified.map((x) => x.provenance)), view: showAll ? 'all_records' : 'operational_only' },
    });
  })
);

router.get(
  '/api/admin/identity/verification-sessions/:sessionId',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    const session = await getVerificationSessionForReview(undefined, req.userContext, req.params.sessionId);
    res.json({ success: true, session });
  })
);

router.post(
  '/api/admin/identity/verification-sessions/:sessionId/review',
  authorizeRole(['admin']),
  // Deciding an identity is the most consequential action O2 takes, and it was reachable on role
  // alone: a borrowed or stolen admin session could approve a person. Owner UAT measured it against
  // a positive control — a ghost session id returned 404 (the handler ran) while the DEALER decision
  // two files away returned 403 STEP_UP_REQUIRED before any lookup. Viewing the evidence below was
  // already step-up gated, so the LESS consequential action was the better protected one.
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const result = await reviewVerificationSession(
      undefined,
      req.userContext,
      req.params.sessionId,
      req.body,
      { req }
    );
    res.json({ success: true, ...result });
  })
);

// Secure, short-lived evidence preview (Workstream G). Admin-only + session-
// scoped; returns only a signed URL (never the raw storage path), audited, and
// marked no-store so the URL is not cached by intermediaries.
router.get(
  '/api/admin/identity/verification-sessions/:sessionId/evidence/:side/preview',
  authorizeRole(['admin']),
  // This signs an object in the SAME private ocr-documents bucket — passport, national ID and
  // selfie evidence. An admin id asserted by a spoofable header must not be able to mint it.
  requireProvenIdentity(),
  // O2-X3: viewing raw identity evidence is a sensitive action — a fresh step-up is required
  // even for a proven admin session.
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const preview = await getEvidencePreviewUrl(
      undefined,
      req.userContext,
      req.params.sessionId,
      req.params.side,
      { req }
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, preview });
  })
);

export default router;
