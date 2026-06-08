import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { DatabaseError } from '../../utils/errors.js';

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

export async function listDiasporaAudit({ importOrderId, limit = 100 }) {
  let query = supabase
    .from('diaspora_import_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (importOrderId) query = query.eq('import_order_id', importOrderId);

  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}
