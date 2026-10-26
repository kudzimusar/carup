/**
 * T11-CAP-02 — Journey & Arrival routes. Mounted under /api/diaspora.
 *
 * ONE read-only endpoint. The journey is a composition of records other layers own, so nothing here
 * creates, moves or edits anything, and there is deliberately no write route to add one to later.
 *
 * Route middleware is coarse on purpose, exactly like the T11/T12 participant routes: the service is
 * the authority boundary. It derives access from the resolved import order, never from a header or a
 * claimed role, and it refuses a non-privileged caller identically whether a journey is missing or
 * merely not theirs.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getJourney } from '../services/diaspora/journeyProjectionService.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

/** A factory so tests can inject authentication and the service; production uses the defaults below. */
export function createJourneyRouter({ auth = participantAuth, getJourneyFn = getJourney } = {}) {
  const router = express.Router();

  // `subjectType` is `import_order`, `cargo_reservation` or `shipment`; the service validates it.
  router.get('/journeys/:subjectType/:subjectId', auth, asyncHandler(async (req, res) => {
    const data = await getJourneyFn(req.params.subjectType, req.params.subjectId, req.userContext, { req });
    // Private to the viewer, and — for the vehicle's owner — it carries short-lived links to their photographs: never stored by a browser or a shared cache.
    res.set('Cache-Control', 'private, no-store');
    res.json({ data });
  }));

  return router;
}

export default createJourneyRouter();
