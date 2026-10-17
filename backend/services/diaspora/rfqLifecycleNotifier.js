/**
 * Trade OS T2 §9.12 — sourcing lifecycle → canonical Communications.
 *
 * Same discipline as containerBookingNotifier: the authoritative mutation has already committed and
 * been audited; here we emit a best-effort domain event into the outbox. Communications subscribes
 * and its NOTIFICATION_POLICIES render the governed template into a one-way in-app notification.
 * No RFQ-specific notification store, and no notification is ever the source of truth.
 *
 * Addressability (C1 gate): every payload carries the recipient as a literal `recipientUserId`.
 * The governed `container_booking_update` template requires reference/status/route; sourcing events
 * use their own `rfq_update` template (registered in the same migration family) with the same
 * required variables so a missing value can never render a blank claim.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

function rfqRef(orderId) {
  return `RFQ-${String(orderId || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Corridor in human words. Used as the template's `route` variable. */
function routeOf(order = {}) {
  const from = order.origin_country || 'origin';
  const to = [order.destination_city, order.destination_country].filter(Boolean).join(', ') || 'destination';
  return `${from} → ${to}`;
}

async function emitRfqEvent(eventType, payload, tenantId) {
  try {
    return await emitDomainEvent(null, eventType, payload, tenantId ?? null);
  } catch (err) {
    // The request/quote state is already durable and audited; an outbox failure must never roll
    // back or mask it.
    console.warn(`[rfq-lifecycle] outbox emit failed (${eventType}):`, err.message);
    return null;
  }
}

function base(order, status) {
  return {
    rfqId: order.id,
    status,
    reference: rfqRef(order.id),
    route: routeOf(order),
    subject_type: 'diaspora_rfq',
  };
}

/** A supplier submitted an offer — the BUYER needs to know; that is the whole point of the RFQ. */
export async function notifyQuoteSubmitted({ order, quote, tenantId = null }) {
  const recipientUserId = order.buyer_id || order.created_by || null;
  if (!recipientUserId) return null;
  return emitRfqEvent('diaspora.rfq.quote_submitted', {
    ...base(order, 'QUOTE_RECEIVED'),
    recipientUserId,
    quoteId: quote.id,
  }, tenantId);
}

/** The buyer chose this supplier. */
export async function notifyQuoteAccepted({ order, quote, tenantId = null }) {
  const recipientUserId = quote.seller_id || quote.created_by || null;
  if (!recipientUserId) return null;
  return emitRfqEvent('diaspora.rfq.quote_accepted', {
    ...base(order, 'OFFER_ACCEPTED'),
    recipientUserId,
    quoteId: quote.id,
  }, tenantId);
}

/**
 * A competing offer was not selected. Told plainly, because a supplier who is never told they lost
 * keeps chasing a closed request — and silence is its own bad product decision.
 */
export async function notifyQuoteNotSelected({ order, quotes = [], acceptedQuoteId, tenantId = null }) {
  const results = [];
  const seen = new Set();
  for (const quote of quotes) {
    if (quote.id === acceptedQuoteId) continue;
    const recipientUserId = quote.seller_id || quote.created_by || null;
    if (!recipientUserId || seen.has(recipientUserId)) continue;
    seen.add(recipientUserId);
    results.push(await emitRfqEvent('diaspora.rfq.quote_not_selected', {
      ...base(order, 'NOT_SELECTED'),
      recipientUserId,
      quoteId: quote.id,
    }, tenantId));
  }
  return results;
}
