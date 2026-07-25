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
import { NotFoundError, ValidationError, ForbiddenError, UnauthorizedError } from '../../utils/errors.js';
import {
  STOCK_LEDGER_ACTIONS,
  STOCK_LEDGER_ACTION_LIST,
  STOCK_LEDGER_APPROVAL_REQUIRED,
} from '../../constants/diaspora/diasporaStockConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, requestCorrelationId } from './diasporaServiceUtils.js';

const STOCK_RPC = 'diaspora_append_stock_movement_atomic';

/** Map a sanitized RPC exception to a stable application error (no raw SQL/stack leakage). */
function translateStockRpcError(error) {
  const raw = String(error?.message || 'Stock movement failed');
  const marker = raw.indexOf('DIASPORA_STOCK/');
  const code = marker >= 0 ? raw.slice(marker + 'DIASPORA_STOCK/'.length).split(/[:\s]/)[0] : '';
  switch (code) {
    case 'NOT_FOUND': return new NotFoundError('Diaspora stock item not found');
    case 'FORBIDDEN': return new ForbiddenError('You do not have access to this stock item');
    case 'UNAUTHENTICATED': return new UnauthorizedError('Authentication required for stock movements');
    case 'APPROVAL_REQUIRED': return new ValidationError('ADJUST_WITH_APPROVAL requires approval.approvedBy metadata');
    case 'APPROVAL_ROLE_REQUIRED': return new ForbiddenError('ADJUST_WITH_APPROVAL requires a reviewer or admin actor');
    case 'INSUFFICIENT_AVAILABLE': return new ValidationError('Movement exceeds available stock');
    case 'RELEASE_EXCEEDS_RESERVED': return new ValidationError('Release exceeds reserved stock');
    case 'DAMAGE_BELOW_RESERVED': return new ValidationError('Damage would drop on-hand below reserved');
    case 'ADJUST_BELOW_ZERO': return new ValidationError('Adjustment cannot drive on-hand below zero');
    case 'ADJUST_BELOW_RESERVED': return new ValidationError('Adjustment cannot drive on-hand below reserved');
    case 'IDEMPOTENCY_CONFLICT': return new ValidationError('Idempotency key reused with a different movement');
    case 'INVALID_QUANTITY': return new ValidationError('Stock movement requires a valid positive quantity');
    case 'INVALID_ACTION': return new ValidationError('Unsupported stock ledger action');
    default: return new ValidationError('Stock movement could not be applied');
  }
}

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

  // Defense in depth: the atomic RPC re-checks these, but reject early with a clear message too.
  if (STOCK_LEDGER_APPROVAL_REQUIRED.includes(action)) {
    if (!movement.approval?.approvedBy) {
      throw new ValidationError(`${action} requires approval.approvedBy metadata`);
    }
    if (!isPlatformAdmin(context) && !isPlatformReviewer(context)) {
      throw new ForbiddenError(`${action} requires a reviewer or admin actor`);
    }
  }

  // Single atomic transaction: lock + validate + ledger insert + balance update + critical audit.
  // No non-atomic production fallback (directive H1 §10).
  const { data, error } = await client.rpc(STOCK_RPC, {
    p_stock_item_id: stockItemId,
    p_actor_id: context.id,
    p_tenant_id: context.tenantId || null,
    p_actor_is_privileged: isPlatformAdmin(context) || isPlatformReviewer(context),
    p_action: action,
    p_quantity: Number(movement.quantity),
    p_idempotency_key: movement.idempotencyKey || null,
    p_import_order_id: movement.importOrderId || null,
    p_reservation_ref: movement.reservationRef || null,
    p_source_command_id: movement.sourceCommandId || null,
    p_reference_document_id: movement.referenceDocumentId || null,
    p_unit_cost: movement.unitCost ?? null,
    p_unit_price: movement.unitPrice ?? null,
    p_currency: movement.currency || null,
    p_reason: movement.reason || null,
    p_approval: movement.approval || null,
    p_correlation_id: requestCorrelationId(req),
    p_source: movement.source || 'ui',
  });
  if (error) throw translateStockRpcError(error);
  if (!data) throw new ValidationError('Stock movement returned no result');

  return { ledgerEntry: data.ledgerEntry, stockItem: data.stockItem, idempotentReplay: Boolean(data.idempotentReplay) };
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
