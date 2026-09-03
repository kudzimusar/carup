/**
 * Vehicle Operations routes — Operations Control Plane M4/M5.
 *
 * The VIN-centered reviewer aggregate. Read-only: every mutation the workspace
 * offers goes through the owning canonical route/service (evidence verify /
 * reject / classification correction, seller-authority review, trust facts,
 * governance, fraud, moderation). There is no combined write endpoint here,
 * and there will never be an "approve everything" action (G8).
 *
 * Authorization: base role gate for compatibility + the bounded Operations
 * capability policy (M5). The capability check demands a PROVEN session — the
 * x-user-id fallback identity is refused for private vehicle reads.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  OPERATIONS_CAPABILITIES,
  requireOperationsCapability,
} from '../services/operations/operationsAuthorizationService.js';
import { buildVehicleOperationsReview } from '../services/operations/vehicleOperationsReadModel.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get(
  '/api/admin/vehicles/:vin/review',
  authorizeRole(['admin', 'government'], { allowUserIdFallback: false }),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.VEHICLE_READ_PRIVATE),
  asyncHandler(async (req, res) => {
    const review = await buildVehicleOperationsReview(supabase, {
      vin: req.params.vin,
      userContext: req.userContext,
    });
    if (!review) {
      return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_OPERATIONS_NOT_FOUND' });
    }
    return res.json({ success: true, review });
  })
);

export default router;
