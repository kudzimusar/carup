import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import {
  acceptInvitation, inviteToGarage, listInvitations, peekInvitation, revokeInvitation,
} from '../services/garageOnboarding/garageInvitationService.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GMO-6 — garage invitations (ported by OC-5E from PR #209).
 *
 * Managing a garage's invitations is its ADMIN's act, on THIS lineage's authority: a real session
 * (never the x-user-id fallback) PLUS `requireActiveTenant` — the person selected this garage, the
 * membership and the garage's status are re-verified on the request, the organisation IS a garage
 * (F1: #209's tenant gate never checked the type, so a dealership's tenant admin passed it), and
 * their role inside it is admin. No platform role substitutes for any of that.
 *
 * Reading an invitation (peek) needs no account — a person must see what they are being asked to
 * join before deciding to create one — so it is rate-limited instead. Accepting needs a real session;
 * the token and the account's own verified address are the authority, checked in one transaction.
 */
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];
const PEEK_LIMIT = rateLimiter({ max: 30, windowMs: 15 * 60 * 1000, isSensitive: true });

router.get('/api/garage/invitations', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listInvitations(supabase, req.userContext));
}));

router.post('/api/garage/invitations', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await inviteToGarage(supabase, req.userContext, req.body || {}, { req, emitDomainEvent });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json(result);
}));

router.delete('/api/garage/invitations/:invitationId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await revokeInvitation(supabase, req.userContext, req.params.invitationId, { req }));
}));

router.get('/api/garage/invitations/peek/:token', PEEK_LIMIT, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await peekInvitation(supabase, req.params.token));
}));

router.post('/api/garage/invitations/accept', authorizeSessionRole(), asyncHandler(async (req, res) => {
  const result = await acceptInvitation(supabase, req.userContext, req.body?.token, { req, emitDomainEvent });
  res.status(result.created ? 201 : 200).json(result);
}));

export default router;
