import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { biometricContract } from '../services/identity/biometrics/biometricContractService.js';
import { confirmApplicantOcr } from '../services/identity/applicantOcrConfirmation.js';
import {
  createVerificationSession,
  getLatestVerificationSessionForUser,
  getVerificationSession,
  submitVerificationSession,
  uploadVerificationSessionImage,
} from '../services/identity/verificationSessionService.js';

const router = express.Router();

router.use('/api/identity/verification-sessions', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.post('/api/identity/verification-sessions', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const session = await createVerificationSession(undefined, req.userContext, req.body, { req });
  res.status(201).json({ success: true, session });
}));

router.post('/api/identity/verification-sessions/:sessionId/upload/:side', authorizeSessionRole(), asyncHandler(async (req, res) => {
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

router.post('/api/identity/verification-sessions/:sessionId/submit', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const session = await submitVerificationSession(undefined, req.userContext, req.params.sessionId, { req });
  res.json({ success: true, session });
}));

router.post('/api/identity/verification-sessions/:sessionId/ocr-confirmation', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const confirmation = await confirmApplicantOcr(supabase, req.userContext, req.params.sessionId, req.body);
  res.json({ success: true, confirmation });
}));

router.get('/api/identity/verification-sessions/:sessionId/biometrics', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const biometric = await biometricContract(supabase, req.userContext, req.params.sessionId, 'state');
  res.json({ success: true, biometric });
}));

for (const operation of ['grant', 'withdraw', 'assess']) {
  router.post(`/api/identity/verification-sessions/:sessionId/biometrics/${operation}`, authorizeSessionRole(), asyncHandler(async (req, res) => {
    const biometric = await biometricContract(supabase, req.userContext, req.params.sessionId, operation, req.body);
    res.json({ success: true, biometric });
  }));
}

// ENTRY PREFLIGHT: the applicant's latest session — registered BEFORE the
// :sessionId route so "latest" is never captured as an id.
router.get('/api/identity/verification-sessions/latest', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const session = await getLatestVerificationSessionForUser(undefined, req.userContext);
  res.json({ success: true, session });
}));

router.get('/api/identity/verification-sessions/:sessionId', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const session = await getVerificationSession(undefined, req.userContext, req.params.sessionId);
  res.json({ success: true, session });
}));

export default router;
