/**
 * Trade OS T7.4 — participant ↔ organiser conversation on a shared-container sailing.
 *
 * The gap this closes: container booking already emitted one-way notifications
 * (`containerBookingNotifier` → the governed `container_booking_update` template), so a participant
 * was TOLD things and could reply to nobody. Every other Trade OS relationship — the sourcing
 * request, the shipping request — has a two-way clarification thread. A booking did not.
 *
 * Deliberately creates NO booking chat table. This is a canonical Communications reference flow,
 * exactly as T2's RFQ thread and T3's logistics thread are, bound to the authoritative sailing via
 * the generic `subject_type`/`subject_id` the canonical thread already carries.
 *
 * One thread per (sailing, participant) pair. Co-loaders on one container are strangers sharing a
 * box, not a group: their cargo, their reservation and their questions stay private from each
 * other, and only the organiser sees them all.
 *
 * A conversation is NOT capacity. Nothing here approves a reservation, changes a status, or creates
 * space — `diaspora_approve_cargo_reservation_atomic` remains the only thing that can, and a
 * message saying "your space is confirmed" is a sentence, not an approval.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId,
} from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { createCommunicationServices } from '../communication/communicationServiceFactory.js';

const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';

/** The canonical subject vocabulary for a sailing conversation. */
export const CONTAINER_SUBJECT_TYPE = 'diaspora_container_booking';
export const CONTAINER_WORKFLOW = 'marketplace';

/** Reservation states that still represent a live relationship worth talking about. */
const LIVE_RESERVATION_STATES = new Set(['REQUESTED', 'APPROVED']);

/**
 * Who operates this sailing.
 *
 * The coordinator is included explicitly. Tenant-admin authority alone was not enough: a sailing
 * created by a logistics provider can carry a null `tenant_id`, so its OWN coordinator failed
 * `isTenantAdminForRecord`, fell through to the participant branch, and was told they had no
 * booking on the sailing they organise. Found on staging, not in review — the unit fixture happened
 * to give the coordinator platform authority as well, which hid it.
 */
function isOperator(container, context) {
  const coordinator = normalizeId(container.coordinator_id || container.created_by);
  if (coordinator && coordinator === context.id) return true;
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(container, context);
}

/**
 * Decide who the caller is on this sailing, and who the other side of the thread is.
 *
 * A participant earns their place by holding a live reservation — asking BEFORE approval is the
 * whole point, so REQUESTED counts. The organiser is the sailing's coordinator; when the sailing
 * records none, platform review authority stands in rather than leaving the participant with
 * nobody to ask.
 */
async function resolveParticipants(client, containerId, context, requestedParticipantId) {
  const { data: container, error } = await client.from(CONTAINERS).select('*')
    .eq('id', containerId).is('deleted_at', null).maybeSingle();
  if (error || !container) throw new NotFoundError('Sailing not found');

  const organiserId = normalizeId(container.coordinator_id || container.created_by);
  if (!organiserId) throw new ValidationError('This sailing records no organiser to talk to');

  const { data: reservations } = await client.from(RESERVATIONS).select('*')
    .eq('container_id', containerId).is('deleted_at', null);
  const live = (reservations || []).filter((r) => LIVE_RESERVATION_STATES.has(String(r.reservation_status)));

  if (isOperator(container, context)) {
    // The organiser must say WHICH participant they are answering; they hold one thread per person.
    const participantId = normalizeId(requestedParticipantId);
    if (!participantId) {
      throw new ValidationError('participantId is required to open the conversation with a specific participant');
    }
    // Client-supplied participant — verified against the sailing, never believed.
    const theirs = live.find((r) => normalizeId(r.buyer_id) === participantId || normalizeId(r.created_by) === participantId);
    if (!theirs) {
      throw new ForbiddenError('That person holds no live booking on this sailing, so there is no conversation to open with them');
    }
    return { container, organiserId, participantId, role: 'organiser' };
  }

  const mine = live.find((r) => normalizeId(r.buyer_id) === context.id || normalizeId(r.created_by) === context.id);
  if (!mine) {
    throw new ForbiddenError('You have no live booking on this sailing');
  }
  return { container, organiserId, participantId: context.id, role: 'participant' };
}

/**
 * Ensure the canonical conversation for one participant on one sailing, and return its thread id.
 */
export async function ensureContainerConversation(containerId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { container, organiserId, participantId, role } = await resolveParticipants(
    client, containerId, context, options.participantId ?? userContext.participantId,
  );

  if (organiserId === participantId) {
    throw new ValidationError('The organiser and the participant are the same person, so there is no conversation to open');
  }

  const services = options.communicationServices || createCommunicationServices();
  const result = await services.stakeholderService.ensureReferenceFlow({
    workflow: CONTAINER_WORKFLOW,
    subject_type: CONTAINER_SUBJECT_TYPE,
    // Distinct per participant: co-loaders never read each other's questions.
    subject_id: `${containerId}:${participantId}`,
    tenant_id: container.tenant_id || null,
    participants: [
      { user_id: participantId, stakeholder_role: 'buyer' },
      { user_id: organiserId, stakeholder_role: 'seller' },
    ],
    metadata: {
      diaspora_container_id: containerId,
      // What a human recognises in an inbox, without leaking ids or another participant's cargo.
      container_reference: `SAIL-${String(containerId).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      route: [
        [container.origin_city, container.origin_country].filter(Boolean).join(', '),
        [container.destination_city, container.destination_country].filter(Boolean).join(', '),
      ].filter(Boolean).join(' → ') || null,
    },
  });

  const thread = result?.thread || result;
  return { threadId: thread?.id || null, role, containerId };
}
