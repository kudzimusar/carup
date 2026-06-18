import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
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
    });
    res.json({ success: true, sessions });
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
  asyncHandler(async (req, res) => {
    const session = await reviewVerificationSession(
      undefined,
      req.userContext,
      req.params.sessionId,
      req.body,
      { req }
    );
    res.json({ success: true, session });
  })
);

// Secure, short-lived evidence preview (Workstream G). Admin-only + session-
// scoped; returns only a signed URL (never the raw storage path), audited, and
// marked no-store so the URL is not cached by intermediaries.
router.get(
  '/api/admin/identity/verification-sessions/:sessionId/evidence/:side/preview',
  authorizeRole(['admin']),
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
