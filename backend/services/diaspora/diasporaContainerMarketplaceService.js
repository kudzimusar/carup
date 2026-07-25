/**
 * Phase 6 — Container co-loading marketplace.
 *
 * Authoritative, server-side capacity rules over the existing diaspora_container_shipments and
 * diaspora_cargo_reservations tables (directive §28). Approval recomputes used volume from the set of
 * APPROVED reservations and rejects overfill, so concurrent approvals cannot exceed capacity. Pending
 * reservations do not consume approved capacity. Cancellation/rejection releases capacity. Closing a
 * booking never implies shipment delivery / customs / payment.
 *
 * Exposed under /api/diaspora/container-marketplace/* to avoid shadowing the legacy /containers and
 * /reservations routes (which existing consumers and tests depend on).
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import { CONTAINER_STATUSES, RESERVATION_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, appendCriticalAudit, paging } from './diasporaServiceUtils.js';

const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';
const APPROVE_RPC = 'diaspora_approve_cargo_reservation_atomic';

const READY_TO_CLOSE_RATIO = 0.90;
const FULL_RATIO = 0.98;

/** Map a sanitized approval RPC exception to a stable application error. */
function translateApprovalError(error) {
  const raw = String(error?.message || 'Reservation approval failed');
  const marker = raw.indexOf('DIASPORA_CONTAINER/');
  const code = marker >= 0 ? raw.slice(marker + 'DIASPORA_CONTAINER/'.length).split(/[:\s]/)[0] : '';
  switch (code) {
    case 'NOT_FOUND_RESERVATION': return new NotFoundError('Reservation not found');
    case 'NOT_FOUND_CONTAINER': return new NotFoundError('Container not found');
    case 'FORBIDDEN': return new ForbiddenError('Only logistics reviewers/admins can approve reservations');
    case 'NOT_REQUESTED': return new ValidationError('Only REQUESTED reservations can be approved');
    case 'OVERFILL': return new ValidationError('Approving this reservation would overfill the container');
    case 'WEIGHT_OVERFILL': return new ValidationError('Approving this reservation would exceed container weight capacity');
    default: return new ValidationError('Reservation approval could not be applied');
  }
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function canReview(container, context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(container, context);
}

function ownsReservation(reservation, context) {
  return [reservation.buyer_id, reservation.created_by].some((c) => normalizeId(c) === context.id);
}

/** Authoritative capacity from APPROVED reservations. */
export function computeCapacity(container, reservations = []) {
  const totalVolume = Number(container.total_capacity_volume || 0);
  const usedVolume = round3(
    reservations
      .filter((r) => r.reservation_status === RESERVATION_STATUSES.APPROVED && !r.deleted_at)
      .reduce((sum, r) => sum + Number(r.estimated_volume || 0), 0),
  );
  const availableVolume = round3(Math.max(totalVolume - usedVolume, 0));
  const fillPercent = totalVolume > 0 ? round3(usedVolume / totalVolume) : 0;
  return {
    totalVolume,
    usedVolume,
    availableVolume,
    fillPercent,
    readyToClose: fillPercent >= READY_TO_CLOSE_RATIO,
    full: fillPercent >= FULL_RATIO,
    overfilled: usedVolume > totalVolume,
  };
}

async function loadContainer(client, id) {
  const { data, error } = await client.from(CONTAINERS).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Container not found');
  return data;
}

async function loadReservations(client, containerId) {
  const { data } = await client.from(RESERVATIONS).select('*').eq('container_id', containerId).is('deleted_at', null);
  return data || [];
}

async function syncContainerCapacity(client, container, reservations, actorId) {
  const cap = computeCapacity(container, reservations);
  await client.from(CONTAINERS).update({
    used_capacity_volume: cap.usedVolume,
    available_capacity_volume: cap.availableVolume,
    metadata: { ...(container.metadata || {}), capacity: { fillPercent: cap.fillPercent, readyToClose: cap.readyToClose, full: cap.full } },
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  }).eq('id', container.id).select().single();
  return cap;
}

export async function createContainer(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  if (!canReview({ tenant_id: context.tenantId }, context)) {
    throw new ForbiddenError('Only logistics reviewers/admins can create containers');
  }
  const totalVolume = Number(payload.total_capacity_volume);
  if (!(totalVolume > 0)) throw new ValidationError('total_capacity_volume must be positive');

  const row = {
    tenant_id: context.tenantId || payload.tenant_id || null,
    origin_country: payload.origin_country,
    origin_city: payload.origin_city,
    destination_country: payload.destination_country,
    destination_city: payload.destination_city,
    departure_date: payload.departure_date,
    booking_deadline: payload.booking_deadline,
    container_type: payload.container_type || '40HC',
    total_capacity_volume: round3(totalVolume),
    used_capacity_volume: 0,
    available_capacity_volume: round3(totalVolume),
    status: CONTAINER_STATUSES.BOOKING_OPEN,
    coordinator_id: context.id,
    metadata: { ...(payload.metadata || {}), total_capacity_weight: payload.total_capacity_weight ?? null },
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(CONTAINERS).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create container: ${error.message}`);
  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'CONTAINER_CREATED', resourceType: 'diaspora_container_shipment', resourceId: data.id, newState: data, req });
  return data;
}

export async function listOpenContainers(filters = {}, userContext = {}, options = {}) {
  requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);
  let query = client.from(CONTAINERS).select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  query = query.eq('status', filters.status || CONTAINER_STATUSES.BOOKING_OPEN);
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list containers: ${error.message}`);
  return data || [];
}

export async function getContainerCapacity(id, userContext = {}, options = {}) {
  requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, id);
  const reservations = await loadReservations(client, id);
  return { container, capacity: computeCapacity(container, reservations) };
}

export async function requestReservation(containerId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const container = await loadContainer(client, containerId);
  if (container.status !== CONTAINER_STATUSES.BOOKING_OPEN) throw new ValidationError('Container is not open for booking');

  const volume = Number(payload.estimated_volume);
  if (!(volume > 0)) throw new ValidationError('estimated_volume must be positive');
  if (volume > Number(container.total_capacity_volume)) {
    throw new ValidationError('Requested volume exceeds total container capacity', { total: container.total_capacity_volume, requested: volume });
  }

  const row = {
    tenant_id: container.tenant_id || context.tenantId || null,
    container_id: containerId,
    import_order_id: payload.import_order_id || null,
    buyer_id: context.id,
    seller_id: payload.seller_id || null,
    cargo_type: payload.cargo_type || 'parts',
    estimated_volume: round3(volume),
    estimated_weight: payload.estimated_weight ?? null,
    declared_value: payload.declared_value ?? null,
    currency: payload.currency || 'USD',
    cargo_description: payload.cargo_description || null,
    reservation_status: RESERVATION_STATUSES.REQUESTED,
    metadata: { ...(payload.metadata || {}), source: payload.source || 'ui' },
    created_by: context.id,
    updated_by: context.id,
  };
  const { data, error } = await client.from(RESERVATIONS).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to request reservation: ${error.message}`);
  await appendAudit(client, { importOrderId: data.import_order_id, actorId: context.id, tenantId: data.tenant_id, action: 'CARGO_RESERVATION_REQUESTED', resourceType: 'diaspora_cargo_reservation', resourceId: data.id, newState: data, req });
  return data;
}

export async function listContainerReservations(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const container = await loadContainer(client, containerId);
  const reservations = await loadReservations(client, containerId);

  // Participant-safe: reviewers/coordinator see all; others see only their own reservations.
  const privileged = canReview(container, context) || normalizeId(container.coordinator_id) === context.id;
  const visible = privileged ? reservations : reservations.filter((r) => ownsReservation(r, context));
  return visible;
}

async function fetchReservation(client, id) {
  const { data, error } = await client.from(RESERVATIONS).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Reservation not found');
  return data;
}

/**
 * Approve a reservation through the atomic, container-serialized RPC: lock container, recompute
 * approved capacity, reject overfill (volume + weight), update reservation + cached capacity, and
 * write a critical audit row — in one transaction. No non-atomic production fallback (directive H3).
 */
export async function approveReservation(reservationId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const { data, error } = await client.rpc(APPROVE_RPC, {
    p_reservation_id: reservationId,
    p_actor_id: context.id,
    p_actor_is_privileged: isPlatformAdmin(context) || isPlatformReviewer(context),
    p_actor_tenant_role: context.tenantRole || null,
    p_actor_tenant_id: context.tenantId || null,
  });
  if (error) throw translateApprovalError(error);
  if (!data) throw new ValidationError('Reservation approval returned no result');
  return { reservation: data.reservation, capacity: data.capacity };
}

async function transitionToReleased(client, reservationId, nextStatus, userContext, options, action) {
  const context = requireUserContext(userContext);
  const { req = null } = options;
  const reservation = await fetchReservation(client, reservationId);
  const container = await loadContainer(client, reservation.container_id);

  if (nextStatus === RESERVATION_STATUSES.CANCELLED) {
    if (!ownsReservation(reservation, context) && !canReview(container, context)) {
      throw new ForbiddenError('Only the reservation owner or a reviewer can cancel');
    }
  } else if (!canReview(container, context)) {
    throw new ForbiddenError('Only logistics reviewers/admins can reject reservations');
  }

  const { data, error } = await client.from(RESERVATIONS).update({
    reservation_status: nextStatus,
    reviewed_by: context.id,
    reviewed_at: new Date().toISOString(),
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', reservationId).select().single();
  if (error) throw new ValidationError(`Failed to ${action} reservation: ${error.message}`);

  // Releasing capacity: recompute from the (now reduced) approved set.
  const refreshed = await loadReservations(client, container.id);
  const newCap = await syncContainerCapacity(client, container, refreshed, context.id);

  // Reject/cancel are security-relevant capacity mutations: fail loud if audit cannot be written.
  await appendCriticalAudit(client, { importOrderId: data.import_order_id, actorId: context.id, tenantId: data.tenant_id, action: `CARGO_RESERVATION_${nextStatus}`, resourceType: 'diaspora_cargo_reservation', resourceId: reservationId, previousState: reservation, newState: data, metadata: { capacity: newCap }, req });
  return { reservation: data, capacity: newCap };
}

export function rejectReservation(reservationId, userContext = {}, options = {}) {
  return resolveClient(options).then((client) => transitionToReleased(client, reservationId, RESERVATION_STATUSES.REJECTED, userContext, options, 'reject'));
}

export function cancelReservation(reservationId, userContext = {}, options = {}) {
  return resolveClient(options).then((client) => transitionToReleased(client, reservationId, RESERVATION_STATUSES.CANCELLED, userContext, options, 'cancel'));
}

export async function closeBooking(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const container = await loadContainer(client, containerId);
  if (!canReview(container, context)) throw new ForbiddenError('Only logistics reviewers/admins can close booking');
  if (container.status !== CONTAINER_STATUSES.BOOKING_OPEN) throw new ValidationError(`Container is not open (status: ${container.status})`);

  const { data, error } = await client.from(CONTAINERS).update({
    status: CONTAINER_STATUSES.BOOKING_CLOSED, // closing booking only — NOT shipment delivery/customs/payment
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', containerId).select().single();
  if (error) throw new ValidationError(`Failed to close booking: ${error.message}`);
  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'CONTAINER_BOOKING_CLOSED', resourceType: 'diaspora_container_shipment', resourceId: containerId, previousState: container, newState: data, req });
  return data;
}
