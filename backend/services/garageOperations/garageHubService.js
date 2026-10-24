import { supabase as defaultClient } from '../../db/supabase.js';
import { GARAGE_ADMIN_ROLES, requireGarageTenant } from '../serviceNetwork/serviceAuthority.js';
import { getGarageMechanics } from '../serviceNetwork/garageQueueService.js';
import { deriveNextAction } from '../serviceNetwork/nextAction.js';
import { allowedActions } from '../serviceNetwork/allowedActions.js';
import { listCaseEstimates } from './garageEstimateService.js';
import { listWorkOrderParts } from './garageStockService.js';
import { getCloseout } from './garageInvoiceService.js';
import { DatabaseError, NotFoundError } from '../../utils/errors.js';
import { moneyString } from '../../utils/garageMoney.js';

/**
 * GARAGE-1.0 — the operating hub's read model for /garage/cases/:caseId.
 *
 * ONE call returns what the screen needs to guide the operator through the whole job — request,
 * appointment, estimate, the customer's decision, assignment, work, parts, completion and the
 * commercial closeout — plus the exact set of actions the backend will accept for THIS caller now.
 * It composes the existing authorities (it reads, never writes, and owns no table), and it states
 * what is unknown instead of filling it.
 */
export async function getCaseHub(client = defaultClient, actor = {}, caseId) {
  const tenantId = requireGarageTenant(actor);
  const isAdmin = (() => { try { requireGarageTenant(actor, GARAGE_ADMIN_ROLES); return true; } catch { return false; } })();

  const id = String(caseId ?? '').trim();
  const { data: serviceCase, error } = await client.from('service_cases').select('*').eq('id', id).eq('garage_tenant_id', tenantId).maybeSingle();
  if (error) throw new DatabaseError('Could not load the service case: ' + error.message);
  if (!serviceCase) throw new NotFoundError('Service case not found');

  const [{ data: vehicle }, { data: workOrder, error: woError }, { data: events, error: eventsError }, { data: appointments, error: apptError }] = await Promise.all([
    client.from('vehicles').select('vin, make, model, year').eq('vin', serviceCase.vin).maybeSingle(),
    client.from('mechanic_work_orders').select('id, status, owner_authorization, owner_authorized_at, description, currency, completed_at').eq('service_case_id', serviceCase.id).eq('tenant_id', tenantId).maybeSingle(),
    client.from('service_case_events').select('id, event_type, from_status, to_status, created_at').eq('service_case_id', serviceCase.id).order('id', { ascending: true }),
    client.from('garage_appointments').select('id, status, starts_at, ends_at, appointment_timezone, branch_id, planned_workforce_profile_id').eq('service_case_id', serviceCase.id).eq('tenant_id', tenantId).order('created_at', { ascending: false }),
  ]);
  if (woError) throw new DatabaseError('Could not load the job: ' + woError.message);
  if (eventsError) throw new DatabaseError('Could not load the case history: ' + eventsError.message);
  if (apptError) throw new DatabaseError('Could not load the appointment: ' + apptError.message);

  let assignedMechanicUserId = null;
  let records = [];
  let parts = { usage: [] };
  if (workOrder) {
    const [assignment, recs] = await Promise.all([
      client.from('work_order_assignments').select('mechanic_user_id').eq('work_order_id', workOrder.id).is('unassigned_at', null).maybeSingle(),
      client.from('service_records').select('id, service_category, service_authority, work_performed, total_cost, currency, performed_at, recorded_by_user_id')
        .eq('work_order_id', workOrder.id).eq('tenant_id', tenantId).order('performed_at', { ascending: true }),
    ]);
    if (assignment.error) throw new DatabaseError('Could not load the assignment: ' + assignment.error.message);
    if (recs.error) throw new DatabaseError('Could not load service records: ' + recs.error.message);
    assignedMechanicUserId = assignment.data?.mechanic_user_id || null;
    records = recs.data || [];
    parts = await listWorkOrderParts(client, actor, workOrder.id);
  }

  const estimates = await listCaseEstimates(client, actor, serviceCase.id);
  const closeout = isAdmin ? await getCloseout(client, actor, serviceCase.id) : null;
  const liveInvoice = closeout?.invoice && closeout.invoice.status === 'issued' ? closeout.invoice : null;

  const facts = {
    caseStatus: serviceCase.status,
    workOrder: workOrder ? { ...workOrder, assigned_mechanic_user_id: assignedMechanicUserId } : null,
    estimate: estimates.latest ? { status: estimates.latest.status } : null,
    serviceRecordCount: records.length,
    invoice: liveInvoice ? { status: liveInvoice.status, payment_status: liveInvoice.payment_status } : null,
  };
  const liveAppointment = (appointments || []).find((a) => ['requested', 'confirmed'].includes(a.status)) || null;

  return {
    case: {
      id: serviceCase.id, status: serviceCase.status, vin: serviceCase.vin, service_category: serviceCase.service_category || null,
      requested_at: serviceCase.requested_at, accepted_at: serviceCase.accepted_at || null, started_at: serviceCase.started_at || null,
      completed_at: serviceCase.completed_at || null, branch_id: serviceCase.branch_id || null,
      // the customer's own words; private notes of the garage are never mixed in here
      request_summary: serviceCase.request_summary || null,
    },
    vehicle: vehicle ? { vin: vehicle.vin, make: vehicle.make || null, model: vehicle.model || null, year: vehicle.year || null } : null,
    work_order: workOrder
      ? { id: workOrder.id, status: workOrder.status, owner_authorization: workOrder.owner_authorization, owner_authorized_at: workOrder.owner_authorized_at || null, assigned_mechanic_user_id: assignedMechanicUserId }
      : null,
    appointment: liveAppointment,
    estimates: { latest: estimates.latest, versions: estimates.estimates },
    service_records: records.map((r) => ({
      id: r.id, service_category: r.service_category, service_authority: r.service_authority, work_performed: r.work_performed || null,
      cost: r.total_cost === null || r.total_cost === undefined ? null : { amount: moneyString(r.total_cost, r.currency), currency: r.currency },
      performed_at: r.performed_at, recorded_by_user_id: r.recorded_by_user_id,
    })),
    parts_used: parts.usage,
    closeout,
    mechanics: isAdmin ? (await getGarageMechanics(client, actor)).mechanics ?? [] : [],
    history: (events || []).map((e) => ({ event_type: e.event_type, from_status: e.from_status, to_status: e.to_status, at: e.created_at })),
    next_action: deriveNextAction(facts),
    allowed_actions: allowedActions({
      caseStatus: serviceCase.status, workOrder: facts.workOrder, estimate: facts.estimate,
      assignedMechanicUserId, serviceRecordCount: records.length, invoice: facts.invoice, isAdmin,
    }),
    viewer: { role: actor.activeTenant?.role || null, is_admin: isAdmin },
  };
}

export default { getCaseHub };
