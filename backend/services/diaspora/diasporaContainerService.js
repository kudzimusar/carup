import { supabase } from '../../db/supabase.js';
import { CONTAINER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateContainerPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';
import { requireUserContext, assertCanManageLogistics } from './diasporaAuthorization.js';

const CONTAINER_TRANSITIONS = Object.freeze({
  DRAFT: ['BOOKING_OPEN', 'CANCELLED'],
  BOOKING_OPEN: ['BOOKING_CLOSED', 'LOADING', 'CANCELLED'],
  BOOKING_CLOSED: ['LOADING', 'CANCELLED'],
  LOADING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['ARRIVED'],
  ARRIVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

export function assertContainerTransition(currentStatus, nextStatus) {
  const allowed = CONTAINER_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ValidationError(`Illegal container transition: ${currentStatus} -> ${nextStatus}`, { currentStatus, nextStatus, allowed });
  }
}

export async function createContainerShipment(payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  // Only logistics-trusted roles may create containers (scoped to their tenant when tenant-bound).
  assertCanManageLogistics({ tenant_id: context.tenantId || payload.tenant_id || null }, context);
  validateContainerPayload(payload);
  const total = Number(payload.total_capacity_volume);
  const used = Number(payload.used_capacity_volume || 0);
  const { data, error } = await supabase
    .from('diaspora_container_shipments')
    .insert({
      tenant_id: userContext?.tenantId || payload.tenant_id || null,
      origin_country: payload.origin_country,
      origin_city: payload.origin_city,
      destination_country: payload.destination_country,
      destination_city: payload.destination_city,
      departure_date: payload.departure_date,
      booking_deadline: payload.booking_deadline,
      estimated_arrival_date: payload.estimated_arrival_date || null,
      container_type: payload.container_type,
      total_capacity_volume: total,
      used_capacity_volume: used,
      available_capacity_volume: Math.max(total - used, 0),
      status: payload.status || CONTAINER_STATUSES.DRAFT,
      coordinator_id: payload.coordinator_id || userContext?.id || null,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'CONTAINER_CREATED', resourceType: 'diaspora_container_shipment', resourceId: data.id, newState: data, req });
  await emitDiasporaEvent('DIASPORA_CONTAINER_CREATED', { containerId: data.id, status: data.status }, data.tenant_id);
  return data;
}

export async function listContainerShipments({ status, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_container_shipments').select('*').is('deleted_at', null).order('departure_date', { ascending: true }).range(offset, offset + limit - 1);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getContainerShipment(id, options = {}) {
  const client = options.supabaseClient || supabase;
  const { data, error } = await client.from('diaspora_container_shipments').select('*, diaspora_cargo_reservations(*)').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora container shipment not found');
  return data;
}

/**
 * T10 — a sailing may not CLAIM to be loading or shipped without the canonical loading fact.
 *
 * The T10.0 audit found this route marking a sailing `LOADING`, and then `SHIPPED`, with no manifest,
 * no warehouse receipt, no attributed load and no seal. Nothing anywhere said a single consignment
 * had gone into the box. A status is a claim, and this one was free.
 *
 * The fix is deliberately NOT a second loading truth. `diaspora_container_loads` is the authority;
 * this status now merely REFLECTS it, and the reflection is checked here:
 *
 *   LOADING  requires a live T10 load  (IN_PROGRESS or COMPLETED)
 *   SHIPPED  requires a COMPLETED one  — you cannot have sailed without finishing loading
 *
 * The `SHIPPED` gate is the strongest precondition T10 can honestly impose: it is about loading, not
 * about movement. **Whether marking a sailing SHIPPED should additionally require a governed T11
 * shipment record is T11.0's question**, and deliberately not answered here — implementing T11
 * inside T10 is exactly what this phase must not do.
 */
async function assertLoadingIsBackedByT10(containerId, nextStatus, client) {
  if (nextStatus !== CONTAINER_STATUSES.LOADING && nextStatus !== CONTAINER_STATUSES.SHIPPED) return;
  const { data } = await client.from('diaspora_container_loads').select('id, status')
    .eq('container_id', containerId).is('deleted_at', null);
  const live = (data || []).filter((l) => ['IN_PROGRESS', 'COMPLETED'].includes(String(l.status)));

  if (nextStatus === CONTAINER_STATUSES.LOADING && !live.length) {
    throw new ValidationError(
      'This sailing cannot be marked as loading: nothing has been recorded as going into it. '
      + 'Start loading in the loading workspace, which records what actually went in and who put it there.',
      { code: 'LOADING_NOT_BACKED_BY_LOAD_RECORD' },
    );
  }
  if (nextStatus === CONTAINER_STATUSES.SHIPPED && !live.some((l) => l.status === 'COMPLETED')) {
    throw new ValidationError(
      'This sailing cannot be marked as shipped: its loading has not been completed. '
      + 'Complete the load first — a container that was never finished being loaded has not sailed.',
      { code: 'SHIPPED_WITHOUT_COMPLETED_LOAD' },
    );
  }
}

export async function transitionContainer(id, nextStatus, userContext = {}, req = null, options = {}) {
  const context = requireUserContext(userContext);
  const client = options.supabaseClient || supabase;
  const previous = await getContainerShipment(id, options);
  assertCanManageLogistics(previous, context);
  assertContainerTransition(previous.status, nextStatus);
  // T10: a loading or shipped claim must be backed by the canonical load authority.
  await assertLoadingIsBackedByT10(id, nextStatus, client);
  const { data, error } = await client
    .from('diaspora_container_shipments')
    .update({ status: nextStatus, updated_by: userContext?.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'CONTAINER_STATUS_CHANGED', resourceType: 'diaspora_container_shipment', resourceId: id, previousState: { status: previous.status }, newState: { status: nextStatus }, req, supabaseClient: client });
  // Best-effort, like every other notifier in the programme — and this one had drifted.
  //
  // By the time we get here the status row is written and the audit is sealed. Throwing on an
  // unreachable outbox therefore reported FAILURE for work that had already committed: the caller
  // saw an error while the database showed the new status. Found by the positive control in
  // trade-os-t10-legacy-loading-bypass, which could not exercise the success path at all until this
  // was fixed. A notification never creates or unwinds domain state.
  try {
    await emitDiasporaEvent(`DIASPORA_CONTAINER_${nextStatus}`, { containerId: id, previousStatus: previous.status, status: nextStatus }, data.tenant_id);
  } catch (err) {
    console.warn(`[container-transition] outbox emit failed for ${nextStatus}:`, err.message);
  }
  return data;
}
