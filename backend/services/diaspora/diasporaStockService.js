/**
 * Phase 3 — Diaspora stock service.
 *
 * Draft stock items, descriptive updates (never quantity overwrite), tenant-scoped list/detail, and
 * reserve / release that delegate to the immutable ledger.
 */
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../utils/errors.js';
import {
  STOCK_CONDITIONS,
  STOCK_EXPORT_READINESS,
  STOCK_ITEM_EDITABLE_FIELDS,
  STOCK_ITEM_PROTECTED_FIELDS,
  STOCK_ITEM_REQUIRED_FOR_PUBLISH,
  STOCK_ITEM_COMPATIBILITY_FIELDS,
  STOCK_PUBLICATION_STATUSES,
  STOCK_PUBLICATION_TRANSITIONS,
  SUPPLY_DOCUMENT_STATUSES,
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

/**
 * Publication is stricter than read access: only the creating seller or a trusted platform
 * reviewer/admin (server-derived platformRole — never a client-supplied role) may change
 * publication state, and the creator must belong to the item's tenant when both are set.
 */
function assertCanChangePublication(item, context) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return;
  const isCreator = normalizeId(item.created_by) === context.id;
  if (!isCreator) {
    throw new ForbiddenError('Only the creating seller or a reviewer/admin may change stock publication');
  }
  const crossTenant = item.tenant_id && context.tenantId && normalizeId(item.tenant_id) !== context.tenantId;
  if (crossTenant) {
    throw new ForbiddenError('You do not have access to this stock item');
  }
}

function assertPublicationTransition(current, next) {
  const allowed = STOCK_PUBLICATION_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new ValidationError(`Cannot transition stock publication from ${current} to ${next}`);
  }
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

  // Optimistic concurrency: if the client sends the version it last saw and the row has since moved,
  // reject with 409 instead of silently clobbering a concurrent edit. Optional (backwards compatible).
  if (payload.expected_updated_at != null) {
    const seen = String(payload.expected_updated_at);
    const current = String(previous.updated_at);
    if (seen !== current) {
      throw new ConflictError('Stock item was modified by someone else. Reload and re-apply your changes.', {
        code: 'STALE_STOCK_VERSION',
        expected_updated_at: seen,
        current_updated_at: current,
      });
    }
  }

  for (const key of ['quantity_on_hand', 'quantity_reserved', 'quantity', 'initial_quantity']) {
    if (key in payload) {
      throw new ValidationError('Stock quantity cannot be set directly. Use a ledger movement instead.');
    }
  }
  for (const key of STOCK_ITEM_PROTECTED_FIELDS) {
    if (key in payload) {
      throw new ValidationError(`${key} is protected and cannot be set directly. Use the dedicated lifecycle endpoint instead.`);
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

/**
 * Publish a stock item so it becomes visible to demand/supply matching. Gated on required fields,
 * ledger availability (read from the stored row — never client input), and the linked supply
 * document (when present) being published/verified. Only publication_status changes; quantities
 * are never written here. Idempotent: re-publishing a PUBLISHED item replays without a new audit.
 */
export async function publishStockItem(id, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const previous = await getStockItem(id, context, options); // existence + not-deleted + read access
  assertCanChangePublication(previous, context);

  if (previous.publication_status === STOCK_PUBLICATION_STATUSES.PUBLISHED) {
    return { ...previous, idempotentReplay: true };
  }

  assertPublicationTransition(previous.publication_status, STOCK_PUBLICATION_STATUSES.PUBLISHED);

  // Required-field gate (unit_price must be a positive number, everything else non-empty).
  const missing = STOCK_ITEM_REQUIRED_FOR_PUBLISH.filter((field) => {
    if (field === 'unit_price') return !(Number(previous.unit_price) > 0);
    return !previous[field] || !String(previous[field]).trim();
  });
  const hasCompatibility = STOCK_ITEM_COMPATIBILITY_FIELDS.some(
    (field) => previous[field] && String(previous[field]).trim(),
  );
  if (!hasCompatibility) {
    missing.push(`one of ${STOCK_ITEM_COMPATIBILITY_FIELDS.join('/')}`);
  }
  if (missing.length) {
    throw new ValidationError(`Cannot publish: missing required fields ${missing.join(', ')}`, { missing });
  }

  // Ledger consistency: availability comes from the stored row, never recomputed from client input.
  const balances = deriveBalances(previous);
  if (!(balances.available > 0)) {
    throw new ValidationError('Cannot publish stock with zero available quantity. Add stock through the ledger first.');
  }

  // Supply-document gate: a linked document must itself be published (or verified) before the
  // stock that references it can go public.
  if (previous.supply_document_id) {
    const { data: doc } = await client
      .from('diaspora_supply_documents')
      .select('*')
      .eq('id', previous.supply_document_id)
      .is('deleted_at', null)
      .maybeSingle();
    const docVerified = String(doc?.verification_status || '').toUpperCase() === 'VERIFIED';
    if (doc && doc.status !== SUPPLY_DOCUMENT_STATUSES.PUBLISHED && !docVerified) {
      throw new ValidationError(`Cannot publish: linked supply document is ${doc.status}, not PUBLISHED`);
    }
  }

  const { data, error } = await client
    .from(STORAGE)
    .update({
      publication_status: STOCK_PUBLICATION_STATUSES.PUBLISHED,
      updated_by: context.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to publish stock item: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'STOCK_ITEM_PUBLISHED',
    resourceType: 'diaspora_stock_item',
    resourceId: id,
    previousState: previous,
    newState: data,
    req,
  });
  return { ...data, balances: deriveBalances(data), idempotentReplay: false };
}

/**
 * Withdraw a published stock item from matching (PUBLISHED -> UNPUBLISHED). Same authority rules
 * as publishing; idempotent on already-UNPUBLISHED items.
 */
export async function unpublishStockItem(id, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const previous = await getStockItem(id, context, options);
  assertCanChangePublication(previous, context);

  if (previous.publication_status === STOCK_PUBLICATION_STATUSES.UNPUBLISHED) {
    return { ...previous, idempotentReplay: true };
  }

  assertPublicationTransition(previous.publication_status, STOCK_PUBLICATION_STATUSES.UNPUBLISHED);

  const { data, error } = await client
    .from(STORAGE)
    .update({
      publication_status: STOCK_PUBLICATION_STATUSES.UNPUBLISHED,
      updated_by: context.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to unpublish stock item: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'STOCK_ITEM_UNPUBLISHED',
    resourceType: 'diaspora_stock_item',
    resourceId: id,
    previousState: previous,
    newState: data,
    req,
  });
  return { ...data, balances: deriveBalances(data), idempotentReplay: false };
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
