/**
 * Phase 4 — Buyer Orders & Reverse RFQ (buyer side).
 *
 * Reuses diaspora_import_orders. RFQ lifecycle lives in metadata.rfq (additive). Quote acceptance is
 * transactional and idempotent: accepting one quote rejects the other submitted quotes and records
 * the accepted quote on the order; a repeat accept of the same quote is a no-op replay.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import { normalizeOrderIntake, normalizeLineIntake } from './tradeIntakeNormalizer.js';
import { normalizeVehicleTaxonomyInput } from '../taxonomy/vehicleTaxonomyService.js';
import { RFQ_URGENCY, deriveRfqLifecycle } from '../../constants/diaspora/diasporaRfqConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isOrderOwner, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { matchSupplyForOrder } from './diasporaDemandSupplyMatchingService.js';
import { withEntitlement } from './diasporaEntitlementGuard.js';
import { notifyQuoteAccepted, notifyQuoteNotSelected } from './rfqLifecycleNotifier.js';
// The CANONICAL vehicle object authority. A request line may reference a vehicle, and a reference
// the caller is not entitled to make must be refused HERE — the UI only offering the caller's own
// vehicles is presentation, not authorization.
import { resolveVehicleObjectAuthority } from '../../middleware/vehicleObjectAuthority.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

const ORDERS = 'diaspora_import_orders';
const QUOTES = 'diaspora_import_quotes';
const REQUEST_LINES = 'diaspora_import_order_request_lines';
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

  const taxonomy = normalizeVehicleTaxonomyInput({
    make: payload.requested_make,
    model: payload.requested_model,
    year: payload.requested_year_min,
  });

  // Intake 2.0 (contract §36): validated intake facts live in columns, not in metadata, so they
  // can be matched against supply and projected selectively. An unanswered question stays null.
  const intake = normalizeOrderIntake(payload);

  const row = {
    ...intake,
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
    requested_make_taxon_id: taxonomy.make.canonical_id,
    requested_model_taxon_id: taxonomy.model.canonical_id,
    taxonomy_version: taxonomy.taxonomy_version,
    taxonomy_resolution: { make: taxonomy.make.state, model: taxonomy.model.state, year: taxonomy.year.state },
    taxonomy_source_values: {
      make: payload.requested_make || null,
      model: payload.requested_model || null,
      year_min: payload.requested_year_min ?? null,
      year_max: payload.requested_year_max ?? null,
    },
    taxonomized_at: new Date().toISOString(),
    budget_amount: payload.budget_amount ?? null,
    budget_currency: payload.budget_currency || 'USD',
    status: 'IMPORT_REQUESTED',
    metadata: {
      ...(payload.metadata || {}),
      urgency,
      requested_part_number: payload.requested_part_number || null,
      // T2: a request starts as a DRAFT. Publication is a separate, deliberate buyer action
      // (publishRfq) so nothing reaches the supplier marketplace on first save.
      rfq: { published: false, ...normalizeRfqIntent(payload) },
    },
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(ORDERS).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create buyer order: ${error.message}`);

  const lines = await replaceRequestLines(client, data, payload.lines, context);

  await appendAudit(client, {
    importOrderId: data.id, actorId: context.id, tenantId: data.tenant_id,
    action: 'BUYER_ORDER_CREATED', resourceType: 'diaspora_import_order', resourceId: data.id, newState: data, req,
  });
  return { ...data, request_lines: lines };
}

/**
 * Buyer sourcing intent that has no dedicated column and is genuinely request-scoped. Kept in
 * `metadata.rfq` alongside the existing published/publishedAt flags rather than widening the
 * orders table for presentational preferences.
 *
 * `discloseBudget` is the buyer's explicit consent to show their budget to suppliers — the safe
 * marketplace projection reads exactly this flag, so silence stays private.
 */
function normalizeRfqIntent(payload = {}) {
  const intent = {};
  if (payload.needed_by || payload.neededBy) intent.neededBy = payload.needed_by || payload.neededBy;
  if (payload.quote_deadline || payload.quoteDeadline) intent.quoteDeadline = payload.quote_deadline || payload.quoteDeadline;
  if (typeof payload.buyer_notes === 'string' && payload.buyer_notes.trim()) intent.buyerNotes = payload.buyer_notes.trim();
  if (typeof payload.buyerNotes === 'string' && payload.buyerNotes.trim()) intent.buyerNotes = payload.buyerNotes.trim();
  const disclose = payload.disclose_budget ?? payload.discloseBudget;
  if (typeof disclose === 'boolean') intent.discloseBudget = disclose;
  if (payload.urgency) intent.urgency = String(payload.urgency).toUpperCase();
  return intent;
}

const LINE_KINDS = ['vehicle', 'part', 'other'];
const LINE_CONDITIONS = ['new', 'used', 'oem', 'aftermarket', 'any'];

/**
 * Replace a request's line items (T2 multi-item sourcing).
 *
 * Lines are only accepted on a DRAFT request: once suppliers can see a request and may have quoted
 * against it, silently changing what was asked for would invalidate their offers. Returns [] when
 * the caller supplied no `lines` key at all, so single-item callers are entirely unaffected.
 */
export async function replaceRequestLines(client, order, rawLines, context) {
  if (!Array.isArray(rawLines)) return [];
  if (order.metadata?.rfq?.published) {
    throw new ValidationError('Request lines cannot be changed after the request is published');
  }
  await client.from(REQUEST_LINES).delete().eq('import_order_id', order.id);
  if (!rawLines.length) return [];

  // Authorize every vehicle linkage BEFORE writing anything, so a single unauthorized VIN cannot
  // leave a partially-written request behind. Refusal reasons map to governed statuses:
  // an unknown VIN is 404 (there is nothing to link), a real vehicle the caller has no authority
  // over is 403 (it exists, they may not use it), and a failed lookup is a refusal, never a pass.
  for (const [index, line] of rawLines.slice(0, 50).entries()) {
    const vin = String(line.linked_vehicle_vin ?? '').trim();
    if (!vin) continue;
    const authority = await resolveVehicleObjectAuthority(vin, context);
    if (authority.allowed) continue;
    if (authority.reason === 'not_found') {
      throw new NotFoundError(`Line ${index + 1}: that vehicle is not on record`);
    }
    throw new ForbiddenError(`Line ${index + 1}: you are not authorized to link that vehicle`);
  }

  const rows = rawLines.slice(0, 50).map((line, index) => {
    const description = String(line.item_description ?? line.description ?? '').trim();
    if (!description) throw new ValidationError(`Line ${index + 1} needs a description of what you are looking for`);
    const kind = LINE_KINDS.includes(line.item_kind) ? line.item_kind : 'part';
    const quantity = Number(line.quantity);
    const condition = LINE_CONDITIONS.includes(line.condition_preference) ? line.condition_preference : null;
    const partNumber = String(line.part_number ?? '').trim() || null;
    return {
      // Intake 2.0 — the vehicle/part preferences a supplier matches inventory against. They live
      // on the LINE because they describe the thing being sourced, and in columns because they are
      // exactly what a supplier filters by. Every one is optional; an unstated preference is null.
      ...normalizeLineIntake(line),
      import_order_id: order.id,
      tenant_id: order.tenant_id || null,
      line_number: index + 1,
      item_description: description.slice(0, 500),
      item_kind: kind,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
      vehicle_make: line.vehicle_make || null,
      vehicle_model: line.vehicle_model || null,
      vehicle_year_min: line.vehicle_year_min ?? null,
      vehicle_year_max: line.vehicle_year_max ?? null,
      linked_vehicle_vin: String(line.linked_vehicle_vin ?? '').trim() || null,
      part_number: partNumber,
      // Never inferred from a blank field: the buyer answers this question explicitly, and a
      // supplier reads "buyer does not know" as real information rather than missing data.
      part_number_known: line.part_number_known === true && Boolean(partNumber),
      condition_preference: condition,
      notes: line.notes ? String(line.notes).slice(0, 1000) : null,
      created_by: context.id,
      updated_by: context.id,
    };
  });

  const { data, error } = await client.from(REQUEST_LINES).insert(rows).select();
  if (error) throw new ValidationError(`Failed to save request lines: ${error.message}`);
  return data || [];
}

/**
 * Safe supplier identity on the offers a buyer is choosing between (T2 §9.9 / audit item 4).
 *
 * "Choose this supplier" is unanswerable without knowing WHO the supplier is. This attaches the
 * minimum commercial identity — display name, business type and country — from the canonical
 * user/registration authorities.
 *
 * Deliberately NOT attached: email, phone, tenant ids, internal risk fields, or any reputation
 * score (CarUp has no governed supplier reputation authority yet, and Vehicle Trust is not one).
 * A DRAFT quote is skipped: it is private to the supplier and is not an offer to the buyer.
 */
async function attachSupplierIdentity(client, quotes) {
  const offers = quotes.filter((q) => q.status !== 'DRAFT');
  const sellerIds = [...new Set(offers.map((q) => q.seller_id).filter(Boolean))];
  if (!sellerIds.length) return quotes;

  const [usersRes, profilesRes] = await Promise.all([
    client.from('users').select('id, name').in('id', sellerIds),
    client.from('user_registration_profiles')
      .select('user_id, organization_name, business_type, account_kind, country_of_residence')
      .in('user_id', sellerIds),
  ]);
  const nameById = new Map((usersRes.data || []).map((u) => [normalizeId(u.id), u.name || null]));
  const profileById = new Map((profilesRes.data || []).map((p) => [normalizeId(p.user_id), p]));

  return quotes.map((q) => {
    if (q.status === 'DRAFT' || !q.seller_id) return q;
    const profile = profileById.get(normalizeId(q.seller_id)) || null;
    return {
      ...q,
      supplier: {
        // A business trades under its organisation name; an individual under their own.
        display_name: profile?.organization_name || nameById.get(normalizeId(q.seller_id)) || null,
        business_type: profile?.business_type || null,
        account_kind: profile?.account_kind || null,
        country: profile?.country_of_residence || null,
        // Stated by the supplier at registration; CarUp has not verified it. Said plainly in the UI.
        verified: false,
      },
    };
  });
}

export async function listRequestLines(client, orderId) {
  const { data } = await client.from(REQUEST_LINES).select('*').eq('import_order_id', orderId).is('deleted_at', null);
  return (data || []).sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
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

  // A supplier's DRAFT offer is theirs until they submit it. `createQuote` already says so — "A
  // DRAFT is private to the supplier — only a real submission is news for the buyer" — but this
  // read returned every row, so a buyer could see an unsubmitted offer AND its amount. T3 filters
  // the equivalent list at its route (REQUESTER_VISIBLE); T2 did not, and a richer intake made the
  // omission easy to see. A supplier still sees their own draft here, and privileged readers see
  // everything, so nothing legitimate is hidden.
  const viewerIsPrivileged = isPlatformAdmin(context) || isPlatformReviewer(context);
  const readable = (quotes || []).filter((quote) => (
    String(quote.status || '').toUpperCase() !== 'DRAFT'
    || viewerIsPrivileged
    || normalizeId(quote.seller_id) === context.id
  ));
  const visibleQuotes = await attachSupplierIdentity(client, readable);
  return {
    ...order,
    quotes: visibleQuotes,
    request_lines: await listRequestLines(client, id),
    // The buyer-facing lifecycle step, derived from authoritative state (no new status column).
    rfq_lifecycle: deriveRfqLifecycle(order, visibleQuotes.filter((q) => q.status === 'ISSUED').length),
  };
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

  // Intake 2.0: the expanded intake is editable under the SAME rule as everything else here — the
  // accepted-quote refusal above still stands, so a supplier's offer can never end up describing
  // requirements that changed underneath it. Each value is re-validated rather than trusted, and
  // `previous` is passed so an omitted field keeps its stored answer instead of being blanked by a
  // partial payload.
  Object.assign(update, normalizeOrderIntake(payload, previous));

  if (['requested_make', 'requested_model', 'requested_year_min', 'requested_year_max'].some(field => field in payload)) {
    const nextMake = 'requested_make' in payload ? payload.requested_make : previous.requested_make;
    const nextModel = 'requested_model' in payload ? payload.requested_model : previous.requested_model;
    const nextYearMin = 'requested_year_min' in payload ? payload.requested_year_min : previous.requested_year_min;
    const nextYearMax = 'requested_year_max' in payload ? payload.requested_year_max : previous.requested_year_max;
    const taxonomy = normalizeVehicleTaxonomyInput({ make: nextMake, model: nextModel, year: nextYearMin });
    update.requested_make_taxon_id = taxonomy.make.canonical_id;
    update.requested_model_taxon_id = taxonomy.model.canonical_id;
    update.taxonomy_version = taxonomy.taxonomy_version;
    update.taxonomy_resolution = { make: taxonomy.make.state, model: taxonomy.model.state, year: taxonomy.year.state };
    update.taxonomy_source_values = { make: nextMake || null, model: nextModel || null, year_min: nextYearMin ?? null, year_max: nextYearMax ?? null };
    update.taxonomized_at = new Date().toISOString();
  }
  const rfqIntent = normalizeRfqIntent(payload);
  if (payload.metadata || payload.urgency || payload.requested_part_number || Object.keys(rfqIntent).length) {
    update.metadata = {
      ...(previous.metadata || {}),
      ...(payload.metadata || {}),
      ...(payload.urgency ? { urgency: String(payload.urgency).toUpperCase() } : {}),
      ...(payload.requested_part_number ? { requested_part_number: payload.requested_part_number } : {}),
      // Preserve the authoritative publication/award flags; only sourcing intent is editable here.
      rfq: { ...(previous.metadata?.rfq || { published: false }), ...rfqIntent },
    };
  }

  const { data, error } = await client.from(ORDERS).update(update).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to update buyer order: ${error.message}`);
  const lines = Array.isArray(payload.lines)
    ? await replaceRequestLines(client, data, payload.lines, context)
    : await listRequestLines(client, id);
  await appendAudit(client, { importOrderId: id, actorId: context.id, tenantId: data.tenant_id, action: 'BUYER_ORDER_UPDATED', resourceType: 'diaspora_import_order', resourceId: id, previousState: previous, newState: data, req });
  return { ...data, request_lines: lines };
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
  // Tell the winner AND the suppliers who were not selected — silence leaves them chasing a closed
  // request. Skipped on an idempotent replay so a retry never re-notifies.
  if (!data.idempotentReplay && data.acceptedQuote) {
    const order = data.order || {};
    await notifyQuoteAccepted({ order, quote: data.acceptedQuote, tenantId: order.tenant_id });
    const { data: siblings } = await client.from(QUOTES).select('*').eq('import_order_id', orderId).is('deleted_at', null);
    await notifyQuoteNotSelected({ order, quotes: siblings || [], acceptedQuoteId: data.acceptedQuote.id, tenantId: order.tenant_id });
  }
  return { order: data.order, acceptedQuote: data.acceptedQuote, idempotentReplay: Boolean(data.idempotentReplay) };
}
