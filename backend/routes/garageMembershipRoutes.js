import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeTenantRole } from '../middleware/authMiddleware.js';
import {
  changeMemberRole,
  listMembers,
  removeMember,
} from '../services/garageOnboarding/garageMembershipService.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-7 — who works here, and who no longer does.
 *
 * Tenant-scoped: `admin` means an administrator of THIS garage. The service re-checks the caller's
 * verified `tenantRole` before acting; the route's role list is the coarse gate, not the decision.
 *
 * Nothing on this router touches a record of work already done. Removing someone ends what they can
 * do next — the service history of every car they worked on is unchanged.
 */
const GARAGE_ADMIN_ROLES = ['admin'];

router.get('/api/garage/members', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMembers(supabase, req.userContext));
}));

router.delete('/api/garage/members/:userId', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await removeMember(supabase, req.userContext, req.params.userId, { req, emitDomainEvent }));
}));

router.patch('/api/garage/members/:userId/role', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await changeMemberRole(supabase, req.userContext, req.params.userId, req.body?.role, { req }));
}));

export default router;
