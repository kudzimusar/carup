/**
 * Trade OS T7.5 — shipment EXCEPTION communication.
 *
 * The canonical producer already existed and nobody was listening. `updateShipmentStage` records an
 * authoritative `EXCEPTION` (or `CUSTOMS_HOLD`) stage event, audits it, and emits
 * `DIASPORA_SHIPMENT_<STAGE>` on the domain bus — but Communications subscribed to none of it, so
 * the one stage a customer most needs to hear about was the one nobody told them.
 *
 * This is the CONSUMER half, and only that. It runs AFTER the authoritative mutation has committed
 * and been audited, exactly like `containerBookingNotifier` and `logisticsLifecycleNotifier`:
 *
 *   authoritative shipment stage change → audit → outbox event → governed template → in-app notice
 *
 * The direction is one-way and load-bearing. **A notification never creates shipment state.**
 * Nothing here writes a stage, and a delivery failure can no more un-hold a container than a
 * successful one can release it. T11 remains the authority for what a shipment is doing; T7 only
 * carries the sentence about it.
 *
 * Addressability: the domain event carries `{ shipmentId, importOrderId, stage }` and no recipient,
 * so the buyer is resolved here from the authoritative order. An event nobody can be addressed with
 * is not a notification.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

/**
 * The stages that are an EXCEPTION from the customer's point of view.
 *
 * `CUSTOMS_HOLD` is included deliberately: it is a stop, the customer's goods are not moving, and
 * treating it as ordinary progress because it has its own enum value would be the letter of the
 * vocabulary against its meaning. Recording it here does NOT make any customs claim — T12 owns
 * customs truth, and this says only that the shipment authority reported a hold.
 */
export const EXCEPTION_STAGES = Object.freeze(['EXCEPTION', 'CUSTOMS_HOLD']);

export function isExceptionStage(stage) {
  return EXCEPTION_STAGES.includes(String(stage || '').toUpperCase());
}

function shortRef(id) {
  return `SHPM-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Tell the buyer their shipment hit an exception.
 *
 * Best-effort by design: the shipment state is already durable and audited, and an outbox failure
 * must never roll back or mask it.
 */
export async function notifyShipmentException({ shipment, stage, notes = null, buyerId = null, tenantId = null }) {
  if (!isExceptionStage(stage)) return null;
  const recipientUserId = buyerId || shipment?.buyer_id || shipment?.created_by || null;
  if (!recipientUserId) return null;

  try {
    return await emitDomainEvent(null, 'diaspora.shipment.exception', {
      shipmentId: shipment?.id || null,
      importOrderId: shipment?.import_order_id || null,
      recipientUserId,
      stage: String(stage).toUpperCase(),
      reference: shortRef(shipment?.id),
      // The operator's own words about what happened, when they gave any. Never invented.
      notes: notes || null,
      subject_type: 'diaspora_shipment',
      // Said plainly in the payload so no downstream template can imply otherwise.
      advisory_only: true,
    }, tenantId ?? shipment?.tenant_id ?? null);
  } catch (err) {
    console.warn('[shipment-exception] outbox emit failed:', err.message);
    return null;
  }
}
