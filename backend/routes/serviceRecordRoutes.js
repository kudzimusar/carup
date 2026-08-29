import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
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

const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.post('/api/service-work-orders/:workOrderId/records', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(await recordService(supabase, req.userContext, req.params.workOrderId, req.body));
}));

router.get('/api/service-records/:recordId', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getServiceRecord(supabase, req.userContext, req.params.recordId));
}));

router.post('/api/service-records/:recordId/mileage', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(await recordMileageObservation(supabase, req.userContext, req.params.recordId, req.body));
}));

router.post('/api/service-records/:recordId/parts', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await linkPartRecord(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

router.post('/api/service-records/:recordId/evidence', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  const result = await linkEvidence(supabase, req.userContext, req.params.recordId, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

export default router;
