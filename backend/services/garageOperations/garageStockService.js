import { randomUUID } from 'node:crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from '../serviceNetwork/serviceAuthority.js';
import { executionGateFailure } from '../serviceNetwork/executionGate.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';
import { moneyAmount, moneyString, requireCurrency } from '../../utils/garageMoney.js';

/**
 * GARAGE-1.0 OPS06 — parts and stock over the ONE parts master (mechanic_parts).
 *
 * Quantity changes only through the append-only movement ledger (database-enforced). A quantity that
 * has never been stated against the shelf is "uncounted" and a missing quantity is "unknown": neither
 * is shown as, or treated as, zero. "Low" exists only where the garage explicitly set a threshold.
 * Supplier is the free text the garage stated; nothing here implies a verified supplier or purchasing.
 */

const MESSAGES = Object.freeze({
  PART_NOT_FOUND: 'That part could not be found.',
  USAGE_NOT_FOUND: 'That usage could not be found.',
  SERVICE_RECORD_NOT_FOUND: 'That service record could not be found.',
  SKU_EXISTS: 'A part with that SKU already exists in this garage.',
  NAME_INVALID: 'A part needs a name (up to 200 characters).',
  SKU_INVALID: 'A part needs a SKU (up to 80 characters).',
  QUANTITY_INVALID: 'Enter a whole number of units greater than zero (a count may be zero).',
  THRESHOLD_INVALID: 'The reorder threshold must be zero or more.',
  CURRENCY_REQUIRED: 'A cost or price needs a currency.',
  CURRENCY_UNSUPPORTED: 'That currency cannot be recorded exactly.',
  AMOUNT_INVALID: 'An amount is negative or has more decimal places than the currency allows.',
  PATCH_INVALID: 'One of the values you entered is not valid.',
  INSUFFICIENT_STOCK: 'There is not enough of this part in stock.',
  STOCK_UNKNOWN: 'The quantity of this part is unknown. Count it first.',
  STOCK_NOT_COUNTED: 'This part\'s quantity has not been counted yet. Do a stock count before using it on a job.',
  PART_INACTIVE: 'This part is inactive. Re-activate it before using it.',
  NO_CHANGE: 'The count matches the current quantity; there is nothing to adjust.',
  REASON_REQUIRED: 'Give a reason.',
  IDEMPOTENCY_CONFLICT: 'This request was already used for a different action. Start again.',
  PARTSENTRY_MISMATCH: 'That PartSentry record was not attested on this job.',
  USAGE_ALREADY_REVERSED: 'That usage has already been reversed.',
  STOCK_WRITE_VIA_MOVEMENT: 'A quantity can only change through a stock movement.',
});
const CONFLICT = new Set([
  'SKU_EXISTS', 'INSUFFICIENT_STOCK', 'STOCK_UNKNOWN', 'STOCK_NOT_COUNTED', 'PART_INACTIVE', 'NO_CHANGE',
  'IDEMPOTENCY_CONFLICT', 'USAGE_ALREADY_REVERSED', 'STOCK_WRITE_VIA_MOVEMENT',
]);
const NOT_FOUND = new Set(['PART_NOT_FOUND', 'USAGE_NOT_FOUND', 'SERVICE_RECORD_NOT_FOUND']);

const adminTenant = (actor) => requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
const workspaceTenant = (actor) => requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES);
function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);

export function stockFailure(error, fallback = 'Could not complete the stock action') {
  const gate = executionGateFailure(error);
  if (gate) return gate;
  const message = String(error?.message || error || '');
  if (/GARAGE_OPS03_ADMIN_REQUIRED/.test(message)) return new ForbiddenError('Only a garage administrator can manage stock.');
  const match = /GARAGE_OPS06_([A-Z_]+)/.exec(message);
  if (match) {
    const token = match[1];
    let text = MESSAGES[token] || token.toLowerCase().replaceAll('_', ' ');
    if (token === 'INSUFFICIENT_STOCK') {
      const d = /available=(\d+) requested=(\d+)/.exec(String(error?.details ?? error?.detail ?? ''));
      if (d) text = `Only ${d[1]} in stock; ${d[2]} requested.`;
    }
    if (NOT_FOUND.has(token)) return new NotFoundError(text);
    if (CONFLICT.has(token)) return new ConflictError(text);
    return new ValidationError(text);
  }
  if (error?.code === '23505') return new ConflictError(MESSAGES.SKU_EXISTS);
  return new DatabaseError(`${fallback}: ${message || 'database error'}`);
}

function wholeNumber(value, label, { min = 0 } = {}) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new ValidationError(`${label} is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > 1_000_000_000) {
    throw new ValidationError(`${label} must be a whole number${min > 0 ? ' greater than zero' : ''}`);
  }
  return n;
}
function optionalWhole(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return wholeNumber(value, label);
}
function text(value, label, max, { required = false } = {}) {
  const t = String(value ?? '').trim();
  if (!t) {
    if (required) throw new ValidationError(`${label} is required`);
    return null;
  }
  if (t.length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return t;
}
export function idempotencyKey(provided) {
  if (provided === undefined || provided === null || provided === '') return randomUUID();
  const k = String(provided).trim();
  if (k.length < 8 || k.length > 120) throw new ValidationError('Idempotency-Key must be 8 to 120 characters');
  return k;
}

export function stockState(row) {
  const level = row.stock_level;
  if (level === null || level === undefined) return 'unknown';
  if (row.counted === false) return 'uncounted';
  if (level === 0) return 'out';
  if (row.min_stock !== null && row.min_stock !== undefined && level <= row.min_stock) return 'low';
  return 'in_stock';
}

export function partView(row, { moneyVisible = true } = {}) {
  const view = {
    id: row.id,
    name: row.name,
    sku: row.sku,
    stock_level: row.stock_level ?? null,
    stock_state: stockState(row),
    counted: row.counted ?? null,
    min_stock: row.min_stock ?? null,
    supplier: row.supplier ?? null,
    unit_cost: moneyString(row.unit_cost, row.price_currency),
    sell_price: moneyString(row.sell_price, row.price_currency),
    price_currency: row.price_currency ?? null,
    // the pre-GARAGE-1.0 price carries no currency, so it is shown as a legacy value, never as money
    legacy_unit_price: moneyString(row.legacy_unit_price ?? row.unit_price, null),
    legacy_price_currency_unknown: (row.legacy_unit_price ?? row.unit_price ?? null) !== null,
    is_active: row.is_active !== false,
    last_movement_at: row.last_movement_at ?? null,
    updated_at: row.updated_at ?? null,
  };
  // Cost and price are margin: a mechanic needs the quantity and the SKU, not what the garage paid.
  if (!moneyVisible) {
    return {
      ...view, unit_cost: null, sell_price: null, legacy_unit_price: null, legacy_price_currency_unknown: false, money_visible: false,
    };
  }
  return { ...view, money_visible: true };
}

const isGarageAdmin = (actor) => actor?.activeTenant?.role === 'admin';

function moneyInputs(body, { requireNone = false } = {}) {
  const hasMoney = ['unit_cost', 'sell_price'].some((k) => body[k] !== undefined && body[k] !== null && body[k] !== '');
  if (!hasMoney && !body.price_currency) return { unit_cost: null, sell_price: null, price_currency: null };
  const currency = requireCurrency(body.price_currency, 'price_currency');
  return {
    unit_cost: moneyAmount(body.unit_cost, 'unit_cost', currency, { optional: true }),
    sell_price: moneyAmount(body.sell_price, 'sell_price', currency, { optional: true }),
    price_currency: currency,
    requireNone,
  };
}

// ───────────────────────────── reads ─────────────────────────────

export async function listParts(client = defaultClient, actor = {}, { includeInactive = false } = {}) {
  const tenantId = workspaceTenant(actor);
  const { data, error } = await client.rpc('garage_ops06_list_parts', {
    p_tenant_id: tenantId, p_include_inactive: Boolean(includeInactive),
  });
  if (error) throw stockFailure(error, 'Could not load stock');
  const moneyVisible = isGarageAdmin(actor);
  const parts = list(data).map((p) => partView(p, { moneyVisible }));
  return {
    money_visible: moneyVisible,
    parts,
    summary: {
      total: parts.length,
      // each count is of parts in that exact state; none is a stand-in for another
      out: parts.filter((p) => p.stock_state === 'out').length,
      low: parts.filter((p) => p.stock_state === 'low').length,
      uncounted: parts.filter((p) => p.stock_state === 'uncounted').length,
      unknown: parts.filter((p) => p.stock_state === 'unknown').length,
    },
  };
}

export async function getPart(client = defaultClient, actor = {}, partId) {
  const tenantId = workspaceTenant(actor);
  const { data, error } = await client.rpc('garage_ops06_list_parts', { p_tenant_id: tenantId, p_include_inactive: true });
  if (error) throw stockFailure(error, 'Could not load the part');
  const row = list(data).find((p) => p.id === String(partId));
  if (!row) throw new NotFoundError('Part not found');
  const { data: moves, error: moveError } = await client.from('garage_stock_movements')
    .select('id, seq, movement_type, quantity_delta, balance_before, balance_after, reason_code, note, work_order_id, service_record_id, actor_user_id, created_at')
    .eq('tenant_id', tenantId).eq('part_id', row.id).order('seq', { ascending: false }).limit(100);
  if (moveError) throw new DatabaseError('Could not load stock history: ' + moveError.message);
  return { money_visible: isGarageAdmin(actor), part: partView(row, { moneyVisible: isGarageAdmin(actor) }), movements: list(moves) };
}

/** What was actually used on a job, with the snapshot costs — never the estimate. */
export async function listWorkOrderParts(client = defaultClient, actor = {}, workOrderId) {
  const tenantId = workspaceTenant(actor);
  const { data, error } = await client.from('garage_service_part_usage')
    .select('id, service_record_id, part_id, quantity, part_name_snapshot, part_sku_snapshot, unit_cost_snapshot, sell_price_snapshot, price_currency_snapshot, partsentry_log_id, reversed_at, created_by_user_id, created_at')
    .eq('tenant_id', tenantId).eq('work_order_id', String(workOrderId)).order('created_at', { ascending: true });
  if (error) throw new DatabaseError('Could not load parts used: ' + error.message);
  const moneyVisible = isGarageAdmin(actor);
  return {
    money_visible: moneyVisible,
    usage: list(data).map((u) => ({
      ...u,
      unit_cost_snapshot: moneyVisible ? moneyString(u.unit_cost_snapshot, u.price_currency_snapshot) : null,
      sell_price_snapshot: moneyVisible ? moneyString(u.sell_price_snapshot, u.price_currency_snapshot) : null,
      price_currency_snapshot: moneyVisible ? (u.price_currency_snapshot ?? null) : null,
      active: !u.reversed_at,
    })),
  };
}

// ───────────────────────────── stock management (admin) ─────────────────────────────

export async function createPart(client = defaultClient, actor = {}, body = {}) {
  const tenantId = adminTenant(actor);
  const actorUserId = actorId(actor);
  const money = moneyInputs(body);
  const { data, error } = await client.rpc('garage_ops06_create_part', {
    p_tenant_id: tenantId,
    p_name: text(body.name, 'name', 200, { required: true }),
    p_sku: text(body.sku, 'sku', 80, { required: true }),
    // an opening count is stated, never defaulted: 0 is a count, absence is a refusal
    p_opening_quantity: wholeNumber(body.opening_quantity, 'opening_quantity'),
    p_min_stock: optionalWhole(body.min_stock, 'min_stock'),
    p_supplier: text(body.supplier, 'supplier', 200),
    p_unit_cost: money.unit_cost,
    p_sell_price: money.sell_price,
    p_price_currency: money.price_currency,
    p_actor_user_id: actorUserId,
    p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw stockFailure(error, 'Could not create the part');
  return getPart(client, actor, one(data).id);
}

export async function updatePart(client = defaultClient, actor = {}, partId, body = {}) {
  const tenantId = adminTenant(actor);
  const patch = {};
  if ('name' in body) patch.name = text(body.name, 'name', 200, { required: true });
  if ('supplier' in body) patch.supplier = text(body.supplier, 'supplier', 200);
  if ('min_stock' in body) patch.min_stock = optionalWhole(body.min_stock, 'min_stock');
  if ('is_active' in body) patch.is_active = Boolean(body.is_active);
  if ('price_currency' in body) {
    patch.price_currency = body.price_currency ? requireCurrency(body.price_currency, 'price_currency') : null;
  }
  for (const k of ['unit_cost', 'sell_price']) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === undefined || v === '') { patch[k] = null; continue; }
    // With a currency in the same request the scale is checked here; otherwise the database checks the
    // amount against the part's existing currency (and refuses an amount that has none).
    patch[k] = patch.price_currency
      ? moneyAmount(v, k, patch.price_currency)
      : moneyAmount(v, k, 'USD', { max: 999999999999.99 }) && String(v).trim();
  }
  if (!Object.keys(patch).length) throw new ValidationError('Nothing to update');
  const { error } = await client.rpc('garage_ops06_update_part', {
    p_tenant_id: tenantId, p_part_id: String(partId), p_patch: patch, p_actor_user_id: actorId(actor),
  });
  if (error) throw stockFailure(error, 'Could not update the part');
  return getPart(client, actor, partId);
}

export async function receiveStock(client = defaultClient, actor = {}, partId, body = {}) {
  const tenantId = adminTenant(actor);
  const { error } = await client.rpc('garage_ops06_receive_stock', {
    p_tenant_id: tenantId, p_part_id: String(partId),
    p_quantity: wholeNumber(body.quantity, 'quantity', { min: 1 }),
    p_reason: text(body.reason, 'reason', 60),
    p_note: text(body.note, 'note', 500),
    p_actor_user_id: actorId(actor),
    p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw stockFailure(error, 'Could not receive stock');
  return getPart(client, actor, partId);
}

export async function countStock(client = defaultClient, actor = {}, partId, body = {}) {
  const tenantId = adminTenant(actor);
  const { error } = await client.rpc('garage_ops06_count_stock', {
    p_tenant_id: tenantId, p_part_id: String(partId),
    p_counted_quantity: wholeNumber(body.counted_quantity, 'counted_quantity'),
    p_reason: text(body.reason, 'reason', 60),
    p_note: text(body.note, 'note', 500),
    p_actor_user_id: actorId(actor),
    p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw stockFailure(error, 'Could not record the count');
  return getPart(client, actor, partId);
}

// ───────────────────────────── consumption (workspace) ─────────────────────────────

export async function consumeForService(client = defaultClient, actor = {}, recordId, body = {}) {
  const tenantId = workspaceTenant(actor);
  const logId = body.partsentry_log_id;
  const { data, error } = await client.rpc('garage_ops06_consume_for_service', {
    p_tenant_id: tenantId,
    p_service_record_id: String(recordId),
    p_part_id: text(body.part_id, 'part_id', 80, { required: true }),
    p_quantity: wholeNumber(body.quantity, 'quantity', { min: 1 }),
    p_partsentry_log_id: logId === undefined || logId === null || logId === '' ? null : wholeNumber(logId, 'partsentry_log_id', { min: 1 }),
    p_actor_user_id: actorId(actor),
    p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw stockFailure(error, 'Could not record the part used');
  return typeof data === 'string' ? JSON.parse(data) : one(data);
}

export async function reverseUsage(client = defaultClient, actor = {}, usageId, body = {}) {
  const tenantId = workspaceTenant(actor);
  const { data, error } = await client.rpc('garage_ops06_reverse_usage', {
    p_tenant_id: tenantId,
    p_usage_id: String(usageId),
    p_reason: text(body.reason, 'reason', 60, { required: true }),
    p_actor_user_id: actorId(actor),
    p_idempotency_key: idempotencyKey(body.idempotency_key),
  });
  if (error) throw stockFailure(error, 'Could not reverse the usage');
  return typeof data === 'string' ? JSON.parse(data) : one(data);
}

export default {
  listParts, getPart, listWorkOrderParts, createPart, updatePart, receiveStock, countStock, consumeForService, reverseUsage,
};
