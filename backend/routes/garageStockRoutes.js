import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import {
  GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES,
} from '../services/serviceNetwork/serviceAuthority.js';
import {
  consumeForService,
  countStock,
  createPart,
  getPart,
  listParts,
  listWorkOrderParts,
  receiveStock,
  reverseUsage,
  updatePart,
} from '../services/garageOperations/garageStockService.js';

/**
 * GARAGE-1.0 OPS06 — governed stock over mechanic_parts (the one parts master).
 * Managing stock is a garage-admin act; reading it and recording parts USED on a job is the workspace's.
 * The legacy /api/mechanic/parts routes are untouched (CV01 pins them).
 */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const WORKSPACE = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })];
const ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];
const withKey = (req) => ({ ...(req.body || {}), idempotency_key: req.body?.idempotency_key ?? req.get('Idempotency-Key') });

router.get('/api/garage/stock', WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await listParts(supabase, req.userContext, { includeInactive: req.query.include_inactive === 'true' }));
}));
router.post('/api/garage/stock', ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await createPart(supabase, req.userContext, withKey(req)));
}));
router.get('/api/garage/stock/:partId', WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getPart(supabase, req.userContext, req.params.partId));
}));
router.patch('/api/garage/stock/:partId', ADMIN, asyncHandler(async (req, res) => {
  res.json(await updatePart(supabase, req.userContext, req.params.partId, req.body || {}));
}));
router.post('/api/garage/stock/:partId/receive', ADMIN, asyncHandler(async (req, res) => {
  res.json(await receiveStock(supabase, req.userContext, req.params.partId, withKey(req)));
}));
router.post('/api/garage/stock/:partId/count', ADMIN, asyncHandler(async (req, res) => {
  res.json(await countStock(supabase, req.userContext, req.params.partId, withKey(req)));
}));

router.get('/api/garage/work-orders/:workOrderId/parts', WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await listWorkOrderParts(supabase, req.userContext, req.params.workOrderId));
}));
router.post('/api/garage/service-records/:recordId/parts', WORKSPACE, asyncHandler(async (req, res) => {
  res.status(201).json(await consumeForService(supabase, req.userContext, req.params.recordId, withKey(req)));
}));
router.post('/api/garage/part-usage/:usageId/reverse', WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await reverseUsage(supabase, req.userContext, req.params.usageId, withKey(req)));
}));

export default router;
