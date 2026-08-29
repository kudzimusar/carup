import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getGarageCustomers, getGarageQueue } from '../services/serviceNetwork/garageQueueService.js';

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

const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

router.get('/api/garage/queue', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getGarageQueue(supabase, req.userContext, req.query));
}));

router.get('/api/garage/customers', authorizeRole(GARAGE_ROLES), asyncHandler(async (req, res) => {
  res.json(await getGarageCustomers(supabase, req.userContext));
}));

export default router;
