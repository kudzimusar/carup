/**
 * T11-CAP-04 — shipment leg routes. Mounted under /api/diaspora.
 *
 * Legs are DECLARED vessel/route facts under a shipment; they are not movement, and nothing here can
 * say a vessel sailed. Route middleware is coarse on purpose, like the T11/T12 routes: the service is
 * the authority boundary and applies T11's own rule for who may write. Every response is an
 * allow-listed projection — never a raw row, never `metadata` or a tenant id.
 *
 * There is no way to change a leg's position or shipment, and no hard delete: DELETE supersedes.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  addShipmentLeg,
  listShipmentLegs,
  projectLegForOperator,
  supersedeShipmentLeg,
  updateShipmentLeg,
} from '../services/diaspora/diasporaShipmentLegService.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

/** A factory so tests can inject authentication and the service functions; production uses the defaults below. */
export function createShipmentLegRouter({
  auth = participantAuth,
  service = { addShipmentLeg, listShipmentLegs, updateShipmentLeg, supersedeShipmentLeg },
} = {}) {
  const router = express.Router();

  router.get('/shipments/:shipmentId/legs', auth, asyncHandler(async (req, res) => {
    res.json({ data: await service.listShipmentLegs(req.params.shipmentId, req.userContext, { req }) });
  }));

  router.post('/shipments/:shipmentId/legs', auth, asyncHandler(async (req, res) => {
    const leg = await service.addShipmentLeg(req.params.shipmentId, req.body, req.userContext, { req });
    res.status(201).json({ data: projectLegForOperator(leg) });
  }));

  router.patch('/shipment-legs/:legId', auth, asyncHandler(async (req, res) => {
    const leg = await service.updateShipmentLeg(req.params.legId, req.body, req.userContext, { req });
    res.json({ data: projectLegForOperator(leg) });
  }));

  // Supersede, never erase.
  router.delete('/shipment-legs/:legId', auth, asyncHandler(async (req, res) => {
    const leg = await service.supersedeShipmentLeg(req.params.legId, req.userContext, { req });
    res.json({ data: { id: leg.id, superseded: true } });
  }));

  return router;
}

export default createShipmentLegRouter();
