/**
 * T11-CAP-05 — estimate-revision routes. Mounted under /api/diaspora.
 *
 * An estimate revision is an OBSERVATION: something an authorised operator says about a shipment. It
 * is recorded, never edited and never deleted — a later revision supersedes it and the history stays —
 * so there is deliberately no PATCH, no PUT and no DELETE here, and a test asserts it.
 *
 * Route middleware is coarse on purpose, like the T11/T12 routes: the service is the authority
 * boundary and applies T11's own rule for who may write. A POST is idempotent when the caller supplies
 * `provider_event_id`: the same event described the same way returns the recorded revision; the same
 * id with different content is a 409. Responses are allow-listed projections only.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { listEtaRevisions, recordEtaRevision } from '../services/diaspora/diasporaShipmentObservationService.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

/** A factory so tests can inject authentication and the service functions; production uses the defaults below. */
export function createShipmentObservationRouter({
  auth = participantAuth,
  service = { recordEtaRevision, listEtaRevisions },
} = {}) {
  const router = express.Router();

  router.get('/shipments/:shipmentId/eta-revisions', auth, asyncHandler(async (req, res) => {
    res.json({ data: await service.listEtaRevisions(req.params.shipmentId, req.userContext, { req }) });
  }));

  router.post('/shipments/:shipmentId/eta-revisions', auth, asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.recordEtaRevision(req.params.shipmentId, req.body, req.userContext, { req }) });
  }));

  return router;
}

export default createShipmentObservationRouter();
