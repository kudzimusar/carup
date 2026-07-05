// Communication audit trail writer (Command Center plan §8).
//
// Appends one row per material communication mutation to communication_audit_events
// (database/migrations/20260705170000_communication_audit_events.sql). Deliberately fail-soft: an
// audit write must NEVER break the mutation it records, so failures are swallowed and logged. The
// existing auditLogger.js targets vehicle/trust tables and cannot represent these events.

export const COMMUNICATION_AUDIT_EVENTS = Object.freeze({
  INBOUND_RECEIVED: 'inbound_received',
  AI_CLASSIFIED: 'ai_classified',
  AI_DRAFTED: 'ai_drafted',
  ASSIGNED: 'assigned',
  REASSIGNED: 'reassigned',
  ESCALATED: 'escalated',
  REPLY_SENT: 'reply_sent',
  INTERNAL_NOTE: 'internal_note',
  QUEUE_CLAIMED: 'queue_claimed',
  DELIVERY_ATTEMPT: 'delivery_attempt',
  DELIVERY_RECEIPT: 'delivery_receipt',
  RETRY_SCHEDULED: 'retry_scheduled',
  CANCELLED: 'cancelled',
  DEAD_LETTERED: 'dead_lettered',
  RESOLVED: 'resolved',
  REOPENED: 'reopened',
  PRIORITY_CHANGED: 'priority_changed',
  SLA_PAUSED: 'sla_paused',
  SLA_RESUMED: 'sla_resumed',
  IDENTITY_LINKED: 'identity_linked',
  PREFERENCE_CHANGED: 'preference_changed',
  CONSENT_CHANGED: 'consent_changed',
  MARKED_READ: 'marked_read',
  SMOKE_TEST: 'smoke_test',
});

const ACTOR_TYPES = new Set(['agent', 'admin', 'system', 'worker', 'ai', 'customer', 'platform']);

// Map a request userContext (or a worker/system marker) to an audit actor.
export function auditActorFromContext(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return { actor_type: 'system', actor_id: null };
  if (ctx.actor === 'worker_secret' || ctx.role === 'worker') return { actor_type: 'worker', actor_id: ctx.id || 'communication-worker' };
  const platformRole = ctx.platformRole || ctx.baseRole || ctx.role || '';
  const actorType = ['admin', 'platform_admin', 'super_admin'].includes(platformRole) ? 'admin' : 'agent';
  return { actor_type: actorType, actor_id: ctx.id || ctx.userId || null };
}

/**
 * Append an audit event. Returns the inserted row, or null on missing repository / missing
 * event_type / write failure (never throws).
 */
export async function logCommunicationAuditEvent(repository, event = {}) {
  if (!repository || typeof repository.insert !== 'function' || !event.event_type) return null;
  const actorType = ACTOR_TYPES.has(event.actor_type) ? event.actor_type : 'system';
  const row = {
    tenant_id: event.tenant_id ?? null,
    thread_id: event.thread_id ?? null,
    message_id: event.message_id ?? null,
    notification_id: event.notification_id ?? null,
    event_type: event.event_type,
    actor_type: actorType,
    actor_id: event.actor_id ?? null,
    channel: event.channel ?? null,
    summary: event.summary ?? null,
    correlation_id: event.correlation_id ?? null,
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  };
  try {
    return await repository.insert('communication_audit_events', row);
  } catch (error) {
    // Fail-soft: audit must not break the mutation. Emit a structured line for ops visibility.
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ event: 'communication_audit_write_failed', event_type: row.event_type, thread_id: row.thread_id, error: error?.message }));
    return null;
  }
}
