import { supabase } from '../db/supabase.js';

const SENSITIVE_KEYS = ['password', 'token', 'api_key', 'secret', 'key', 'credential', 'auth', 'signature'];

/**
 * Deeply redacts sensitive keys from any logging payload
 */
function redact(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk));
    if (isSensitive && val !== null && val !== undefined) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object') {
      result[key] = redact(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function normalizeArgs(clientOrEvent, maybeEvent) {
  if (clientOrEvent?.from && maybeEvent) {
    return { client: clientOrEvent, event: maybeEvent };
  }

  return { client: supabase, event: clientOrEvent || {} };
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function requestHeader(req, key) {
  const value = req?.headers?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function requestContext(req) {
  return {
    requestId: req?.requestId || req?.correlationId || requestHeader(req, 'x-request-id') || requestHeader(req, 'x-correlation-id') || null,
    ipAddress: req?.ip || requestHeader(req, 'x-forwarded-for') || null,
    userAgent: requestHeader(req, 'user-agent') || null
  };
}

function normalizeTrustAuditEvent(event) {
  const req = event.req;
  const request = requestContext(req);
  const actorUserId = event.actor_user_id || event.actorUserId || event.actorId || req?.userContext?.id || req?.userContext?.userId || null;
  const actorRole = event.actor_role || event.actorRole || req?.userContext?.effectiveRole || req?.userContext?.role || null;
  const actorTenantId = event.actor_tenant_id || event.actorTenantId || req?.userContext?.tenantId || requestHeader(req, 'x-tenant-id') || null;
  const actorType = event.actor_type || event.actorType || (actorRole === 'system' ? 'system' : 'user');
  const metadata = event.metadata || {};
  const targetType = event.targetType || event.target_type || null;
  const targetId = event.targetId || event.target_id || null;

  return {
    event_type: event.event_type || event.eventType || event.action || 'UNKNOWN_AUDIT_EVENT',
    vin: event.vin || metadata.vin || (targetType === 'vehicle' ? targetId : null),
    vehicle_id: event.vehicle_id || event.vehicleId || (targetType === 'vehicle' ? targetId : null),
    trust_fact: event.trust_fact || event.trustFact || null,
    previous_value: event.previous_value ?? event.previousValue ?? null,
    new_value: event.new_value ?? event.newValue ?? null,
    actor_user_id: actorUserId,
    actor_role: actorRole,
    actor_tenant_id: actorTenantId,
    actor_type: actorType,
    source_dashboard: event.source_dashboard || event.sourceDashboard || null,
    source_route: event.source_route || event.sourceRoute || req?.route?.path || req?.path || req?.originalUrl || null,
    evidence_ids: normalizeArray(event.evidence_ids || event.evidenceIds || (targetType === 'evidence' ? targetId : null)),
    partsentry_log_ids: normalizeArray(event.partsentry_log_ids || event.partsentryLogIds || (targetType === 'partsentry_log' ? targetId : null)),
    registry_verification_id: event.registry_verification_id || event.registryVerificationId || null,
    safepay_transaction_id: event.safepay_transaction_id || event.safepayTransactionId || null,
    reason: event.reason || null,
    decision_notes: event.decision_notes || event.decisionNotes || event.notes || metadata.notes || null,
    request_id: event.request_id || event.requestId || request.requestId,
    ip_address: event.ip_address || event.ipAddress || request.ipAddress,
    user_agent: event.user_agent || event.userAgent || request.userAgent
  };
}

async function writeLegacyOrganizationAudit(client, event, trustEvent) {
  const req = event.req;
  const userId = trustEvent.actor_user_id || 'system';
  let orgId = event.organization_id || event.organizationId || req?.headers?.['x-tenant-id'] || req?.userContext?.tenantId;

  if (!orgId && userId && userId !== 'system') {
    const { data } = await client
      .from('organization_users')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.organization_id) {
      orgId = data.organization_id;
    }
  }

  if (!orgId) {
    orgId = 'org_croco';
  }

  const detailsObj = {
    correlationId: trustEvent.request_id || 'system-global',
    ipAddress: trustEvent.ip_address || '127.0.0.1',
    userAgent: trustEvent.user_agent || 'System',
    actorRole: trustEvent.actor_role || 'system',
    targetId: event.targetId || event.target_id || trustEvent.vehicle_id || null,
    status: event.status || 'success',
    severity: event.severity || 'info',
    metadata: redact(event.metadata || {})
  };

  return client
    .from('organization_audit_logs')
    .insert({
      organization_id: orgId,
      user_id: userId,
      action: trustEvent.event_type,
      resource: event.targetType || event.target_type || trustEvent.trust_fact || 'trust_audit',
      details: JSON.stringify(detailsObj),
      timestamp: new Date().toISOString(),
      ip_address: trustEvent.ip_address || '127.0.0.1'
    });
}

/**
 * Centrally log an audit event to the database.
 *
 * Supports `logAuditEvent(client, event)` and the legacy route-local
 * `logAuditEvent(event)` shape. Audit failures are reported but not thrown.
 */
export async function logAuditEvent(clientOrEvent, maybeEvent) {
  const { client, event } = normalizeArgs(clientOrEvent, maybeEvent);
  const trustEvent = normalizeTrustAuditEvent(event);

  try {
    const { error } = await client
      .from('trust_audit_events')
      .insert({
        ...trustEvent,
        previous_value: trustEvent.previous_value === undefined ? null : redact(trustEvent.previous_value),
        new_value: trustEvent.new_value === undefined ? null : redact(trustEvent.new_value)
      });

    if (!error) {
      writeLegacyOrganizationAudit(client, event, trustEvent).catch(() => {});
      return { success: true, event: trustEvent };
    }

    const legacyResult = await writeLegacyOrganizationAudit(client, event, trustEvent);
    if (!legacyResult.error) {
      return { success: true, warning: error.message, event: trustEvent };
    }

    return { success: false, error: error.message, fallbackError: legacyResult.error.message, event: trustEvent };
  } catch (error) {
    return { success: false, error: error.message, event: trustEvent };
  }
}

export { redact, normalizeTrustAuditEvent };
