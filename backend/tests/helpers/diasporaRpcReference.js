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

export const DIASPORA_RPCS = {
  diaspora_append_stock_movement_atomic: appendStockMovementAtomic,
  diaspora_accept_quote_atomic: acceptQuoteAtomic,
};
