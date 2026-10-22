import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES } from '../services/serviceNetwork/serviceAuthority.js';
import { DatabaseError, UnauthorizedError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// GARAGE-1.0-CV01 — the parts master is a Garage workspace capability.
// The caller must have a real session, must have selected an active Garage, and must hold an
// operating role inside that Garage. Platform/effective role alone is never Garage authority.
const GARAGE_PARTS_WORKSPACE = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES }),
];

// Existing behaviour permits both Garage administrators and mechanics to read and create basic
// inventory records. CV01 preserves that capability while moving its authority to the canonical
// Garage tenant boundary; Inventory 2.0 concerns (stock movements, suppliers, branches, purchasing)
// remain intentionally out of scope.
router.get('/api/mechanic/parts', ...GARAGE_PARTS_WORKSPACE, asyncHandler(async (req, res) => {
  const orgId = req.userContext.activeTenant?.id;
  if (!orgId) throw new UnauthorizedError('Garage tenant context missing');

  const { data, error } = await supabase.from('mechanic_parts').select('*').eq('tenant_id', orgId);
  if (error) throw new DatabaseError(error.message);

  res.json(data || []);
}));

router.post('/api/mechanic/parts', ...GARAGE_PARTS_WORKSPACE, asyncHandler(async (req, res) => {
  const orgId = req.userContext.activeTenant?.id;
  if (!orgId) throw new UnauthorizedError('Garage tenant context missing');

  const { name, sku, stock_level, unit_price } = req.body;
  const { data, error } = await supabase.from('mechanic_parts').insert({
    tenant_id: orgId, name, sku, stock_level, unit_price
  }).select().single();
  if (error) throw new DatabaseError(error.message);

  res.json({ success: true, part: data });
}));

export default router;
