import { supabase } from '../../db/supabase.js';
import { CONTAINER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateContainerPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';

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

export async function getContainerShipment(id) {
  const { data, error } = await supabase.from('diaspora_container_shipments').select('*, diaspora_cargo_reservations(*)').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora container shipment not found');
  return data;
}

export async function transitionContainer(id, nextStatus, userContext = {}, req = null) {
  const previous = await getContainerShipment(id);
  assertContainerTransition(previous.status, nextStatus);
  const { data, error } = await supabase
    .from('diaspora_container_shipments')
    .update({ status: nextStatus, updated_by: userContext?.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'CONTAINER_STATUS_CHANGED', resourceType: 'diaspora_container_shipment', resourceId: id, previousState: { status: previous.status }, newState: { status: nextStatus }, req });
  await emitDiasporaEvent(`DIASPORA_CONTAINER_${nextStatus}`, { containerId: id, previousStatus: previous.status, status: nextStatus }, data.tenant_id);
  return data;
}
