import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, authorizeTenantRole } from '../middleware/authMiddleware.js';
import {
  acceptInvitation,
  inviteToGarage,
  listInvitations,
  peekInvitation,
  revokeInvitation,
} from '../services/garageOnboarding/garageInvitationService.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-6 — inviting a mechanic into a garage.
 *
 * The management routes are TENANT-scoped: `admin` here means an administrator of THIS garage, so
 * they use `authorizeTenantRole` — the same opt-in gate the rest of the garage workspace uses, and
 * deliberately not the platform-role gate. The service then re-checks that the caller's verified
 * tenant role may invite; the route's role list is the coarse gate, not the decision.
 */
const GARAGE_ADMIN_ROLES = ['admin'];

/** Who this garage has invited, and where each offer stands. */
router.get('/api/garage/invitations', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await listInvitations(supabase, req.userContext));
}));

/** Invite someone. The raw token comes back exactly once, for delivery to the invitee. */
router.post('/api/garage/invitations', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  const result = await inviteToGarage(supabase, req.userContext, req.body || {}, { req, emitDomainEvent });
  res.status(201).json(result);
}));

/** Withdraw an invitation that has not been taken up. */
router.delete('/api/garage/invitations/:invitationId', authorizeTenantRole(GARAGE_ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await revokeInvitation(supabase, req.userContext, req.params.invitationId, { req }));
}));

/**
 * What an invitation says, before signing in.
 *
 * Unauthenticated on purpose: a person who has never used CarUp needs to see who is inviting them
 * and in what role before deciding to create an account. It returns the garage's name, the role and
 * the invited address, and nothing about the garage's work, customers or other members — a token
 * found in a forwarded email must not become a reconnaissance tool.
 */
router.get('/api/garage/invitations/peek/:token', asyncHandler(async (req, res) => {
  res.json(await peekInvitation(supabase, req.params.token));
}));

/**
 * Accept, and become a member.
 *
 * A proven session with NO role list: the invitee is whoever they are — an ordinary `owner` who has
 * just registered, or someone who already works at another garage. The authority check is the
 * invitation itself, and the service refuses a token that is revoked, expired, spent, or addressed
 * to a different person.
 */
router.post('/api/garage/invitations/accept', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const result = await acceptInvitation(supabase, req.userContext, req.body?.token, { req, emitDomainEvent });
  res.status(result.created ? 201 : 200).json(result);
}));

export default router;
