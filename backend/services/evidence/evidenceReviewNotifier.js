/**
 * Evidence review decision → communication engine bridge (seam-E E7).
 *
 * The evidence verify/reject flow lives in backend/routes/vehiclesRoutes.js;
 * that route calls this helper after a review decision persists so the
 * evidence submitter learns the outcome through the canonical notification
 * fabric ('evidence.review.decided' → NOTIFICATION_POLICIES →
 * evidence_review_v1 template).
 *
 * Best-effort: the review decision is already durable when this runs, so an
 * outbox write failure warns and returns null — it never fails the review.
 */

import { emitDomainEvent } from '../eventBus/eventBusService.js';

/**
 * Emit the 'evidence.review.decided' domain event for a reviewed evidence item.
 *
 * @param {object} input
 * @param {string} input.vin              - Vehicle/listing VIN the evidence belongs to.
 * @param {string} input.evidenceId       - Reviewed evidence record id.
 * @param {string} input.decision         - Review outcome (e.g. 'verified' | 'rejected').
 * @param {string} input.recipientUserId  - Evidence submitter to notify.
 * @param {string|null} [input.tenantId]  - Tenant context for the event.
 * @returns {Promise<object|null>} The created domain event record, or null when
 *   the recipient is unknown or the outbox write failed.
 */
export async function notifyEvidenceReviewDecided({ vin, evidenceId, decision, recipientUserId, tenantId = null }) {
  if (!recipientUserId) return null;
  try {
    return await emitDomainEvent(null, 'evidence.review.decided', {
      vin: vin || null,
      evidenceId: evidenceId || null,
      decision,
      recipientUserId,
      listingId: vin || null,
    }, tenantId);
  } catch (err) {
    console.warn('[evidence-review] outbox emit failed:', err.message);
    return null;
  }
}
