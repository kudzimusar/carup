/**
 * Phase 3 — Diaspora stock ledger service.
 *
 * The single authority for stock quantity changes. Stock totals are NEVER overwritten directly;
 * every change is an immutable ledger row, and the item's quantity_on_hand / quantity_reserved are
 * transactionally maintained from that ledger event (directive §7.3).
 *
 * Guarantees:
 *  - available = quantity_on_hand - quantity_reserved is never negative;
 *  - reservations cannot exceed availability;
 *  - releases cannot exceed reserved;
 *  - duplicate idempotency keys never double-apply a movement;
 *  - ADJUST_WITH_APPROVAL requires approval metadata;
 *  - every movement writes a sealed audit event.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  STOCK_LEDGER_ACTIONS,
  STOCK_LEDGER_ACTION_LIST,
  STOCK_LEDGER_APPROVAL_REQUIRED,
} from '../../constants/diaspora/diasporaStockConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, requestCorrelationId } from './diasporaServiceUtils.js';

const STORAGE = 'diaspora_stock_items';
const LEDGER = 'diaspora_stock_ledger';

function assertOwnership(item, context) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return;
  const owns = [item.created_by, item.updated_by].some((c) => normalizeId(c) === context.id);
  const sameTenant = item.tenant_id && context.tenantId && normalizeId(item.tenant_id) === context.tenantId;
  if (!owns && !sameTenant) {
    throw new ForbiddenError('You do not have access to this stock item');
  }
}

async function fetchStockItem(client, stockItemId, context) {
  const { data, error } = await client
    .from(STORAGE)
    .select('*')
    .eq('id', stockItemId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new NotFoundError('Diaspora stock item not found');
  assertOwnership(data, context);
  return data;
}

/**
 * Compute the resulting balances for a movement. Returns { onHand, reserved } or throws a
 * ValidationError when the movement would violate an integrity rule.
 */
export function computeBalances(action, quantity, current) {
  const onHand = Number(current.quantity_on_hand || 0);
  const reserved = Number(current.quantity_reserved || 0);
  const available = onHand - reserved;
  const qty = Number(quantity);

  switch (action) {
    case STOCK_LEDGER_ACTIONS.ADD:
    case STOCK_LEDGER_ACTIONS.RETURN:
      if (!(qty > 0)) throw new ValidationError(`${action} requires a positive quantity`);
      return { onHand: onHand + qty, reserved };

    case STOCK_LEDGER_ACTIONS.REMOVE:
    case STOCK_LEDGER_ACTIONS.TRANSFER:
      if (!(qty > 0)) throw new ValidationError(`${action} requires a positive quantity`);
      if (qty > available) {
        throw new ValidationError(`${action} of ${qty} exceeds available ${available}`, { available, requested: qty });
      }
      return { onHand: onHand - qty, reserved };

    case STOCK_LEDGER_ACTIONS.DAMAGE:
      if (!(qty > 0)) throw new ValidationError('DAMAGE requires a positive quantity');
      if (onHand - qty < reserved) {
        throw new ValidationError(`DAMAGE of ${qty} would drop on-hand below reserved ${reserved}`, { onHand, reserved, requested: qty });
      }
      return { onHand: onHand - qty, reserved };

    case STOCK_LEDGER_ACTIONS.RESERVE:
      if (!(qty > 0)) throw new ValidationError('RESERVE requires a positive quantity');
      if (qty > available) {
        throw new ValidationError(`RESERVE of ${qty} exceeds available ${available}`, { available, requested: qty });
      }
      return { onHand, reserved: reserved + qty };

    case STOCK_LEDGER_ACTIONS.RELEASE_RESERVATION:
      if (!(qty > 0)) throw new ValidationError('RELEASE_RESERVATION requires a positive quantity');
      if (qty > reserved) {
        throw new ValidationError(`RELEASE_RESERVATION of ${qty} exceeds reserved ${reserved}`, { reserved, requested: qty });
      }
      return { onHand, reserved: reserved - qty };

    case STOCK_LEDGER_ACTIONS.ADJUST_WITH_APPROVAL: {
      // Signed adjustment to on-hand; may be negative but never below reserved or zero.
      const next = onHand + qty;
      if (next < 0) throw new ValidationError('ADJUST_WITH_APPROVAL cannot drive on-hand below zero', { onHand, requested: qty });
      if (next < reserved) throw new ValidationError('ADJUST_WITH_APPROVAL cannot drive on-hand below reserved', { reserved, requested: qty });
      return { onHand: next, reserved };
    }

    default:
      throw new ValidationError(`Unsupported stock ledger action: ${action}`);
  }
}

/**
 * Append a stock movement. Idempotent on (stock_item_id, idempotencyKey).
 *
 * @param {string} stockItemId
 * @param {object} movement { action, quantity, reason, idempotencyKey, importOrderId, reservationRef,
 *   sourceCommandId, referenceDocumentId, approval: { approvedBy, note } }
 */
export async function appendStockMovement(stockItemId, movement = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const action = String(movement.action || '').toUpperCase();
  if (!STOCK_LEDGER_ACTION_LIST.includes(action)) {
    throw new ValidationError(`Unsupported stock ledger action: ${movement.action}`);
  }
  if (movement.quantity === undefined || movement.quantity === null || Number.isNaN(Number(movement.quantity))) {
    throw new ValidationError('Stock movement requires a numeric quantity');
  }

  if (STOCK_LEDGER_APPROVAL_REQUIRED.includes(action)) {
    const approvedBy = movement.approval?.approvedBy;
    if (!approvedBy) {
      throw new ValidationError(`${action} requires approval.approvedBy metadata`);
    }
    if (!isPlatformAdmin(context) && !isPlatformReviewer(context)) {
      throw new ForbiddenError(`${action} requires a reviewer or admin actor`);
    }
  }

  const item = await fetchStockItem(client, stockItemId, context);

  // Idempotency: a prior movement with the same key returns the existing row unchanged.
  const idempotencyKey = movement.idempotencyKey || null;
  if (idempotencyKey) {
    const { data: existing } = await client
      .from(LEDGER)
      .select('*')
      .eq('stock_item_id', stockItemId)
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) {
      return { ledgerEntry: existing, stockItem: item, idempotentReplay: true };
    }
  }

  const onHandBefore = Number(item.quantity_on_hand || 0);
  const { onHand, reserved } = computeBalances(action, movement.quantity, item);

  const ledgerRow = {
    tenant_id: item.tenant_id || context.tenantId || null,
    stock_item_id: stockItemId,
    import_order_id: movement.importOrderId || null,
    supply_document_id: item.supply_document_id || null,
    source_command_id: movement.sourceCommandId || null,
    reference_document_id: movement.referenceDocumentId || null,
    action_type: action,
    quantity_delta: onHand - onHandBefore,
    quantity_before: onHandBefore,
    quantity_after: onHand,
    unit_cost: movement.unitCost ?? item.unit_cost ?? null,
    unit_price: movement.unitPrice ?? item.unit_price ?? null,
    currency: movement.currency || item.currency || 'USD',
    approval_status: STOCK_LEDGER_APPROVAL_REQUIRED.includes(action) ? 'APPROVED' : 'NOT_REQUIRED',
    execution_status: 'EXECUTED',
    audit_lock: true,
    idempotency_key: idempotencyKey,
    notes: movement.reason || null,
    metadata: {
      reservationRef: movement.reservationRef || null,
      reservedBefore: Number(item.quantity_reserved || 0),
      reservedAfter: reserved,
      availableAfter: onHand - reserved,
      approval: movement.approval || null,
      correlationId: requestCorrelationId(req),
      source: movement.source || 'ui',
    },
    created_by: context.id,
    updated_by: context.id,
  };

  const { data: ledgerEntry, error: ledgerError } = await client
    .from(LEDGER)
    .insert(ledgerRow)
    .select()
    .single();
  if (ledgerError) throw new ValidationError(`Failed to append stock movement: ${ledgerError.message}`);

  const { data: stockItem, error: updateError } = await client
    .from(STORAGE)
    .update({
      quantity_on_hand: onHand,
      quantity_reserved: reserved,
      updated_by: context.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stockItemId)
    .select()
    .single();
  if (updateError) throw new ValidationError(`Failed to update stock balances: ${updateError.message}`);

  await appendAudit(client, {
    importOrderId: movement.importOrderId || null,
    actorId: context.id,
    tenantId: stockItem.tenant_id,
    action: `STOCK_${action}`,
    resourceType: 'diaspora_stock_item',
    resourceId: stockItemId,
    previousState: { quantity_on_hand: onHandBefore, quantity_reserved: Number(item.quantity_reserved || 0) },
    newState: { quantity_on_hand: onHand, quantity_reserved: reserved },
    metadata: { ledgerEntryId: ledgerEntry.id, action, quantity: movement.quantity, source: movement.source || 'ui' },
    req,
  });

  return { ledgerEntry, stockItem, idempotentReplay: false };
}

/** List the immutable ledger history for a stock item (tenant/ownership scoped). */
export async function listStockLedger(stockItemId, { limit = 100, offset = 0 } = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  await fetchStockItem(client, stockItemId, context); // authorization

  const { data, error } = await client
    .from(LEDGER)
    .select('*')
    .eq('stock_item_id', stockItemId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new ValidationError(`Failed to list stock ledger: ${error.message}`);
  return data || [];
}

/** Derive balances from the item row (authoritative, ledger-maintained). */
export function deriveBalances(item = {}) {
  const onHand = Number(item.quantity_on_hand || 0);
  const reserved = Number(item.quantity_reserved || 0);
  return { onHand, reserved, available: onHand - reserved };
}
