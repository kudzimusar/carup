// Presentation helpers for the communication audit trail (Command Center plan §8).
// Pure + unit-tested; maps audit event types to human labels and a semantic tone, and shapes an
// event for the AuditDrawer/timeline. Mirrors communication_audit_events / communicationAuditLog.js.

import { titleCase } from '../communicationFormatting'

export interface AuditEvent {
  id: string
  event_type: string
  actor_type?: string | null
  actor_id?: string | null
  channel?: string | null
  summary?: string | null
  correlation_id?: string | null
  thread_id?: string | null
  message_id?: string | null
  notification_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export type AuditTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info'

// Canonical event-type → { label, tone }. Unknown types fall back to a title-cased label.
const EVENT_META: Record<string, { label: string; tone: AuditTone }> = {
  inbound_received: { label: 'Inbound received', tone: 'info' },
  ai_classified: { label: 'AI classified', tone: 'info' },
  ai_drafted: { label: 'AI drafted reply', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'neutral' },
  reassigned: { label: 'Reassigned', tone: 'neutral' },
  escalated: { label: 'Escalated', tone: 'warning' },
  reply_sent: { label: 'Reply sent', tone: 'positive' },
  internal_note: { label: 'Internal note', tone: 'neutral' },
  queue_claimed: { label: 'Queue claimed', tone: 'neutral' },
  delivery_attempt: { label: 'Delivery attempt', tone: 'info' },
  delivery_receipt: { label: 'Delivery receipt', tone: 'positive' },
  retry_scheduled: { label: 'Retry scheduled', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  dead_lettered: { label: 'Dead-lettered', tone: 'critical' },
  resolved: { label: 'Resolved', tone: 'positive' },
  reopened: { label: 'Reopened', tone: 'neutral' },
  priority_changed: { label: 'Priority changed', tone: 'neutral' },
  identity_linked: { label: 'Identity linked', tone: 'neutral' },
  preference_changed: { label: 'Preference changed', tone: 'neutral' },
  consent_changed: { label: 'Consent changed', tone: 'warning' },
  marked_read: { label: 'Marked read', tone: 'neutral' },
  smoke_test: { label: 'Provider smoke test', tone: 'info' },
}

export function auditEventLabel(eventType?: string | null): string {
  const key = String(eventType || '').toLowerCase()
  return EVENT_META[key]?.label || titleCase(eventType) || 'Event'
}

export function auditEventTone(eventType?: string | null): AuditTone {
  const key = String(eventType || '').toLowerCase()
  return EVENT_META[key]?.tone || 'neutral'
}

export function auditActorLabel(event?: Pick<AuditEvent, 'actor_type' | 'actor_id'> | null): string {
  if (!event) return 'System'
  const type = String(event.actor_type || 'system')
  const typeLabel = titleCase(type) || 'System'
  const id = event.actor_id ? String(event.actor_id) : ''
  if (!id) return typeLabel
  // Short, non-PII actor reference (agents/admins are opaque ids).
  const shortId = id.length > 12 ? `${id.slice(0, 8)}…` : id
  return type === 'system' || type === 'worker' ? typeLabel : `${typeLabel} ${shortId}`
}

// Technical detail rows for the audit drawer's expandable section (only non-empty ones).
export function auditTechnicalRows(event?: AuditEvent | null): Array<{ key: string; value: string }> {
  if (!event) return []
  const rows: Array<{ key: string; value: string }> = []
  if (event.correlation_id) rows.push({ key: 'Correlation ID', value: String(event.correlation_id) })
  if (event.message_id) rows.push({ key: 'Message ID', value: String(event.message_id) })
  if (event.notification_id) rows.push({ key: 'Notification ID', value: String(event.notification_id) })
  const meta = event.metadata && typeof event.metadata === 'object' ? event.metadata : null
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v === null || v === undefined || v === '') continue
      rows.push({ key: titleCase(k) || k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) })
    }
  }
  return rows
}
