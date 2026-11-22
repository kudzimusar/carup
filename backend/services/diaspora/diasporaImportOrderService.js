import { supabase } from '../../db/supabase.js';
import { normalizeVehicleTaxonomyInput } from '../taxonomy/vehicleTaxonomyService.js';
import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { CarUpError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateImportOrderPayload, validatePaymentMilestonePayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { notifyDiasporaMilestone, queueDiasporaNotification } from './diasporaNotificationService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { assertCanReadImportOrder, assertCanTransitionImportOrder, isOrderOwner, isTenantAdminForRecord, isPlatformAdmin, isPlatformReviewer, requireUserContext } from './diasporaAuthorization.js';

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
  const context = requireUserContext(userContext);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Import order payload must be an object');
  }
  // B18: buyer and tenant identities are derived from the signed-in session,
  // not client JSON. No privileged on-behalf creation without a separate approved contract.
  if (payload.buyer_id != null && String(payload.buyer_id) !== context.id) {
    throw new ForbiddenError("Cannot create another buyer's import order");
  }
  if (payload.tenant_id != null && String(payload.tenant_id) !== String(context.tenantId)) {
    throw new ForbiddenError('Cannot create an import order for another tenant');
  }
  const orderPayload = cleanOrderPayload(payload, context);
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

export async function assignSeller(importOrderId, { sellerId, roleType = 'seller', notes = null }, userContext = {}, req = null) {
  const context = requireUserContext(userContext);
  if (!sellerId) throw new ValidationError('sellerId is required');
  // Defense in depth: the PostgreSQL function repeats every authority check under lock.
  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders').select('*').eq('id', importOrderId)
    .is('deleted_at', null).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');
  if (!(isPlatformReviewer(context) || isTenantAdminForRecord(order, context) || isOrderOwner(order, context))) {
    throw new ForbiddenError('You are not authorized to assign a seller to this import order');
  }
  if (!['IMPORT_REQUESTED','QUOTE_ISSUED','SELLER_ASSIGNED'].includes(order.status)) {
    throw new ValidationError('The order cannot accept seller assignments in its current state');
  }
  const { data, error } = await supabase.rpc('diaspora_assign_import_seller_atomic', {
    p_order_id: importOrderId,
    p_actor_id: context.id,
    p_seller_id: String(sellerId),
    p_role_type: roleType,
    p_notes: notes,
    p_ip_address: req?.ip || null,
    p_user_agent: req?.headers?.['user-agent'] || null,
  });
  if (error) {
    const code = String(error.code || '');
    const message = String(error.message || '');
    if (code === '42501' || /RX06_ASSIGN_(ORDER_ACCESS_DENIED|AUTH_REQUIRED|SELF_SELLER_DENIED)/.test(message))
      throw new ForbiddenError('You are not authorized to assign this seller');
    if (code === 'P0002') throw new NotFoundError('Diaspora import order not found');
    if (code === '22023') throw new ValidationError('Invalid seller assignment or order state');
    throw new DatabaseError('Atomic import seller assignment could not be recorded');
  }
  if (!data?.order || !data?.participant) throw new DatabaseError('Atomic assignment returned an invalid receipt');
  // The RPC durably appends the domain events (outbox) in the same transaction as the participant,
  // status change and audits. The buyer notifications below mirror the pre-R2 notifyDiasporaMilestone
  // calls exactly (best-effort, after commit, never for a replay), so no behaviour is silently lost.
  if (!data.idempotentReplay) {
    const buyer = data.order.buyer_id || data.order.created_by;
    if (data.statusChanged) {
      await queueBuyerNotification({
        recipientId: buyer, importOrderId: data.order.id, type: 'DIASPORA_SELLER_ASSIGNED',
        title: 'Import order seller assigned',
        message: `Your CarUp diaspora import order has moved from ${data.previousStatus} to SELLER_ASSIGNED.`,
        metadata: { sellerId: String(sellerId) },
      });
    }
    await queueBuyerNotification({
      recipientId: buyer, importOrderId: data.order.id, type: 'DIASPORA_SELLER_ASSIGNED',
      title: 'Seller assigned',
      message: 'A verified diaspora seller/export participant has been assigned to your import order.',
      metadata: { sellerId: String(sellerId) },
    });
  }
  return { order: data.order, participant: data.participant, idempotentReplay: Boolean(data.idempotentReplay) };
}

/** Best-effort, post-commit buyer notification — same channels and failure handling as before R2. */
async function queueBuyerNotification({ recipientId, importOrderId, type, title, message, metadata }) {
  try {
    await queueDiasporaNotification({
      recipientId, type, title, message, importOrderId,
      channels: ['IN_APP', 'EMAIL_READY', 'SMS_READY', 'WHATSAPP_READY', 'PUSH_READY'],
      metadata,
    });
  } catch (err) {
    console.warn('Diaspora buyer notification skipped:', err?.message);
  }
}

/**
 * R6-F13 / C03 quotation command key. A quotation is a command that must not be duplicated by a
 * network retry or a double click, so every HTTP quotation carries a client-generated key that the
 * client REUSES when it retries the same quotation. A missing or malformed key is refused before
 * any database read or write.
 */
export const QUOTE_COMMAND_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function requireQuoteCommandKey(req) {
  const raw = req?.headers?.['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new CarUpError(
      'An Idempotency-Key header is required to issue a quotation. Generate one key per quotation and reuse it when retrying.',
      400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const key = String(value).trim();
  if (!QUOTE_COMMAND_KEY_PATTERN.test(key)) {
    throw new CarUpError(
      'The Idempotency-Key must be 8 to 128 characters: letters, digits, dot, underscore, colon or hyphen.',
      400, 'IDEMPOTENCY_KEY_INVALID');
  }
  return key;
}

export async function addQuote(importOrderId, payload, userContext = {}, req = null) {
  // R6-F13: authoritative pre-write guard even when an order is already
  // QUOTE_ISSUED. The SQL RPC independently re-verifies authority under lock.
  const context = requireUserContext(userContext);
  const commandKey = requireQuoteCommandKey(req); // C03: refused before any database access
  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');
  const participants = await getImportOrderParticipants(importOrderId);
  assertCanReadImportOrder(order, participants, context);
  assertCanTransitionImportOrder(order, participants, IMPORT_ORDER_STATUSES.QUOTE_ISSUED, context);

  // Never let an ordinary participant impersonate another seller.
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context)
      && payload?.seller_id && String(payload.seller_id) !== context.id) {
    throw new ForbiddenError('You may not issue a quote in another seller\'s name');
  }
  const quoteInput = {
    seller_id: payload?.seller_id ?? null,
    quote_amount: payload?.quote_amount,
    quote_currency: payload?.quote_currency ?? 'USD',
    valid_until: payload?.valid_until ?? null,
    inclusions: payload?.inclusions ?? [],
    exclusions: payload?.exclusions ?? [],
    metadata: payload?.metadata ?? {},
  };
  // One PostgREST RPC call is one PostgreSQL transaction. Quote, status,
  // mandatory audits, and optional replay receipt either ALL commit or ALL roll back.
  const { data, error } = await supabase.rpc('diaspora_issue_import_quote_atomic', {
    p_order_id: importOrderId,
    p_actor_id: context.id,
    p_quote: quoteInput,
    p_command_key: commandKey,
    p_ip_address: req?.ip || null,
    p_user_agent: req?.headers?.['user-agent'] || null,
  });
  if (error) {
    const code = String(error.code || '');
    const message = String(error.message || '');
    if (code === '42501' || /RX06_QUOTE_(ORDER_ACCESS_DENIED|SELLER_SPOOFING|SELLER_NOT_ASSIGNED|AUTH_REQUIRED)/.test(message))
      throw new ForbiddenError('You are not authorized to issue this import quotation');
    if (code === 'P0002') throw new NotFoundError('Diaspora import order or quote not found');
    if (code === '23505') {
      throw new CarUpError('This Idempotency-Key was already used for a different quotation. Use a new key for a new quotation.',
        409, 'IDEMPOTENCY_KEY_CONFLICT');
    }
    if (code === '22023' || code === '22007') throw new ValidationError(message);
    throw new DatabaseError('Atomic import quotation could not be recorded');
  }
  if (!data?.order || !data?.quote) throw new DatabaseError('Atomic import quotation returned an invalid receipt');

  // The RPC writes the durable quote event into domain_events in the same transaction.
  // Do not emit an additional event from the application or replayed request. The buyer
  // notification mirrors the pre-R2 transition notification (best-effort, post-commit,
  // only when the status actually changed, never for a replay).
  if (!data.idempotentReplay && data.statusChanged) {
    await queueBuyerNotification({
      recipientId: data.order.buyer_id || data.order.created_by, importOrderId: data.order.id,
      type: 'DIASPORA_QUOTE_ISSUED', title: 'Import order quote issued',
      message: `Your CarUp diaspora import order has moved from ${data.previousStatus} to QUOTE_ISSUED.`,
      metadata: { quoteId: data.quote.id },
    });
  }
  return { order: data.order, quote: data.quote, idempotentReplay: Boolean(data.idempotentReplay) };
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
