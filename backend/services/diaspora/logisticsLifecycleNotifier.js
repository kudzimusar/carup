/**
 * Trade OS T3 — shipping-request (logistics) lifecycle → canonical Communications.
 *
 * Same discipline as rfqLifecycleNotifier and containerBookingNotifier: the authoritative mutation
 * has already committed and been audited; here we emit a best-effort domain event into the outbox.
 * Communications subscribes and its NOTIFICATION_POLICIES render the governed template into a
 * one-way in-app notification. No logistics-specific notification store, no second chat authority,
 * and no notification is ever the source of truth.
 *
 * Why T3 gets these now rather than deferring them to T7: T2 already tells a buyer when an offer
 * arrives and tells every supplier whether they won. A logistics provider who submits an offer and
 * is never told the outcome keeps chasing a request that is already awarded — the same defect the
 * T2 notifier was written to prevent. T7 extends the Communications lifecycle (warehouse, shipment
 * exceptions, provider-channel routing); it does not own these three commercial moments.
 *
 * Addressability (C1 gate): every payload carries the recipient as a literal `recipientUserId`.
 * The governed `logistics_update_v1` template requires reference/status/route, exactly like the
 * container and sourcing templates, so a missing value can never render a blank commercial claim.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

function shippingRef(requestId) {
  return `SHIP-${String(requestId || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Corridor in human words. Used as the template's `route` variable. */
function routeOf(request = {}) {
  const from = [request.origin_city, request.origin_country].filter(Boolean).join(', ') || 'origin';
  const to = [request.destination_city, request.destination_country].filter(Boolean).join(', ') || 'destination';
  return `${from} → ${to}`;
}

async function emitLogisticsEvent(eventType, payload, tenantId) {
  try {
    return await emitDomainEvent(null, eventType, payload, tenantId ?? null);
  } catch (err) {
    // The request/quote state is already durable and audited; an outbox failure must never roll
    // back or mask it.
    console.warn(`[logistics-lifecycle] outbox emit failed (${eventType}):`, err.message);
    return null;
  }
}

function base(request, status) {
  return {
    logisticsRequestId: request.id,
    status,
    reference: shippingRef(request.id),
    route: routeOf(request),
    subject_type: 'diaspora_logistics_request',
  };
}

/**
 * A provider submitted an offer — the REQUESTER needs to know; that is the whole point of
 * publishing the request. A DRAFT offer is private to the provider and emits nothing.
 */
export async function notifyLogisticsQuoteSubmitted({ request, quote, tenantId = null }) {
  const recipientUserId = request.requester_id || request.created_by || null;
  if (!recipientUserId) return null;
  return emitLogisticsEvent('diaspora.logistics.quote_submitted', {
    ...base(request, 'OFFER_RECEIVED'),
    recipientUserId,
    quoteId: quote.id,
  }, tenantId);
}

/**
 * The requester chose this provider. Deliberately says the offer was selected and nothing more:
 * an award is not approved container space, carrier acceptance, customs or payment.
 */
export async function notifyLogisticsQuoteAccepted({ request, quote, tenantId = null }) {
  const recipientUserId = quote.provider_id || quote.created_by || null;
  if (!recipientUserId) return null;
  return emitLogisticsEvent('diaspora.logistics.quote_accepted', {
    ...base(request, 'OFFER_ACCEPTED'),
    recipientUserId,
    quoteId: quote.id,
  }, tenantId);
}

/**
 * A competing offer was not selected. Told plainly, because a provider who is never told they lost
 * keeps chasing a closed request — and silence is its own bad product decision. A WITHDRAWN offer
 * is not "not selected"; the provider already left, so telling them they lost would be false.
 */
export async function notifyLogisticsQuoteNotSelected({ request, quotes = [], acceptedQuoteId, acceptedProviderId = null, tenantId = null }) {
  const results = [];
  const seen = new Set();
  // A provider may hold SEVERAL offers on one request (a named alternative is legitimate). The
  // winner must be skipped as a PERSON, not merely as a quote id — telling the provider whose
  // offer was just accepted that they were "not selected" for their other option on the same
  // request is false in the way that destroys trust in every later notification.
  if (acceptedProviderId) seen.add(acceptedProviderId);
  for (const quote of quotes) {
    if (quote.id === acceptedQuoteId) continue;
    if (quote.status === 'WITHDRAWN' || quote.status === 'DRAFT') continue;
    const recipientUserId = quote.provider_id || quote.created_by || null;
    if (!recipientUserId || seen.has(recipientUserId)) continue;
    seen.add(recipientUserId);
    results.push(await emitLogisticsEvent('diaspora.logistics.quote_not_selected', {
      ...base(request, 'NOT_SELECTED'),
      recipientUserId,
      quoteId: quote.id,
    }, tenantId));
  }
  return results;
}
