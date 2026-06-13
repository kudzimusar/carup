import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createVerificationSession,
  getVerificationSession,
  submitVerificationSession,
  uploadVerificationSessionImage,
} from '../services/identity/verificationSessionService.js';

const router = express.Router();

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

router.get('/api/identity/verification-sessions/:sessionId', authorizeRole(), asyncHandler(async (req, res) => {
  const session = await getVerificationSession(undefined, req.userContext, req.params.sessionId);
  res.json({ success: true, session });
}));

export default router;
