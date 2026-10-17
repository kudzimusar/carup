/**
 * OC-5R-REL-03A D7 correlation boundary.
 *
 * Pure, side-effect-free helpers shared by the deployed Playwright gate and Node contract tests.
 * A notification is proof only when it is linked to this run's exact reservation, recipient,
 * event direction, state and time window. Historical rows of the same notification_type cannot
 * satisfy the predicate.
 */

export const D7_PARTICIPANT_EVENT = 'diaspora.container_booking.reservation_approved';
export const D7_ORGANISER_EVENT = 'diaspora.container_booking.reservation_received';

export function reservationReference(reservationId) {
  const id = String(reservationId || '').trim();
  if (!id) throw new Error('reservation id is required for D7 correlation');
  return `RES-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function matchesD7Notification(row, expected = {}) {
  const safe = row?.payload?.safe_payload || {};
  const createdAt = Date.parse(String(row?.created_at || ''));
  const notBefore = Date.parse(String(expected.notBefore || ''));
  const recipient = row?.recipient_user_id ?? row?.recipient_id ?? null;
  const eventId = row?.event_id == null ? '' : String(row.event_id).trim();

  return row?.notification_type === 'container_booking'
    && Boolean(expected.recipientUserId)
    && String(recipient || '') === String(expected.recipientUserId)
    && Boolean(eventId)
    && row?.payload?.event_type === expected.eventType
    && Boolean(expected.reservationId)
    && String(safe?.reservationId || '') === String(expected.reservationId)
    && Boolean(expected.reference)
    && safe?.reference === expected.reference
    && Boolean(expected.status)
    && safe?.status === expected.status
    && Number.isFinite(createdAt)
    && Number.isFinite(notBefore)
    && createdAt >= notBefore;
}
