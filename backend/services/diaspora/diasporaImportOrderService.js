import { supabase } from '../../db/supabase.js';
import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateImportOrderPayload, validatePaymentMilestonePayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { notifyDiasporaMilestone } from './diasporaNotificationService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { assertCanReadImportOrder, requireUserContext } from './diasporaAuthorization.js';

function cleanOrderPayload(payload, userContext) {
  validateImportOrderPayload(payload);
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
  if (!sellerId) throw new ValidationError('sellerId is required');

  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

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

export async function addQuote(importOrderId, payload, userContext = {}, req = null) {
  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  const { data: quote, error } = await supabase
    .from('diaspora_import_quotes')
    .insert({
      import_order_id: importOrderId,
      tenant_id: order.tenant_id,
      seller_id: payload.seller_id || null,
      quote_amount: payload.quote_amount,
      quote_currency: payload.quote_currency || 'USD',
      valid_until: payload.valid_until || null,
      inclusions: payload.inclusions || [],
      exclusions: payload.exclusions || [],
      metadata: payload.metadata || {},
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
    action: 'QUOTE_ISSUED',
    resourceType: 'diaspora_import_quote',
    resourceId: quote.id,
    newState: quote,
    req,
  });

  const updatedOrder = order.status === IMPORT_ORDER_STATUSES.QUOTE_ISSUED
    ? order
    : await transitionImportOrder({ importOrderId, nextStatus: IMPORT_ORDER_STATUSES.QUOTE_ISSUED, actorId: userContext?.id, userContext, metadata: { quoteId: quote.id }, req });

  return { order: updatedOrder, quote };
}

/**
 * A payment milestone is a non-custodial reference record — the buyer/seller declaring that an
 * off-platform payment step happened or is due. CarUp never moves money here (see
 * diaspora_safetrade_milestones for the separate, fail-closed sandbox-only escrow overlay).
 *
 * Authorization now reuses getImportOrder's own access gate (order owner, assigned participant,
 * tenant admin, or platform admin/reviewer) — previously ANY authenticated user could add a
 * milestone to ANY order regardless of access. Idempotent on (import_order_id, idempotency_key)
 * when a key is supplied, so a retried submit cannot create a duplicate financial record.
 */
export async function addPaymentMilestone(importOrderId, payload, userContext = {}, req = null) {
  validatePaymentMilestonePayload(payload);
  const order = await getImportOrder(importOrderId, userContext);

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
      metadata: payload.metadata || {},
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
