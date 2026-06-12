import { supabase } from '../../db/supabase.js';
import { RESERVATION_STATUSES, IMPORT_ORDER_STATUSES, CONTAINER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateReservationPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { emitDiasporaEvent } from './diasporaNotificationService.js';
import {
  requireUserContext,
  assertCanReadImportOrder,
  assertCanReviewReservation,
  assertCanCancelReservation,
  isPlatformReviewer,
  isPlatformAdmin,
} from './diasporaAuthorization.js';

async function fetchReservation(id) {
  const { data, error } = await supabase.from('diaspora_cargo_reservations').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora cargo reservation not found');
  return data;
}

// Authorize against the import order the reservation belongs to, reusing the trusted server context
// from authorizeRole(). Throws NotFoundError (missing order) or ForbiddenError (no access).
async function assertImportOrderAccess(importOrderId, userContext) {
  if (!importOrderId) throw new ValidationError('import_order_id is required');
  const { data: order, error } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (error || !order) throw new NotFoundError('Diaspora import order not found');
  const { data: participants } = await supabase
    .from('diaspora_import_order_participants')
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);
  assertCanReadImportOrder(order, participants || [], userContext);
  return order;
}

export async function createCargoReservation(payload, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  validateReservationPayload(payload);

  // 1. The caller must be allowed to act on the target import order (buyer owns it, or reviewer/admin).
  await assertImportOrderAccess(payload.import_order_id, context);

  const { data: container, error: containerError } = await supabase.from('diaspora_container_shipments').select('*').eq('id', payload.container_id).single();
  if (containerError || !container) throw new NotFoundError('Diaspora container shipment not found');

  // 2. Only open containers accept reservation requests.
  if (container.status !== CONTAINER_STATUSES.BOOKING_OPEN) {
    throw new ValidationError('This container is not open for booking.');
  }

  const requestedVolume = Number(payload.estimated_volume);
  if (requestedVolume > Number(container.available_capacity_volume)) {
    throw new ValidationError('Requested cargo volume exceeds available container capacity.', { requestedVolume, available: container.available_capacity_volume });
  }

  // 3. Buyers may only reserve as themselves; reviewers/admins may reserve on behalf of a buyer.
  const privileged = isPlatformReviewer(context) || isPlatformAdmin(context);
  const buyerId = privileged ? (payload.buyer_id || context.id) : context.id;

  const { data, error } = await supabase
    .from('diaspora_cargo_reservations')
    .insert({
      tenant_id: userContext?.tenantId || container.tenant_id,
      container_id: payload.container_id,
      import_order_id: payload.import_order_id,
      buyer_id: buyerId,
      seller_id: payload.seller_id || null,
      cargo_type: payload.cargo_type,
      estimated_volume: requestedVolume,
      estimated_weight: payload.estimated_weight || null,
      declared_value: payload.declared_value || null,
      currency: payload.currency || 'USD',
      cargo_description: payload.cargo_description || null,
      pickup_location: payload.pickup_location || null,
      receiver_name: payload.receiver_name || null,
      receiver_phone: payload.receiver_phone || null,
      receiver_location: payload.receiver_location || null,
      reservation_status: RESERVATION_STATUSES.REQUESTED,
      invoice_document_id: payload.invoice_document_id || null,
      dimensions_document_id: payload.dimensions_document_id || null,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'CARGO_RESERVATION_CREATED', resourceType: 'diaspora_cargo_reservation', resourceId: data.id, newState: data, req });
  await emitDiasporaEvent('DIASPORA_CARGO_RESERVATION_REQUESTED', { reservationId: data.id, containerId: data.container_id, importOrderId: data.import_order_id }, data.tenant_id);
  return data;
}

export async function listCargoReservations({ containerId, importOrderId, status, limit = 50, offset = 0 }, userContext = {}) {
  const context = requireUserContext(userContext);

  // Buyers (non-reviewers) may only list reservations for an import order they can access, and must
  // scope by that order. Reviewers/admins may query more broadly.
  if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
    if (!importOrderId) {
      throw new ValidationError('importOrderId is required to list cargo reservations');
    }
    await assertImportOrderAccess(importOrderId, context);
  }

  let query = supabase.from('diaspora_cargo_reservations').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (containerId) query = query.eq('container_id', containerId);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (status) query = query.eq('reservation_status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function updateReservationStatus(id, nextStatus, userContext = {}, req = null, metadata = {}) {
  if (![RESERVATION_STATUSES.APPROVED, RESERVATION_STATUSES.REJECTED, RESERVATION_STATUSES.CANCELLED].includes(nextStatus)) {
    throw new ValidationError('Unsupported reservation status transition.');
  }
  const context = requireUserContext(userContext);
  const previous = await fetchReservation(id);

  // Authorize by server-derived role, not the client header. Approve/reject is reviewer/admin only;
  // cancel is allowed for the reservation owner or a reviewer/admin.
  if (nextStatus === RESERVATION_STATUSES.CANCELLED) {
    assertCanCancelReservation(previous, context);
  } else {
    assertCanReviewReservation(previous, context);
  }

  if (previous.reservation_status !== RESERVATION_STATUSES.REQUESTED && nextStatus !== RESERVATION_STATUSES.CANCELLED) {
    throw new ValidationError(`Reservation can only be approved/rejected from REQUESTED. Current status: ${previous.reservation_status}`);
  }

  const { data, error } = await supabase
    .from('diaspora_cargo_reservations')
    .update({ reservation_status: nextStatus, reviewed_by: userContext?.id, reviewed_at: new Date().toISOString(), updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), statusChange: metadata } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  if (nextStatus === RESERVATION_STATUSES.APPROVED) {
    const { data: container } = await supabase.from('diaspora_container_shipments').select('*').eq('id', previous.container_id).single();
    if (container) {
      const used = Number(container.used_capacity_volume || 0) + Number(previous.estimated_volume || 0);
      await supabase.from('diaspora_container_shipments').update({ used_capacity_volume: used, available_capacity_volume: Math.max(Number(container.total_capacity_volume) - used, 0), updated_at: new Date().toISOString() }).eq('id', container.id);
    }
    try {
      await transitionImportOrder({ importOrderId: previous.import_order_id, nextStatus: IMPORT_ORDER_STATUSES.CONTAINER_BOOKED, actorId: userContext?.id, userContext, metadata: { reservationId: id }, req });
    } catch (err) {
      console.warn('Skipping automatic CONTAINER_BOOKED transition:', err.message);
    }
  }

  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: `CARGO_RESERVATION_${nextStatus}`, resourceType: 'diaspora_cargo_reservation', resourceId: id, previousState: previous, newState: data, req });
  await emitDiasporaEvent(`DIASPORA_CARGO_RESERVATION_${nextStatus}`, { reservationId: id, importOrderId: data.import_order_id, status: nextStatus }, data.tenant_id);
  return data;
}
