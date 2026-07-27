/**
 * Phase 4 — Reverse RFQ (seller side): discover published RFQs and respond with quotes.
 *
 * Sellers see only published RFQs. Quotes use diaspora_import_quotes; submission is idempotent on a
 * client key; only DRAFT quotes are editable; withdraw soft-deletes a not-yet-accepted quote.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import { QUOTE_DB_STATUSES, QUOTE_EDITABLE_FIELDS } from '../../constants/diaspora/diasporaRfqConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
// Enforcement via the GUARD (no-op while DIASPORA_SUBSCRIPTION_ENFORCEMENT is off, which is default).
import { requireFeature } from './diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

const ORDERS = 'diaspora_import_orders';
const QUOTES = 'diaspora_import_quotes';

function isPublished(order) {
  return Boolean(order.metadata?.rfq?.published);
}

function ownsQuote(quote, context) {
  return [quote.seller_id, quote.created_by].some((c) => normalizeId(c) === context.id);
}

/** Published RFQs visible to a seller. Reviewers/admins see all published; sellers exclude own. */
export async function listRfqs(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);

  const { data, error } = await client.from(ORDERS).select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Failed to list RFQs: ${error.message}`);

  let published = (data || []).filter(isPublished).filter((o) => !o.metadata?.rfq?.acceptedQuoteId);
  if (context.tenantId) published = published.filter((o) => normalizeId(o.tenant_id) === context.tenantId);
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    published = published.filter((o) => normalizeId(o.buyer_id) !== context.id);
  }
  return published.slice(offset, offset + limit);
}

async function loadPublishedOrder(client, orderId) {
  const { data, error } = await client.from(ORDERS).select('*').eq('id', orderId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Buyer order not found');
  if (!isPublished(data)) throw new ValidationError('This order is not an open RFQ');
  if (data.metadata?.rfq?.acceptedQuoteId) throw new ValidationError('This RFQ has already accepted a quote');
  return data;
}

export async function createQuote(orderId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const order = await loadPublishedOrder(client, orderId);

  const amount = Number(payload.quote_amount);
  if (!(amount > 0)) throw new ValidationError('quote_amount must be positive');

  const submit = Boolean(payload.submit);
  const idempotencyKey = payload.idempotencyKey || null;

  if (idempotencyKey) {
    const { data: existingList } = await client.from(QUOTES).select('*').eq('import_order_id', orderId).eq('seller_id', context.id).is('deleted_at', null);
    const dup = (existingList || []).find((q) => q.metadata?.idempotencyKey === idempotencyKey);
    if (dup) return { quote: dup, idempotentReplay: true };
  }

  // Gate on diaspora.rfq.respond, AFTER the idempotent-replay return above so a client retry is never
  // re-evaluated (and, once quotas attach to this key, never re-charged).
  await requireFeature(client, {
    tenantId: order.tenant_id || context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.RFQ_RESPOND,
  });

  const row = {
    tenant_id: order.tenant_id || context.tenantId || null,
    import_order_id: orderId,
    seller_id: context.id,
    quote_amount: amount,
    quote_currency: payload.quote_currency || 'USD',
    valid_until: payload.valid_until || null,
    inclusions: payload.inclusions || [],
    exclusions: payload.exclusions || [],
    status: submit ? QUOTE_DB_STATUSES.SUBMITTED : QUOTE_DB_STATUSES.DRAFT,
    metadata: {
      ...(payload.metadata || {}),
      idempotencyKey,
      stockItemId: payload.stockItemId || null,
      leadTimeDays: payload.leadTimeDays ?? null,
      shippingTerms: payload.shippingTerms || null,
    },
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(QUOTES).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create quote: ${error.message}`);
  await appendAudit(client, { importOrderId: orderId, actorId: context.id, tenantId: data.tenant_id, action: submit ? 'RFQ_QUOTE_SUBMITTED' : 'RFQ_QUOTE_DRAFTED', resourceType: 'diaspora_import_quote', resourceId: data.id, newState: data, req });
  return { quote: data, idempotentReplay: false };
}

async function loadOwnedQuote(client, quoteId, context) {
  const { data, error } = await client.from(QUOTES).select('*').eq('id', quoteId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Quote not found');
  if (!ownsQuote(data, context) && !isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    throw new ForbiddenError('You do not have access to this quote');
  }
  return data;
}

export async function updateQuote(quoteId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (previous.status !== QUOTE_DB_STATUSES.DRAFT) throw new ValidationError('Only DRAFT quotes can be edited');

  const update = { updated_by: context.id, updated_at: new Date().toISOString() };
  for (const f of QUOTE_EDITABLE_FIELDS) if (f in payload) update[f] = payload[f];
  if (update.quote_amount !== undefined && !(Number(update.quote_amount) > 0)) throw new ValidationError('quote_amount must be positive');

  const { data, error } = await client.from(QUOTES).update(update).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Failed to update quote: ${error.message}`);
  await appendAudit(client, { importOrderId: data.import_order_id, actorId: context.id, tenantId: data.tenant_id, action: 'RFQ_QUOTE_UPDATED', resourceType: 'diaspora_import_quote', resourceId: quoteId, previousState: previous, newState: data, req });
  return data;
}

export async function submitQuoteById(quoteId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (previous.status !== QUOTE_DB_STATUSES.DRAFT) throw new ValidationError(`Only DRAFT quotes can be submitted (status: ${previous.status})`);

  // A draft can be created before a downgrade and submitted after it, so submission is gated too —
  // otherwise the draft path is a way around the entitlement on responding to RFQs.
  await requireFeature(client, {
    tenantId: previous.tenant_id || context.tenantId || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.RFQ_RESPOND,
  });

  const { data, error } = await client.from(QUOTES).update({ status: QUOTE_DB_STATUSES.SUBMITTED, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Failed to submit quote: ${error.message}`);
  await appendAudit(client, { importOrderId: data.import_order_id, actorId: context.id, tenantId: data.tenant_id, action: 'RFQ_QUOTE_SUBMITTED', resourceType: 'diaspora_import_quote', resourceId: quoteId, previousState: previous, newState: data, req });
  return data;
}

export async function withdrawQuote(quoteId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await loadOwnedQuote(client, quoteId, context);
  if (previous.status === QUOTE_DB_STATUSES.ACCEPTED) throw new ValidationError('An accepted quote cannot be withdrawn');

  const { data, error } = await client.from(QUOTES).update({ deleted_at: new Date().toISOString(), updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', quoteId).select().single();
  if (error) throw new ValidationError(`Failed to withdraw quote: ${error.message}`);
  await appendAudit(client, { importOrderId: previous.import_order_id, actorId: context.id, tenantId: previous.tenant_id, action: 'RFQ_QUOTE_WITHDRAWN', resourceType: 'diaspora_import_quote', resourceId: quoteId, previousState: previous, newState: data, req });
  return { withdrawn: true, quoteId };
}
