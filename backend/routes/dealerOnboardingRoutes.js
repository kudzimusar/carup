import express from 'express';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  requireDealerOnboardingContext,
  getDealerOnboardingOverview,
  updateOwnDealerProfile,
  uploadOwnDealerEvidence,
  getOwnDealerEvidencePreview,
  addOwnDealerBranch,
  DEALER_DOCUMENT_TYPES,
} from '../services/dealer/dealerOnboardingService.js';

/**
 * O2-X5 — Dealer ONBOARDING self-service (applicant lane; ported by OC-5C from PR #208).
 *
 * Access = a caller whose OWN registration profile says business+dealer (requireDealerOnboardingContext)
 * — onboarding capability only, never Dealer authority. Every route is self-scoped by construction:
 * the subject is req.userContext, never a path or body parameter. Writes need a real session.
 * Company-document OCR is not offered (deferred to the governed OCR pattern); the workbook migration
 * lane is mounted separately.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const read = [authorizeRole(), requireDealerOnboardingContext()];
const write = [authorizeSessionRole(), requireDealerOnboardingContext()];

router.get('/api/dealer-onboarding/overview', ...read, asyncHandler(async (req, res) => {
  const overview = await getDealerOnboardingOverview(undefined, req.userContext);
  res.json({ success: true, ...overview, document_types: DEALER_DOCUMENT_TYPES });
}));

router.put('/api/dealer-onboarding/profile', ...write, asyncHandler(async (req, res) => {
  const result = await updateOwnDealerProfile(undefined, req.userContext, req.body || {}, { req });
  res.json({ success: true, ...result });
}));

router.post('/api/dealer-onboarding/documents', ...write, asyncHandler(async (req, res) => {
  const result = await uploadOwnDealerEvidence(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, ...result });
}));

router.get('/api/dealer-onboarding/documents/:docId/preview', ...read, asyncHandler(async (req, res) => {
  const preview = await getOwnDealerEvidencePreview(undefined, req.userContext, req.params.docId, { req });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, preview });
}));

router.post('/api/dealer-onboarding/branches', ...write, asyncHandler(async (req, res) => {
  const result = await addOwnDealerBranch(undefined, req.userContext, req.body || {}, { req });
  res.status(201).json({ success: true, ...result });
}));

export default router;
