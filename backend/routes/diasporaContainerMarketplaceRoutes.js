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
const auth = authorizeRole();
const base = '/container-marketplace';

router.get(`${base}/containers`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await listOpenContainers(req.query, req.userContext, { req }) });
}));
router.post(`${base}/containers`, auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createContainer(req.body, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/capacity`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await getContainerCapacity(req.params.id, req.userContext, { req }) });
}));
router.get(`${base}/containers/:id/reservations`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await listContainerReservations(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/reservations`, auth, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await requestReservation(req.params.id, req.body, req.userContext, { req }) });
}));
router.post(`${base}/containers/:id/close-booking`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await closeBooking(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/approve`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await approveReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/reject`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await rejectReservation(req.params.id, req.userContext, { req }) });
}));
router.post(`${base}/reservations/:id/cancel`, auth, asyncHandler(async (req, res) => {
  res.json({ data: await cancelReservation(req.params.id, req.userContext, { req }) });
}));

export default router;
