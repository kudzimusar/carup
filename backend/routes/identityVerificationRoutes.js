import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import ocrConvergenceRouter from './ocrConvergenceRoutes.js';
import {
  createVerificationSession,
  getLatestVerificationSessionForUser,
  getVerificationSession,
  submitVerificationSession,
  uploadVerificationSessionImage,
} from '../services/identity/verificationSessionService.js';

const router = express.Router();

// OCR Path Convergence is mounted here because this router is itself mounted at the gateway root
// before both the historical /api/ai/ocr handler and the Diaspora bounded-context router. Keeping
// the ordering explicit makes the two retired truth-breaking routes fail closed without changing
// the O2 identity authority boundary; the convergence router owns no identity decision.
router.use(ocrConvergenceRouter);

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.post('/api/identity/verification-sessions', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await createVerificationSession(undefined, req.userContext, req.body, { req });
  res.status(201).json({ success: true, session });
}));

router.post('/api/identity/verification-sessions/:sessionId/upload/:side', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await uploadVerificationSessionImage(
    undefined,
    req.userContext,
    req.params.sessionId,
    req.params.side,
    req.body,
    { req }
  );
  res.json({ success: true, session });
}));

router.post('/api/identity/verification-sessions/:sessionId/submit', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await submitVerificationSession(undefined, req.userContext, req.params.sessionId, { req });
  res.json({ success: true, session });
}));

// ENTRY PREFLIGHT: the applicant's latest session — registered BEFORE the
// :sessionId route so "latest" is never captured as an id.
router.get('/api/identity/verification-sessions/latest', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await getLatestVerificationSessionForUser(undefined, req.userContext);
  res.json({ success: true, session });
}));

router.get('/api/identity/verification-sessions/:sessionId', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await getVerificationSession(undefined, req.userContext, req.params.sessionId);
  res.json({ success: true, session });
}));

export default router;
