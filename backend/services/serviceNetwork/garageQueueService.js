import { DatabaseError } from '../../utils/errors.js';
import { GARAGE_PRACTITIONER_ROLES, requireGarageTenant } from './serviceAuthority.js';
import { deriveNextAction } from './nextAction.js';
import { sumMoney } from '../../utils/garageMoney.js';

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

// OC-5D: the verified active garage, in a workspace role (serviceAuthority).
const requireTenantContext = (userContext) => requireGarageTenant(userContext);

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
  // OC-5D: a failed read is not "no work order" — that would tell the garage to open a second one.
  const { data: workOrders, error: workOrderError } = await supabaseClient
    .from('mechanic_work_orders').select('id, service_case_id, status, owner_authorization').in('service_case_id', caseIds);
  if (workOrderError) throw new DatabaseError(`Failed to load work orders: ${workOrderError.message}`);
  const workOrderByCase = new Map((workOrders || []).map((w) => [w.service_case_id, w]));

  // WHO is on each job (R6).
  //
  // A mechanic and a garage manager look at the same queue and need different things from it: the
  // manager needs everything, the mechanic needs their own work. Without this the two are the same
  // screen, and a mechanic must open every job to find out which are theirs.
  //
  // `work_order_assignments` is the authority for assignment — not the legacy `mechanic_id` column
  // — and a live assignment is one that has not been unassigned. Read failure leaves every job
  // unattributed rather than silently attributing them to nobody-in-particular: `null` here means
  // "not known from this read", and the surfaces treat it as unknown, never as unassigned.
  const workOrderIds = (workOrders || []).map((w) => w.id);
  const assigneeByWorkOrder = new Map();
  if (workOrderIds.length) {
    // OC-5D: a failed read fails the queue rather than presenting every job as unassigned.
    const { data: assignments, error: assignmentError } = await supabaseClient
      .from('work_order_assignments')
      .select('work_order_id, mechanic_user_id, unassigned_at')
      .in('work_order_id', workOrderIds)
      .is('unassigned_at', null);
    if (assignmentError) throw new DatabaseError(`Failed to load assignments: ${assignmentError.message}`);
    for (const a of assignments || []) assigneeByWorkOrder.set(a.work_order_id, a.mechanic_user_id);
  }

  // GARAGE-1.0: the facts a job is actually waiting on — the latest estimate, whether any work has
  // been recorded, and (for finished jobs) the live invoice and what has been recorded against it.
  // A failed read fails the queue: it must not present "no estimate" / "no invoice" on a guess.
  const estimateByWorkOrder = new Map();
  const recordCountByWorkOrder = new Map();
  const invoiceByWorkOrder = new Map();
  if (workOrderIds.length) {
    const { data: estimates, error: estimateError } = await supabaseClient
      .from('garage_estimates').select('id, work_order_id, version, status')
      .eq('tenant_id', tenantId).in('work_order_id', workOrderIds);
    if (estimateError) throw new DatabaseError(`Failed to load estimates: ${estimateError.message}`);
    for (const e of estimates || []) {
      const current = estimateByWorkOrder.get(e.work_order_id);
      if (!current || e.version > current.version) estimateByWorkOrder.set(e.work_order_id, e);
    }
    const { data: records, error: recordError } = await supabaseClient
      .from('service_records').select('work_order_id').eq('tenant_id', tenantId).in('work_order_id', workOrderIds);
    if (recordError) throw new DatabaseError(`Failed to load service records: ${recordError.message}`);
    for (const r of records || []) recordCountByWorkOrder.set(r.work_order_id, (recordCountByWorkOrder.get(r.work_order_id) || 0) + 1);

    const finished = (workOrders || []).filter((w) => {
      const c = cases.find((x) => x.id === w.service_case_id);
      return c?.status === 'completed';
    }).map((w) => w.id);
    if (finished.length) {
      const { data: invoices, error: invoiceError } = await supabaseClient
        .from('garage_invoices').select('id, work_order_id, invoice_number, status, total_amount, currency')
        .eq('tenant_id', tenantId).in('work_order_id', finished);
      if (invoiceError) throw new DatabaseError(`Failed to load invoices: ${invoiceError.message}`);
      const liveIds = (invoices || []).filter((i) => i.status === 'issued').map((i) => i.id);
      const net = new Map();
      if (liveIds.length) {
        const { data: payments, error: paymentError } = await supabaseClient
          .from('garage_payment_records').select('invoice_id, kind, amount').eq('tenant_id', tenantId).in('invoice_id', liveIds);
        if (paymentError) throw new DatabaseError(`Failed to load payment records: ${paymentError.message}`);
        for (const p of payments || []) {
          const cents = Math.round(Number(p.amount) * 100) * (p.kind === 'payment' ? 1 : -1);
          net.set(p.invoice_id, (net.get(p.invoice_id) || 0) + cents);
        }
      }
      for (const i of invoices || []) {
        if (i.status !== 'issued') continue;
        const paid = net.get(i.id) || 0;
        const total = Math.round(Number(i.total_amount) * 100);
        invoiceByWorkOrder.set(i.work_order_id, {
          id: i.id, invoice_number: i.invoice_number, status: i.status,
          payment_status: paid <= 0 ? 'unpaid' : (paid < total ? 'partially_paid' : 'paid'),
        });
      }
    }
  }

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
        work_order: workOrder
          ? {
            id: workOrder.id,
            status: workOrder.status,
            // The customer's decision on this work — the one authorization (OC-5A). Absent in an old
            // read is "pending", never "authorized".
            owner_authorization: workOrder.owner_authorization || 'pending',
            // null = nobody is assigned, or the assignment could not be read. Either way the UI
            // must not claim a name it does not have.
            assigned_mechanic_user_id: assigneeByWorkOrder.get(workOrder.id) || null,
          }
          : null,
        estimate: workOrder && estimateByWorkOrder.get(workOrder.id)
          ? { id: estimateByWorkOrder.get(workOrder.id).id, version: estimateByWorkOrder.get(workOrder.id).version, status: estimateByWorkOrder.get(workOrder.id).status }
          : null,
        service_record_count: workOrder ? (recordCountByWorkOrder.get(workOrder.id) || 0) : 0,
        invoice: workOrder ? (invoiceByWorkOrder.get(workOrder.id) || null) : null,
        // What this case is actually waiting for — derived from recorded facts, never guessed.
        next_action: deriveNextAction({
          caseStatus: c.status,
          workOrder: workOrder
            ? { ...workOrder, assigned_mechanic_user_id: assigneeByWorkOrder.get(workOrder.id) || null }
            : null,
          estimate: workOrder ? estimateByWorkOrder.get(workOrder.id) || null : null,
          serviceRecordCount: workOrder ? (recordCountByWorkOrder.get(workOrder.id) || 0) : 0,
          invoice: workOrder ? invoiceByWorkOrder.get(workOrder.id) || null : null,
        }),
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
 * The garage's own people, so a mechanic can be CHOSEN (R5).
 *
 * `assignMechanic` takes a `mechanic_user_id` and refuses any id that is not a member of the
 * caller's tenant. Nothing in the product could tell an operator what those ids are, so a certified
 * assignment capability was reachable only by typing a UUID — which is the same as not having it.
 *
 * This adds no authority and no table. It reads the SAME `tenant_users` membership that
 * `assignMechanic` already validates against, for the caller's own tenant only, and returns the
 * minimum needed to pick a person. A member whose name cannot be resolved is reported as unnamed
 * rather than given an invented one, and no other tenant's membership is readable through here.
 */
export async function getGarageMechanics(supabaseClient, userContext) {
  const tenantId = requireTenantContext(userContext);

  const { data: members, error } = await supabaseClient
    .from('tenant_users')
    .select('user_id, role')
    .eq('tenant_id', tenantId);
  if (error) throw new DatabaseError(`Failed to load garage members: ${error.message}`);

  // Only the people who can be assigned (OC-5D: assignMechanic accepts exactly these roles).
  const rows = (members || []).filter((m) => GARAGE_PRACTITIONER_ROLES.includes(String(m.role || '').trim().toLowerCase()));
  if (!rows.length) return { mechanics: [], total: 0 };

  const userIds = [...new Set(rows.map((m) => m.user_id).filter(Boolean))];
  const { data: users } = await supabaseClient.from('users').select('id, name').in('id', userIds);
  const nameById = new Map((users || []).map((u) => [u.id, u.name || null]));

  const mechanics = rows
    .map((m) => ({
      user_id: m.user_id,
      display_name: nameById.get(m.user_id) || null,
      // The membership role, stated as recorded. It is not a qualification and not a rating.
      role: m.role || null,
    }))
    .sort((a, b) => String(a.display_name || '￿').localeCompare(String(b.display_name || '￿')));

  return { mechanics, total: mechanics.length };
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
  const { data: users, error: userError } = await supabaseClient.from('users').select('id, name').in('id', userIds);
  if (userError) throw new DatabaseError(`Failed to load customer identities: ${userError.message}`);
  const nameById = new Map((users || []).map((u) => [u.id, u.name || null]));

  const caseIds = rows.map((c) => c.id);
  // OC-5D: a failed read is not "no cost recorded" (an empty spend means exactly that).
  const { data: records, error: recordError } = await supabaseClient
    .from('service_records').select('service_case_id, total_cost, currency').in('service_case_id', caseIds);
  if (recordError) throw new DatabaseError(`Failed to load service records: ${recordError.message}`);
  // Every record counts: a case can carry more than one service record (#197 kept only the last).
  const recordsByCase = new Map();
  for (const r of records || []) {
    if (!recordsByCase.has(r.service_case_id)) recordsByCase.set(r.service_case_id, []);
    recordsByCase.get(r.service_case_id).push(r);
  }

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
        spend_terms: {},
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
    for (const record of recordsByCase.get(c.id) || []) {
      if (record.total_cost === null || record.total_cost === undefined || !record.currency) continue;
      // Spend is tracked PER CURRENCY. Amounts in different currencies are never added.
      (entry.spend_terms[record.currency] ||= []).push(String(record.total_cost));
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
      // An empty object means no cost has been recorded — not that they spent zero. Summed as exact decimals
      // (0.10 + 0.20 is 0.30, not 0.30000000000000004); a currency the money helper cannot hold exactly falls
      // back to the plain sum rather than losing the figure.
      spend_by_currency: Object.fromEntries(Object.entries(c.spend_terms).map(([currency, terms]) => {
        const exact = sumMoney(terms, currency);
        return [currency, exact === null ? terms.reduce((a, b) => a + Number(b), 0) : Number(exact)];
      })),
      conversation_thread_id: c.conversation_thread_id,
    }))
    .sort((a, b) => String(b.last_service_at || '').localeCompare(String(a.last_service_at || '')));

  return { customers, total: customers.length };
}
