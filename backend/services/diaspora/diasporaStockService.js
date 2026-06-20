/**
 * Phase 3 — Diaspora stock service.
 *
 * Draft stock items, descriptive updates (never quantity overwrite), tenant-scoped list/detail, and
 * reserve / release that delegate to the immutable ledger.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  STOCK_CONDITIONS,
  STOCK_EXPORT_READINESS,
  STOCK_ITEM_EDITABLE_FIELDS,
} from '../../constants/diaspora/diasporaStockConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { appendStockMovement, deriveBalances } from './diasporaStockLedgerService.js';
import { STOCK_LEDGER_ACTIONS } from '../../constants/diaspora/diasporaStockConstants.js';

const STORAGE = 'diaspora_stock_items';

function assertOwnership(item, context) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return;
  const owns = [item.created_by, item.updated_by].some((c) => normalizeId(c) === context.id);
  const sameTenant = item.tenant_id && context.tenantId && normalizeId(item.tenant_id) === context.tenantId;
  if (!owns && !sameTenant) throw new ForbiddenError('You do not have access to this stock item');
}

export async function createStockItem(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  if (!payload.part_name || !String(payload.part_name).trim()) {
    throw new ValidationError('part_name is required to create a stock item');
  }
  if (payload.condition && !STOCK_CONDITIONS.includes(payload.condition)) {
    throw new ValidationError(`Invalid condition. Allowed: ${STOCK_CONDITIONS.join(', ')}`);
  }
  if (payload.export_readiness_status && !STOCK_EXPORT_READINESS.includes(payload.export_readiness_status)) {
    throw new ValidationError(`Invalid export_readiness_status. Allowed: ${STOCK_EXPORT_READINESS.join(', ')}`);
  }

  const initialQty = Number(payload.initial_quantity || 0);
  if (initialQty < 0) throw new ValidationError('initial_quantity cannot be negative');

  const row = {
    tenant_id: context.tenantId || payload.tenant_id || null,
    seller_trade_profile_id: payload.seller_trade_profile_id || null,
    supply_document_id: payload.supply_document_id || null,
    sku: payload.sku || null,
    part_name: String(payload.part_name).trim(),
    part_number: payload.part_number || null,
    oem_number: payload.oem_number || null,
    aftermarket_number: payload.aftermarket_number || null,
    vehicle_make: payload.vehicle_make || null,
    vehicle_model: payload.vehicle_model || null,
    vehicle_year_min: payload.vehicle_year_min ?? null,
    vehicle_year_max: payload.vehicle_year_max ?? null,
    condition: payload.condition || 'USED',
    origin_country: payload.origin_country || null,
    origin_city: payload.origin_city || null,
    warehouse_location: payload.warehouse_location || null,
    quantity_on_hand: 0,
    quantity_reserved: 0,
    unit_cost: payload.unit_cost ?? null,
    unit_price: payload.unit_price ?? null,
    currency: payload.currency || 'USD',
    export_readiness_status: payload.export_readiness_status || 'DRAFT',
    verification_status: 'UNVERIFIED',
    publication_status: 'PRIVATE',
    metadata: payload.metadata || {},
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(STORAGE).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create stock item: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'STOCK_ITEM_CREATED',
    resourceType: 'diaspora_stock_item',
    resourceId: data.id,
    newState: data,
    req,
  });

  // Seed opening balance through the ledger (never a direct quantity write).
  if (initialQty > 0) {
    const { stockItem } = await appendStockMovement(
      data.id,
      { action: STOCK_LEDGER_ACTIONS.ADD, quantity: initialQty, reason: 'Opening balance', source: 'ui', idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:open` : null },
      context,
      options,
    );
    return stockItem;
  }
  return data;
}

export async function listStockItems(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);

  let query = client
    .from(STORAGE)
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.publicationStatus) query = query.eq('publication_status', filters.publicationStatus);
  if (filters.exportReadiness) query = query.eq('export_readiness_status', filters.exportReadiness);
  if (filters.supplyDocumentId) query = query.eq('supply_document_id', filters.supplyDocumentId);

  // Tenant scoping: privileged roles see the tenant; sellers see only their own items.
  if (context.tenantId) {
    query = query.eq('tenant_id', context.tenantId);
  }
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context) && !context.tenantId) {
    query = query.eq('created_by', context.id);
  }

  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list stock items: ${error.message}`);
  return (data || []).map((item) => ({ ...item, balances: deriveBalances(item) }));
}

export async function getStockItem(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data, error } = await client.from(STORAGE).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora stock item not found');
  assertOwnership(data, context);
  return { ...data, balances: deriveBalances(data) };
}

/** Descriptive update only. Quantity columns are rejected — they change only via the ledger. */
export async function updateStockItem(id, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const previous = await getStockItem(id, context, options);

  for (const key of ['quantity_on_hand', 'quantity_reserved', 'quantity', 'initial_quantity']) {
    if (key in payload) {
      throw new ValidationError('Stock quantity cannot be set directly. Use a ledger movement instead.');
    }
  }
  if (payload.condition && !STOCK_CONDITIONS.includes(payload.condition)) {
    throw new ValidationError(`Invalid condition. Allowed: ${STOCK_CONDITIONS.join(', ')}`);
  }
  if (payload.export_readiness_status && !STOCK_EXPORT_READINESS.includes(payload.export_readiness_status)) {
    throw new ValidationError(`Invalid export_readiness_status. Allowed: ${STOCK_EXPORT_READINESS.join(', ')}`);
  }

  const update = { updated_by: context.id, updated_at: new Date().toISOString() };
  for (const field of STOCK_ITEM_EDITABLE_FIELDS) {
    if (field in payload) update[field] = payload[field];
  }

  const { data, error } = await client.from(STORAGE).update(update).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to update stock item: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'STOCK_ITEM_UPDATED',
    resourceType: 'diaspora_stock_item',
    resourceId: id,
    previousState: previous,
    newState: data,
    req,
  });
  return { ...data, balances: deriveBalances(data) };
}

export async function reserveStock(id, payload = {}, userContext = {}, options = {}) {
  const quantity = Number(payload.quantity);
  if (!(quantity > 0)) throw new ValidationError('reserve requires a positive quantity');
  const { ledgerEntry, stockItem, idempotentReplay } = await appendStockMovement(
    id,
    {
      action: STOCK_LEDGER_ACTIONS.RESERVE,
      quantity,
      reason: payload.reason || 'Reserved against order/RFQ',
      importOrderId: payload.importOrderId || null,
      reservationRef: payload.reservationRef || null,
      idempotencyKey: payload.idempotencyKey || null,
      source: payload.source || 'ui',
    },
    userContext,
    options,
  );
  return { ledgerEntry, stockItem: { ...stockItem, balances: deriveBalances(stockItem) }, idempotentReplay };
}

export async function releaseReservation(id, payload = {}, userContext = {}, options = {}) {
  const quantity = Number(payload.quantity);
  if (!(quantity > 0)) throw new ValidationError('release-reservation requires a positive quantity');
  const { ledgerEntry, stockItem, idempotentReplay } = await appendStockMovement(
    id,
    {
      action: STOCK_LEDGER_ACTIONS.RELEASE_RESERVATION,
      quantity,
      reason: payload.reason || 'Released reservation',
      importOrderId: payload.importOrderId || null,
      reservationRef: payload.reservationRef || null,
      idempotencyKey: payload.idempotencyKey || null,
      source: payload.source || 'ui',
    },
    userContext,
    options,
  );
  return { ledgerEntry, stockItem: { ...stockItem, balances: deriveBalances(stockItem) }, idempotentReplay };
}
