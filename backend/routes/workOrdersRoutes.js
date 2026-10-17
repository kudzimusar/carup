import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import { DatabaseError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { resolveWorkOrderCustodian } from '../services/partsentry/partsentryServiceAuthority.js';

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

  // OC-5A: opening a work order grants NOTHING by itself. It is a request until the vehicle's
  // custodian authorizes it (owner_authorization starts 'pending'); only then may this mechanic record
  // service on the vehicle. Said here so the client never presents an unauthorized order as active.
  res.json({ success: true, workOrder: data, ownerAuthorization: data?.owner_authorization ?? 'pending' });
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

// --- VEHICLE CUSTODIAN: WORK ORDER AUTHORIZATION (OC-5A) ---
// A work order is a governed service relationship only once the vehicle's custodian authorizes it.
// resolveWorkOrderCustodian decides who that is (owner; for owner-less dealership stock, its governed
// dealer; a platform administrator). The decision itself is ONE database function that locks the work
// order, refuses self-authorization, re-proves an owner basis, and writes the decision and its
// trust_audit_events record together.

const DECISIONS = ['authorized', 'declined', 'revoked'];

async function namesById(table, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from(table).select(table === 'tenants' ? 'id, name, type' : 'id, name').in('id', unique);
  if (error) throw new DatabaseError(error.message);
  return new Map((data || []).map((row) => [row.id, row]));
}

/** What a custodian sees of a work order: who is asking, for what, and the decision — no contact details. */
function custodianView(order, organisations, mechanics) {
  const organisation = organisations.get(order.tenant_id);
  return {
    id: order.id,
    vin: order.vin,
    status: order.status,
    description: order.description ?? null,
    created_at: order.created_at ?? null,
    owner_authorization: order.owner_authorization,
    owner_authorized_at: order.owner_authorized_at ?? null,
    organisation: organisation ? { id: organisation.id, name: organisation.name ?? null, type: organisation.type ?? null } : null,
    mechanic: order.mechanic_id ? { name: mechanics.get(order.mechanic_id)?.name ?? null } : null,
  };
}

router.get('/api/vehicles/:vin/work-orders', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const custodian = await resolveWorkOrderCustodian({ vin: req.params.vin, userContext: req.userContext });
  if (!custodian.allowed) return res.status(custodian.status).json({ error: custodian.message, reason: custodian.reason });
  const { data, error } = await supabase
    .from('mechanic_work_orders')
    .select('id, vin, tenant_id, mechanic_id, status, description, created_at, owner_authorization, owner_authorized_at')
    .eq('vin', req.params.vin);
  if (error) throw new DatabaseError(error.message);
  const orders = data || [];
  const [organisations, mechanics] = await Promise.all([
    namesById('tenants', orders.map((o) => o.tenant_id)),
    namesById('users', orders.map((o) => o.mechanic_id)),
  ]);
  res.json(orders.map((order) => custodianView(order, organisations, mechanics)));
}));

router.post('/api/vehicles/:vin/work-orders/:id/authorization', authorizeSessionRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
  const decision = req.body?.decision;
  if (!DECISIONS.includes(decision)) throw new ValidationError(`decision must be one of: ${DECISIONS.join(', ')}`);
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 500) : null;

  const custodian = await resolveWorkOrderCustodian({ vin: req.params.vin, userContext: req.userContext });
  if (!custodian.allowed) return res.status(custodian.status).json({ error: custodian.message, reason: custodian.reason });

  const { data, error } = await supabase.rpc('mechanic_work_order_decide_authorization', {
    p_work_order_id: req.params.id,
    p_vin: req.params.vin,
    p_actor_id: req.userContext.id,
    p_actor_role: req.userContext.platformRole ?? req.userContext.role ?? null,
    p_actor_tenant_id: custodian.basis === 'dealer' ? (req.userContext.tenantId ?? null) : null,
    p_basis: custodian.basis,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) {
    if (error.code === 'P0002' || error.code === '22P02') throw new NotFoundError('Work order not found');
    if (error.code === '42501') return res.status(403).json({ error: error.message });
    if (error.code === '55000') return res.status(409).json({ error: error.message });
    if (error.code === '22023') throw new ValidationError(error.message);
    throw new DatabaseError(error.message);
  }
  const workOrder = typeof data === 'string' ? JSON.parse(data) : data;
  res.json({ success: true, workOrder });
}));

export default router;
