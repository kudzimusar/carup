import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import { changeMemberRole, listMembers, removeMember } from '../services/garageOnboarding/garageMembershipService.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-7 — a garage's team (ported by OC-5E from PR #209).
 *
 * Its ADMIN's act, on THIS lineage's authority: a real session PLUS `requireActiveTenant` — the person
 * selected this garage, the membership and the garage's status are re-verified on the request, the
 * organisation IS a garage (F1) and their role inside it is admin. No platform role substitutes.
 */
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

router.get('/api/garage/members', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listMembers(supabase, req.userContext));
}));

router.delete('/api/garage/members/:userId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await removeMember(supabase, req.userContext, req.params.userId, { req, emitDomainEvent }));
}));

router.patch('/api/garage/members/:userId/role', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await changeMemberRole(supabase, req.userContext, req.params.userId, req.body?.role, { req }));
}));

export default router;
