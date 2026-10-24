import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import { getOperationsSummary } from '../services/garageOperations/garageOperationsSummaryService.js';

/** GARAGE-1.0 — the garage's operating view. Admin only: it carries money. Read-only. */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

router.get('/api/garage/operations/summary', ADMIN, asyncHandler(async (req, res) => {
  res.json(await getOperationsSummary(supabase, req.userContext, { windowDays: req.query.window_days ?? 30 }));
}));

export default router;
