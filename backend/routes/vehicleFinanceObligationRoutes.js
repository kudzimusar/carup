import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, optionalAuth } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import {
  recordFinanceObligation,
  transitionFinanceObligation,
  getGovernedEncumbrance,
  readFinanceObligationsForVehicle,
} from '../services/finance/vehicleFinanceObligationService.js';
import { toVehicleFinanceObligationBlock } from '../utils/publicVehicleProjection.js';

/**
 * Governed Vehicle Finance Obligation / Encumbrance authority (Track 1). Write routes require a
 * real session — never the `x-user-id` fallback — matching the note on the ownership-transfer
 * router, since these rows can gate a legal ownership transfer.
 */
export function createVehicleFinanceObligationRouter({ client = supabase } = {}) {
  const router = express.Router();

  router.post(
    '/api/vehicles/:vin/finance-obligations',
    authorizeSessionRole([]),
    async (req, res, next) => {
      try {
        const obligation = await recordFinanceObligation(client, { ...req.body, vin: req.params.vin }, req.userContext);
        return res.status(201).json({ ok: true, obligation });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.patch(
    '/api/finance-obligations/:obligationId',
    authorizeSessionRole([]),
    async (req, res, next) => {
      try {
        const obligation = await transitionFinanceObligation(client, {
          obligationId: req.params.obligationId,
          toState: req.body?.state,
          reason: req.body?.reason ?? null,
          effectiveDate: req.body?.effective_date ?? null,
          releaseReference: req.body?.release_reference ?? null,
        }, req.userContext);
        return res.json({ ok: true, obligation });
      } catch (error) {
        return next(error);
      }
    },
  );

  // Audience-scoped read. Public/anonymous callers get exactly the buyer-facing projection — the
  // same block the passport and marketplace detail payload publish, never a privileged raw row.
  router.get(
    '/api/vehicles/:vin/finance-obligations',
    optionalAuth(),
    async (req, res, next) => {
      try {
        if (!req.params.vin) throw new ValidationError('vin is required.');
        const rows = await readFinanceObligationsForVehicle(client, req.params.vin);
        const block = toVehicleFinanceObligationBlock(rows, { channelAvailable: rows !== undefined });
        return res.json({ ok: true, finance_obligation: block });
      } catch (error) {
        return next(error);
      }
    },
  );

  // R23's condition text for the seller/buyer transaction panel — never the fields behind it.
  router.get(
    '/api/vehicles/:vin/finance-obligations/transfer-gate',
    authorizeSessionRole([]),
    async (req, res, next) => {
      try {
        const encumbrance = await getGovernedEncumbrance(client, req.params.vin);
        return res.json({
          ok: true,
          blocking: encumbrance.blocking,
          transfer_condition: encumbrance.transfer_condition,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export default createVehicleFinanceObligationRouter();
