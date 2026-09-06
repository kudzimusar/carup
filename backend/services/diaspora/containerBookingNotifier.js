/**
 * Trade OS D7 — container booking lifecycle → canonical Communications.
 *
 * Pattern copied from evidenceReviewNotifier: the authoritative Trade OS mutation (reservation
 * request/approve/reject/cancel, booking close) already committed and wrote its audit row; here we
 * emit a best-effort domain event into the outbox. Communications subscribes to these types
 * (communicationEventListeners) and its NOTIFICATION_POLICIES render the governed
 * `container_booking_update` template into a one-way in-app notification on a canonical `container`
 * thread. No Trade OS chat silo, no feature-specific message storage.
 *
 * Addressability (C1 gate): every payload carries the recipient as a literal `buyerId`.
 * The governed template requires `reference`, `status` and `route` — every emitter here supplies
 * all three, always.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

function shortRef(prefix, id) {
  return `${prefix}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function routeOf(container = {}) {
  const from = [container.origin_city, container.origin_country].filter(Boolean).join(', ');
  const to = [container.destination_city, container.destination_country].filter(Boolean).join(', ');
  return `${from || 'origin'} → ${to || 'destination'}`;
}

async function emitContainerBookingEvent(eventType, payload, tenantId) {
  try {
    return await emitDomainEvent(null, eventType, payload, tenantId ?? null);
  } catch (err) {
    // Best-effort: the booking state is already durable + audited; a notification outbox failure
    // must never roll back or mask the booking mutation.
    console.warn(`[container-booking] outbox emit failed (${eventType}):`, err.message);
    return null;
  }
}

function basePayload(reservation, container, status) {
  return {
    reservationId: reservation.id,
    containerId: container.id,
    buyerId: reservation.buyer_id || reservation.created_by || null,
    status,
    reference: shortRef('RES', reservation.id),
    route: routeOf(container),
    subject_type: 'container_booking',
  };
}

export async function notifyReservationRequested({ reservation, container, tenantId = null }) {
  const payload = basePayload(reservation, container, 'REQUESTED');
  if (!payload.buyerId) return null;
  return emitContainerBookingEvent('diaspora.container_booking.reservation_requested', payload, tenantId);
}

/**
 * Owner UAT #10B: a new space request matters to the ORGANISER first. This event addresses the
 * container's coordinator (recipientUserId), separately from the participant's own confirmation.
 */
export async function notifyReservationReceived({ reservation, container, tenantId = null }) {
  const coordinatorId = container.coordinator_id || null;
  if (!coordinatorId) return null;
  return emitContainerBookingEvent('diaspora.container_booking.reservation_received', {
    reservationId: reservation.id,
    containerId: container.id,
    recipientUserId: coordinatorId,
    status: 'REQUESTED',
    reference: shortRef('RES', reservation.id),
    route: routeOf(container),
    subject_type: 'container_booking',
  }, tenantId);
}

export async function notifyReservationApproved({ reservation, container, tenantId = null }) {
  const payload = basePayload(reservation, container, 'APPROVED');
  if (!payload.buyerId) return null;
  return emitContainerBookingEvent('diaspora.container_booking.reservation_approved', payload, tenantId);
}

export async function notifyReservationReleased({ reservation, container, status, tenantId = null }) {
  const payload = basePayload(reservation, container, status);
  if (!payload.buyerId) return null;
  if (status === 'CANCELLED') {
    return emitContainerBookingEvent('diaspora.container_booking.reservation_cancelled', payload, tenantId);
  }
  return emitContainerBookingEvent('diaspora.container_booking.reservation_rejected', payload, tenantId);
}

/**
 * Booking closed: tell every buyer with a live (REQUESTED/APPROVED) reservation. Closing booking
 * means "no further requests" — the notification says exactly that and nothing about shipment,
 * customs, payment or delivery.
 */
export async function notifyBookingClosed({ container, reservations = [], tenantId = null }) {
  const live = reservations.filter((r) => ['REQUESTED', 'APPROVED'].includes(r.reservation_status) && !r.deleted_at);
  const seen = new Set();
  const results = [];
  for (const reservation of live) {
    const buyerId = reservation.buyer_id || reservation.created_by || null;
    if (!buyerId || seen.has(buyerId)) continue;
    seen.add(buyerId);
    results.push(await emitContainerBookingEvent('diaspora.container_booking.booking_closed', {
      reservationId: reservation.id,
      containerId: container.id,
      buyerId,
      status: 'BOOKING_CLOSED',
      reference: shortRef('CNT', container.id),
      route: routeOf(container),
      subject_type: 'container_booking',
    }, tenantId));
  }
  return results;
}
