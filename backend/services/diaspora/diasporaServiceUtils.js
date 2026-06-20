/**
 * Shared helpers for Diaspora Trade OS Phase 3-7 services.
 *
 * - resolveClient: returns the injected client (tests) or the singleton service-role client (prod),
 *   so every service is testable with an in-memory mock via `options.supabaseClient`.
 * - appendAudit: writes a cryptographically sealed audit row through the SAME (possibly injected)
 *   client, keeping audit calls testable and consistent with diaspora_import_audit_log.
 */
import { buildAuditSeal } from './diasporaAuditService.js';

export async function resolveClient(options = {}) {
  if (options.supabaseClient) return options.supabaseClient;
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

/**
 * Append a sealed audit event. Best-effort by default so a non-critical audit failure never breaks a
 * primary mutation, but the seal + shape match diasporaAuditService.writeDiasporaAudit exactly.
 */
export async function appendAudit(client, {
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
  const cryptographicSeal = buildAuditSeal({
    actorId,
    action,
    resourceType,
    resourceId,
    timestamp,
    payload: { previousState, newState, metadata },
  });

  const { data, error } = await client
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

  if (error) {
    // Surface only in non-production; never throw on audit so the domain mutation result stands.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[diaspora audit] failed to write ${action}: ${error.message}`);
    }
    return null;
  }
  return data;
}

/** Stable correlation id from the request, for audit/idempotency metadata. */
export function requestCorrelationId(req) {
  return req?.requestId || req?.correlationId || req?.headers?.['x-request-id'] || req?.headers?.['x-correlation-id'] || null;
}

/** Coerce to a finite number or throw a ValidationError-friendly null. */
export function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a paging window. */
export function paging({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return { limit: safeLimit, offset: safeOffset };
}
