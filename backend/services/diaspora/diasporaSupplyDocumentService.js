/**
 * Phase 3 — Diaspora supply-document service.
 *
 * Sellers draft, edit, and publish supply documents through a controlled state machine. Publication
 * is gated on required fields; transitions are validated; every mutation is audited.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  SUPPLY_DOCUMENT_STATUSES,
  SUPPLY_DOCUMENT_TRANSITIONS,
  SUPPLY_DOCUMENT_REQUIRED_FOR_PUBLISH,
} from '../../constants/diaspora/diasporaStockConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { requireFeature, withEntitlement } from './diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../constants/diaspora/diasporaEntitlements.js';

const STORAGE = 'diaspora_supply_documents';
const EDITABLE = ['document_number', 'title', 'origin_country', 'origin_city', 'valid_from', 'valid_until', 'seller_trade_profile_id', 'metadata'];

function assertOwnership(doc, context) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return;
  const owns = [doc.created_by, doc.updated_by].some((c) => normalizeId(c) === context.id);
  const sameTenant = doc.tenant_id && context.tenantId && normalizeId(doc.tenant_id) === context.tenantId;
  if (!owns && !sameTenant) throw new ForbiddenError('You do not have access to this supply document');
}

function assertTransition(current, next) {
  const allowed = SUPPLY_DOCUMENT_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new ValidationError(`Cannot transition supply document from ${current} to ${next}`);
  }
}

export async function createSupplyDocument(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  if (!payload.document_number || !String(payload.document_number).trim()) {
    throw new ValidationError('document_number is required');
  }
  if (!payload.title || !String(payload.title).trim()) {
    throw new ValidationError('title is required');
  }

  // Gate on diaspora.stock.create AFTER validation, so an invalid payload still fails with its
  // existing 400 rather than a confusing 403. No quota is reserved: stock.max_items is a
  // point-in-time ceiling reserved at PUBLISH, and reserving it here too would double-count.
  await requireFeature(client, {
    tenantId: context.tenantId || payload.tenant_id || null,
    userId: context.id,
    featureKey: FEATURE_KEYS.STOCK_CREATE,
  });

  const row = {
    tenant_id: context.tenantId || payload.tenant_id || null,
    seller_trade_profile_id: payload.seller_trade_profile_id || null,
    document_number: String(payload.document_number).trim(),
    title: String(payload.title).trim(),
    status: SUPPLY_DOCUMENT_STATUSES.DRAFT,
    origin_country: payload.origin_country || null,
    origin_city: payload.origin_city || null,
    valid_from: payload.valid_from || null,
    valid_until: payload.valid_until || null,
    verification_status: 'UNVERIFIED',
    publication_status: 'PRIVATE',
    metadata: payload.metadata || {},
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(STORAGE).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create supply document: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'SUPPLY_DOCUMENT_CREATED',
    resourceType: 'diaspora_supply_document',
    resourceId: data.id,
    newState: data,
    req,
  });
  return data;
}

export async function listSupplyDocuments(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);

  let query = client
    .from(STORAGE)
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.status) query = query.eq('status', filters.status);
  if (context.tenantId) query = query.eq('tenant_id', context.tenantId);
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context) && !context.tenantId) {
    query = query.eq('created_by', context.id);
  }

  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list supply documents: ${error.message}`);
  return data || [];
}

export async function getSupplyDocument(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data, error } = await client.from(STORAGE).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora supply document not found');
  assertOwnership(data, context);
  return data;
}

export async function updateSupplyDocument(id, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await getSupplyDocument(id, context, options);

  if (previous.status !== SUPPLY_DOCUMENT_STATUSES.DRAFT && previous.status !== SUPPLY_DOCUMENT_STATUSES.UNPUBLISHED) {
    throw new ValidationError(`Supply document can only be edited while DRAFT or UNPUBLISHED (current: ${previous.status})`);
  }

  const update = { updated_by: context.id, updated_at: new Date().toISOString() };
  for (const field of EDITABLE) {
    if (field in payload) update[field] = payload[field];
  }

  const { data, error } = await client.from(STORAGE).update(update).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to update supply document: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'SUPPLY_DOCUMENT_UPDATED',
    resourceType: 'diaspora_supply_document',
    resourceId: id,
    previousState: previous,
    newState: data,
    req,
  });
  return data;
}

export async function publishSupplyDocument(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await getSupplyDocument(id, context, options);

  assertTransition(previous.status, SUPPLY_DOCUMENT_STATUSES.PUBLISHED);

  const missing = SUPPLY_DOCUMENT_REQUIRED_FOR_PUBLISH.filter((f) => !previous[f] || !String(previous[f]).trim());
  if (missing.length) {
    throw new ValidationError(`Cannot publish: missing required fields ${missing.join(', ')}`, { missing });
  }

  // Phase 8 (M2): gate publish on the diaspora.stock.publish feature and reserve a
  // diaspora.stock.max_items slot. Flag-gated — a no-op (identical behavior) when enforcement is OFF;
  // a failed DB write/audit releases the reserved slot so it is never permanently consumed.
  return withEntitlement(client, {
    tenantId: previous.tenant_id ?? context.tenantId ?? null,
    userId: context.id,
    featureKey: FEATURE_KEYS.STOCK_PUBLISH,
    quotaFeatureKey: FEATURE_KEYS.STOCK_MAX_ITEMS,
    amount: 1,
    idempotencyKey: `stock-publish:${id}`,
    req,
  }, async () => {
    const { data, error } = await client
      .from(STORAGE)
      .update({
        status: SUPPLY_DOCUMENT_STATUSES.PUBLISHED,
        publication_status: 'PUBLISHED',
        updated_by: context.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new ValidationError(`Failed to publish supply document: ${error.message}`);

    await appendAudit(client, {
      actorId: context.id,
      tenantId: data.tenant_id,
      action: 'SUPPLY_DOCUMENT_PUBLISHED',
      resourceType: 'diaspora_supply_document',
      resourceId: id,
      previousState: previous,
      newState: data,
      req,
    });
    return data;
  });
}

export async function unpublishSupplyDocument(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const previous = await getSupplyDocument(id, context, options);

  assertTransition(previous.status, SUPPLY_DOCUMENT_STATUSES.UNPUBLISHED);

  const { data, error } = await client
    .from(STORAGE)
    .update({
      status: SUPPLY_DOCUMENT_STATUSES.UNPUBLISHED,
      publication_status: 'PRIVATE',
      updated_by: context.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to unpublish supply document: ${error.message}`);

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'SUPPLY_DOCUMENT_UNPUBLISHED',
    resourceType: 'diaspora_supply_document',
    resourceId: id,
    previousState: previous,
    newState: data,
    req,
  });
  return data;
}
