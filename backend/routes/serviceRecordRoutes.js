import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
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

// OC-5D — re-gated on the VERIFIED ACTIVE GARAGE. #197 gated these routes on platform role lists
// (GARAGE_ROLES = mechanic/dealer/admin) that a TENANT role could satisfy, with the garage taken from
// the session's guessed or header-asserted tenant. Now every garage-side route is a real session
// (`authorizeSessionRole()` — never the x-user-id fallback) PLUS `requireActiveTenant`: the person
// selected this garage, the membership and the garage's active status are re-verified on this request,
// the organisation is a garage, and their role INSIDE it is in the route's set. The tenant role never
// becomes a platform role, a platform 'dealer' or 'mechanic' without a garage membership is refused,
// and there is no platform-admin bypass. The services re-check the same rule (serviceAuthority).
const GARAGE_WORKSPACE = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })];
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

router.post('/api/service-work-orders/:workOrderId/records', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.status(201).json(await recordService(supabase, req.userContext, req.params.workOrderId, req.body));
}));

router.get('/api/service-records/:recordId', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getServiceRecord(supabase, req.userContext, req.params.recordId));
}));

router.post('/api/service-records/:recordId/mileage', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.status(201).json(await recordMileageObservation(supabase, req.userContext, req.params.recordId, req.body));
}));

router.post('/api/service-records/:recordId/parts', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  const result = await linkPartRecord(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/service-records/:recordId/evidence', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  const result = await linkEvidence(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

export default router;
