import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const WORK_ORDER_STATUSES = ['In Progress', 'Completed', 'Cancelled'];

// --- MECHANIC: WORK ORDERS ---
router.get('/api/mechanic/work-orders', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');

  const { data, error } = await supabase.from('mechanic_work_orders').select('*').eq('tenant_id', orgId);
  if (error) throw new DatabaseError(error.message);

  res.json(data || []);
}));

router.post('/api/mechanic/work-orders', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');

  const { vin, customer_name, issue_description } = req.body;
  if (!vin) throw new ValidationError('vin is required');

  // Resolve the customer from the vehicle's registered owner. The VIN must
  // exist: mechanic_work_orders.vin is a FK, so an unknown VIN previously
  // surfaced as a raw 500 DatabaseError instead of a client error.
  let customerId = null;
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('owner_id')
    .eq('vin', vin)
    .maybeSingle();
  if (vehicleError) throw new DatabaseError(vehicleError.message);
  if (!vehicle) throw new ValidationError(`Unknown VIN: ${vin}. Look the vehicle up before opening a work order.`);
  if (vehicle.owner_id) customerId = vehicle.owner_id;

  const { data, error } = await supabase.from('mechanic_work_orders').insert({
    tenant_id: orgId,
    vin,
    customer_name: customer_name || null,
    customer_id: customerId,
    mechanic_id: req.userContext.id,
    description: issue_description,
    status: 'In Progress'
  }).select().single();
  if (error) throw new DatabaseError(error.message);

  res.json({ success: true, workOrder: data });
}));

router.patch('/api/mechanic/work-orders/:id', authorizeRole(['mechanic', 'admin']), asyncHandler(async (req, res) => {
  const orgId = req.userContext.tenantId;
  if (!orgId) throw new UnauthorizedError('Tenant context missing');

  const { status, total_cost } = req.body;
  if (!WORK_ORDER_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${WORK_ORDER_STATUSES.join(', ')}`);
  }

  const updates = { status };
  if (total_cost !== undefined) {
    const parsedCost = Number(total_cost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new ValidationError('total_cost must be a non-negative number');
    }
    updates.total_cost = parsedCost;
  }

  // Tenant scoping in the UPDATE itself: another tenant's work order is
  // indistinguishable from a missing one (404), never a cross-tenant write.
  const { data, error } = await supabase
    .from('mechanic_work_orders')
    .update(updates)
    .eq('id', req.params.id)
    .eq('tenant_id', orgId)
    .select();
  if (error) throw new DatabaseError(error.message);
  if (!data || data.length === 0) throw new NotFoundError('Work order not found');

  res.json({ success: true, workOrder: data[0] });
}));

export default router;
