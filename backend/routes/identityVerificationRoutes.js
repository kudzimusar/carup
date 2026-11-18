import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { veriffTestEnabled } from '../services/identity/biometrics/veriffTestTransport.js';
import { biometricContract, recordVeriffTestWebhook, veriffTestAttempt } from '../services/identity/biometrics/biometricContractService.js';
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

const veriffTestPath = '/api/identity/verification-sessions/:sessionId/biometrics/veriff-test';

router.post(veriffTestPath + '/start', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const biometric = await veriffTestAttempt(supabase, req.userContext, req.params.sessionId, req.body?.requestId, 'start', req.body);
  res.json({ success: true, biometric });
}));

router.post(veriffTestPath + '/:requestId/recover', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const biometric = await veriffTestAttempt(supabase, req.userContext, req.params.sessionId, req.params.requestId, 'recover', req.body);
  res.json({ success: true, biometric });
}));

// Mounted only on the dedicated callback path, before JSON and browser CSRF.
const veriffRawBody = express.raw({ type: 'application/json', limit: '32kb', inflate: false });

export function identityVeriffTestWebhook(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!veriffTestEnabled()) return res.sendStatus(503);
  veriffRawBody(req, res, async parseError => {
    if (parseError) return res.sendStatus([400, 413, 415].includes(parseError.status) ? parseError.status : 400);
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
    try {
      const outcome = await recordVeriffTestWebhook(supabase, req.body, req.get('X-AUTH-CLIENT'), req.get('X-HMAC-SIGNATURE'));
      res.json({ outcome });
    } catch (error) {
      // Never pass provider body content or credentials to generic request logging.
      res.sendStatus([400, 401].includes(error.statusCode) ? error.statusCode : 503);
    }
  });
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
