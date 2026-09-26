import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  getBiometricConsentState,
  grantBiometricConsent,
  withdrawBiometricConsent,
} from '../services/identity/biometrics/biometricConsentService.js';
import { runBiometricAssessment } from '../services/identity/biometrics/biometricAssessmentService.js';

/**
 * O2-X4 — applicant biometric consent + assessment.
 *
 * Self-scoped throughout: the subject is always req.userContext, so consent can never be
 * granted, withdrawn or read for another user, and an assessment can only run on the caller's
 * OWN verification session. The assessment route accepts NO scores, statuses or verdicts —
 * only the session id in the path; every biometric fact is provider-derived server-side.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/api/identity/biometric-consent', authorizeRole(), asyncHandler(async (req, res) => {
  const consent = await getBiometricConsentState(undefined, req.userContext);
  res.json({ success: true, consent });
}));

router.post('/api/identity/biometric-consent', authorizeRole(), asyncHandler(async (req, res) => {
  const consent = await grantBiometricConsent(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({
    success: true,
    consent: { id: consent.id, status: consent.status, purposes: consent.purposes, consent_text_version: consent.consent_text_version, created_at: consent.created_at },
  });
}));

router.post('/api/identity/biometric-consent/withdraw', authorizeRole(), asyncHandler(async (req, res) => {
  const withdrawal = await withdrawBiometricConsent(undefined, req.userContext, req.body || {}, { req });
  res.json({ success: true, withdrawal: { id: withdrawal.id, status: withdrawal.status, created_at: withdrawal.created_at } });
}));

router.post('/api/identity/verification-sessions/:sessionId/biometrics', authorizeRole(), asyncHandler(async (req, res) => {
  const result = await runBiometricAssessment(undefined, req.userContext, req.params.sessionId, { req });
  res.status(201).json({ success: true, biometric: result.applicant_view });
}));

export default router;
