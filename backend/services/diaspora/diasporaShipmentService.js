import { supabase } from '../../db/supabase.js';
import { SHIPMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateShipmentPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';

const SHIPMENT_TO_IMPORT_STATUS = Object.freeze({
  LOADING: IMPORT_ORDER_STATUSES.READY_FOR_LOADING,
  IN_TRANSIT: IMPORT_ORDER_STATUSES.SHIPPED,
  ARRIVED: IMPORT_ORDER_STATUSES.ARRIVED_AT_BORDER,
  CUSTOMS_HOLD: IMPORT_ORDER_STATUSES.CUSTOMS_IN_PROGRESS,
  RELEASED: IMPORT_ORDER_STATUSES.RELEASED,
  COMPLETED: IMPORT_ORDER_STATUSES.COMPLETED,
});

export async function createShipment(payload, userContext = {}, req = null) {
  validateShipmentPayload(payload);
  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', payload.import_order_id).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  const { data, error } = await supabase
    .from('diaspora_shipments')
    .insert({
      tenant_id: userContext?.tenantId || order.tenant_id,
      import_order_id: payload.import_order_id,
      container_id: payload.container_id || null,
      carrier_name: payload.carrier_name || null,
      tracking_number: payload.tracking_number || null,
      origin_port: payload.origin_port || null,
      destination_port: payload.destination_port || null,
      departure_date: payload.departure_date || null,
      estimated_arrival_date: payload.estimated_arrival_date || null,
      actual_arrival_date: payload.actual_arrival_date || null,
      status: payload.status || SHIPMENT_STATUSES.PLANNED,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeShipmentStageEvent(data.id, data.status, 'Shipment created', userContext, req, { created: true });
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'SHIPMENT_CREATED', resourceType: 'diaspora_shipment', resourceId: data.id, newState: data, req });
  return data;
}

export async function listShipments({ importOrderId, status, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_shipments').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getShipment(id) {
  const { data, error } = await supabase.from('diaspora_shipments').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora shipment not found');
  return data;
}

export async function writeShipmentStageEvent(shipmentId, stage, notes, userContext = {}, req = null, metadata = {}) {
  const shipment = await getShipment(shipmentId).catch(() => null);
  const { data, error } = await supabase
    .from('diaspora_shipment_stage_events')
    .insert({
      shipment_id: shipmentId,
      import_order_id: shipment?.import_order_id || null,
      tenant_id: shipment?.tenant_id || userContext?.tenantId || null,
      stage,
      notes,
      location: metadata.location || null,
      event_time: metadata.event_time || new Date().toISOString(),
      metadata,
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  return data;
}

export async function updateShipmentStage(id, payload, userContext = {}, req = null) {
  const nextStage = payload.stage || payload.status;
  if (!Object.values(SHIPMENT_STATUSES).includes(nextStage)) throw new ValidationError(`Invalid shipment stage: ${nextStage}`);
  const previous = await getShipment(id);

  const { data, error } = await supabase
    .from('diaspora_shipments')
    .update({ status: nextStage, updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), lastStage: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  const stageEvent = await writeShipmentStageEvent(id, nextStage, payload.notes || `Shipment moved to ${nextStage}`, userContext, req, payload.metadata || {});
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'SHIPMENT_STAGE_CHANGED', resourceType: 'diaspora_shipment', resourceId: id, previousState: { status: previous.status }, newState: { status: nextStage }, metadata: { stageEventId: stageEvent.id }, req });
  await emitDiasporaEvent(`DIASPORA_SHIPMENT_${nextStage}`, { shipmentId: id, importOrderId: data.import_order_id, stage: nextStage }, data.tenant_id);

  const importStatus = SHIPMENT_TO_IMPORT_STATUS[nextStage];
  if (importStatus) {
    try {
      await transitionImportOrder({ importOrderId: data.import_order_id, nextStatus: importStatus, actorId: userContext?.id, userContext, metadata: { shipmentId: id, shipmentStage: nextStage }, req });
    } catch (err) {
      console.warn(`Skipping automatic import transition for shipment stage ${nextStage}:`, err.message);
    }
  }

  return { shipment: data, stageEvent };
}

export async function getShipmentTimeline(id) {
  const { data, error } = await supabase.from('diaspora_shipment_stage_events').select('*').eq('shipment_id', id).is('deleted_at', null).order('event_time', { ascending: true });
  if (error) throw new DatabaseError(error.message);
  return data || [];
}
