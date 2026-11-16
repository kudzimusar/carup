import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  getServiceRecord,
  linkEvidence,
  linkPartRecord,
  recordMileageObservation,
  recordService,
} from '../services/serviceNetwork/serviceRecordService.js';

/**
 * Service Network S5 routes — service records, mileage observations, parts, evidence.
 *
 * Note what is absent by design: there is no endpoint here that writes
 * vehicles.mileage. A mileage reading taken during service is recorded as an
 * observation; the canonical odometer keeps its single existing writer (plan §13.1).
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Service Network auth hardening: every consequential route below composes `authorizeSessionRole`,
// NOT `authorizeRole`. The difference is `allowUserIdFallback: false` — a spoofable `x-user-id`
// header can never stand in for a real session on a route that creates a case, moves work, assigns a
// mechanic, reads a garage's private customer list, or mints/redeems/revokes a capability.
// `isUserIdFallbackAllowed()` already closes that header in production deployments, but a private
// garage workspace must not depend on one environment variable being right; the route states its own
// requirement. The public directory reads and the anonymous service-link resolver deliberately keep
// their weaker gates — see the comments at those routes.
const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.post('/api/service-work-orders/:workOrderId/records', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(await recordService(supabase, req.userContext, req.params.workOrderId, req.body));
}));

router.get('/api/service-records/:recordId', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getServiceRecord(supabase, req.userContext, req.params.recordId));
}));

router.post('/api/service-records/:recordId/mileage', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(await recordMileageObservation(supabase, req.userContext, req.params.recordId, req.body));
}));

router.post('/api/service-records/:recordId/parts', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await linkPartRecord(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/service-records/:recordId/evidence', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await linkEvidence(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

export default router;
