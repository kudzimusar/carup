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
/**
 * Reference mirror of `diaspora_accept_logistics_quote_atomic`
 * (database/migrations/20260905090000_trade_os_logistics_rfq.sql).
 *
 * Mirrors the SQL branch-for-branch so service/route tests exercise the same invariants: only the
 * requester (or a privileged actor) may award, a provider can never award to itself, only a
 * SUBMITTED offer can win, re-accepting the same offer is an idempotent replay, and every other
 * SUBMITTED sibling is rejected in the same all-or-nothing step.
 */
export function acceptLogisticsQuoteAtomic(params, { table, faults }) {
  const ts = new Date(2026, 8, 5).toISOString();
  const requests = table('diaspora_logistics_requests');
  const quotes = table('diaspora_logistics_quotes');
  const audit = table('diaspora_import_audit_log');

  if (!params.p_actor_id) fail('DIASPORA_LOGISTICS/UNAUTHENTICATED');

  const request = requests.find((row) => row.id === params.p_request_id && !row.deleted_at);
  if (!request) fail('DIASPORA_LOGISTICS/NOT_FOUND_REQUEST');

  const owner = params.p_actor_is_privileged
    || request.requester_id === params.p_actor_id
    || request.created_by === params.p_actor_id;
  if (!owner) fail('DIASPORA_LOGISTICS/FORBIDDEN');

  if (request.accepted_quote_id != null) {
    if (request.accepted_quote_id === params.p_quote_id) {
      const existing = quotes.find((row) => row.id === params.p_quote_id);
      return { request: { ...request }, acceptedQuote: existing ? { ...existing } : null, idempotentReplay: true };
    }
    fail('DIASPORA_LOGISTICS/ALREADY_ACCEPTED_DIFFERENT');
  }

  const quote = quotes.find((row) => row.id === params.p_quote_id && !row.deleted_at);
  if (!quote) fail('DIASPORA_LOGISTICS/NOT_FOUND_QUOTE');
  if (quote.logistics_request_id !== params.p_request_id) fail('DIASPORA_LOGISTICS/QUOTE_NOT_IN_REQUEST');
  if (quote.status !== 'SUBMITTED') fail('DIASPORA_LOGISTICS/NOT_SUBMITTED');
  if (quote.provider_id === params.p_actor_id) fail('DIASPORA_LOGISTICS/SELF_AWARD');

  if (faults.failLogisticsAward) fail('DIASPORA_LOGISTICS/AWARD_FAILED');

  quote.status = 'ACCEPTED';
  quote.updated_by = params.p_actor_id;
  quote.updated_at = ts;
  for (const sibling of quotes) {
    if (sibling.id !== params.p_quote_id
      && sibling.logistics_request_id === params.p_request_id
      && sibling.status === 'SUBMITTED'
      && !sibling.deleted_at) {
      sibling.status = 'REJECTED';
      sibling.updated_by = params.p_actor_id;
      sibling.updated_at = ts;
    }
  }
  request.accepted_quote_id = params.p_quote_id;
  request.status = 'AWARDED';
  request.updated_by = params.p_actor_id;
  request.updated_at = ts;

  audit.push({
    import_order_id: null,
    tenant_id: request.tenant_id || null,
    actor_id: params.p_actor_id,
    action: 'LOGISTICS_QUOTE_ACCEPTED',
    resource_type: 'diaspora_logistics_quote',
    resource_id: String(params.p_quote_id),
    new_state: { ...quote },
    metadata: { logisticsRequestId: String(params.p_request_id) },
    cryptographic_seal: `seal-${params.p_quote_id}`,
  });

  return { request: { ...request }, acceptedQuote: { ...quote }, idempotentReplay: false };
}

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

/**
 * Mirrors diaspora_release_usage_atomic (ledger #25).
 *
 * The SQL takes the reservation FOR UPDATE, then the meter FOR UPDATE, decrements with
 * GREATEST(used - amount, 0), flips the status and writes the audit row — all in one transaction.
 * This reference reproduces the observable contract: a released reservation is an idempotent no-op
 * (it does NOT decrement a second time), a COMMITTED reservation cannot be released, the meter is
 * located by the RESERVATION's own tenant/feature/period rather than by caller input, and the audit
 * row exists for every release that actually happened.
 *
 * Keep in lockstep with database/migrations/20260730090000_diaspora_atomic_quota_release.sql
 */
export function releaseUsageAtomic(params, { table, nextId }) {
  const ts = new Date(2026, 5, 21).toISOString();
  const reservations = table('diaspora_usage_reservations');
  const meters = table('diaspora_usage_meters');
  const audit = table('diaspora_import_audit_log');

  const reservation = reservations.find((r) => String(r.id) === String(params.p_reservation_id));
  if (!reservation) fail('DIASPORA_ENTITLEMENT/RESERVATION_NOT_FOUND');

  if (reservation.status === 'RELEASED') {
    return {
      reservationId: params.p_reservation_id,
      status: 'RELEASED',
      idempotentReplay: true,
      meterBefore: null,
      meterAfter: null,
    };
  }
  if (reservation.status === 'COMMITTED') fail('DIASPORA_ENTITLEMENT/CANNOT_RELEASE_COMMITTED');

  // The meter is found through the RESERVATION's own scope. A caller cannot name another tenant's
  // meter, because the caller never names a meter at all.
  const meter = meters.find(
    (m) => String(m.tenant_id) === String(reservation.tenant_id)
      && m.feature_key === reservation.feature_key
      && String(m.period_start) === String(reservation.period_start),
  );

  let before = null;
  let after = null;
  if (meter) {
    before = Number(meter.used_count || 0);
    after = Math.max(before - Number(reservation.amount || 0), 0); // GREATEST(..., 0)
    meter.used_count = after;
    meter.updated_at = ts;
  }

  reservation.status = 'RELEASED';
  reservation.updated_at = ts;

  audit.push({
    id: nextId('aud'),
    tenant_id: reservation.tenant_id,
    actor_id: params.p_actor_id ?? null,
    action: 'ENTITLEMENT_USAGE_RELEASED',
    resource_type: 'diaspora_usage_reservation',
    resource_id: String(params.p_reservation_id),
    previous_state: { status: 'RESERVED', meterUsed: before },
    new_state: { status: 'RELEASED', meterUsed: after },
    metadata: {
      featureKey: reservation.feature_key,
      amount: reservation.amount,
      correlationId: params.p_correlation_id ?? null,
    },
    cryptographic_seal: seal(
      params.p_actor_id, 'ENTITLEMENT_USAGE_RELEASED', 'diaspora_usage_reservation',
      params.p_reservation_id, ts,
    ),
    created_at: ts,
  });

  return {
    reservationId: params.p_reservation_id,
    status: 'RELEASED',
    idempotentReplay: false,
    meterBefore: before,
    meterAfter: after,
    reservation: { ...reservation },
  };
}

/**
 * Mirrors diaspora_apply_entitlement_override_atomic (ledger #26).
 *
 * The SQL locks the logical (tenant, user, feature) row — soft-deleted included — then upserts
 * ON CONFLICT ON CONSTRAINT uq_diaspora_user_override, clearing deleted_at so a re-grant REVIVES the
 * existing row instead of colliding with it, and writes the audit row in the same transaction with a
 * distinct action per outcome.
 *
 * This reference reproduces that contract against the in-memory tables, which is why it writes the
 * override row directly rather than through the mock's insert path: the RPC is a single upsert
 * statement in Postgres, and routing it through an INSERT that the mock's unique index would reject
 * would model the OLD broken sequence rather than the new one.
 *
 * Keep in lockstep with database/migrations/20260731090000_diaspora_entitlement_override_regrant.sql
 */
export function applyEntitlementOverrideAtomic(params, { table, nextId }) {
  const ts = new Date().toISOString();
  const overrides = table('diaspora_user_entitlement_overrides');
  const audit = table('diaspora_import_audit_log');

  if (!params.p_tenant_id) fail('DIASPORA_ENTITLEMENT/TENANT_REQUIRED');
  if (!params.p_user_id) fail('DIASPORA_ENTITLEMENT/USER_REQUIRED');
  if (!params.p_feature_key) fail('DIASPORA_ENTITLEMENT/FEATURE_REQUIRED');
  if (params.p_value === undefined || params.p_value === null) fail('DIASPORA_ENTITLEMENT/VALUE_REQUIRED');
  if (!params.p_actor_id) fail('DIASPORA_ENTITLEMENT/ACTOR_REQUIRED');

  // The lookup ignores deleted_at exactly as the SQL does — that row is the one being revived.
  const prev = overrides.find(
    (r) => String(r.tenant_id) === String(params.p_tenant_id)
      && String(r.user_id) === String(params.p_user_id)
      && r.feature_key === params.p_feature_key,
  );

  let outcome;
  if (!prev) outcome = 'GRANTED';
  else if (prev.deleted_at) outcome = 'REGRANTED';
  else if (JSON.stringify(prev.value) !== JSON.stringify(params.p_value)) outcome = 'UPDATED';
  else outcome = 'UNCHANGED';

  const previousState = prev
    ? { value: prev.value, revoked: Boolean(prev.deleted_at), revokedAt: prev.deleted_at ?? null }
    : null;

  let row;
  if (prev) {
    prev.value = params.p_value;
    prev.reason = params.p_reason ?? null;
    prev.updated_by = params.p_actor_id;
    prev.updated_at = ts;
    prev.deleted_at = null; // ON CONFLICT ... DO UPDATE SET deleted_at = NULL
    row = prev;
  } else {
    row = {
      id: nextId('ovr'),
      tenant_id: String(params.p_tenant_id),
      user_id: String(params.p_user_id),
      feature_key: params.p_feature_key,
      value: params.p_value,
      reason: params.p_reason ?? null,
      created_by: params.p_actor_id,
      updated_by: params.p_actor_id,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    overrides.push(row);
  }

  const action = {
    GRANTED: 'ENTITLEMENT_OVERRIDE_GRANTED',
    REGRANTED: 'ENTITLEMENT_OVERRIDE_REGRANTED',
    UPDATED: 'ENTITLEMENT_OVERRIDE_UPDATED',
    UNCHANGED: 'ENTITLEMENT_OVERRIDE_REAPPLIED',
  }[outcome];

  audit.push({
    id: nextId('aud'),
    tenant_id: String(params.p_tenant_id),
    actor_id: params.p_actor_id,
    action,
    resource_type: 'diaspora_user_entitlement_override',
    resource_id: String(row.id),
    previous_state: previousState,
    new_state: { value: row.value, revoked: false },
    metadata: {
      featureKey: params.p_feature_key,
      userId: String(params.p_user_id),
      outcome,
      reason: params.p_reason ?? null,
      correlationId: params.p_correlation_id ?? null,
    },
    cryptographic_seal: seal(params.p_actor_id, action, 'diaspora_user_entitlement_override', row.id, ts),
    created_at: ts,
  });

  return { outcome, action, override: { ...row } };
}

/** Mirrors diaspora_revoke_entitlement_override_atomic (ledger #26). */
export function revokeEntitlementOverrideAtomic(params, { table, nextId }) {
  const ts = new Date().toISOString();
  const overrides = table('diaspora_user_entitlement_overrides');
  const audit = table('diaspora_import_audit_log');

  if (!params.p_tenant_id) fail('DIASPORA_ENTITLEMENT/TENANT_REQUIRED');
  if (!params.p_actor_id) fail('DIASPORA_ENTITLEMENT/ACTOR_REQUIRED');

  const row = overrides.find(
    (r) => String(r.tenant_id) === String(params.p_tenant_id)
      && String(r.user_id) === String(params.p_user_id)
      && r.feature_key === params.p_feature_key,
  );
  if (!row) fail('DIASPORA_ENTITLEMENT/OVERRIDE_NOT_FOUND');

  if (row.deleted_at) {
    // Already revoked. Re-stamping deleted_at would rewrite when the capability was withdrawn.
    return {
      outcome: 'ALREADY_REVOKED',
      action: 'ENTITLEMENT_OVERRIDE_REVOKED',
      idempotentReplay: true,
      override: { ...row },
    };
  }

  const previousValue = row.value;
  row.deleted_at = ts;
  row.reason = params.p_reason ?? row.reason ?? null;
  row.updated_by = params.p_actor_id;
  row.updated_at = ts;

  audit.push({
    id: nextId('aud'),
    tenant_id: String(params.p_tenant_id),
    actor_id: params.p_actor_id,
    action: 'ENTITLEMENT_OVERRIDE_REVOKED',
    resource_type: 'diaspora_user_entitlement_override',
    resource_id: String(row.id),
    previous_state: { value: previousValue, revoked: false },
    new_state: { value: row.value, revoked: true, revokedAt: row.deleted_at },
    metadata: {
      featureKey: params.p_feature_key,
      userId: String(params.p_user_id),
      outcome: 'REVOKED',
      reason: params.p_reason ?? null,
      correlationId: params.p_correlation_id ?? null,
    },
    cryptographic_seal: seal(params.p_actor_id, 'ENTITLEMENT_OVERRIDE_REVOKED', 'diaspora_user_entitlement_override', row.id, ts),
    created_at: ts,
  });

  return { outcome: 'REVOKED', action: 'ENTITLEMENT_OVERRIDE_REVOKED', idempotentReplay: false, override: { ...row } };
}

export const DIASPORA_RPCS = {
  diaspora_append_stock_movement_atomic: appendStockMovementAtomic,
  diaspora_accept_quote_atomic: acceptQuoteAtomic,
  diaspora_accept_logistics_quote_atomic: acceptLogisticsQuoteAtomic,
  diaspora_approve_cargo_reservation_atomic: approveCargoReservationAtomic,
  diaspora_reserve_usage_atomic: reserveUsageAtomic,
  diaspora_release_usage_atomic: releaseUsageAtomic,
  diaspora_apply_entitlement_override_atomic: applyEntitlementOverrideAtomic,
  diaspora_revoke_entitlement_override_atomic: revokeEntitlementOverrideAtomic,
};
