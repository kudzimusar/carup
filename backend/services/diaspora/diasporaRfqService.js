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
// T2 §9.12: best-effort canonical Communications events AFTER the audited mutation.
import { notifyQuoteSubmitted } from './rfqLifecycleNotifier.js';
// The existing deterministic scorer — reused, never re-implemented, so supplier-facing match
// reasons and buyer-facing matches come from ONE authority.
import { scoreStockAgainstOrder } from './diasporaDemandSupplyMatchingService.js';
import { deriveBalances } from './diasporaStockLedgerService.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

const ORDERS = 'diaspora_import_orders';
const QUOTES = 'diaspora_import_quotes';
const REQUEST_LINES = 'diaspora_import_order_request_lines';

function isPublished(order) {
  return Boolean(order.metadata?.rfq?.published);
}

function ownsQuote(quote, context) {
  return [quote.seller_id, quote.created_by].some((c) => normalizeId(c) === context.id);
}

/**
 * T2 §9.4 — the SAFE marketplace projection.
 *
 * A supplier deciding whether to quote needs the requirement, not the requester. This is the ONLY
 * shape a non-owner ever receives for another party's buyer order, and it is built by allow-list:
 * a column added to `diaspora_import_orders` later cannot leak by default because nothing here
 * spreads the row.
 *
 * Deliberately EXCLUDED (private, and asserted by adversarial tests):
 *   buyer_id, tenant_id, created_by/updated_by, vin, chassis_number, linked_vehicle_vin,
 *   auction_lot_number, verification_status, raw metadata, and any buyer contact detail.
 *
 * Budget is exposed ONLY when the buyer explicitly chose to disclose it. A budget is negotiating
 * position, so silence must stay silence rather than defaulting to disclosure.
 */
export function projectRfqForMarketplace(order = {}, lines = [], extra = {}) {
  const rfq = order.metadata?.rfq || {};
  const disclosesBudget = rfq.discloseBudget === true && order.budget_amount != null;
  return {
    id: order.id,
    reference: rfqReference(order.id),
    order_type: order.order_type || null,
    requested_make: order.requested_make || null,
    requested_model: order.requested_model || null,
    requested_year_min: order.requested_year_min ?? null,
    requested_year_max: order.requested_year_max ?? null,
    origin_country: order.origin_country || null,
    destination_country: order.destination_country || null,
    destination_city: order.destination_city || null,
    // Buyer-stated commercial context, only where the buyer chose to publish it.
    budget_amount: disclosesBudget ? order.budget_amount : null,
    budget_currency: disclosesBudget ? order.budget_currency || null : null,
    budget_disclosed: disclosesBudget,
    needed_by: rfq.neededBy || null,
    urgency: rfq.urgency || null,
    buyer_notes: typeof rfq.buyerNotes === 'string' ? rfq.buyerNotes : null,
    published_at: rfq.publishedAt || null,
    quote_deadline: rfq.quoteDeadline || null,
    // NO buyer verification signal is published.
    //
    // `diaspora_import_orders.verification_status` verifies the ORDER (its documents/review state),
    // not the PERSON. Rendering it as "Verified CarUp buyer" converted order verification into
    // identity verification — a Truth & Trust violation. The person/business authority is
    // `diaspora_trade_profiles.verification_status`, which is dormant: on staging 5 profiles exist
    // and 0 are VERIFIED, so there is nothing truthful to publish. When that authority is genuinely
    // populated and governed, a non-identifying signal may be derived FROM IT — never from the order.
    // Pinned by diaspora-rfq2-marketplace-projection.test.js.
    lines: (lines || []).map(projectRequestLineForMarketplace),
    ...extra,
  };
}

/** Safe per-line projection. `part_number_known:false` is surfaced deliberately — see the migration. */
export function projectRequestLineForMarketplace(line = {}) {
  return {
    id: line.id,
    line_number: line.line_number,
    item_description: line.item_description || null,
    item_kind: line.item_kind || null,
    quantity: line.quantity ?? null,
    vehicle_make: line.vehicle_make || null,
    vehicle_model: line.vehicle_model || null,
    vehicle_year_min: line.vehicle_year_min ?? null,
    vehicle_year_max: line.vehicle_year_max ?? null,
    part_number: line.part_number || null,
    part_number_known: Boolean(line.part_number_known),
    condition_preference: line.condition_preference || null,
    notes: line.notes || null,
  };
}

/** Short, stable, non-guessable-order-id display reference. */
export function rfqReference(id) {
  return `RFQ-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function isAwarded(order) {
  return Boolean(order.metadata?.rfq?.acceptedQuoteId);
}

const POSITIVE_INT = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const POSITIVE_NUM = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Map a quote payload onto the additive commercial columns.
 *
 * `shipping_included` is tri-state on purpose: true / false / NULL("not stated"). Coercing an absent
 * answer to false would publish a commercial claim the supplier never made.
 */
function commercialQuoteColumns(payload = {}) {
  return {
    offered_quantity: POSITIVE_INT(payload.offered_quantity ?? payload.offeredQuantity),
    unit_price: POSITIVE_NUM(payload.unit_price ?? payload.unitPrice),
    lead_time_days: POSITIVE_INT(payload.lead_time_days ?? payload.leadTimeDays),
    shipping_included: typeof (payload.shipping_included ?? payload.shippingIncluded) === 'boolean'
      ? (payload.shipping_included ?? payload.shippingIncluded)
      : null,
    offered_condition: payload.offered_condition || payload.offeredCondition || null,
    offered_description: payload.offered_description || payload.offeredDescription || null,
    stock_item_id: payload.stock_item_id || payload.stockItemId || null,
  };
}

/**
 * Why THIS request matches THIS supplier — genuine, supplier-specific evidence (T2 §9.6).
 *
 * Scoped to the caller's OWN published stock, so a supplier can never learn what a competitor
 * holds. Scoring is the existing deterministic `scoreStockAgainstOrder`; only its own stock's
 * reasons are surfaced. Returns null when nothing actually matches — the UI then says so plainly
 * rather than dressing up restated request facts as a match.
 */
async function buildSupplierMatches(client, orders, context) {
  const byOrder = new Map();
  if (!orders.length) return byOrder;

  let query = client.from('diaspora_stock_items').select('*')
    .eq('publication_status', 'PUBLISHED').is('deleted_at', null);
  // Own-stock scoping: tenant when the supplier trades as an organisation, else their own rows.
  if (context.tenantId) query = query.eq('tenant_id', context.tenantId);
  else query = query.eq('created_by', context.id);
  const { data: stock, error } = await query;
  // A failed read is "unknown", not "no match" — the caller renders an honest absence either way,
  // but we must never claim a confirmed non-match from a broken query.
  if (error) return byOrder;

  const available = (stock || [])
    .map((item) => ({ ...item, balances: deriveBalances(item) }))
    .filter((item) => item.balances.available > 0);
  if (!available.length) return byOrder;

  for (const order of orders) {
    let best = null;
    for (const item of available) {
      const { score, reasons, available: qty } = scoreStockAgainstOrder(order, item);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = {
          score,
          // Evidence from the supplier's OWN stock — safe to show them.
          stock_item_id: item.id,
          stock_name: item.part_name || item.sku || 'Stock item',
          available_quantity: qty,
          export_ready: item.export_readiness_status === 'EXPORT_READY',
          reasons,
        };
      }
    }
    if (best) byOrder.set(order.id, best);
  }
  return byOrder;
}

/**
 * Published RFQs a supplier may consider — the cross-tenant sourcing marketplace.
 *
 * Two deliberate changes from the pre-T2 behaviour:
 *
 *  1. The same-tenant restriction is GONE for published requests. It made a marketplace impossible
 *     (a supplier could only ever see their own organisation's requests). Visibility is now
 *     published + open + not-your-own, which is the actual marketplace rule.
 *
 *  2. Every row is returned as the sanitized projection above. The previous implementation did
 *     `select('*')` and handed the FULL private order row to the caller — which also meant a
 *     supplier with NO tenant context received every published buyer's private columns across all
 *     tenants. Widening discovery without this projection would have deepened that leak; the two
 *     changes are one change.
 *
 * Tenant isolation for PRIVATE records is untouched: nothing here grants access to a draft order,
 * to `getBuyerOrder`, or to any other tenant's records.
 */
export async function listRfqs(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);

  const { data, error } = await client.from(ORDERS).select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Failed to list RFQs: ${error.message}`);

  let published = (data || []).filter(isPublished).filter((o) => !isAwarded(o));
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    published = published.filter((o) => normalizeId(o.buyer_id) !== context.id);
  }
  published = applyMarketplaceFilters(published, filters);
  const page = published.slice(offset, offset + limit);
  if (!page.length) return [];

  const orderIds = page.map((o) => o.id);
  const [linesByOrder, quoteCounts, matches] = await Promise.all([
    loadRequestLines(client, orderIds),
    countSubmittedQuotes(client, orderIds),
    buildSupplierMatches(client, page, context),
  ]);
  return page.map((o) => projectRfqForMarketplace(o, linesByOrder.get(o.id) || [], {
    quote_count: quoteCounts.get(o.id) || 0,
    // null when this supplier has no matching stock — an honest absence, not a fabricated reason.
    supplier_match: matches.get(o.id) || null,
  }));
}

/** Deterministic supplier-side filters. Only fields present in the safe projection are filterable. */
function applyMarketplaceFilters(orders, filters = {}) {
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  let out = orders;
  if (filters.order_type) out = out.filter((o) => eq(o.order_type, filters.order_type));
  if (filters.make) out = out.filter((o) => eq(o.requested_make, filters.make));
  if (filters.destination_country) out = out.filter((o) => eq(o.destination_country, filters.destination_country));
  return out;
}

async function loadRequestLines(client, orderIds) {
  const byOrder = new Map();
  if (!orderIds.length) return byOrder;
  const { data } = await client.from(REQUEST_LINES).select('*').in('import_order_id', orderIds).is('deleted_at', null);
  for (const line of data || []) {
    if (!byOrder.has(line.import_order_id)) byOrder.set(line.import_order_id, []);
    byOrder.get(line.import_order_id).push(line);
  }
  for (const list of byOrder.values()) list.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
  return byOrder;
}

/**
 * Submitted-quote counts per request — competitive context ("3 suppliers have quoted"), never the
 * competitors' identities or amounts.
 */
async function countSubmittedQuotes(client, orderIds) {
  const counts = new Map();
  if (!orderIds.length) return counts;
  const { data } = await client.from(QUOTES).select('import_order_id, status').in('import_order_id', orderIds).is('deleted_at', null);
  for (const q of data || []) {
    if (q.status !== QUOTE_DB_STATUSES.SUBMITTED) continue;
    counts.set(q.import_order_id, (counts.get(q.import_order_id) || 0) + 1);
  }
  return counts;
}

/**
 * One published request, as a supplier sees it. Same allow-list projection as the feed — a supplier
 * opening a request detail must never receive more than the feed would have shown them.
 */
export async function getRfqForSeller(orderId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const order = await loadPublishedOrder(client, orderId);
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context) && normalizeId(order.buyer_id) === context.id) {
    // The buyer owns this request; they read it through their own (full) buyer-order endpoint.
    throw new ForbiddenError('Use the buyer order endpoint to read your own request');
  }
  const [linesByOrder, quoteCounts, matches] = await Promise.all([
    loadRequestLines(client, [orderId]),
    countSubmittedQuotes(client, [orderId]),
    buildSupplierMatches(client, [order], context),
  ]);
  return projectRfqForMarketplace(order, linesByOrder.get(orderId) || [], {
    quote_count: quoteCounts.get(orderId) || 0,
    supplier_match: matches.get(orderId) || null,
  });
}

async function loadPublishedOrder(client, orderId) {
  const { data, error } = await client.from(ORDERS).select('*').eq('id', orderId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Buyer order not found');
  if (!isPublished(data)) throw new ValidationError('This order is not an open RFQ');
  if (data.metadata?.rfq?.acceptedQuoteId) throw new ValidationError('This RFQ has already accepted a quote');
  return data;
}

/**
 * A supplier's own quote pipeline across every request they have engaged with.
 *
 * Scoped to quotes the caller owns — never a competitor's. Each quote is paired with the SAFE
 * projection of the request it answers, so a supplier can see "what I offered, on what request,
 * and whether I won" without any private buyer data entering the response.
 */
export async function listMyQuotes(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data, error } = await client.from(QUOTES).select('*').eq('seller_id', context.id).is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw new ValidationError(`Failed to list quotes: ${error.message}`);

  const quotes = data || [];
  if (!quotes.length) return [];
  const orderIds = [...new Set(quotes.map((q) => q.import_order_id).filter(Boolean))];
  const { data: orders } = await client.from(ORDERS).select('*').in('id', orderIds).is('deleted_at', null);
  const linesByOrder = await loadRequestLines(client, orderIds);
  const orderById = new Map((orders || []).map((o) => [o.id, o]));

  return quotes.map((q) => {
    const order = orderById.get(q.import_order_id);
    return {
      quote: q,
      // Won/lost is derived from authoritative order state, not from the quote row alone.
      outcome: !order ? 'unknown'
        : order.metadata?.rfq?.acceptedQuoteId === q.id ? 'won'
          : order.metadata?.rfq?.acceptedQuoteId ? 'not_selected'
            : q.status,
      request: order ? projectRfqForMarketplace(order, linesByOrder.get(order.id) || []) : null,
    };
  });
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
    // T2: real commercial terms as columns, so buyer comparison compares data rather than prose.
    // Every one is optional — a supplier who says nothing produces NULL, which the comparison
    // renders as "Not provided", never as a default (see the migration comments).
    ...commercialQuoteColumns(payload),
    metadata: {
      ...(payload.metadata || {}),
      idempotencyKey,
      // Retained for backwards compatibility with quotes written before the columns existed.
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
  // A DRAFT is private to the supplier — only a real submission is news for the buyer.
  if (submit) await notifyQuoteSubmitted({ order, quote: data, tenantId: data.tenant_id });
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
  const { data: submittedOrder } = await client.from(ORDERS).select('*').eq('id', data.import_order_id).single();
  if (submittedOrder) await notifyQuoteSubmitted({ order: submittedOrder, quote: data, tenantId: data.tenant_id });
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
