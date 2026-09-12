/**
 * People & Compliance Operations routes — O2/P3.
 *
 * The person-centered reviewer aggregate. Read-only: every decision the workspace offers goes
 * through the owning canonical route/service (identity session review, seller-authority review,
 * dealer compliance decision, ownership transfer transitions). There is no combined write endpoint
 * here, no "verify this person" action, and no "verified seller" boolean — the separate facts stay
 * separate.
 *
 * Authorization: base role gate for compatibility + the bounded Operations capability policy. The
 * capability check demands a PROVEN session — the x-user-id fallback identity is refused for
 * private person reads. Tenant admins hold no Operations capability: a tenant's own admin must
 * never read another person's private compliance state through a platform surface.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  OPERATIONS_CAPABILITIES,
  requireOperationsCapability,
} from '../services/operations/operationsAuthorizationService.js';
import { buildPersonComplianceReview } from '../services/operations/peopleComplianceReadModel.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get(
  '/api/admin/people/:userId/review',
  authorizeRole(['admin', 'government'], { allowUserIdFallback: false }),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.PERSON_READ_PRIVATE),
  asyncHandler(async (req, res) => {
    try {
      const review = await buildPersonComplianceReview(supabase, {
        userId: req.params.userId,
        userContext: req.userContext,
      });
      return res.json({ success: true, review });
    } catch (error) {
      if (error?.status === 404) {
        return res.status(404).json({ error: 'Person not found', code: 'PEOPLE_OPERATIONS_NOT_FOUND' });
      }
      if (error?.status === 400) {
        return res.status(400).json({ error: error.message, code: 'PEOPLE_OPERATIONS_INVALID' });
      }
      // O2 post-Ready review C8 — a constituent authority read failed. The reviewer is told
      // WHICH part is unavailable, because the alternative (a 200 with that section empty)
      // reads as "this person holds nothing there" and is acted on as if it were a finding.
      if (error?.code === 'PEOPLE_REVIEW_SECTION_UNAVAILABLE') {
        return res.status(503).json({
          error: error.message,
          code: 'PEOPLE_REVIEW_SECTION_UNAVAILABLE',
          section: error.section || null,
        });
      }
      throw error;
    }
  })
);

export default router;
