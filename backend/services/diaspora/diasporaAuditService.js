import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { DatabaseError, ForbiddenError } from '../../utils/errors.js';
import { assertCanReadImportOrder, isPlatformReviewer, requireUserContext } from './diasporaAuthorization.js';

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
    };
  }
  // Fixed, non-extensible allowlist; never spread a database row here.
  return {
    id: row.id,
    action: row.action,
    resource_type: row.resource_type,
    created_at: row.created_at,
  };
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
