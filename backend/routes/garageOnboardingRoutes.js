import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  getMyApplication,
  requireGarageOnboardingContext,
  startApplication,
  submitApplication,
  updateApplication,
} from '../services/garageOnboarding/garageApplicationService.js';
import {
  acknowledgeExtraction,
  getOwnEvidencePreview,
  listOwnEvidence,
  removeEvidence,
  runEvidenceExtraction,
  uploadEvidence,
} from '../services/garageOnboarding/garageEvidenceService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// C3 applicant surface only. No reviewer/activation/membership authority is mounted here.
const APPLICANT_ROLES = ['owner', 'mechanic', 'dealer', 'admin'];
const applicant = [authorizeSessionRole(APPLICANT_ROLES), requireGarageOnboardingContext()];

router.get('/api/garage-onboarding/application', ...applicant, asyncHandler(async (req, res) => {
  res.json(await getMyApplication(supabase, req.userContext));
}));

router.post('/api/garage-onboarding/application', ...applicant, asyncHandler(async (req, res) => {
  const result = await startApplication(supabase, req.userContext, { supersedes: req.body?.supersedes || null });
  res.status(result.created ? 201 : 200).json(result);
}));

router.patch('/api/garage-onboarding/application/:applicationId', ...applicant, asyncHandler(async (req, res) => {
  res.json(await updateApplication(supabase, req.userContext, req.params.applicationId, req.body || {}));
}));

router.post('/api/garage-onboarding/application/:applicationId/submit', ...applicant, asyncHandler(async (req, res) => {
  // Submission hands the ordinary application to its external reviewer authority. This route cannot
  // approve, activate, create a tenant, grant Garage Admin or publish a Garage.
  res.json(await submitApplication(supabase, req.userContext, req.params.applicationId));
}));

router.get('/api/garage-onboarding/application/:applicationId/evidence', ...applicant, asyncHandler(async (req, res) => {
  res.json(await listOwnEvidence(supabase, req.userContext, req.params.applicationId));
}));

router.post('/api/garage-onboarding/application/:applicationId/evidence', ...applicant, asyncHandler(async (req, res) => {
  const result = await uploadEvidence(supabase, req.userContext, req.params.applicationId, req.body || {}, { req });
  res.status(201).json(result);
}));

router.delete('/api/garage-onboarding/application/:applicationId/evidence/:documentId', ...applicant, asyncHandler(async (req, res) => {
  res.json(await removeEvidence(supabase, req.userContext, req.params.applicationId, req.params.documentId, { req }));
}));

router.get('/api/garage-onboarding/application/:applicationId/evidence/:documentId/preview', ...applicant, asyncHandler(async (req, res) => {
  res.json(await getOwnEvidencePreview(supabase, req.userContext, req.params.applicationId, req.params.documentId, { req }));
}));

router.post('/api/garage-onboarding/application/:applicationId/evidence/:documentId/extract', ...applicant, asyncHandler(async (req, res) => {
  res.json(await runEvidenceExtraction(supabase, req.userContext, req.params.applicationId, req.params.documentId, { req }));
}));

router.post('/api/garage-onboarding/application/:applicationId/evidence/:documentId/acknowledge', ...applicant, asyncHandler(async (req, res) => {
  res.json(await acknowledgeExtraction(supabase, req.userContext, req.params.applicationId, req.params.documentId, { req }));
}));

export default router;
