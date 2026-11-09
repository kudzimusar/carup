import { supabase } from '../../db/supabase.js';
import { normalizeVehicleTaxonomyInput } from '../taxonomy/vehicleTaxonomyService.js';
import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateImportOrderPayload, validatePaymentMilestonePayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { notifyDiasporaMilestone } from './diasporaNotificationService.js';
import { assertTransitionAllowed, transitionImportOrder } from './diasporaWorkflowService.js';
import { assertCanReadImportOrder, assertCanTransitionImportOrder, isAssignedParticipant, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId, requireUserContext } from './diasporaAuthorization.js';

function cleanOrderPayload(payload, userContext) {
  validateImportOrderPayload(payload);
  const taxonomy = normalizeVehicleTaxonomyInput({
    make: payload.requested_make,
    model: payload.requested_model,
    year: payload.requested_year_min,
  });
  return {
    tenant_id: userContext?.tenantId || payload.tenant_id || null,
    buyer_id: payload.buyer_id || userContext?.id || null,
    order_type: payload.order_type,
    origin_country: payload.origin_country,
    origin_city: payload.origin_city || null,
    destination_country: payload.destination_country || 'Zimbabwe',
    destination_city: payload.destination_city || null,
    requested_make: payload.requested_make || null,
    requested_model: payload.requested_model || null,
    requested_year_min: payload.requested_year_min || null,
    requested_year_max: payload.requested_year_max || null,
    requested_make_taxon_id: taxonomy.make.canonical_id,
    requested_model_taxon_id: taxonomy.model.canonical_id,
    taxonomy_version: taxonomy.taxonomy_version,
    taxonomy_resolution: {
      make: taxonomy.make.state,
      model: taxonomy.model.state,
      year: taxonomy.year.state,
    },
    taxonomy_source_values: {
      make: payload.requested_make || null,
      model: payload.requested_model || null,
      year_min: payload.requested_year_min || null,
      year_max: payload.requested_year_max || null,
    },
    taxonomized_at: new Date().toISOString(),
    budget_amount: payload.budget_amount || null,
    budget_currency: payload.budget_currency || 'USD',
    auction_lot_number: payload.auction_lot_number || null,
    chassis_number: payload.chassis_number || null,
    vin: payload.vin || null,
    status: IMPORT_ORDER_STATUSES.IMPORT_REQUESTED,
    metadata: payload.metadata || {},
    created_by: userContext?.id || payload.created_by || null,
    updated_by: userContext?.id || payload.updated_by || null,
  };
}

export async function createImportOrder(payload, userContext = {}, req = null) {
  const orderPayload = cleanOrderPayload(payload, userContext);
  const { data, error } = await supabase
    .from('diaspora_import_orders')
    .insert(orderPayload)
    .select()
    .single();

  if (error) throw new DatabaseError(error.message);

  const taxonomyObservations = [
    ['make', orderPayload.taxonomy_resolution?.make, orderPayload.taxonomy_source_values?.make],
    ['model', orderPayload.taxonomy_resolution?.model, orderPayload.taxonomy_source_values?.model],
    ['year', orderPayload.taxonomy_resolution?.year, orderPayload.taxonomy_source_values?.year_min],
  ].filter(([, state, raw]) => state === 'unrecognized' && raw !== null && raw !== undefined)
    .map(([dimension, _state, raw]) => ({
      dimension,
      raw_value: String(raw),
      source_type: 'import',
      source_reference: data.id,
      taxonomy_version: orderPayload.taxonomy_version,
      review_status: 'unresolved',
    }));
  if (taxonomyObservations.length) {
    const { error: observationError } = await supabase.from('vehicle_taxonomy_observations').insert(taxonomyObservations);
    if (observationError) console.warn('Diaspora taxonomy observation could not be recorded:', observationError.message);
  }

  await writeDiasporaAudit({
    importOrderId: data.id,
    tenantId: data.tenant_id,
    actorId: userContext?.id,
    action: 'IMPORT_ORDER_CREATED',
    resourceType: 'diaspora_import_order',
    resourceId: data.id,
    newState: data,
    req,
  });

  await notifyDiasporaMilestone({
    eventType: 'DIASPORA_IMPORT_ORDER_CREATED',
    importOrder: data,
    actorId: userContext?.id,
    title: 'Import request created',
    message: 'Your CarUp diaspora import request has been created and is ready for coordination.',
  });

  return data;
}

export async function listImportOrders({ userContext = {}, status, limit = 50, offset = 0 }) {
  let query = supabase
    .from('diaspora_import_orders')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (userContext?.tenantId) query = query.eq('tenant_id', userContext.tenantId);
  if (!userContext?.tenantId && userContext?.role !== 'admin' && userContext?.role !== 'government') {
    query = query.or(`buyer_id.eq.${userContext?.id},created_by.eq.${userContext?.id}`);
  }

  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getImportOrderParticipants(importOrderId) {
  const { data, error } = await supabase
    .from('diaspora_import_order_participants')
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);

  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getImportOrder(id, userContext = {}) {
  const context = requireUserContext(userContext);
  const { data, error } = await supabase
    .from('diaspora_import_orders')
    .select('*, diaspora_import_order_participants(*), diaspora_import_quotes(*), diaspora_trade_documents(*), diaspora_cargo_reservations(*), diaspora_shipments(*), diaspora_compliance_reviews(*), diaspora_payment_milestones(*)')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new NotFoundError('Diaspora import order not found');
  const participants = data.diaspora_import_order_participants || await getImportOrderParticipants(id);
  assertCanReadImportOrder(data, participants, context);
  return { ...data, diaspora_import_order_participants: participants };
}

/** Participant roles that act for the SELL side of an import order (schema CHECK vocabulary). */
export const SELLER_PARTICIPANT_ROLES = new Set(['seller', 'exporter', 'dealer', 'company']);

/**
 * Who may put a seller on an order: platform review/admin staff, or an admin of the ORDER's tenant.
 * Seller assignment is what later lets a seller quote, so an unauthorised assignment would make
 * every downstream seller-authority check forgeable. Server-derived roles only.
 */
function isOrderOperator(order, context) {
  return isPlatformReviewer(context) || isPlatformAdmin(context) || isTenantAdminForRecord(order, context);
}

/**
 * The BUYER of an order — buyer_id, else its creator. Deliberately stricter than isOrderOwner, which
 * also matches `updated_by`: a seller's own status transition stamps updated_by, and must not turn
 * that seller into "the buyer" for self-dealing checks.
 */
function isOrderBuyer(order, userId) {
  const id = normalizeId(userId);
  if (!id) return false;
  return [order.buyer_id, order.buyerId, order.created_by, order.createdBy].some((c) => normalizeId(c) === id);
}

function activeSellerParticipants(participants = []) {
  return participants.filter((p) => SELLER_PARTICIPANT_ROLES.has(String(p.participant_role ?? p.role ?? '').toLowerCase()));
}

export async function assignSeller(importOrderId, { sellerId, roleType = 'seller', notes = null }, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  if (!sellerId) throw new ValidationError('sellerId is required');
  if (!SELLER_PARTICIPANT_ROLES.has(String(roleType).toLowerCase())) {
    throw new ValidationError('roleType must be a seller-side participant role', { code: 'INVALID_SELLER_ROLE', allowed: [...SELLER_PARTICIPANT_ROLES] });
  }

  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  // Authorise BEFORE writing anything. This route used to insert the participant first and only
  // meet an authority check (inside the status transition) afterwards — or none at all when the
  // order was already SELLER_ASSIGNED.
  if (!isOrderOperator(order, context)) {
    throw new ForbiddenError('Only a platform operator or this order\'s tenant admin may assign a seller', { code: 'SELLER_ASSIGNMENT_FORBIDDEN' });
  }
  if (isOrderBuyer(order, sellerId)) {
    throw new ValidationError('The buyer on an order cannot be assigned as its seller', { code: 'SELF_DEALING_REFUSED' });
  }
  if (order.status !== IMPORT_ORDER_STATUSES.SELLER_ASSIGNED) {
    assertTransitionAllowed(order.status, IMPORT_ORDER_STATUSES.SELLER_ASSIGNED);
  }

  const { data: participant, error } = await supabase
    .from('diaspora_import_order_participants')
    .insert({
      import_order_id: importOrderId,
      tenant_id: order.tenant_id,
      user_id: sellerId,
      participant_role: roleType,
      notes,
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await writeDiasporaAudit({
    importOrderId,
    tenantId: order.tenant_id,
    actorId: userContext?.id,
    action: 'SELLER_ASSIGNED',
    resourceType: 'diaspora_import_order_participant',
    resourceId: participant.id,
    previousState: { status: order.status },
    newState: participant,
    req,
  });

  const updatedOrder = order.status === IMPORT_ORDER_STATUSES.SELLER_ASSIGNED
    ? order
    : await transitionImportOrder({ importOrderId, nextStatus: IMPORT_ORDER_STATUSES.SELLER_ASSIGNED, actorId: userContext?.id, userContext, metadata: { sellerId }, req });

  await notifyDiasporaMilestone({
    eventType: 'DIASPORA_SELLER_ASSIGNED',
    importOrder: updatedOrder,
    actorId: userContext?.id,
    title: 'Seller assigned',
    message: 'A verified diaspora seller/export participant has been assigned to your import order.',
    metadata: { sellerId },
  });

  return { order: updatedOrder, participant };
}

/**
 * Legacy quote write, now authorised BEFORE any mutation.
 *
 * The defect this closes: the route was guarded by authentication only, and this function inserted
 * the quote first — with `seller_id` taken from the request body — and met an authority check only
 * inside the later status transition, which was skipped entirely when the order was already
 * QUOTE_ISSUED. Any signed-in user could therefore put a complete quote on someone else's order in
 * any seller's name, and an accepted quote is SafeTrade's commercial authority (T13).
 *
 * Now:
 *   - the seller is derived by the server: an active seller-side participant of THIS order quotes as
 *     themselves; a body `seller_id` naming anyone else is refused, never substituted;
 *   - a platform operator or the order's own tenant admin may record a quote only on behalf of a seller
 *     who is an active seller-side participant of this order;
 *   - the buyer cannot quote their own order; everyone else is refused (cross-tenant included);
 *   - amount must be positive and currency a three-letter code — no defaulting to USD;
 *   - the status transition is authorised and validated before the insert.
 * Every refusal happens before any write, so a refused request mutates nothing.
 */
export async function addQuote(importOrderId, payload = {}, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  const actorId = normalizeId(context.id ?? context.userId);

  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');
  const participants = await getImportOrderParticipants(importOrderId);
  const sellerParticipants = activeSellerParticipants(participants);
  const assertedSellerId = normalizeId(payload.seller_id ?? payload.sellerId);

  let sellerId;
  if (isOrderBuyer(order, actorId)) {
    throw new ForbiddenError('The buyer cannot quote their own import order', { code: 'QUOTE_FORBIDDEN' });
  } else if (isAssignedParticipant(sellerParticipants, context)) {
    if (assertedSellerId && assertedSellerId !== actorId) {
      throw new ForbiddenError('A seller can only quote as themselves', { code: 'QUOTE_SELLER_FORGED' });
    }
    sellerId = actorId;
  } else if (isOrderOperator(order, context)) {
    if (!assertedSellerId || !isAssignedParticipant(sellerParticipants, { id: assertedSellerId })) {
      throw new ValidationError('An operator may only record a quote for a seller assigned to this order', { code: 'QUOTE_SELLER_NOT_ASSIGNED' });
    }
    sellerId = assertedSellerId;
  } else {
    throw new ForbiddenError('You are not authorised to quote on this import order', { code: 'QUOTE_FORBIDDEN' });
  }

  const amount = Number(payload.quote_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('quote_amount must be a positive number', { code: 'QUOTE_AMOUNT_INVALID' });
  }
  const currency = String(payload.quote_currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('quote_currency must be a three-letter currency code', { code: 'QUOTE_CURRENCY_INVALID' });
  }

  const needsTransition = order.status !== IMPORT_ORDER_STATUSES.QUOTE_ISSUED;
  if (needsTransition) {
    assertTransitionAllowed(order.status, IMPORT_ORDER_STATUSES.QUOTE_ISSUED);
    assertCanTransitionImportOrder(order, participants, IMPORT_ORDER_STATUSES.QUOTE_ISSUED, context);
  }

  const { data: quote, error } = await supabase
    .from('diaspora_import_quotes')
    .insert({
      import_order_id: importOrderId,
      tenant_id: order.tenant_id,
      seller_id: sellerId,
      quote_amount: amount,
      quote_currency: currency,
      valid_until: payload.valid_until || null,
      inclusions: payload.inclusions || [],
      exclusions: payload.exclusions || [],
      metadata: payload.metadata || {},
      created_by: actorId,
      updated_by: actorId,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  let updatedOrder = order;
  try {
    await writeDiasporaAudit({
      importOrderId,
      tenantId: order.tenant_id,
      actorId,
      action: 'QUOTE_ISSUED',
      resourceType: 'diaspora_import_quote',
      resourceId: quote.id,
      newState: quote,
      req,
    });
    if (needsTransition) {
      updatedOrder = await transitionImportOrder({ importOrderId, nextStatus: IMPORT_ORDER_STATUSES.QUOTE_ISSUED, actorId, userContext: context, metadata: { quoteId: quote.id }, req });
    }
  } catch (err) {
    // Pre-checks passed, so this is a race or an infrastructure failure. Do not leave a quote
    // standing that its own issuance could not complete: retire it, then surface the error.
    await supabase.from('diaspora_import_quotes').update({ deleted_at: new Date().toISOString(), updated_by: actorId }).eq('id', quote.id);
    throw err;
  }

  return { order: updatedOrder, quote };
}

/** Milestone statuses that still count against the order's payment allocation. */
const ACTIVE_MILESTONE_STATUSES = new Set(['PENDING', 'CONFIRMED']);

/**
 * A NON-privileged caller may only create milestones in the initial 'PENDING' status — clients must
 * never mint final/confirmed payment states (a milestone is only evidence-of-declaration, and a
 * client-supplied CONFIRMED would fabricate payment history). Trusted platform admins/reviewers
 * (server-derived platformRole only) may pass any validated enum status, e.g. when importing a
 * historical CONFIRMED record. Throws ForbiddenError code MILESTONE_STATUS_FORBIDDEN.
 */
function assertMilestoneStatusAllowed(payload, userContext) {
  if (!payload.status || payload.status === 'PENDING') return;
  if (isPlatformAdmin(userContext) || isPlatformReviewer(userContext)) return;
  const error = new ForbiddenError(
    'New payment milestones must start as PENDING — only platform admins/reviewers may record a non-PENDING milestone status',
    { requestedStatus: payload.status },
  );
  error.code = 'MILESTONE_STATUS_FORBIDDEN';
  throw error;
}

/**
 * Rows for an order-embedded relation. getImportOrder's select embeds these arrays in production;
 * fall back to a direct query when the embed is absent (defensive, and how the in-memory test
 * harness resolves them).
 */
async function loadOrderRelation(order, table) {
  const embedded = order?.[table];
  if (Array.isArray(embedded)) return embedded.filter((row) => !row.deleted_at);
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('import_order_id', order.id)
    .is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

/**
 * The over-allocation cap for new milestones: the ACCEPTED quote's quote_amount when one exists
 * (quote acceptance rejects all sibling ISSUED quotes, so at most one is ACCEPTED), else the
 * order's budget_amount when set, else no cap.
 */
async function resolveMilestoneCap(order) {
  const quotes = await loadOrderRelation(order, 'diaspora_import_quotes');
  const acceptedQuote = quotes.find((quote) => quote.status === 'ACCEPTED');
  if (acceptedQuote) {
    return { cap: Number(acceptedQuote.quote_amount), capCurrency: acceptedQuote.quote_currency || 'USD', capSource: 'ACCEPTED_QUOTE' };
  }
  if (order.budget_amount !== null && order.budget_amount !== undefined) {
    return { cap: Number(order.budget_amount), capCurrency: order.budget_currency || 'USD', capSource: 'ORDER_BUDGET' };
  }
  return null;
}

/**
 * Cumulative-amount guard, applied to ALL callers (privileged included): existing active
 * (PENDING/CONFIRMED, not soft-deleted) milestones plus the new amount must not exceed the cap
 * from resolveMilestoneCap. CANCELLED/WAIVED/FAILED milestones do not count. Currency is compared,
 * never converted (kept deliberately simple): the check only sums existing active milestones in the
 * new milestone's currency, and is skipped entirely — recording a metadata note instead — when an
 * existing active milestone or the cap itself is in a different currency, since summing mixed
 * currencies would produce a meaningless total. Throws ValidationError code
 * MILESTONE_OVER_ALLOCATION with details { cap, cumulative, existing } when the cap is exceeded.
 * Returns { note } (note = null when the cap check fully applied).
 */
async function assertMilestoneWithinAllocation(order, payload) {
  const newCurrency = payload.currency || 'USD';
  const milestones = await loadOrderRelation(order, 'diaspora_payment_milestones');
  const activeMilestones = milestones.filter((milestone) => ACTIVE_MILESTONE_STATUSES.has(milestone.status));

  if (activeMilestones.some((milestone) => (milestone.currency || 'USD') !== newCurrency)) {
    return { note: 'OVER_ALLOCATION_CHECK_SKIPPED_MIXED_MILESTONE_CURRENCIES' };
  }

  const capInfo = await resolveMilestoneCap(order);
  if (!capInfo) return { note: null };
  if (capInfo.capCurrency !== newCurrency) {
    return { note: `OVER_ALLOCATION_CHECK_SKIPPED_CAP_CURRENCY_MISMATCH_${capInfo.capSource}` };
  }

  const existing = activeMilestones.reduce((sum, milestone) => sum + Number(milestone.amount), 0);
  const cumulative = existing + Number(payload.amount);
  if (cumulative > capInfo.cap) {
    const error = new ValidationError(
      `Cumulative milestone amount ${newCurrency} ${cumulative} would exceed the ${capInfo.capSource === 'ACCEPTED_QUOTE' ? 'accepted quote' : 'order budget'} cap of ${newCurrency} ${capInfo.cap}`,
      { cap: capInfo.cap, cumulative, existing },
    );
    error.code = 'MILESTONE_OVER_ALLOCATION';
    throw error;
  }
  return { note: null };
}

/**
 * A payment milestone is a non-custodial reference record — the buyer/seller declaring that an
 * off-platform payment step happened or is due. CarUp never moves money here (see
 * diaspora_safetrade_milestones for the separate, fail-closed sandbox-only escrow overlay).
 *
 * Authorization now reuses getImportOrder's own access gate (order owner, assigned participant,
 * tenant admin, or platform admin/reviewer) — previously ANY authenticated user could add a
 * milestone to ANY order regardless of access. Idempotent on (import_order_id, idempotency_key)
 * when a key is supplied, so a retried submit cannot create a duplicate financial record; the
 * replay short-circuit runs before the allocation guard so a retried submit of an already-recorded
 * milestone returns the original instead of tripping the cap against itself. Non-privileged callers
 * can only create PENDING milestones (assertMilestoneStatusAllowed) and every caller is bound by
 * the cumulative allocation cap (assertMilestoneWithinAllocation).
 */
export async function addPaymentMilestone(importOrderId, payload, userContext = {}, req = null) {
  validatePaymentMilestonePayload(payload);
  const order = await getImportOrder(importOrderId, userContext);
  assertMilestoneStatusAllowed(payload, userContext);

  if (payload.idempotency_key) {
    const { data: existing, error: existingError } = await supabase
      .from('diaspora_payment_milestones')
      .select('*')
      .eq('import_order_id', importOrderId)
      .eq('idempotency_key', payload.idempotency_key)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingError) throw new DatabaseError(existingError.message);
    if (existing) return existing;
  }

  const allocation = await assertMilestoneWithinAllocation(order, payload);
  const milestoneMetadata = allocation.note
    ? { ...(payload.metadata || {}), allocation_note: allocation.note }
    : payload.metadata || {};

  const { data, error } = await supabase
    .from('diaspora_payment_milestones')
    .insert({
      import_order_id: importOrderId,
      tenant_id: order.tenant_id,
      milestone_type: payload.milestone_type,
      amount: payload.amount,
      currency: payload.currency || 'USD',
      due_date: payload.due_date || null,
      status: payload.status || 'PENDING',
      external_reference: payload.external_reference || null,
      idempotency_key: payload.idempotency_key || null,
      metadata: milestoneMetadata,
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await writeDiasporaAudit({ importOrderId, tenantId: order.tenant_id, actorId: userContext?.id, action: 'PAYMENT_MILESTONE_CREATED', resourceType: 'diaspora_payment_milestone', resourceId: data.id, newState: data, req });
  await notifyDiasporaMilestone({
    eventType: 'DIASPORA_PAYMENT_MILESTONE_CREATED',
    importOrder: order,
    actorId: userContext?.id,
    title: 'Payment milestone recorded',
    message: `A ${data.milestone_type.toLowerCase().replace(/_/g, ' ')} milestone of ${data.currency} ${data.amount} has been recorded for your import order. This is a reference record only — CarUp does not process this payment.`,
    metadata: { milestoneId: data.id, milestoneType: data.milestone_type, amount: data.amount, currency: data.currency },
  });
  return data;
}

export async function linkVehicleImportRecord(importOrderId, payload, userContext = {}, req = null) {
  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', importOrderId).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  if (payload.vehicle_vin && payload.verification_status !== 'VERIFIED') {
    throw new ValidationError('Cannot link a vehicle VIN until import identity is verified.');
  }

  const { data, error } = await supabase
    .from('vehicle_import_records')
    .insert({
      import_order_id: importOrderId,
      tenant_id: order.tenant_id,
      vehicle_vin: payload.vehicle_vin || null,
      chassis_number: payload.chassis_number || order.chassis_number || null,
      origin_country: order.origin_country,
      export_port: payload.export_port || null,
      import_port: payload.import_port || null,
      import_date: payload.import_date || null,
      verification_status: payload.verification_status || 'PENDING_REVIEW',
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  if (payload.vehicle_vin) {
    const { error: updateError } = await supabase
      .from('diaspora_import_orders')
      .update({ linked_vehicle_vin: payload.vehicle_vin, updated_by: userContext?.id, updated_at: new Date().toISOString() })
      .eq('id', importOrderId);
    if (updateError) throw new DatabaseError(updateError.message);
  }

  await writeDiasporaAudit({ importOrderId, tenantId: order.tenant_id, actorId: userContext?.id, action: 'VEHICLE_IMPORT_RECORD_LINKED', resourceType: 'vehicle_import_record', resourceId: data.id, newState: data, req });
  return data;
}
