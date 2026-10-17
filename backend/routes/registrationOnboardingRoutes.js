import express from 'express';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  getRegistrationJourney,
  getProfileAutofillCandidates,
  upsertRegistrationProfile,
} from '../services/registration/registrationJourneyService.js';

/**
 * O2-X2 — the applicant's OWN registration journey (ported by OC-5C from PR #208).
 *
 * Every route is self-scoped: the subject is always req.userContext, never a path or
 * body parameter, so one user can never read another's onboarding state, candidates or
 * evidence-derived fields. The journey/candidates responses DESCRIBE state and grant
 * nothing; the single write here touches only user_registration_profiles, and it needs a
 * real session (OC-5C) — the x-user-id development fallback never writes a profile.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/api/registration/journey', authorizeRole(), asyncHandler(async (req, res) => {
  const journey = await getRegistrationJourney(undefined, req.userContext);
  res.json({ success: true, ...journey });
}));

router.get('/api/registration/profile/candidates', authorizeRole(), asyncHandler(async (req, res) => {
  const candidates = await getProfileAutofillCandidates(undefined, req.userContext);
  res.json({ success: true, candidates });
}));

router.put('/api/registration/profile', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const result = await upsertRegistrationProfile(undefined, req.userContext, req.body || {}, { req });
  res.json({ success: true, ...result });
}));

export default router;
