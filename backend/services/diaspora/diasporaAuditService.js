import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { DatabaseError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { assertCanReadImportOrder, isPlatformReviewer, requireUserContext } from './diasporaAuthorization.js';

const KNOWN_ORDER_STATUSES = new Set(Object.values(IMPORT_ORDER_STATUSES));
/**
 * Resource types whose rows an authorized order reader already receives in the order read-model
 * (getImportOrder embeds participants, quotes, trade documents, cargo reservations, shipments,
 * compliance reviews and payment milestones). Only for these does the redacted timeline carry
 * resource_id, so the UI can de-duplicate and describe entries from records it already holds.
 * Government documents, vehicle import records, SafeTrade, stock, Drive, AI and workbook rows are
 * NOT in the read-model, so their identifiers stay forensic-only.
 */
const ORDER_READ_MODEL_RESOURCE_TYPES = new Set([
  'diaspora_import_order', 'diaspora_import_quote', 'diaspora_import_order_participant', 'diaspora_trade_document',
  'diaspora_cargo_reservation', 'diaspora_shipment', 'diaspora_compliance_review', 'diaspora_payment_milestone',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildAuditSeal({ actorId, action, resourceType, resourceId, timestamp, payload }) {
  return crypto
    .createHash('sha256')
    .update(`${actorId || 'system'}|${action}|${resourceType}|${resourceId}|${timestamp}|${JSON.stringify(payload || {})}`)
    .digest('hex');
}

export async function writeDiasporaAudit({
  importOrderId = null,
  actorId = null,
  tenantId = null,
  action,
  resourceType,
  resourceId = null,
  previousState = null,
  newState = null,
  metadata = {},
  req = null,
}) {
  const timestamp = new Date().toISOString();
  const cryptographicSeal = buildAuditSeal({ actorId, action, resourceType, resourceId, timestamp, payload: { previousState, newState, metadata } });

  const { data, error } = await supabase
    .from('diaspora_import_audit_log')
    .insert({
      import_order_id: importOrderId,
      tenant_id: tenantId,
      actor_id: actorId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      previous_state: previousState,
      new_state: newState,
      metadata,
      cryptographic_seal: cryptographicSeal,
      ip_address: req?.ip || null,
      user_agent: req?.headers?.['user-agent'] || null,
    })
    .select()
    .single();

  if (error) throw new DatabaseError(error.message);
  return data;
}

/**
 * R6-F17/B16: never return the raw audit row to ordinary order readers.
 * R6-B17: route must prove order access before any audit read.
 * The database migration revokes direct REST SELECT from non-service roles.
 */
/**
 * R2C derived timeline fields. They let an ordinary authorized reader see the same activity
 * timeline as before (which status the order moved between, whether it was them, whether the
 * entry is sealed) WITHOUT receiving raw snapshots, metadata, actor identifiers, IP/UA or seals:
 *  - status_from / status_to: only on IMPORT_ORDER_STATUS_CHANGED, and only when the value is a
 *    canonical order status (an allowlist — never an arbitrary snapshot value). The reader can
 *    already see the order's status, so this discloses nothing new.
 *  - actor_relation: 'you' | 'other' | 'system' relative to the signed-in reader — never an id.
 *  - sealed: whether a cryptographic seal exists — never the seal itself.
 */
function derivedTimelineFields(row, context) {
  const fields = {};
  if (row.action === 'IMPORT_ORDER_STATUS_CHANGED') {
    const from = row.previous_state?.status;
    const to = row.new_state?.status;
    fields.status_from = KNOWN_ORDER_STATUSES.has(from) ? from : null;
    fields.status_to = KNOWN_ORDER_STATUSES.has(to) ? to : null;
  }
  const actor = row.actor_id === undefined || row.actor_id === null ? null : String(row.actor_id);
  fields.actor_relation = actor === null ? 'system' : actor === context.id ? 'you' : 'other';
  fields.sealed = Boolean(row.cryptographic_seal);
  return fields;
}

export function projectDiasporaAudit(row, userContext = {}) {
  const context = requireUserContext(userContext);
  if (isPlatformReviewer(context)) {
    // Full forensic fields only for server-derived platform reviewer authority.
    return {
      id: row.id, import_order_id: row.import_order_id, tenant_id: row.tenant_id,
      actor_id: row.actor_id, action: row.action,
      resource_type: row.resource_type, resource_id: row.resource_id,
      previous_state: row.previous_state, new_state: row.new_state,
      metadata: row.metadata, cryptographic_seal: row.cryptographic_seal,
      ip_address: row.ip_address, user_agent: row.user_agent,
      verification_status: row.verification_status, created_at: row.created_at,
      ...derivedTimelineFields(row, context),
    };
  }
  // Fixed, non-extensible allowlist; never spread a database row here.
  return {
    id: row.id,
    action: row.action,
    resource_type: row.resource_type,
    ...(ORDER_READ_MODEL_RESOURCE_TYPES.has(row.resource_type) && row.resource_id != null ? { resource_id: String(row.resource_id) } : {}),
    created_at: row.created_at,
    ...derivedTimelineFields(row, context),
  };
}

/**
 * C02: the reviewer-wide audit listing (GET /api/diaspora/audit). Before R2 it answered any route-level
 * reviewer role INCLUDING 'dealer' and plain 'admin' with raw rows across every order. It now serves
 * only server-derived platform reviewers (users.role), with the forensic projection, optionally
 * narrowed to one existing order. Everyone else is refused before any audit query.
 */
export async function listDiasporaAuditForReviewer({ importOrderId = null, limit = 100, userContext }) {
  const context = requireUserContext(userContext);
  if (!isPlatformReviewer(context)) {
    throw new ForbiddenError('The reviewer-wide Diaspora audit is limited to platform reviewers');
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  let query = supabase.from('diaspora_import_audit_log')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (importOrderId !== null && importOrderId !== undefined && String(importOrderId) !== '') {
    const id = String(importOrderId);
    if (!UUID_PATTERN.test(id)) throw new NotFoundError('Diaspora import order not found');
    const { data: order, error: orderError } = await supabase
      .from('diaspora_import_orders').select('id').eq('id', id).is('deleted_at', null).maybeSingle();
    if (orderError) throw new DatabaseError(orderError.message);
    if (!order) throw new NotFoundError('Diaspora import order not found');
    query = query.eq('import_order_id', id);
  }
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return (data || []).map(row => projectDiasporaAudit(row, context));
}

export async function listDiasporaAudit({ importOrderId, limit = 100, userContext, authorizedOrder }) {
  const context = requireUserContext(userContext);
  if (!importOrderId || !authorizedOrder || String(authorizedOrder.id) !== String(importOrderId)) {
    throw new ForbiddenError('Authorized import order context required before audit access');
  }
  assertCanReadImportOrder(
    authorizedOrder,
    authorizedOrder.diaspora_import_order_participants || [],
    context,
  );
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const { data, error } = await supabase.from('diaspora_import_audit_log')
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new DatabaseError(error.message);
  return (data || []).map(row => projectDiasporaAudit(row, context));
}
