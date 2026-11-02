import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import {
  OPERATIONS_CAPABILITIES,
  requireOperationsCapability,
} from '../services/operations/operationsAuthorizationService.js';
import {
  getApplicationForReview,
  getEvidencePreviewForReview,
  listApplicationsForReview,
  recordDecision,
} from '../services/garageOnboarding/garageReviewService.js';
import {
  activateAfterApproval,
  activateApprovedApplication,
} from '../services/garageOnboarding/garageActivationService.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-3 — the Operations / Compliance reviewer's surface (ported by OC-5E from PR #209).
 *
 * PO-3: an authorised CarUp reviewer, gated by the same layers that govern dealer compliance review
 * on this lineage (dealerRoutes.js):
 *
 *   authorizeSessionRole          → a REAL session (never the x-user-id fallback), and req.userContext
 *   requireOperationsCapability   → named authority, derived from the SERVER-side platform role
 *                                   (platform administration only — OC-5E owner decision)
 *   requireAuthenticationAssurance → X3 step-up, because deciding someone's livelihood and viewing
 *                                    their private documents are both sensitive acts
 *
 * Approving records a judgment; GMO-4's activation (one database transaction, idempotent) builds the
 * workspace from it, as a SEPARATE step reported separately.
 */

const ADMIN_ROLES = ['admin', 'government', 'reviewer'];
const reviewer = [
  authorizeSessionRole(ADMIN_ROLES),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.GARAGE_ONBOARDING_REVIEW),
];

/** The queue of applications waiting on CarUp (never a draft: refused, not answered empty). */
router.get('/api/admin/garage-applications', ...reviewer, asyncHandler(async (req, res) => {
  const statuses = req.query?.status
    ? String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  res.json(await listApplicationsForReview(supabase, { statuses }));
}));

/** One application, with its evidence, its history, and the applicant's governed identity state. */
router.get('/api/admin/garage-applications/:applicationId', ...reviewer, asyncHandler(async (req, res) => {
  res.json(await getApplicationForReview(supabase, req.params.applicationId));
}));

/** Record a decision. Step-up applies: this changes what happens to a person's business. */
router.post(
  '/api/admin/garage-applications/:applicationId/decision',
  ...reviewer,
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const result = await recordDecision(supabase, req.userContext, req.params.applicationId, req.body || {}, {
      req, emitDomainEvent,
    });

    // GMO-4: an approval that stops at "approved" leaves a person with a decision and no workspace,
    // so the workspace is built here — but as a SEPARATE step whose outcome is reported separately.
    // If it fails, the decision stands and `POST .../activate` retries it idempotently; the reviewer
    // is never asked to make the same judgment twice.
    if (result.application?.status === 'approved') {
      result.activation = await activateAfterApproval(
        supabase, req.userContext, req.params.applicationId, { req, emitDomainEvent },
      );
    }

    res.status(201).json(result);
  }),
);

/**
 * Build the workspace for an application that is already approved.
 *
 * Idempotent, so this is both the retry path for a failed activation and safe to press twice. It
 * cannot activate anything that is not approved — the database refuses.
 */
router.post(
  '/api/admin/garage-applications/:applicationId/activate',
  ...reviewer,
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const result = await activateApprovedApplication(
      supabase, req.userContext, req.params.applicationId, { req, emitDomainEvent },
    );
    res.status(result.created ? 201 : 200).json(result);
  }),
);

/** View a private document. Sensitive, exactly as dealer and identity evidence previews are. */
router.get(
  '/api/admin/garage-applications/:applicationId/evidence/:documentId/preview',
  ...reviewer,
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const preview = await getEvidencePreviewForReview(
      supabase, req.userContext, req.params.applicationId, req.params.documentId, { req },
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(preview);
  }),
);

export default router;
