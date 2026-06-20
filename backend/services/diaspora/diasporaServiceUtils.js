/**
 * Shared helpers for Diaspora Trade OS Phase 3-7 services.
 *
 * - resolveClient: returns the injected client (tests) or the singleton service-role client (prod),
 *   so every service is testable with an in-memory mock via `options.supabaseClient`.
 * - appendAudit: writes a cryptographically sealed audit row through the SAME (possibly injected)
 *   client, keeping audit calls testable and consistent with diaspora_import_audit_log.
 */
import { buildAuditSeal } from './diasporaAuditService.js';
import { DatabaseError } from '../../utils/errors.js';

export async function resolveClient(options = {}) {
  if (options.supabaseClient) return options.supabaseClient;
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

/**
 * Audit policy (H5).
 *
 * The integrity-critical mutations — stock movement, quote acceptance, container approval — write
 * their audit row INSIDE the atomic RPC transaction (see the H1/H2/H3 SQL functions), so audit
 * failure rolls the whole mutation back. That is the strongest guarantee and is proven by the
 * RPC rollback tests.
 *
 * For JS-orchestrated mutations there are two explicit helpers:
 *  - appendCriticalAudit: throws on failure (fail-loud, never silently swallowed). Used for
 *    security-relevant lifecycle mutations (AI approve/reject/execute, reservation reject/cancel,
 *    Drive connect/disconnect/upload).
 *  - appendBestEffortAudit: returns null on failure (telemetry / descriptive create/update).
 *
 * `appendAudit` remains as an explicit alias of the best-effort helper for existing call sites.
 */
async function writeAuditRow(client, {
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
    actorId, action, resourceType, resourceId, timestamp,
    payload: { previousState, newState, metadata },
  });
  return client
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
}

/** Critical audit — throws if the audit row cannot be written. Use for security-relevant mutations. */
export async function appendCriticalAudit(client, fields) {
  const { data, error } = await writeAuditRow(client, fields);
  if (error) {
    throw new DatabaseError(`Critical audit write failed for ${fields.action}: ${error.message}`);
  }
  return data;
}

/** Best-effort audit — never throws; used for telemetry / descriptive create/update. */
export async function appendBestEffortAudit(client, fields) {
  const { data, error } = await writeAuditRow(client, fields);
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[diaspora audit] best-effort write failed for ${fields.action}: ${error.message}`);
    }
    return null;
  }
  return data;
}

// Backward-compatible alias (best-effort) for existing call sites.
export const appendAudit = appendBestEffortAudit;

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
