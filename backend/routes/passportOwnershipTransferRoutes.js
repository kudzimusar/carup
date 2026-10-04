import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import {
  beginOwnershipTransfer,
  transitionOwnershipTransfer,
  getOwnershipTransfer,
} from '../services/passport/passportOwnershipTransferService.js';

export function createPassportOwnershipTransferRouter({ client = supabase } = {}) {
  const router = express.Router();

  // Consequential ownership operations require a real session; x-user-id fallback is never accepted.
  router.post(
    '/api/vehicles/:vin/ownership-transfers',
    authorizeSessionRole([]),
    async (req, res, next) => {
      try {
        const idempotencyKey = String(req.headers['x-idempotency-key'] || '').trim();
        if (!idempotencyKey) {
          throw new ValidationError('x-idempotency-key is required to begin an ownership transfer.');
        }
        const result = await beginOwnershipTransfer(client, {
          vin: req.params.vin,
          incomingOwnerId: req.body?.incoming_owner_id,
          idempotencyKey,
        }, req.userContext);
        return res.status(201).json({ ok: true, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    '/api/ownership-transfers/:transferId',
    authorizeSessionRole([]),
    async (req, res, next) => {
      try {
        const transfer = await getOwnershipTransfer(client, req.params.transferId, req.userContext);
        if (!transfer) throw new NotFoundError('Ownership transfer not found.');
        return res.json({ ok: true, transfer });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.patch(
    '/api/ownership-transfers/:transferId',
    authorizeSessionRole([]),
    // O2-X3: every transfer transition changes who may act on a vehicle — the critical class.
    // Step-up proves the ACTOR strongly enough; the service's own governance (roles, registry
    // authority, encumbrance guard) still decides whether the transition is permitted at all.
    requireAuthenticationAssurance(ACTION_CLASSES.CRITICAL),
    async (req, res, next) => {
      try {
        const result = await transitionOwnershipTransfer(client, {
          transferId: req.params.transferId,
          toState: req.body?.state,
          reason: req.body?.reason ?? null,
          registryAuthority: req.body?.registry_authority ?? null,
          completionReference: req.body?.completion_reference ?? null,
        }, req.userContext);
        return res.json({ ok: true, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export default createPassportOwnershipTransferRouter();
