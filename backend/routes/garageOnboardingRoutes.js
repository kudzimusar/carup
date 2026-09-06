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
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

/** Local async wrapper — the convention every route file in this codebase uses. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-1 — the Garage applicant's own surface.
 *
 * Every route here is scoped to the caller's OWN application. There is no route that reads someone
 * else's, and no route that grants anything: the reviewer decides (GMO-3) and the activation service
 * acts (GMO-4).
 *
 * `authorizeSessionRole(APPLICANT_ROLES)` requires a real proven session rather than the weaker
 * header gate — a person's business application is their own private data, and the same reasoning
 * that put `authorizeSessionRole` on the garage workspace applies here.
 *
 * `requireGarageOnboardingContext` then confirms the caller's own registration records a garage
 * business. That is self-service access, not authority: it lets you fill in your own form and
 * nothing else.
 */

// Public registration only ever creates `owner`, so a garage applicant is an owner until the day
// they are activated. Listing the other roles keeps a person who already operates elsewhere on
// CarUp from being locked out of applying for a garage of their own.
const APPLICANT_ROLES = ['owner', 'mechanic', 'dealer', 'admin'];

const applicant = [authorizeSessionRole(APPLICANT_ROLES), requireGarageOnboardingContext()];

/** The applicant's current application, its history, and what still blocks submission. */
router.get('/api/garage-onboarding/application', ...applicant, asyncHandler(async (req, res) => {
  res.json(await getMyApplication(supabase, req.userContext));
}));

/** Start one, or return the live one. Idempotent — a double tap must not create two. */
router.post('/api/garage-onboarding/application', ...applicant, asyncHandler(async (req, res) => {
  const result = await startApplication(supabase, req.userContext, { supersedes: req.body?.supersedes || null });
  res.status(result.created ? 201 : 200).json(result);
}));

/** Autosave. Partial bodies are the normal case. */
router.patch('/api/garage-onboarding/application/:applicationId', ...applicant, asyncHandler(async (req, res) => {
  res.json(await updateApplication(supabase, req.userContext, req.params.applicationId, req.body || {}));
}));

/** Hand it to review. */
router.post('/api/garage-onboarding/application/:applicationId/submit', ...applicant, asyncHandler(async (req, res) => {
  res.json(await submitApplication(supabase, req.userContext, req.params.applicationId, { emitDomainEvent }));
}));

export default router;
