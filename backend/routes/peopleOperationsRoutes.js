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
      throw error;
    }
  })
);

export default router;
