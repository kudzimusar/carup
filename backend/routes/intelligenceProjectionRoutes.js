/**
 * CarUp Intelligence 1.0 — I5 authorized projection API.
 *
 * The read side of Intelligence. Every route resolves its own scope from the
 * verified session: there is deliberately no seller, tenant or organization
 * parameter anywhere in this file, because a scope a caller can name is a scope a
 * caller can change.
 *
 * Responses carry an `availability` envelope per metric, so a client cannot
 * render an unavailable number as zero without noticing.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { getInsuranceDemandIntelligence } from '../services/intelligence/insuranceIntelligenceService.js';
import {
  getMechanicIntelligence,
  getGarageIntelligence,
} from '../services/intelligence/serviceIntelligenceService.js';
import {
  getListingInsights,
  getSellerPulse,
  getDealerIntelligence,
  getAdminIntelligence,
  getGovernmentIntelligence,
  resolveWindowDays,
  AuthorizationError,
  NotFoundError,
} from '../services/intelligence/intelligenceProjectionService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Turn an authorization outcome into a response.
 *
 * An unexpected failure becomes an explicit `unavailable` payload rather than a
 * 500 with no body: the surface must be able to say "we could not read this",
 * which is a different statement from "there is nothing here".
 */
function handleProjectionError(res, error) {
  if (error instanceof AuthorizationError) {
    return res.status(403).json({ ok: false, error: 'forbidden', message: error.message });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ ok: false, error: 'not_found', message: error.message });
  }
  return res.status(200).json({
    ok: true,
    availability: 'unavailable',
    reason: 'intelligence_read_failed',
    message: 'Intelligence could not be read. These figures are NOT zero.',
  });
}

/** Seller: one of my listings. Ownership is proven inside the service. */
router.get(
  '/api/marketplace/my-listings/:vin/analytics',
  authorizeRole([]),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getListingInsights(supabase, req.userContext, req.params.vin, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/** Seller: my whole portfolio. */
router.get(
  '/api/marketplace/my-analytics',
  authorizeRole([]),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getSellerPulse(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/** Dealer: my tenant. The tenant comes from verified membership, not a parameter. */
router.get(
  '/api/dealer/analytics',
  authorizeRole(['dealer', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getDealerIntelligence(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/**
 * CarUp admin: platform grain.
 *
 * Note the gate is `['admin']` alone. The existing marketplace admin analytics
 * endpoint is gated `['admin','government']`, which hands an institutional role
 * platform-wide commercial data — recorded as gap G5 in the I0 audit and
 * deliberately not repeated here.
 */
router.get(
  '/api/admin/marketplace/intelligence',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getAdminIntelligence(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/**
 * Institutional projection: purpose-limited, and explicitly not commercial
 * behaviour. It answers honestly that no governed institutional contract exists
 * yet rather than returning an empty commercial dashboard.
 */
router.get(
  '/api/government/intelligence',
  authorizeRole(['government', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const data = await getGovernmentIntelligence(supabase, req.userContext);
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/**
 * Mechanic intelligence — PERSON scope.
 *
 * Scoped to the practitioner's own id. It never widens to their organization: an
 * unattributed work order is not this mechanic's work.
 */
router.get(
  '/api/mechanic/analytics',
  authorizeRole(['mechanic', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getMechanicIntelligence(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/**
 * Garage intelligence — TENANT / ORGANIZATION scope.
 *
 * Gated on the roles that can belong to a garage organization, and scoped to the
 * VERIFIED tenant on the session. There is deliberately no organization parameter,
 * and a caller with no verified tenant is refused rather than shown their own work
 * relabelled as the organization's.
 */
router.get(
  '/api/garage/analytics',
  authorizeRole(['mechanic', 'dealer', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getGarageIntelligence(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

/**
 * Insurance COMMERCIAL demand — deliberately not the risk domain.
 *
 * Scope comes from verified insurer membership; a platform admin sees the platform
 * view. Risk, underwriting, claims and fraud are not served here, and the payload
 * states that boundary so a demand figure cannot be quietly reused as a risk one.
 */
router.get(
  '/api/insurance/demand-intelligence',
  authorizeRole(['insurance', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const windowDays = resolveWindowDays(req.query.window);
      const data = await getInsuranceDemandIntelligence(supabase, req.userContext, { windowDays });
      return res.json({ ok: true, ...data });
    } catch (error) {
      return handleProjectionError(res, error);
    }
  }),
);

export default router;
