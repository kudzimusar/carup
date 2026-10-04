import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, optionalAuth } from '../middleware/authMiddleware.js';
import {
  ensureServiceLink,
  grantCapability,
  redeemCapability,
  resolveServiceLink,
  revokeCapability,
} from '../services/serviceNetwork/serviceLinkService.js';

/**
 * Service Network S8 routes — Service Link resolution and scoped capabilities.
 *
 * Resolution is intentionally open to unauthenticated callers, because a QR sticker is
 * a public address: the resolver returns only what kind of thing was scanned and what to
 * do next, and discloses nothing about the owner, the VIN or the case. Note optionalAuth
 * is a FACTORY and must be invoked. Since OC-5D its tenant context is the session's VERIFIED
 * selection (never the raw header), and the resolver still grants nothing by itself.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Every route but the resolver is a real session (`authorizeSessionRole` — never the x-user-id
// fallback). Resource authority over the vehicle, case or practitioner is decided in the service, and
// any garage it involves is the VERIFIED active garage (OC-5D), never a header.
const AUTHENTICATED_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];

// Public resolution — grants nothing on its own.
router.get('/api/service-links/:publicToken', optionalAuth(), asyncHandler(async (req, res) => {
  res.json(await resolveServiceLink(supabase, req.userContext || {}, req.params.publicToken));
}));

router.post('/api/service-links', authorizeSessionRole(AUTHENTICATED_ROLES), asyncHandler(async (req, res) => {
  const result = await ensureServiceLink(supabase, req.userContext, req.body);
  res.status(result.created ? 201 : 200).json(result);
}));

// Scoped capability grants — resource authority is verified in the service.
router.post('/api/service-capabilities', authorizeSessionRole(AUTHENTICATED_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(await grantCapability(supabase, req.userContext, req.body));
}));

router.post('/api/service-capabilities/redeem', authorizeSessionRole(AUTHENTICATED_ROLES), asyncHandler(async (req, res) => {
  res.json(await redeemCapability(supabase, req.userContext, req.body?.token));
}));

router.delete('/api/service-capabilities/:grantId', authorizeSessionRole(AUTHENTICATED_ROLES), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await revokeCapability(supabase, req.userContext, req.params.grantId)) });
}));

export default router;
