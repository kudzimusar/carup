import { DatabaseError, ForbiddenError } from '../../utils/errors.js';

/**
 * Service Network S9 — garage-side projections: the service queue, and the garage's
 * real customers.
 *
 * `CustomerRecords` previously shipped four invented people — fabricated names, phone
 * numbers, email addresses and spend totals — on a live product surface. After S2 a
 * garage has ACTUAL customers (the requesters of its service cases), so this replaces
 * the fabrication with truth rather than merely deleting it.
 *
 * Contact detail is deliberately NOT harvested here. Communications owns conversation
 * (Invariant 6): a garage reaches a customer through the canonical thread, not by being
 * handed a scraped phone number. So a customer record carries identity and service facts,
 * and messaging goes through the bound conversation.
 */

function requireTenantContext(userContext = {}) {
  const tenantId = userContext.tenantId || null;
  if (!tenantId) throw new ForbiddenError('A verified garage tenant context is required');
  return tenantId;
}

/** Cases needing attention first: requested, then accepted, then active. */
const QUEUE_ORDER = Object.freeze({ requested: 0, accepted: 1, active: 2 });
const OPEN_STATUSES = Object.freeze(['requested', 'accepted', 'active']);

/**
 * The garage service queue — the cases this tenant must act on.
 *
 * Strictly tenant-scoped, and it states what is unknown rather than filling gaps: a case
 * with no recorded category says so, and a vehicle whose make/model cannot be resolved is
 * reported by VIN alone.
 */
export async function getGarageQueue(supabaseClient, userContext, query = {}) {
  const tenantId = requireTenantContext(userContext);

  let builder = supabaseClient.from('service_cases').select('*').eq('garage_tenant_id', tenantId);
  const status = String(query.status || '').trim();
  if (status) {
    builder = builder.eq('status', status);
  }
  const { data, error } = await builder.order('requested_at', { ascending: true }).limit(200);
  if (error) throw new DatabaseError(`Failed to load garage queue: ${error.message}`);

  const cases = (data || []).filter((c) => (status ? true : OPEN_STATUSES.includes(c.status)));
  if (!cases.length) {
    return { queue: [], total: 0, counts: { requested: 0, accepted: 0, active: 0 } };
  }

  const vins = [...new Set(cases.map((c) => c.vin).filter(Boolean))];
  const { data: vehicles } = await supabaseClient
    .from('vehicles').select('vin, make, model, year').in('vin', vins);
  const vehicleByVin = new Map((vehicles || []).map((v) => [v.vin, v]));

  const caseIds = cases.map((c) => c.id);
  const { data: workOrders } = await supabaseClient
    .from('mechanic_work_orders').select('id, service_case_id, status').in('service_case_id', caseIds);
  const workOrderByCase = new Map((workOrders || []).map((w) => [w.service_case_id, w]));

  const queue = cases
    .map((c) => {
      const vehicle = vehicleByVin.get(c.vin) || null;
      const workOrder = workOrderByCase.get(c.id) || null;
      return {
        id: c.id,
        status: c.status,
        vin: c.vin,
        // A vehicle we cannot resolve is reported by VIN, not given a placeholder name.
        vehicle: vehicle
          ? { make: vehicle.make || null, model: vehicle.model || null, year: vehicle.year || null }
          : null,
        // Unknown category is stated, not defaulted to "General".
        service_category: c.service_category || null,
        requested_at: c.requested_at,
        accepted_at: c.accepted_at || null,
        branch_id: c.branch_id || null,
        work_order: workOrder ? { id: workOrder.id, status: workOrder.status } : null,
        // What this case is actually waiting for — derived from state, never guessed.
        next_action: c.status === 'requested'
          ? 'accept_or_decline'
          : c.status === 'accepted'
            ? (workOrder ? 'start_work' : 'open_work_order')
            : 'record_service',
      };
    })
    .sort((a, b) => {
      const byStatus = (QUEUE_ORDER[a.status] ?? 9) - (QUEUE_ORDER[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return String(a.requested_at || '').localeCompare(String(b.requested_at || ''));
    });

  const counts = { requested: 0, accepted: 0, active: 0 };
  for (const c of cases) {
    if (counts[c.status] !== undefined) counts[c.status] += 1;
  }
  return { queue, total: queue.length, counts };
}

/**
 * The garage's real customers, derived from its own service cases.
 *
 * Every figure is counted from records this garage owns. Nothing is estimated, and a
 * customer whose display name cannot be resolved is shown as an unnamed customer rather
 * than given an invented one.
 */
export async function getGarageCustomers(supabaseClient, userContext) {
  const tenantId = requireTenantContext(userContext);

  const { data: cases, error } = await supabaseClient
    .from('service_cases')
    .select('*')
    .eq('garage_tenant_id', tenantId);
  if (error) throw new DatabaseError(`Failed to load customers: ${error.message}`);
  const rows = (cases || []).filter((c) => c.requester_user_id);
  if (!rows.length) return { customers: [], total: 0 };

  const userIds = [...new Set(rows.map((c) => c.requester_user_id))];
  const { data: users } = await supabaseClient.from('users').select('id, name').in('id', userIds);
  const nameById = new Map((users || []).map((u) => [u.id, u.name || null]));

  const caseIds = rows.map((c) => c.id);
  const { data: records } = await supabaseClient
    .from('service_records').select('service_case_id, total_cost, currency').in('service_case_id', caseIds);
  const recordsByCase = new Map();
  for (const r of records || []) recordsByCase.set(r.service_case_id, r);

  const byCustomer = new Map();
  for (const c of rows) {
    if (!byCustomer.has(c.requester_user_id)) {
      byCustomer.set(c.requester_user_id, {
        user_id: c.requester_user_id,
        // No fabricated name; the UI says "Unnamed customer" rather than inventing one.
        display_name: nameById.get(c.requester_user_id) || null,
        vins: new Set(),
        case_count: 0,
        completed_count: 0,
        last_service_at: null,
        spend_by_currency: {},
        // Contact runs through Communications, so a bound thread is the way to reach them.
        conversation_thread_id: null,
      });
    }
    const entry = byCustomer.get(c.requester_user_id);
    if (c.vin) entry.vins.add(c.vin);
    entry.case_count += 1;
    if (c.status === 'completed') entry.completed_count += 1;
    const when = c.completed_at || c.requested_at || null;
    if (when && (!entry.last_service_at || when > entry.last_service_at)) entry.last_service_at = when;
    if (!entry.conversation_thread_id && c.conversation_thread_id) {
      entry.conversation_thread_id = c.conversation_thread_id;
    }
    const record = recordsByCase.get(c.id);
    if (record && record.total_cost !== null && record.total_cost !== undefined && record.currency) {
      // Spend is tracked PER CURRENCY. Amounts in different currencies are never added.
      entry.spend_by_currency[record.currency] =
        (entry.spend_by_currency[record.currency] || 0) + Number(record.total_cost);
    }
  }

  const customers = [...byCustomer.values()]
    .map((c) => ({
      user_id: c.user_id,
      display_name: c.display_name,
      vehicle_count: c.vins.size,
      case_count: c.case_count,
      completed_count: c.completed_count,
      last_service_at: c.last_service_at,
      // An empty object means no cost has been recorded — not that they spent zero.
      spend_by_currency: c.spend_by_currency,
      conversation_thread_id: c.conversation_thread_id,
    }))
    .sort((a, b) => String(b.last_service_at || '').localeCompare(String(a.last_service_at || '')));

  return { customers, total: customers.length };
}
