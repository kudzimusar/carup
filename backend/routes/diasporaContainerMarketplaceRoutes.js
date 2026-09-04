/**
 * Phase 6 — Container co-loading marketplace routes. Mounted under /api/diaspora.
 * Uses the /container-marketplace prefix to avoid shadowing the legacy /containers and /reservations
 * routes that existing consumers and tests depend on.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  createContainer,
  listOpenContainers,
  getContainerCapacity,
  requestReservation,
  listContainerReservations,
  approveReservation,
  rejectReservation,
  cancelReservation,
  closeBooking,
} from '../services/diaspora/diasporaContainerMarketplaceService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const base = '/container-marketplace';
// H4: participants may browse/request/cancel; create/close/approve/reject are OPERATOR actions.
// D2 (client-demo convergence): a legitimate logistics business is a TENANT operator, not a platform
// reviewer/admin — `users.role` cannot even store 'platform_admin'/'reviewer'. The route gate
// therefore only establishes an authenticated known role; the AUTHORITATIVE operator decision stays
// in the service/RPC (`canReview`: server-derived platform admin/reviewer OR tenant admin of the
// record's own tenant via verified tenant_users membership). A plain buyer who reaches the service
// without tenant authority still gets 403, and cross-tenant admins are rejected on tenant equality.
const participantAuth = authorizeRole(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);
const operatorAuth = participantAuth;

router.get(`${base}/containers`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listOpenContainers(req.query, req.userContext, { req }) });
}));
router.post(`${base}/containers`, operatorAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createContainer(req.body, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/capacity`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getContainerCapacity(req.params.id, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/reservations`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listContainerReservations(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/reservations`, participantAuth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await requestReservation(req.params.id, req.body, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/close-booking`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await closeBooking(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/approve`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await approveReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/reject`, operatorAuth, asyncHandler(async (req, res) => {
  res.json({ data: await rejectReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/cancel`, participantAuth, asyncHandler(async (req, res) => {
  res.json({ data: await cancelReservation(req.params.id, req.userContext, { req }) });
}));

export default router;
