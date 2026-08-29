import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { GARAGE_SERVICE_CATEGORIES } from './garageDirectoryService.js';

/**
 * Service Network S4 — work order convergence and mechanic assignment.
 *
 * The existing `mechanic_work_orders` table remains THE work-order authority
 * (plan §6.3 — no second work-order table). This service adds what Foundation 1.0
 * needs on top of it, additively:
 *
 *   - an explicit, idempotent link to a Service Case;
 *   - durable, attributable mechanic assignment that replaces the historical
 *     "whoever created the work order is the mechanic" conflation (plan §6.4);
 *   - terminal-state immutability (plan §7.6, Invariant 12).
 *
 * IMPORTANT SCHEMA TRUTH: the Title-Case status CHECK lives only in
 * 009_phase4_schema.sql, which is RETIRED_UNAPPLIABLE, and the legacy 006 shape
 * declares `status TEXT DEFAULT 'pending'` with no constraint. The database
 * therefore does NOT uniformly enforce the status vocabulary, and adding a CHECK
 * would be unsafe because legacy rows can legitimately hold values outside it.
 * Vocabulary and transition rules are enforced HERE, and reads must tolerate
 * legacy values rather than crashing on them.
 */

/** The DB-legal, API-pinned write vocabulary. Reads may see legacy values beyond this. */
export const WORK_ORDER_STATUSES = Object.freeze(['In Progress', 'Completed', 'Cancelled']);
const TERMINAL_WORK_ORDER_STATUSES = Object.freeze(['Completed', 'Cancelled']);
const UNASSIGN_REASON_CODES = Object.freeze(['reassigned', 'unavailable', 'completed', 'other']);

/** Legacy rows may carry anything; normalize for comparison without rewriting them. */
function normalizedStatus(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function isTerminal(status) {
  return TERMINAL_WORK_ORDER_STATUSES.some((t) => normalizedStatus(t) === normalizedStatus(status));
}

function requireTenantContext(userContext = {}) {
  const tenantId = userContext.tenantId || null;
  if (!tenantId) throw new ForbiddenError('A verified garage tenant context is required');
  return tenantId;
}

function actorId(userContext = {}) {
  const id = userContext.id || userContext.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required');
  return id;
}

async function loadWorkOrder(supabaseClient, workOrderId, tenantId) {
  const id = String(workOrderId || '').trim();
  if (!id) throw new ValidationError('work order id is required');
  const { data, error } = await supabaseClient
    .from('mechanic_work_orders')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load work order: ${error.message}`);
  // Another tenant's work order is indistinguishable from a missing one.
  if (!data) throw new NotFoundError('Work order not found');
  return data;
}

/**
 * Create the work order for an accepted Service Case, or return the existing one.
 *
 * The relation is explicit and idempotent (plan §7.3): `service_case_id` is uniquely
 * indexed, so a retry can never open a second work order for one case.
 *
 * Note what this deliberately does NOT do: it does not stamp `mechanic_id` from the
 * caller. Intake and execution are different acts (plan §6.4) — the work order may
 * legitimately begin unassigned.
 */
export async function createWorkOrderForCase(supabaseClient, userContext, caseId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const id = String(caseId || '').trim();
  if (!id) throw new ValidationError('service case id is required');

  const { data: caseRow, error: caseError } = await supabaseClient
    .from('service_cases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (caseError) throw new DatabaseError(`Failed to load service case: ${caseError.message}`);
  if (!caseRow || caseRow.garage_tenant_id !== tenantId) throw new NotFoundError('Service case not found');

  if (!['accepted', 'active'].includes(caseRow.status)) {
    throw new ConflictError(`A work order can only be opened for an accepted case (this one is ${caseRow.status})`);
  }

  const { data: existing, error: existingError } = await supabaseClient
    .from('mechanic_work_orders')
    .select('*')
    .eq('service_case_id', caseRow.id)
    .maybeSingle();
  if (existingError) throw new DatabaseError(`Failed to check work order: ${existingError.message}`);
  if (existing) return { workOrder: existing, created: false };

  const category = body.service_category === undefined
    ? caseRow.service_category
    : normalizeCategory(body.service_category);

  const row = {
    tenant_id: tenantId,
    vin: caseRow.vin,
    customer_id: caseRow.requester_user_id || null,
    service_case_id: caseRow.id,
    branch_id: caseRow.branch_id || null,
    service_category: category || null,
    description: body.description ? String(body.description).trim() : caseRow.request_summary || null,
    status: 'In Progress',
  };

  const { data, error } = await supabaseClient.from('mechanic_work_orders').insert(row).select().single();
  if (error) {
    if (String(error.code) === '23505') {
      const { data: winner } = await supabaseClient
        .from('mechanic_work_orders').select('*').eq('service_case_id', caseRow.id).maybeSingle();
      if (winner) return { workOrder: winner, created: false };
    }
    throw new DatabaseError(`Failed to create work order: ${error.message}`);
  }
  return { workOrder: data, created: true };
}

function normalizeCategory(value) {
  if (value === undefined || value === null || value === '') return null;
  const c = String(value).trim();
  if (!GARAGE_SERVICE_CATEGORIES.includes(c)) throw new ValidationError(`Unknown service category: ${c}`);
  return c;
}

/**
 * Assign a mechanic. Attributable (who assigned, when) and tenant-safe: the mechanic
 * must be a member of the acting garage tenant, so a garage cannot assign someone
 * else's staff (or an arbitrary platform user) to its work.
 */
export async function assignMechanic(supabaseClient, userContext, workOrderId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const assigner = actorId(userContext);
  const mechanicUserId = String(body.mechanic_user_id || '').trim();
  if (!mechanicUserId) throw new ValidationError('mechanic_user_id is required');

  const workOrder = await loadWorkOrder(supabaseClient, workOrderId, tenantId);
  if (isTerminal(workOrder.status)) {
    throw new ConflictError(`This work order is ${workOrder.status} and remains historical; it cannot be reassigned`);
  }

  const { data: membership, error: membershipError } = await supabaseClient
    .from('tenant_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', mechanicUserId)
    .maybeSingle();
  if (membershipError) throw new DatabaseError(`Failed to verify membership: ${membershipError.message}`);
  if (!membership) throw new ValidationError('That mechanic is not a member of this garage');

  const { data: live, error: liveError } = await supabaseClient
    .from('work_order_assignments')
    .select('*')
    .eq('work_order_id', workOrder.id)
    .is('unassigned_at', null)
    .maybeSingle();
  if (liveError) throw new DatabaseError(`Failed to read assignment: ${liveError.message}`);
  if (live) {
    if (live.mechanic_user_id === mechanicUserId) return { assignment: live, created: false };
    throw new ConflictError('This work order already has an assigned mechanic; unassign first');
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from('work_order_assignments')
    .insert({
      work_order_id: workOrder.id,
      tenant_id: tenantId,
      mechanic_user_id: mechanicUserId,
      assigned_by_user_id: assigner,
      assigned_at: now,
      created_at: now,
    })
    .select()
    .single();
  if (error) {
    if (String(error.code) === '23505') {
      throw new ConflictError('This work order already has an assigned mechanic; unassign first');
    }
    throw new DatabaseError(`Failed to assign mechanic: ${error.message}`);
  }

  // Keep the legacy column in step for existing consumers, WITHOUT making it the
  // authority: work_order_assignments is the record of who is assigned.
  await supabaseClient.from('mechanic_work_orders')
    .update({ mechanic_id: mechanicUserId })
    .eq('id', workOrder.id)
    .eq('tenant_id', tenantId);

  return { assignment: data, created: true };
}

/** Unassignment closes the live row; the history is never deleted. */
export async function unassignMechanic(supabaseClient, userContext, workOrderId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const actor = actorId(userContext);
  const reason = body.reason_code ? String(body.reason_code).trim() : null;
  if (reason && !UNASSIGN_REASON_CODES.includes(reason)) {
    throw new ValidationError(`Unknown unassign reason code: ${reason}`);
  }
  const workOrder = await loadWorkOrder(supabaseClient, workOrderId, tenantId);

  const { data, error } = await supabaseClient
    .from('work_order_assignments')
    .update({ unassigned_at: new Date().toISOString(), unassigned_by_user_id: actor, unassign_reason_code: reason })
    .eq('work_order_id', workOrder.id)
    .is('unassigned_at', null)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to unassign mechanic: ${error.message}`);
  if (!data) throw new NotFoundError('This work order has no assigned mechanic');
  return { assignment: data };
}

/**
 * Update work-order status with a real transition guard.
 *
 * The database cannot do this (see the schema-truth note above), so a completed or
 * cancelled work order is protected here: it remains historical.
 */
export async function updateWorkOrderStatus(supabaseClient, userContext, workOrderId, body = {}) {
  const tenantId = requireTenantContext(userContext);
  const status = String(body.status || '').trim();
  if (!WORK_ORDER_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${WORK_ORDER_STATUSES.join(', ')}`);
  }
  const workOrder = await loadWorkOrder(supabaseClient, workOrderId, tenantId);
  if (isTerminal(workOrder.status)) {
    throw new ConflictError(`This work order is ${workOrder.status} and remains historical; it cannot be reopened`);
  }

  const now = new Date().toISOString();
  const updates = { status };
  if (status === 'Completed') updates.completed_at = now;
  if (status === 'Cancelled') {
    updates.cancelled_at = now;
    if (body.reason_code !== undefined) {
      updates.cancellation_reason_code = body.reason_code ? String(body.reason_code).trim() : null;
    }
  }

  if (body.total_cost !== undefined && body.total_cost !== null) {
    const cost = Number(body.total_cost);
    if (!Number.isFinite(cost) || cost < 0) throw new ValidationError('total_cost must be a non-negative number');
    // Money always carries its currency; absent cost stays absent rather than becoming 0.
    const currency = String(body.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError('currency (ISO-4217, e.g. USD) is required whenever a cost is recorded');
    }
    updates.total_cost = cost;
    updates.currency = currency;
  }

  const { data, error } = await supabaseClient
    .from('mechanic_work_orders')
    .update(updates)
    .eq('id', workOrder.id)
    .eq('tenant_id', tenantId)
    .eq('status', workOrder.status)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to update work order: ${error.message}`);
  if (!data) throw new ConflictError('This work order changed while you were acting on it; reload and try again');
  return { workOrder: data };
}

/** Read the assignment record — the authority for "which mechanic", not the legacy column. */
export async function getWorkOrderAssignment(supabaseClient, userContext, workOrderId) {
  const tenantId = requireTenantContext(userContext);
  const workOrder = await loadWorkOrder(supabaseClient, workOrderId, tenantId);
  const { data, error } = await supabaseClient
    .from('work_order_assignments')
    .select('*')
    .eq('work_order_id', workOrder.id)
    .order('assigned_at', { ascending: true });
  if (error) throw new DatabaseError(`Failed to load assignments: ${error.message}`);
  const history = data || [];
  const live = history.find((a) => !a.unassigned_at) || null;
  return {
    work_order_id: workOrder.id,
    // Unknown is not zero, and not a guess: an unassigned work order says so.
    assigned_mechanic_user_id: live ? live.mechanic_user_id : null,
    assigned: Boolean(live),
    history,
  };
}
