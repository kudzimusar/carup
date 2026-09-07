import { supabase } from '../../db/supabase.js';
import { SHIPMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateShipmentPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';
import { notifyShipmentException, isExceptionStage } from './shipmentExceptionNotifier.js';
import { requireUserContext, assertCanManageLogistics, assertCanReadImportOrder, isPlatformReviewer, isPlatformAdmin, isTenantAdminForRecord } from './diasporaAuthorization.js';

// Authorize a read against the import order this shipment belongs to (buyer owns it, or reviewer/admin).
async function assertOrderReadAccess(importOrderId, userContext) {
  if (!importOrderId) throw new ValidationError('importOrderId is required');
  const { data: order, error } = await supabase.from('diaspora_import_orders').select('*').eq('id', importOrderId).is('deleted_at', null).single();
  if (error || !order) throw new NotFoundError('Diaspora import order not found');
  const { data: participants } = await supabase.from('diaspora_import_order_participants').select('*').eq('import_order_id', importOrderId).is('deleted_at', null);
  assertCanReadImportOrder(order, participants || [], userContext);
  return order;
}

/**
 * T11.1 — which stage may follow which.
 *
 * Before this, any stage could follow any stage: `PLANNED → ARRIVED` was accepted, and history could
 * be asserted out of order. A timeline that can be written backwards is not a record of movement.
 *
 * `EXCEPTION` is reachable from anywhere in transit and returns to the stage the goods are actually
 * at, because an exception is a thing that happens TO a shipment rather than a place in its journey.
 */
const SHIPMENT_TRANSITIONS = Object.freeze({
  PLANNED: ['BOOKED', 'LOADING', 'EXCEPTION'],
  BOOKED: ['LOADING', 'IN_TRANSIT', 'EXCEPTION'],
  LOADING: ['IN_TRANSIT', 'EXCEPTION'],
  IN_TRANSIT: ['ARRIVED', 'CUSTOMS_HOLD', 'EXCEPTION'],
  ARRIVED: ['CUSTOMS_HOLD', 'RELEASED', 'COMPLETED', 'EXCEPTION'],
  CUSTOMS_HOLD: ['RELEASED', 'ARRIVED', 'EXCEPTION'],
  RELEASED: ['COMPLETED', 'EXCEPTION'],
  COMPLETED: [],
  EXCEPTION: ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS_HOLD', 'RELEASED', 'COMPLETED'],
});

export function assertShipmentTransition(currentStage, nextStage) {
  if (currentStage === nextStage) {
    // Not an error and not a second event: re-reporting the stage a shipment is already at is what a
    // retried request looks like. The caller is told nothing changed.
    return { unchanged: true };
  }
  const allowed = SHIPMENT_TRANSITIONS[currentStage] || [];
  if (!allowed.includes(nextStage)) {
    throw new ValidationError(
      `A shipment at ${currentStage} cannot move to ${nextStage}. A timeline that can be written out of order is not a record of movement.`,
      { code: 'ILLEGAL_SHIPMENT_TRANSITION', currentStage, nextStage, allowed },
    );
  }
  return { unchanged: false };
}

/**
 * T11.1 — a shipment may only exist for a container that was actually loaded.
 *
 * `createShipment` took `container_id` as a free optional field and checked nothing, so a shipment
 * could be created for a container with no manifest, no cargo and no T10 load — the same free-claim
 * shape T10 closed on `mark-loading`.
 *
 * The requirement is a **COMPLETED** T10 load, and that is derived from T10's own design rather than
 * invented: a completed load may legitimately carry `LEFT_BEHIND` lines, so demanding "all cargo
 * loaded" would make T10's left-behind path unable to ever produce a shipment.
 *
 * An `ABANDONED` load is refused. Whether an abandoned load should ever produce a shipment is an
 * operational policy question with no repository evidence either way, so this takes the conservative
 * reading and says so rather than guessing.
 *
 * A shipment with no container at all is untouched: not every shipment is a co-loaded container, and
 * T11 is not the place to make that a requirement.
 */
async function assertContainerWasLoaded(containerId, client) {
  if (!containerId) return;
  const { data } = await client.from('diaspora_container_loads').select('id, status')
    .eq('container_id', containerId).is('deleted_at', null);
  const completed = (data || []).filter((l) => String(l.status) === 'COMPLETED');
  if (!completed.length) {
    const abandoned = (data || []).some((l) => String(l.status) === 'ABANDONED');
    throw new ValidationError(
      abandoned
        ? 'Loading this container was abandoned, so a shipment cannot be created for it.'
        : 'This container has no completed load, so there is nothing recorded as being inside it. Complete the load first.',
      { code: 'SHIPMENT_WITHOUT_COMPLETED_LOAD', containerId },
    );
  }
}

const SHIPMENT_TO_IMPORT_STATUS = Object.freeze({
  LOADING: IMPORT_ORDER_STATUSES.READY_FOR_LOADING,
  IN_TRANSIT: IMPORT_ORDER_STATUSES.SHIPPED,
  ARRIVED: IMPORT_ORDER_STATUSES.ARRIVED_AT_BORDER,
  CUSTOMS_HOLD: IMPORT_ORDER_STATUSES.CUSTOMS_IN_PROGRESS,
  RELEASED: IMPORT_ORDER_STATUSES.RELEASED,
  COMPLETED: IMPORT_ORDER_STATUSES.COMPLETED,
});

export async function createShipment(payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  validateShipmentPayload(payload);
  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', payload.import_order_id).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');
  // Creating an official shipment is a logistics action (admin/reviewer/tenant-admin of the order).
  assertCanManageLogistics(order, context);
  // …and for a co-loaded container, it also requires that something was actually loaded into it.
  await assertContainerWasLoaded(payload.container_id || null, supabase);

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
      // T11.1 — a date supplied at CREATE is a plan, not an observation.
      //
      // `departure_date` was a free field, so an intended sail date and the fact that a ship sailed
      // were the same column. A customer reading "departed" deserves the second. The planned date is
      // kept where it belongs and the column stays NULL until a real IN_TRANSIT transition sets it.
      departure_date: null,
      estimated_arrival_date: payload.estimated_arrival_date || null,
      // Likewise: an arrival is observed, never declared at creation.
      actual_arrival_date: null,
      status: payload.status || SHIPMENT_STATUSES.PLANNED,
      metadata: {
        ...(payload.metadata || {}),
        ...(payload.departure_date ? { planned_departure_date: payload.departure_date, planned_departure_source: 'stated_at_creation' } : {}),
        ...(payload.actual_arrival_date ? { claimed_arrival_at_creation: payload.actual_arrival_date } : {}),
      },
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

export async function listShipments({ importOrderId, status, limit = 50, offset = 0 }, userContext = {}) {
  const context = requireUserContext(userContext);
  // Buyers may only read shipments for an order they can access, scoped by importOrderId.
  if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
    if (!importOrderId) throw new ValidationError('importOrderId is required to list shipments');
    await assertOrderReadAccess(importOrderId, context);
  }

  let query = supabase.from('diaspora_shipments').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getShipment(id, userContext = {}) {
  const { data, error } = await supabase.from('diaspora_shipments').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora shipment not found');

  const hasUserContext = userContext && (userContext.id || userContext.userId || userContext.actorId);
  if (hasUserContext) {
    const context = requireUserContext(userContext);
    if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
      if (isTenantAdminForRecord(data, context)) {
        return data;
      }
      await assertOrderReadAccess(data.import_order_id, context);
    }
  }

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

/**
 * When a movement was observed.
 *
 * Defaults to now, accepts a stated time, and refuses the future outright: a ship has not sailed at
 * a time that has not happened, and a shipment dated forwards would make a tracking page lie about
 * where the goods are.
 */
function observedTime(stated, now) {
  if (!stated) return now;
  const when = new Date(stated);
  if (Number.isNaN(when.getTime())) throw new ValidationError('That is not a valid date and time');
  if (when.getTime() > Date.parse(now) + 60_000) {
    throw new ValidationError('A shipment cannot be recorded as moving at a time in the future');
  }
  return when.toISOString();
}

export async function updateShipmentStage(id, payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  const nextStage = payload.stage || payload.status;
  if (!Object.values(SHIPMENT_STATUSES).includes(nextStage)) throw new ValidationError(`Invalid shipment stage: ${nextStage}`);
  const previous = await getShipment(id);
  // Advancing official shipment stage is a logistics action (admin/reviewer/tenant-admin).
  assertCanManageLogistics(previous, context);

  // T11.1 — the timeline cannot be written out of order, and a retry is not a second journey.
  const { unchanged } = assertShipmentTransition(previous.status, nextStage);
  if (unchanged) {
    const timeline = await supabase.from('diaspora_shipment_stage_events').select('*')
      .eq('shipment_id', id).eq('stage', nextStage).is('deleted_at', null)
      .order('event_time', { ascending: false }).limit(1);
    return { shipment: previous, stageEvent: timeline.data?.[0] || null, unchanged: true };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('diaspora_shipments')
    .update({
      status: nextStage,
      // T11.1 — these are OBSERVED, stamped when the movement is actually reported rather than
      // accepted as a claim at creation. A caller may state the real time; it may not be in the
      // future, because nothing has departed at a time that has not happened.
      ...(nextStage === SHIPMENT_STATUSES.IN_TRANSIT ? { departure_date: observedTime(payload.event_time || payload.departure_date, now) } : {}),
      ...(nextStage === SHIPMENT_STATUSES.ARRIVED ? { actual_arrival_date: observedTime(payload.event_time || payload.actual_arrival_date, now) } : {}),
      updated_by: userContext?.id,
      updated_at: now,
      metadata: { ...(previous.metadata || {}), lastStage: payload },
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  const stageEvent = await writeShipmentStageEvent(id, nextStage, payload.notes || `Shipment moved to ${nextStage}`, userContext, req, payload.metadata || {});
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'SHIPMENT_STAGE_CHANGED', resourceType: 'diaspora_shipment', resourceId: id, previousState: { status: previous.status }, newState: { status: nextStage }, metadata: { stageEventId: stageEvent.id }, req });
  await emitDiasporaEvent(`DIASPORA_SHIPMENT_${nextStage}`, { shipmentId: id, importOrderId: data.import_order_id, stage: nextStage }, data.tenant_id);

  // T7.5 — the customer-facing half. After the audited authoritative change, never before it, and
  // never in a way that can alter it: an exception the customer is not told about is the one stage
  // that most needs saying.
  if (isExceptionStage(nextStage)) {
    await notifyShipmentException({
      shipment: data, stage: nextStage, notes: payload.notes || null, tenantId: data.tenant_id,
    });
  }

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

export async function getShipmentTimeline(id, userContext = {}) {
  // Enforce read access/existence checks via getShipment
  await getShipment(id, userContext);

  const { data, error } = await supabase.from('diaspora_shipment_stage_events').select('*').eq('shipment_id', id).is('deleted_at', null).order('event_time', { ascending: true });
  if (error) throw new DatabaseError(error.message);
  return data || [];
}
