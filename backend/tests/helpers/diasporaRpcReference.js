/**
 * JS reference implementations of the Diaspora hardening RPCs, used ONLY by the in-memory mock in
 * tests. Each mirrors the invariants of the corresponding SQL function so service-level tests
 * exercise the real contract (validation, idempotency, balance/capacity rules, audit, all-or-nothing
 * rollback). True row-locking concurrency is proven against a real PostgreSQL instance in the
 * staging integration suite (H7/H9); these references prove the contract sequentially.
 *
 * Keep these in lockstep with:
 *   database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql
 *   database/migrations/20260621091000_diaspora_h2_quote_acceptance_rpc.sql
 *   database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql
 */
import crypto from 'crypto';

function seal(actorId, action, resourceType, resourceId, ts) {
  return crypto.createHash('sha256').update(`${actorId || 'system'}|${action}|${resourceType}|${resourceId}|${ts}`).digest('hex');
}

function fail(message) {
  const err = new Error(message);
  throw err;
}

const STOCK_ACTIONS = ['ADD', 'REMOVE', 'RESERVE', 'RELEASE_RESERVATION', 'DAMAGE', 'RETURN', 'TRANSFER', 'ADJUST_WITH_APPROVAL'];

/** Mirrors diaspora_append_stock_movement_atomic. */
export function appendStockMovementAtomic(params, { table, nextId, faults }) {
  const ts = new Date(2026, 5, 21).toISOString();
  const items = table('diaspora_stock_items');
  const ledger = table('diaspora_stock_ledger');
  const audit = table('diaspora_import_audit_log');

  if (!STOCK_ACTIONS.includes(params.p_action)) fail(`DIASPORA_STOCK/INVALID_ACTION: ${params.p_action}`);
  if (params.p_quantity === null || params.p_quantity === undefined || Number.isNaN(Number(params.p_quantity))) fail('DIASPORA_STOCK/INVALID_QUANTITY');
  if (!params.p_actor_id) fail('DIASPORA_STOCK/UNAUTHENTICATED');

  const item = items.find((r) => r.id === params.p_stock_item_id && !r.deleted_at);
  if (!item) fail('DIASPORA_STOCK/NOT_FOUND');

  const owns = params.p_actor_is_privileged
    || item.created_by === params.p_actor_id
    || item.updated_by === params.p_actor_id
    || (params.p_tenant_id != null && String(item.tenant_id) === String(params.p_tenant_id));
  if (!owns) fail('DIASPORA_STOCK/FORBIDDEN');

  const qty = Number(params.p_quantity);
  if (params.p_idempotency_key) {
    const existing = ledger.find((r) => r.stock_item_id === params.p_stock_item_id && r.idempotency_key === params.p_idempotency_key && !r.deleted_at);
    if (existing) {
      if (existing.action_type !== params.p_action || String(existing.metadata?.requestedQuantity ?? '') !== String(qty)) {
        fail('DIASPORA_STOCK/IDEMPOTENCY_CONFLICT');
      }
      return { ledgerEntry: { ...existing }, stockItem: { ...item }, idempotentReplay: true, balances: { onHand: item.quantity_on_hand, reserved: item.quantity_reserved, available: item.quantity_on_hand - item.quantity_reserved } };
    }
  }

  const onHand = Number(item.quantity_on_hand || 0);
  const reserved = Number(item.quantity_reserved || 0);
  const available = onHand - reserved;
  let newOn; let newRes = reserved;

  switch (params.p_action) {
    case 'ADD': case 'RETURN':
      if (qty <= 0) fail('DIASPORA_STOCK/INVALID_QUANTITY');
      newOn = onHand + qty; break;
    case 'REMOVE': case 'TRANSFER':
      if (qty <= 0) fail('DIASPORA_STOCK/INVALID_QUANTITY');
      if (qty > available) fail(`DIASPORA_STOCK/INSUFFICIENT_AVAILABLE: requested ${qty} available ${available}`);
      newOn = onHand - qty; break;
    case 'DAMAGE':
      if (qty <= 0) fail('DIASPORA_STOCK/INVALID_QUANTITY');
      if (onHand - qty < reserved) fail('DIASPORA_STOCK/DAMAGE_BELOW_RESERVED');
      newOn = onHand - qty; break;
    case 'RESERVE':
      if (qty <= 0) fail('DIASPORA_STOCK/INVALID_QUANTITY');
      if (qty > available) fail(`DIASPORA_STOCK/INSUFFICIENT_AVAILABLE: requested ${qty} available ${available}`);
      newOn = onHand; newRes = reserved + qty; break;
    case 'RELEASE_RESERVATION':
      if (qty <= 0) fail('DIASPORA_STOCK/INVALID_QUANTITY');
      if (qty > reserved) fail(`DIASPORA_STOCK/RELEASE_EXCEEDS_RESERVED: requested ${qty} reserved ${reserved}`);
      newOn = onHand; newRes = reserved - qty; break;
    case 'ADJUST_WITH_APPROVAL':
      if (!params.p_approval || !params.p_approval.approvedBy) fail('DIASPORA_STOCK/APPROVAL_REQUIRED');
      if (!params.p_actor_is_privileged) fail('DIASPORA_STOCK/APPROVAL_ROLE_REQUIRED');
      newOn = onHand + qty;
      if (newOn < 0) fail('DIASPORA_STOCK/ADJUST_BELOW_ZERO');
      if (newOn < newRes) fail('DIASPORA_STOCK/ADJUST_BELOW_RESERVED');
      break;
    default:
      fail(`DIASPORA_STOCK/INVALID_ACTION: ${params.p_action}`);
  }

  // Transactional fault hooks: any simulated failure aborts BEFORE any write (all-or-nothing).
  if (faults.failLedgerInsert) fail('DIASPORA_STOCK/LEDGER_INSERT_FAILED');
  if (faults.failItemUpdate) fail('DIASPORA_STOCK/ITEM_UPDATE_FAILED');
  if (faults.failAudit) fail('DIASPORA_STOCK/AUDIT_FAILED');

  const ledgerRow = {
    id: nextId('led'),
    tenant_id: item.tenant_id ?? params.p_tenant_id ?? null,
    stock_item_id: params.p_stock_item_id,
    import_order_id: params.p_import_order_id ?? null,
    supply_document_id: item.supply_document_id ?? null,
    source_command_id: params.p_source_command_id ?? null,
    reference_document_id: params.p_reference_document_id ?? null,
    action_type: params.p_action,
    quantity_delta: newOn - onHand,
    quantity_before: onHand,
    quantity_after: newOn,
    unit_cost: params.p_unit_cost ?? item.unit_cost ?? null,
    unit_price: params.p_unit_price ?? item.unit_price ?? null,
    currency: params.p_currency || item.currency || 'USD',
    approval_status: params.p_action === 'ADJUST_WITH_APPROVAL' ? 'APPROVED' : 'NOT_REQUIRED',
    execution_status: 'EXECUTED',
    audit_lock: true,
    idempotency_key: params.p_idempotency_key ?? null,
    notes: params.p_reason ?? null,
    metadata: {
      requestedQuantity: String(qty),
      reservationRef: params.p_reservation_ref ?? null,
      reservedBefore: reserved,
      reservedAfter: newRes,
      availableAfter: newOn - newRes,
      approval: params.p_approval ?? null,
      correlationId: params.p_correlation_id ?? null,
      source: params.p_source ?? 'ui',
    },
    created_by: params.p_actor_id,
    updated_by: params.p_actor_id,
    created_at: ts,
  };
  ledger.push(ledgerRow);

  item.quantity_on_hand = newOn;
  item.quantity_reserved = newRes;
  item.updated_by = params.p_actor_id;
  item.updated_at = ts;

  audit.push({
    id: nextId('aud'),
    import_order_id: params.p_import_order_id ?? null,
    tenant_id: item.tenant_id,
    actor_id: params.p_actor_id,
    action: `STOCK_${params.p_action}`,
    resource_type: 'diaspora_stock_item',
    resource_id: String(params.p_stock_item_id),
    previous_state: { quantity_on_hand: onHand, quantity_reserved: reserved },
    new_state: { quantity_on_hand: newOn, quantity_reserved: newRes },
    metadata: { ledgerEntryId: ledgerRow.id, action: params.p_action, quantity: qty, source: params.p_source ?? 'ui' },
    cryptographic_seal: seal(params.p_actor_id, `STOCK_${params.p_action}`, 'diaspora_stock_item', params.p_stock_item_id, ts),
    created_at: ts,
  });

  return { ledgerEntry: { ...ledgerRow }, stockItem: { ...item }, idempotentReplay: false, balances: { onHand: newOn, reserved: newRes, available: newOn - newRes } };
}

/** Mirrors diaspora_accept_quote_atomic. */
export function acceptQuoteAtomic(params, { table, nextId, faults }) {
  const ts = new Date(2026, 5, 21).toISOString();
  const orders = table('diaspora_import_orders');
  const quotes = table('diaspora_import_quotes');
  const audit = table('diaspora_import_audit_log');

  if (!params.p_actor_id) fail('DIASPORA_QUOTE/UNAUTHENTICATED');

  const order = orders.find((o) => o.id === params.p_order_id && !o.deleted_at);
  if (!order) fail('DIASPORA_QUOTE/NOT_FOUND_ORDER');

  const owner = params.p_actor_is_privileged || order.buyer_id === params.p_actor_id || order.created_by === params.p_actor_id;
  if (!owner) fail('DIASPORA_QUOTE/FORBIDDEN');

  const acceptedExisting = order.metadata?.rfq?.acceptedQuoteId ?? null;
  if (acceptedExisting != null) {
    if (acceptedExisting === params.p_quote_id) {
      const existingQuote = quotes.find((q) => q.id === params.p_quote_id);
      return { order: { ...order }, acceptedQuote: existingQuote ? { ...existingQuote } : null, idempotentReplay: true };
    }
    fail('DIASPORA_QUOTE/ALREADY_ACCEPTED_DIFFERENT');
  }

  const quote = quotes.find((q) => q.id === params.p_quote_id && !q.deleted_at);
  if (!quote) fail('DIASPORA_QUOTE/NOT_FOUND_QUOTE');
  if (quote.import_order_id !== params.p_order_id) fail('DIASPORA_QUOTE/QUOTE_NOT_IN_ORDER');
  if (quote.status !== 'ISSUED') fail('DIASPORA_QUOTE/NOT_SUBMITTED');

  if (faults.failOrderUpdate) fail('DIASPORA_QUOTE/ORDER_UPDATE_FAILED');
  if (faults.failAudit) fail('DIASPORA_QUOTE/AUDIT_FAILED');

  quote.status = 'ACCEPTED';
  quote.updated_by = params.p_actor_id;
  quote.updated_at = ts;
  for (const sibling of quotes) {
    if (sibling.id !== params.p_quote_id && sibling.import_order_id === params.p_order_id && sibling.status === 'ISSUED' && !sibling.deleted_at) {
      sibling.status = 'REJECTED';
      sibling.updated_by = params.p_actor_id;
      sibling.updated_at = ts;
    }
  }
  order.metadata = { ...(order.metadata || {}), rfq: { ...(order.metadata?.rfq || {}), acceptedQuoteId: params.p_quote_id, acceptedAt: ts } };
  order.status = 'SELLER_ASSIGNED';
  order.updated_by = params.p_actor_id;
  order.updated_at = ts;

  audit.push({
    id: nextId('aud'),
    import_order_id: params.p_order_id,
    tenant_id: order.tenant_id,
    actor_id: params.p_actor_id,
    action: 'RFQ_QUOTE_ACCEPTED',
    resource_type: 'diaspora_import_quote',
    resource_id: String(params.p_quote_id),
    new_state: { ...quote },
    metadata: { orderId: String(params.p_order_id) },
    cryptographic_seal: seal(params.p_actor_id, 'RFQ_QUOTE_ACCEPTED', 'diaspora_import_quote', params.p_quote_id, ts),
    created_at: ts,
  });

  return { order: { ...order }, acceptedQuote: { ...quote }, idempotentReplay: false };
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Mirrors diaspora_approve_cargo_reservation_atomic. */
export function approveCargoReservationAtomic(params, { table, nextId, faults }) {
  const ts = new Date(2026, 5, 21).toISOString();
  const reservations = table('diaspora_cargo_reservations');
  const containers = table('diaspora_container_shipments');
  const audit = table('diaspora_import_audit_log');

  if (!params.p_actor_id) fail('DIASPORA_CONTAINER/UNAUTHENTICATED');

  const res = reservations.find((r) => r.id === params.p_reservation_id && !r.deleted_at);
  if (!res) fail('DIASPORA_CONTAINER/NOT_FOUND_RESERVATION');
  const container = containers.find((c) => c.id === res.container_id && !c.deleted_at);
  if (!container) fail('DIASPORA_CONTAINER/NOT_FOUND_CONTAINER');

  const tenantRole = String(params.p_actor_tenant_role || '').toLowerCase();
  const canReview = params.p_actor_is_privileged
    || (['admin', 'administrator', 'tenant_admin'].includes(tenantRole) && params.p_actor_tenant_id != null && String(params.p_actor_tenant_id) === String(container.tenant_id));
  if (!canReview) fail('DIASPORA_CONTAINER/FORBIDDEN');

  if (res.reservation_status !== 'REQUESTED') fail(`DIASPORA_CONTAINER/NOT_REQUESTED: ${res.reservation_status}`);

  const total = Number(container.total_capacity_volume || 0);
  const used = round3(reservations.filter((r) => r.container_id === container.id && r.reservation_status === 'APPROVED' && !r.deleted_at).reduce((s, r) => s + Number(r.estimated_volume || 0), 0));
  const projected = round3(used + Number(res.estimated_volume || 0));
  if (projected > total) fail(`DIASPORA_CONTAINER/OVERFILL: projected ${projected} total ${total}`);

  const totalWeight = container.metadata?.total_capacity_weight != null ? Number(container.metadata.total_capacity_weight) : null;
  if (totalWeight != null && res.estimated_weight != null) {
    const usedWeight = reservations.filter((r) => r.container_id === container.id && r.reservation_status === 'APPROVED' && !r.deleted_at).reduce((s, r) => s + Number(r.estimated_weight || 0), 0);
    if (round3(usedWeight + Number(res.estimated_weight)) > totalWeight) fail('DIASPORA_CONTAINER/WEIGHT_OVERFILL');
  }

  if (faults.failAudit) fail('DIASPORA_CONTAINER/AUDIT_FAILED');
  if (faults.failContainerUpdate) fail('DIASPORA_CONTAINER/CONTAINER_UPDATE_FAILED');

  res.reservation_status = 'APPROVED';
  res.reviewed_by = params.p_actor_id;
  res.reviewed_at = ts;
  res.updated_by = params.p_actor_id;
  res.updated_at = ts;

  const available = round3(Math.max(total - projected, 0));
  const fill = total > 0 ? round3(projected / total) : 0;
  const ready = fill >= 0.90;
  const full = fill >= 0.98;
  container.used_capacity_volume = projected;
  container.available_capacity_volume = available;
  container.metadata = { ...(container.metadata || {}), capacity: { fillPercent: fill, readyToClose: ready, full } };
  container.updated_by = params.p_actor_id;
  container.updated_at = ts;

  audit.push({
    id: nextId('aud'),
    import_order_id: res.import_order_id,
    tenant_id: res.tenant_id,
    actor_id: params.p_actor_id,
    action: 'CARGO_RESERVATION_APPROVED',
    resource_type: 'diaspora_cargo_reservation',
    resource_id: String(params.p_reservation_id),
    new_state: { ...res },
    metadata: { usedVolume: projected, availableVolume: available, fillPercent: fill },
    cryptographic_seal: seal(params.p_actor_id, 'CARGO_RESERVATION_APPROVED', 'diaspora_cargo_reservation', params.p_reservation_id, ts),
    created_at: ts,
  });

  return {
    reservation: { ...res },
    capacity: { totalVolume: total, usedVolume: projected, availableVolume: available, fillPercent: fill, readyToClose: ready, full, overfilled: false },
  };
}

/**
 * Mirrors diaspora_reserve_usage_atomic (Phase 8).
 *
 * The in-memory mock cannot execute the SQL function, so this JS reference reproduces its contract:
 * locks/creates the (tenant, feature, period) meter row, enforces used + amount <= quota_limit, writes
 * a RESERVED reservation, and is idempotent on (tenant, feature, idempotency_key) — a replay returns the
 * prior result WITHOUT double counting. Keep in lockstep with:
 *   database/migrations/20260621120000_diaspora_phase8_subscription_entitlements.sql
 * True row-locking concurrency is proven against real PostgreSQL in the staging integration suite.
 */
export function reserveUsageAtomic(params, { table, nextId }) {
  const ts = new Date(2026, 5, 21).toISOString();
  const meters = table('diaspora_usage_meters');
  const reservations = table('diaspora_usage_reservations');

  if (!params.p_tenant_id) fail('DIASPORA_USAGE/TENANT_REQUIRED');
  if (!params.p_feature_key) fail('DIASPORA_USAGE/FEATURE_REQUIRED');
  if (!params.p_idempotency_key) fail('DIASPORA_USAGE/IDEMPOTENCY_KEY_REQUIRED');
  const amount = Number(params.p_amount);
  if (!(amount > 0)) fail('DIASPORA_USAGE/INVALID_AMOUNT');

  const tenant = String(params.p_tenant_id);
  const quotaLimit = Number(params.p_quota_limit);

  // Idempotent replay on (tenant, feature, idempotency_key).
  const existing = reservations.find(
    (r) => String(r.tenant_id) === tenant
      && r.feature_key === params.p_feature_key
      && r.idempotency_key === params.p_idempotency_key,
  );
  if (existing) {
    const meterRow = meters.find(
      (m) => String(m.tenant_id) === tenant && m.feature_key === params.p_feature_key && String(m.period_start) === String(params.p_period_start),
    );
    const used = Number(meterRow?.used_count ?? existing.amount);
    return {
      reserved: existing.amount,
      used,
      remaining: Math.max(quotaLimit - used, 0),
      reservationId: existing.id,
      status: existing.status,
      idempotentReplay: true,
    };
  }

  // Lock/create the meter row for this period.
  let meter = meters.find(
    (m) => String(m.tenant_id) === tenant && m.feature_key === params.p_feature_key && String(m.period_start) === String(params.p_period_start),
  );
  if (!meter) {
    meter = {
      id: nextId('meter'),
      tenant_id: tenant,
      feature_key: params.p_feature_key,
      period_start: params.p_period_start,
      period_end: params.p_period_end ?? null,
      used_count: 0,
      created_at: ts,
      updated_at: ts,
    };
    meters.push(meter);
  }

  const used = Number(meter.used_count || 0);
  const newUsed = used + amount;

  // Enforce the ceiling (a non-positive limit means the feature has no quota at all).
  if (!(quotaLimit > 0) || newUsed > quotaLimit) {
    fail(`DIASPORA_USAGE/QUOTA_EXCEEDED: feature ${params.p_feature_key} used ${used} requested ${amount} limit ${quotaLimit}`);
  }

  meter.used_count = newUsed;
  meter.updated_at = ts;

  const reservation = {
    id: nextId('rsv'),
    tenant_id: tenant,
    user_id: params.p_user_id ?? null,
    feature_key: params.p_feature_key,
    amount,
    idempotency_key: params.p_idempotency_key,
    status: 'RESERVED',
    period_start: params.p_period_start,
    period_end: params.p_period_end ?? null,
    created_at: ts,
    updated_at: ts,
  };
  reservations.push(reservation);

  return {
    reserved: amount,
    used: newUsed,
    remaining: Math.max(quotaLimit - newUsed, 0),
    reservationId: reservation.id,
    status: 'RESERVED',
    idempotentReplay: false,
  };
}

export const DIASPORA_RPCS = {
  diaspora_append_stock_movement_atomic: appendStockMovementAtomic,
  diaspora_accept_quote_atomic: acceptQuoteAtomic,
  diaspora_approve_cargo_reservation_atomic: approveCargoReservationAtomic,
  diaspora_reserve_usage_atomic: reserveUsageAtomic,
};
