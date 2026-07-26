/**
 * Phase 4 — Buyer Orders & Reverse RFQ (buyer side).
 *
 * Reuses diaspora_import_orders. RFQ lifecycle lives in metadata.rfq (additive). Quote acceptance is
 * transactional and idempotent: accepting one quote rejects the other submitted quotes and records
 * the accepted quote on the order; a repeat accept of the same quote is a no-op replay.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import { RFQ_URGENCY } from '../../constants/diaspora/diasporaRfqConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isOrderOwner, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { matchSupplyForOrder } from './diasporaDemandSupplyMatchingService.js';
import { withEntitlement } from './diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

const ORDERS = 'diaspora_import_orders';
const QUOTES = 'diaspora_import_quotes';
const VALID_ORDER_TYPES = ['vehicle', 'parts', 'mixed'];
const ACCEPT_QUOTE_RPC = 'diaspora_accept_quote_atomic';

/** Map a sanitized accept-quote RPC exception to a stable application error. */
function translateAcceptQuoteError(error) {
  const raw = String(error?.message || 'Quote acceptance failed');
  const marker = raw.indexOf('DIASPORA_QUOTE/');
  const code = marker >= 0 ? raw.slice(marker + 'DIASPORA_QUOTE/'.length).split(/[:\s]/)[0] : '';
  switch (code) {
    case 'NOT_FOUND_ORDER': return new NotFoundError('Diaspora buyer order not found');
    case 'NOT_FOUND_QUOTE': return new NotFoundError('Quote not found');
    case 'FORBIDDEN': return new ForbiddenError('You do not have access to this buyer order');
    case 'ALREADY_ACCEPTED_DIFFERENT': return new ValidationError('This order already has a different accepted quote');
    case 'QUOTE_NOT_IN_ORDER': return new ValidationError('Quote does not belong to this order');
    case 'NOT_SUBMITTED': return new ValidationError('Only submitted quotes can be accepted');
    default: return new ValidationError('Quote acceptance could not be applied');
  }
}

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
  if (order.metadata?.rfq?.published) return order; // idempotent — already an open RFQ, no new quota

  // Phase 8 (M2): gate opening an RFQ on the diaspora.rfq.create feature and reserve a
  // diaspora.rfq.max_open slot. Flag-gated — a no-op (identical behavior) when enforcement is OFF; a
  // failed DB write/audit releases the reserved slot so it is never permanently consumed.
  return withEntitlement(client, {
    tenantId: order.tenant_id ?? context.tenantId ?? null,
    userId: context.id,
    featureKey: FEATURE_KEYS.RFQ_CREATE,
    quotaFeatureKey: FEATURE_KEYS.RFQ_MAX_OPEN,
    amount: 1,
    idempotencyKey: `rfq-publish:${id}`,
    req,
  }, async () => {
    const metadata = { ...(order.metadata || {}), rfq: { ...(order.metadata?.rfq || {}), published: true, publishedAt: new Date().toISOString() } };
    const { data, error } = await client.from(ORDERS).update({ metadata, status: 'QUOTE_ISSUED', updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw new ValidationError(`Failed to publish RFQ: ${error.message}`);
    await appendAudit(client, { importOrderId: id, actorId: context.id, tenantId: data.tenant_id, action: 'RFQ_PUBLISHED', resourceType: 'diaspora_import_order', resourceId: id, previousState: order, newState: data, req });
    return data;
  });
}

export async function getOrderMatches(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const order = await loadOrder(client, id, context);
  return matchSupplyForOrder(order, context, options);
}

/**
 * Accept one quote through the atomic RPC: lock order, validate authority, accept exactly one
 * submitted quote, reject siblings, stamp the order, and write a critical audit row — in one
 * transaction. Idempotent for the same quote; conflicts on a different accepted quote. No non-atomic
 * production fallback (directive H2 §13).
 */
export async function acceptQuote(orderId, quoteId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (!quoteId) throw new ValidationError('quoteId is required to accept a quote');

  const { data, error } = await client.rpc(ACCEPT_QUOTE_RPC, {
    p_order_id: orderId,
    p_quote_id: quoteId,
    p_actor_id: context.id,
    p_tenant_id: context.tenantId || null,
    p_actor_is_privileged: isPlatformAdmin(context) || isPlatformReviewer(context),
  });
  if (error) throw translateAcceptQuoteError(error);
  if (!data) throw new ValidationError('Quote acceptance returned no result');
  return { order: data.order, acceptedQuote: data.acceptedQuote, idempotentReplay: Boolean(data.idempotentReplay) };
}
