/**
 * Phase 4 — Buyer Orders & Reverse RFQ (buyer side).
 *
 * Reuses diaspora_import_orders. RFQ lifecycle lives in metadata.rfq (additive). Quote acceptance is
 * transactional and idempotent: accepting one quote rejects the other submitted quotes and records
 * the accepted quote on the order; a repeat accept of the same quote is a no-op replay.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import { RFQ_URGENCY, QUOTE_DB_STATUSES } from '../../constants/diaspora/diasporaRfqConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isOrderOwner, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { matchSupplyForOrder } from './diasporaDemandSupplyMatchingService.js';

const ORDERS = 'diaspora_import_orders';
const QUOTES = 'diaspora_import_quotes';
const VALID_ORDER_TYPES = ['vehicle', 'parts', 'mixed'];

function canRead(order, context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isOrderOwner(order, context) ||
    (order.tenant_id && context.tenantId && normalizeId(order.tenant_id) === context.tenantId);
}

async function loadOrder(client, id, context, { mutate = false } = {}) {
  const { data, error } = await client.from(ORDERS).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora buyer order not found');
  if (!canRead(data, context)) throw new ForbiddenError('You do not have access to this buyer order');
  if (mutate && !(isPlatformAdmin(context) || isPlatformReviewer(context) || isOrderOwner(data, context))) {
    throw new ForbiddenError('Only the buyer or a reviewer can modify this order');
  }
  return data;
}

export async function createBuyerOrder(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const orderType = payload.order_type || 'parts';
  if (!VALID_ORDER_TYPES.includes(orderType)) {
    throw new ValidationError(`Invalid order_type. Allowed: ${VALID_ORDER_TYPES.join(', ')}`);
  }
  if (!payload.origin_country) throw new ValidationError('origin_country is required');
  const urgency = (payload.urgency || 'NORMAL').toUpperCase();
  if (!RFQ_URGENCY.includes(urgency)) throw new ValidationError(`Invalid urgency. Allowed: ${RFQ_URGENCY.join(', ')}`);

  const row = {
    tenant_id: context.tenantId || payload.tenant_id || null,
    buyer_id: context.id,
    order_type: orderType,
    origin_country: payload.origin_country,
    origin_city: payload.origin_city || null,
    destination_country: payload.destination_country || 'Zimbabwe',
    destination_city: payload.destination_city || null,
    requested_make: payload.requested_make || null,
    requested_model: payload.requested_model || null,
    requested_year_min: payload.requested_year_min ?? null,
    requested_year_max: payload.requested_year_max ?? null,
    budget_amount: payload.budget_amount ?? null,
    budget_currency: payload.budget_currency || 'USD',
    status: 'IMPORT_REQUESTED',
    metadata: {
      ...(payload.metadata || {}),
      urgency,
      requested_part_number: payload.requested_part_number || null,
      rfq: { published: false },
    },
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(ORDERS).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create buyer order: ${error.message}`);

  await appendAudit(client, {
    importOrderId: data.id, actorId: context.id, tenantId: data.tenant_id,
    action: 'BUYER_ORDER_CREATED', resourceType: 'diaspora_import_order', resourceId: data.id, newState: data, req,
  });
  return data;
}

export async function listBuyerOrders(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);

  let query = client.from(ORDERS).select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (context.tenantId) query = query.eq('tenant_id', context.tenantId);
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context) && !context.tenantId) {
    query = query.eq('buyer_id', context.id);
  }
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list buyer orders: ${error.message}`);
  return data || [];
}

export async function getBuyerOrder(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const order = await loadOrder(client, id, context);

  const { data: quotes } = await client.from(QUOTES).select('*').eq('import_order_id', id).is('deleted_at', null);
  return { ...order, quotes: quotes || [] };
}

export async function updateBuyerOrder(id, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await loadOrder(client, id, context, { mutate: true });

  if (previous.metadata?.rfq?.acceptedQuoteId) {
    throw new ValidationError('Cannot edit an order that has an accepted quote');
  }

  const editable = ['origin_city', 'destination_country', 'destination_city', 'requested_make', 'requested_model', 'requested_year_min', 'requested_year_max', 'budget_amount', 'budget_currency'];
  const update = { updated_by: context.id, updated_at: new Date().toISOString() };
  for (const f of editable) if (f in payload) update[f] = payload[f];
  if (payload.metadata || payload.urgency || payload.requested_part_number) {
    update.metadata = {
      ...(previous.metadata || {}),
      ...(payload.metadata || {}),
      ...(payload.urgency ? { urgency: String(payload.urgency).toUpperCase() } : {}),
      ...(payload.requested_part_number ? { requested_part_number: payload.requested_part_number } : {}),
      rfq: previous.metadata?.rfq || { published: false },
    };
  }

  const { data, error } = await client.from(ORDERS).update(update).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to update buyer order: ${error.message}`);
  await appendAudit(client, { importOrderId: id, actorId: context.id, tenantId: data.tenant_id, action: 'BUYER_ORDER_UPDATED', resourceType: 'diaspora_import_order', resourceId: id, previousState: previous, newState: data, req });
  return data;
}

export async function publishRfq(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const order = await loadOrder(client, id, context, { mutate: true });

  if (!order.destination_country) throw new ValidationError('Cannot publish RFQ without a destination_country');
  if (order.metadata?.rfq?.published) return order; // idempotent

  const metadata = { ...(order.metadata || {}), rfq: { ...(order.metadata?.rfq || {}), published: true, publishedAt: new Date().toISOString() } };
  const { data, error } = await client.from(ORDERS).update({ metadata, status: 'QUOTE_ISSUED', updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to publish RFQ: ${error.message}`);
  await appendAudit(client, { importOrderId: id, actorId: context.id, tenantId: data.tenant_id, action: 'RFQ_PUBLISHED', resourceType: 'diaspora_import_order', resourceId: id, previousState: order, newState: data, req });
  return data;
}

export async function getOrderMatches(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const order = await loadOrder(client, id, context);
  return matchSupplyForOrder(order, context, options);
}

/**
 * Accept one quote. Transactional + idempotent. Rejects other submitted quotes for the order.
 */
export async function acceptQuote(orderId, quoteId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const order = await loadOrder(client, orderId, context, { mutate: true });

  const alreadyAccepted = order.metadata?.rfq?.acceptedQuoteId;
  if (alreadyAccepted) {
    if (alreadyAccepted === quoteId) {
      const { data: existing } = await client.from(QUOTES).select('*').eq('id', quoteId).single();
      return { order, acceptedQuote: existing, idempotentReplay: true };
    }
    throw new ValidationError('This order already has a different accepted quote');
  }

  const { data: quote, error: quoteErr } = await client.from(QUOTES).select('*').eq('id', quoteId).is('deleted_at', null).single();
  if (quoteErr || !quote) throw new NotFoundError('Quote not found');
  if (normalizeId(quote.import_order_id) !== normalizeId(orderId)) throw new ValidationError('Quote does not belong to this order');
  if (quote.status !== QUOTE_DB_STATUSES.SUBMITTED) throw new ValidationError(`Only submitted quotes can be accepted (status: ${quote.status})`);

  // Accept the chosen quote.
  const { data: accepted, error: acceptErr } = await client.from(QUOTES).update({ status: QUOTE_DB_STATUSES.ACCEPTED, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', quoteId).select().single();
  if (acceptErr) throw new ValidationError(`Failed to accept quote: ${acceptErr.message}`);

  // Reject the other submitted quotes for this order.
  const { data: siblings } = await client.from(QUOTES).select('*').eq('import_order_id', orderId).is('deleted_at', null);
  for (const sibling of siblings || []) {
    if (sibling.id !== quoteId && sibling.status === QUOTE_DB_STATUSES.SUBMITTED) {
      await client.from(QUOTES).update({ status: QUOTE_DB_STATUSES.REJECTED, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', sibling.id).select().single();
    }
  }

  const metadata = { ...(order.metadata || {}), rfq: { ...(order.metadata?.rfq || {}), acceptedQuoteId: quoteId, acceptedAt: new Date().toISOString() } };
  const { data: updatedOrder } = await client.from(ORDERS).update({ metadata, status: 'SELLER_ASSIGNED', updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', orderId).select().single();

  await appendAudit(client, { importOrderId: orderId, actorId: context.id, tenantId: order.tenant_id, action: 'RFQ_QUOTE_ACCEPTED', resourceType: 'diaspora_import_quote', resourceId: quoteId, previousState: quote, newState: accepted, metadata: { orderId }, req });
  return { order: updatedOrder, acceptedQuote: accepted, idempotentReplay: false };
}
