/**
 * Trade OS T11-CAP-08 — telling a customer what happened to their shipment's journey.
 *
 * The CONSUMER half only, like `shipmentExceptionNotifier`, `loadingLifecycleNotifier` and the rest. It
 * runs after the authoritative change has committed and been audited, and it creates nothing:
 *
 *   shipment authority (T11) → audit → `DIASPORA_SHIPMENT_<STAGE>` on the bus → THIS → governed template
 *   → in-app notice
 *
 * **A notification never creates shipment state.** Nothing here writes a stage, a date or an estimate,
 * and a delivery failure can no more un-depart a shipment than a successful one can sail it.
 *
 * T11 is not edited. It already emits `DIASPORA_SHIPMENT_<STAGE>` after each audited stage change; this
 * subscribes to the four stages worth saying and ignores the rest. The legacy exception notice
 * (`shipmentExceptionNotifier`) is left exactly as it is — it addresses the shipment's creator, which is
 * the operator (G5 / decision D3) — and these alerts are addressed from the order's own buyers instead.
 *
 * Who is told. The people whose Journey SHOWS this shipment: the same `resolveJourneyShipment` the
 * Journey uses, so an order merely co-loaded on the container is not told another order's shipment
 * moved, cargo that was left behind is not told it sailed, an ambiguous or inconsistent association
 * tells nobody, and the two can never drift apart. Each person is told about
 * their OWN order and nothing else: no other participant, no operator, no container, no tenant.
 *
 * One observation, one alert. The event bus derives a database-enforced identity from `alertKey`
 * (kind · order · person · observation), so a redelivered event, a retried handler or a replayed request
 * recovers the existing alert instead of making a second. The event worker re-runs ALL of an event's
 * handlers when any one throws, so this is not hypothetical: a handler that told two people before
 * failing on the third must be safe to run again. An estimate change is keyed to a window of the
 * revision's own recorded time, so a burst of edits is one alert per person per window — and the same
 * revision replayed is the same alert, whenever it is replayed.
 */
import { createHash } from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { ValidationError } from '../../utils/errors.js';
import { normalizeId } from './diasporaAuthorization.js';
import { resolveJourneyShipment, shipmentReference } from './journeyProjectionService.js';

const ORDERS = 'diaspora_import_orders';
const SHIPMENTS = 'diaspora_shipments';

export const JOURNEY_ALERT_KINDS = Object.freeze({
  DEPARTED: 'DEPARTED',
  ARRIVED: 'ARRIVED',
  EXCEPTION: 'EXCEPTION',
  ETA_CHANGED: 'ETA_CHANGED',
});

export const JOURNEY_ALERT_EVENTS = Object.freeze({
  ALERT: 'diaspora.journey.alert',
  EXCEPTION: 'diaspora.journey.exception',
});

/**
 * The recorded stages that are worth a sentence, and what each is called. RELEASED and COMPLETED are
 * deliberately absent: T11 itself hands them to T12, because a release asserts that duty was paid. LOADING,
 * BOOKED and PLANNED are preparation, and "loaded" already has its own notice (T10.4).
 */
export const STAGE_ALERTS = Object.freeze({
  IN_TRANSIT: JOURNEY_ALERT_KINDS.DEPARTED,
  ARRIVED: JOURNEY_ALERT_KINDS.ARRIVED,
  EXCEPTION: JOURNEY_ALERT_KINDS.EXCEPTION,
  CUSTOMS_HOLD: JOURNEY_ALERT_KINDS.EXCEPTION,
});

/** An estimate is announced once per window of the revision's own recorded time. */
export const ETA_ALERT_WINDOW_MINUTES = 30;

export class JourneyAlertDeliveryError extends Error {
  constructor(failed, total) {
    super(`${failed} of ${total} journey alerts could not be queued`);
    this.name = 'JourneyAlertDeliveryError';
    this.failed = failed;
    this.total = total;
  }
}

/**
 * What an alert says. Bounded to what the shipment authority recorded — and each sentence names what it
 * is NOT: departed is not arrived, arrived is not delivered or cleared, a hold is not a customs decision,
 * an estimate is not an arrival. No date is embedded, because a later revision would make it stale.
 */
export function journeyAlertText(kind, { stage = null } = {}) {
  switch (kind) {
    case JOURNEY_ALERT_KINDS.DEPARTED:
      return 'The organiser has recorded your shipment as departed. Open your journey to see the details.';
    case JOURNEY_ALERT_KINDS.ARRIVED:
      return 'The organiser has recorded your shipment as arrived. That is the shipment’s arrival — it is not delivery to you and it is not customs clearance. Open your journey to see the details.';
    case JOURNEY_ALERT_KINDS.EXCEPTION:
      return stage === 'CUSTOMS_HOLD'
        ? 'The organiser has recorded a hold on your shipment. That says where the goods are held; it is not a customs decision. Open your journey to see what was recorded.'
        : 'The organiser has recorded a problem with your shipment. Open your journey to see what was recorded. This is not a customs decision.';
    case JOURNEY_ALERT_KINDS.ETA_CHANGED:
      return 'The estimated arrival for your shipment has changed. An estimate is not an arrival. Open your journey to see the latest estimate.';
    default:
      throw new ValidationError(`Unknown journey alert kind: ${kind}`);
  }
}

/** The identity of one alert to one person about one observation. */
export function alertKeyFor({ kind, orderId, recipientUserId, observationKey }) {
  return [kind, orderId, recipientUserId, observationKey].join(':');
}

function etaWindowKey(recordedAt) {
  const t = Date.parse(recordedAt);
  if (!recordedAt || Number.isNaN(t)) {
    throw new ValidationError('An estimate alert needs the revision’s recorded time');
  }
  return `win-${Math.floor(t / (ETA_ALERT_WINDOW_MINUTES * 60 * 1000))}`;
}

/**
 * Who is told that this shipment moved: the buyer and creator of the order this shipment is attached to,
 * held to the Journey's own rule — it is told only if that order's Journey resolves THIS shipment by a
 * plain association. A shipment belongs to one order (R1 D2): an order merely co-loaded on its container is
 * not told, and an inconsistent or ambiguous association is flagged on the Journey, not announced as movement.
 */
export async function resolveAlertRecipients(shipment, { client = supabase } = {}) {
  const orderId = normalizeId(shipment.import_order_id);
  if (!orderId) return [];

  const { data: orders } = await client.from(ORDERS).select('*').in('id', [orderId]).is('deleted_at', null);
  const recipients = [];
  for (const order of orders || []) {
    const resolved = await resolveJourneyShipment(client, order);
    if (resolved.goodsNotOnShipment) continue;
    const { picked } = resolved;
    if (!picked?.shipment || normalizeId(picked.shipment.id) !== normalizeId(shipment.id)) continue;
    if (picked.association !== 'order') continue;
    const people = [...new Set([order.buyer_id, order.created_by].map(normalizeId).filter(Boolean))];
    for (const userId of people) recipients.push({ userId, orderId: order.id });
  }
  return recipients;
}

/**
 * Tell every person whose Journey shows this shipment, once.
 *
 * Every recipient is attempted even if one fails; if any failed, this throws AFTER the rest were sent, so
 * a caller that retries (the event worker) completes the set without repeating the delivered ones.
 */
export async function notifyJourneyAlert(
  { kind, shipment, observationId = null, recordedAt = null, stage = null },
  { client = supabase, emitEvent = emitDomainEvent } = {},
) {
  const status = journeyAlertText(kind, { stage });
  let observationKey;
  if (kind === JOURNEY_ALERT_KINDS.ETA_CHANGED) {
    observationKey = etaWindowKey(recordedAt);
  } else {
    const id = String(observationId || '').trim();
    if (!id) throw new ValidationError('An alert needs the observation it is about');
    observationKey = `evt-${id}`;
  }

  const recipients = await resolveAlertRecipients(shipment, { client });
  const tenantId = shipment.tenant_id ?? null;
  const emitted = [];
  let failed = 0;
  for (const { userId, orderId } of recipients) {
    const payload = {
      recipientUserId: userId,
      kind,
      alertKey: alertKeyFor({ kind, orderId, recipientUserId: userId, observationKey }),
      subjectType: 'import_order',
      subjectId: orderId,
      reference: shipmentReference(shipment.id),
      // The sentence, as the governed template's `status`. Said in the payload so no template can
      // improve on what the shipment authority actually recorded.
      status,
      journeyPath: `/diaspora/journey/import_order/${orderId}`,
      advisory_only: true,
      subject_type: 'diaspora_journey',
    };
    try {
      // Keep each event type a LITERAL at its call site: `communication-event-coverage` scans for
      // `emit…Event(null, '<type>', …)`, and a subscription whose emitter it cannot see is one that
      // looks alive and is dead.
      if (kind === JOURNEY_ALERT_KINDS.EXCEPTION) {
        emitted.push(await emitEvent(null, 'diaspora.journey.exception', payload, tenantId));
      } else {
        emitted.push(await emitEvent(null, 'diaspora.journey.alert', payload, tenantId));
      }
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn('[journey-alert] could not queue an alert:', err.message);
    }
  }
  if (failed) throw new JourneyAlertDeliveryError(failed, recipients.length);
  return { kind, recipients: recipients.length, emitted };
}

/**
 * The consumer for T11's `DIASPORA_SHIPMENT_<STAGE>`. The shipment row — not the payload — is the truth
 * about which order and container it belongs to. The key comes from the outbox event's own id, which is
 * stable across redelivery; with none, from a hash of the shipment's own record, so a missing identity
 * can never become a random one that defeats the dedupe.
 */
export async function handleShipmentStageEvent(payload = {}, outboxEvent = {}, { client = supabase, emitEvent = emitDomainEvent } = {}) {
  const stage = String(payload?.stage || '').toUpperCase();
  const kind = STAGE_ALERTS[stage];
  if (!kind) return { skipped: 'not_an_alert_stage' };

  const shipmentId = payload?.shipmentId;
  const { data: shipment } = shipmentId
    ? await client.from(SHIPMENTS).select('*').eq('id', shipmentId).is('deleted_at', null).maybeSingle()
    : { data: null };
  if (!shipment) return { skipped: 'shipment_not_found' };

  const observationId = outboxEvent?.id
    ? String(outboxEvent.id)
    : `rec-${createHash('sha256').update(`${shipment.id}|${stage}|${shipment.updated_at || ''}`).digest('hex').slice(0, 16)}`;
  return notifyJourneyAlert({ kind, shipment, observationId, stage }, { client, emitEvent });
}

const SUBSCRIBED = Symbol('journeyAlertSubscribed');

/**
 * Subscribe to the four stages. Safe to call twice, and safe after a worker's handlers were reset: the
 * check is on the handlers actually present, not on a flag that could outlive them.
 */
export function registerJourneyAlertListeners(eventWorker, deps = {}) {
  if (!eventWorker?.subscribe) return;
  for (const stage of Object.keys(STAGE_ALERTS)) {
    const eventType = `DIASPORA_SHIPMENT_${stage}`;
    if ((eventWorker.handlers?.get(eventType) || []).some((h) => h[SUBSCRIBED])) continue;
    const handler = async (payload, _pgClient, _tenantId, outboxEvent) => {
      await handleShipmentStageEvent(payload, outboxEvent, deps);
    };
    handler[SUBSCRIBED] = true;
    eventWorker.subscribe(eventType, handler);
  }
}
