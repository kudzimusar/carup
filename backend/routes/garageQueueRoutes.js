import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { getGarageCustomers, getGarageMechanics, getGarageQueue } from '../services/serviceNetwork/garageQueueService.js';

/**
 * Service Network S9 routes — garage queue and customer records.
 *
 * Both are strictly tenant-scoped: the acting tenant comes from the membership-verified
 * session context, never from a client parameter.
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

router.get('/api/garage/queue', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getGarageQueue(supabase, req.userContext, req.query));
}));

router.get('/api/garage/customers', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getGarageCustomers(supabase, req.userContext));
}));

// The garage's own members, so a mechanic can be picked rather than a UUID typed (R5). Same tenant
// scope and same session gate as every other private garage read on this router.
router.get('/api/garage/mechanics', authorizeSessionRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getGarageMechanics(supabase, req.userContext));
}));

export default router;
