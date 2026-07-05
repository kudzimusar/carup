// Thread-level presentation helpers for the Command Center (docs §3/§7/§8).
// Identity/context-first title + reference (never a raw UUID as the title), priority styling, and
// SLA state. Pure and unit-tested; shared by the inbox row, conversation header, and the page.

import { titleCase } from './communicationFormatting'

export type SlaLevel = 'none' | 'ok' | 'due' | 'breach'

export interface ThreadLike {
  id?: string
  thread_type?: string | null
  thread_key?: string | null
  status?: string | null
  priority?: string | null
  primary_channel?: string | null
  assigned_admin_id?: string | null
  assigned_team?: string | null
  subject_type?: string | null
  subject_id?: string | null
  marketplace_listing_id?: string | null
  escrow_id?: string | null
  financing_application_id?: string | null
  sla_due_at?: string | null
}

export function threadTitle(thread?: ThreadLike | null): string {
  return titleCase(thread?.thread_type) || 'Conversation'
}

export function threadRef(thread?: ThreadLike | null): string {
  if (!thread) return ''
  return thread.marketplace_listing_id || thread.escrow_id || thread.financing_application_id
    || (thread.subject_id ? `${thread.subject_type || 'ref'}:${thread.subject_id}` : '')
    || (thread.thread_key ? String(thread.thread_key).slice(0, 14) : String(thread.id || '').slice(0, 8))
}

export function priorityVariant(p?: string | null): 'destructive' | 'secondary' | 'outline' {
  const s = String(p || '').toLowerCase()
  if (s === 'urgent' || s === 'high') return 'destructive'
  if (s === 'low') return 'outline'
  return 'secondary'
}

export function threadSla(thread?: ThreadLike | null, now: number = Date.now()): { level: SlaLevel; label: string } {
  const due = thread?.sla_due_at
  if (!due || ['resolved', 'closed', 'spam'].includes(String(thread?.status))) return { level: 'none', label: '' }
  const dueTime = new Date(due).getTime()
  if (Number.isNaN(dueTime)) return { level: 'none', label: '' }
  const diffMs = dueTime - now
  const mins = Math.max(0, Math.round(Math.abs(diffMs) / 60000))
  if (diffMs < 0) return { level: 'breach', label: `SLA overdue ${mins}m` }
  if (diffMs < 15 * 60000) return { level: 'due', label: `SLA due in ${mins}m` }
  return { level: 'ok', label: `SLA in ${mins}m` }
}
