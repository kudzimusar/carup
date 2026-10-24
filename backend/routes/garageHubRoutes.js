import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
import { getCaseHub } from '../services/garageOperations/garageHubService.js';

/**
 * GARAGE-1.0 — the operating hub's single read model (see garageHubService). Read-only: every action
 * it advertises is performed through the existing, individually-governed routes.
 */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const GARAGE_WORKSPACE = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })];

router.get('/api/garage/cases/:caseId/hub', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getCaseHub(supabase, req.userContext, req.params.caseId));
}));

export default router;
