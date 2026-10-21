import { supabase } from '../../db/supabase.js';
import { CONTAINER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateContainerPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import {
  requireUserContext,
  assertCanManageLogistics,
  isPlatformAdmin,
  isPlatformReviewer,
  isSailingOperator,
  normalizeId,
} from './diasporaAuthorization.js';
import { containerBookingEligibility, BOOKING_ELIGIBILITY_STATES } from './containerBookingEligibility.js';

const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';

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
  // Container creation is durable in the container row and audit log. The legacy DIASPORA_CONTAINER_CREATED
  // outbox signal had no current consumer, so creation must not enqueue worker work merely for observability.
  return data;
}

// What a participant may be shown on the legacy list: a sailing still inside its booking window.
// `full` stays listed (with its annotation) — the picker shows the free volume, the refusal says why.
const PARTICIPANT_LISTABLE = new Set([BOOKING_ELIGIBILITY_STATES.OPEN, BOOKING_ELIGIBILITY_STATES.FULL]);

/**
 * F-023 — the legacy sailing list, scoped to the caller.
 *
 * The route admits ANY authenticated role, and this used to return every sailing in every status —
 * DRAFTs included — with no caller context at all. Its consumers are a participant's booking picker
 * (web, `?status=BOOKING_OPEN`) and a native count (`?limit=20`); operator working state lives in
 * the container marketplace, which scopes it per sailing (T5.8).
 *
 * A platform admin/reviewer keeps the full view. Everyone else sees only sailings that are open,
 * live and still inside their booking window. That is filtered in the QUERY so a page stays a full
 * page: ordered by departure, the departed sailings would otherwise fill page one. Both date
 * columns are NOT NULL, so the comparison is exact for stored rows. Unlike the marketplace, this
 * list leaves out a sailing past its cut-off: its consumers can only offer a sailing to book, and
 * cannot say "booking closed". Every row carries `booking_eligibility`; the stored status is never
 * changed.
 */
export async function listContainerShipments({ status, limit = 50, offset = 0 } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = options.supabaseClient || supabase;
  const platformOperator = isPlatformAdmin(context) || isPlatformReviewer(context);
  // A participant asking for operator working state gets what a stranger to it gets: nothing.
  if (!platformOperator && status && status !== CONTAINER_STATUSES.BOOKING_OPEN) return [];

  const now = new Date();
  let query = client.from(CONTAINERS).select('*').is('deleted_at', null).order('departure_date', { ascending: true }).range(offset, offset + limit - 1);
  if (platformOperator) {
    if (status) query = query.eq('status', status);
  } else {
    const nowIso = now.toISOString();
    query = query.eq('status', CONTAINER_STATUSES.BOOKING_OPEN).gte('departure_date', nowIso).gte('booking_deadline', nowIso);
  }
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  const rows = (data || []).map((container) => ({ ...container, booking_eligibility: containerBookingEligibility(container, now) }));
  // The same rule again over the rows themselves — it removes nothing the query kept correctly.
  return platformOperator ? rows : rows.filter((container) => PARTICIPANT_LISTABLE.has(container.booking_eligibility.state));
}

/** The bare sailing row, without any participant's data — what a lifecycle transition reads. */
async function loadContainerShipment(client, id) {
  const { data, error } = await client.from(CONTAINERS).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora container shipment not found');
  return data;
}

function ownsReservation(reservation, context) {
  return [reservation.buyer_id, reservation.created_by].some((candidate) => normalizeId(candidate) === context.id);
}

/**
 * F-023 — the legacy single-sailing read, scoped to the caller.
 *
 * It used to embed `diaspora_cargo_reservations(*)` for anyone signed in: every other participant's
 * receiver name, receiver phone and cargo on the sailing. The embed keeps its key and shape but now
 * carries only the caller's own live reservations — unless the caller runs this sailing
 * (isSailingOperator: its coordinator, a tenant admin of its organisation, or a platform
 * admin/reviewer), the same authority the marketplace manifest uses. A DRAFT does not exist for
 * anyone else, exactly as the marketplace capacity read answers (T5.8).
 */
export async function getContainerShipment(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = options.supabaseClient || supabase;
  const container = await loadContainerShipment(client, id);
  const operates = isSailingOperator(container, context);
  if (container.status === CONTAINER_STATUSES.DRAFT && !operates) {
    throw new NotFoundError('Diaspora container shipment not found');
  }
  const { data: reservations, error } = await client.from(RESERVATIONS).select('*').eq('container_id', id).is('deleted_at', null);
  // Unknown is not "none": an unreadable manifest is an error, never an empty list.
  if (error) throw new DatabaseError(error.message);
  const visible = operates ? (reservations || []) : (reservations || []).filter((reservation) => ownsReservation(reservation, context));
  return {
    ...container,
    diaspora_cargo_reservations: visible,
    booking_eligibility: containerBookingEligibility(container, new Date()),
  };
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
  const previous = await loadContainerShipment(client, id);
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
  // The container row and audit are the durable status authority. Historical DIASPORA_CONTAINER_<STATUS>
  // events were notification-shaped but had no consumer. LOADING communication is owned by T10's
  // governed diaspora.loading.cargo_loaded / cargo_left_behind events after actual load facts exist,
  // so a status reflection must not create a second unconsumed worker item.
  return data;
}
