// Pure formatting helpers for the CarUp Command Center.
//
// Enforces the plan's non-negotiables (docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_
// COMMAND_CENTER_GOAL_LOOP.md §3, §8): thread workflow state is separate from message delivery
// state; identity-first labels never expose raw UUIDs; dates are exact, timezone-aware, and
// never render "Invalid Date". Everything here is pure and unit-tested.

// ── Workflow (thread lifecycle) vs Delivery (message lifecycle) — kept strictly separate ──

export const WORKFLOW_STATES = [
  'open', 'awaiting_ai', 'awaiting_human', 'assigned', 'awaiting_user', 'escalated', 'resolved', 'closed', 'spam',
] as const
export type WorkflowState = typeof WORKFLOW_STATES[number]

export const DELIVERY_STATES = [
  'draft', 'queued', 'processing', 'sent', 'delivered', 'read', 'retry_scheduled', 'failed', 'dead_letter', 'cancelled', 'internal_note',
] as const
export type DeliveryState = typeof DELIVERY_STATES[number]

const WORKFLOW_LABELS: Record<string, string> = {
  open: 'Open', awaiting_ai: 'AI handling', awaiting_human: 'Needs human', assigned: 'Assigned',
  awaiting_user: 'Awaiting customer', escalated: 'Escalated', resolved: 'Resolved', closed: 'Closed', spam: 'Spam',
}

const DELIVERY_LABELS: Record<string, string> = {
  draft: 'Draft', queued: 'Queued', processing: 'Processing', sent: 'Sent', delivered: 'Delivered', read: 'Read',
  retry_scheduled: 'Retry scheduled', failed: 'Failed', dead_letter: 'Dead letter', cancelled: 'Cancelled',
  internal_note: 'Internal note',
}

export function titleCase(value?: string | null): string {
  if (!value) return ''
  return String(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

export function workflowLabel(status?: string | null): string {
  const key = String(status || '').toLowerCase()
  return WORKFLOW_LABELS[key] || titleCase(status) || 'Unknown'
}

export function deliveryLabel(status?: string | null): string {
  const key = String(status || '').toLowerCase()
  return DELIVERY_LABELS[key] || titleCase(status) || 'Unknown'
}

export type StateTone = 'positive' | 'pending' | 'warning' | 'negative' | 'neutral'

export function deliveryTone(status?: string | null): StateTone {
  switch (String(status || '').toLowerCase()) {
    case 'delivered':
    case 'read':
    case 'sent':
      return 'positive'
    case 'queued':
    case 'processing':
    case 'draft':
      return 'pending'
    case 'retry_scheduled':
      return 'warning'
    case 'failed':
    case 'dead_letter':
      return 'negative'
    case 'cancelled':
    case 'internal_note':
      return 'neutral'
    default:
      return 'neutral'
  }
}

// A database insert means Queued, never Sent (docs §3). Guards against a message row's raw status
// being over-reported. `providerAccepted` should reflect a real provider acknowledgement.
export function effectiveDeliveryState(rawStatus?: string | null, providerAccepted = false): DeliveryState {
  const s = String(rawStatus || '').toLowerCase()
  if ((DELIVERY_STATES as readonly string[]).includes(s)) return s as DeliveryState
  if (s === 'received') return 'delivered'
  if (!providerAccepted && (s === '' || s === 'pending')) return 'queued'
  return 'queued'
}

// ── Identity-first labels (never a raw UUID) ──

export interface IdentityLike {
  display_name?: string | null
  verified?: boolean | null
  provider_display_name?: string | null
  handle?: string | null
  normalized_address?: string | null
  external_id?: string | null
  channel?: string | null
  id?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,}$/

export function looksLikeUuid(value?: string | null): boolean {
  return !!value && UUID_RE.test(String(value).trim())
}

export function maskPhone(value?: string | null): string {
  const raw = String(value || '').replace(/[^\d+]/g, '')
  if (!raw) return ''
  const plus = raw.startsWith('+') ? '+' : ''
  const digits = raw.replace(/^\+/, '')
  if (digits.length <= 4) return `${plus}${digits}`
  const head = digits.slice(0, Math.min(2, digits.length - 4))
  const tail = digits.slice(-2)
  return `${plus}${head}${'•'.repeat(Math.max(3, digits.length - head.length - tail.length))}${tail}`
}

export function maskEmail(value?: string | null): string {
  const raw = String(value || '').trim()
  const at = raw.indexOf('@')
  if (at < 1) return ''
  const local = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const tld = dot >= 0 ? domain.slice(dot) : ''
  const domainHead = dot >= 0 ? domain.slice(0, dot) : domain
  return `${local[0]}•••@${domainHead[0]}•••${tld}`
}

/**
 * Identity-first display label per docs §3: verified CarUp/contact name → provider display
 * name/handle → masked phone/email → readable fallback. A raw UUID is NEVER shown as the title.
 */
export function identityLabel(identity?: IdentityLike | null, fallback = 'Unknown contact'): string {
  if (!identity) return fallback
  const name = identity.display_name?.trim()
  if (name && !looksLikeUuid(name)) return name
  if (identity.verified && name) return name

  const provider = identity.provider_display_name?.trim()
  if (provider && !looksLikeUuid(provider)) return provider

  const handle = identity.handle?.trim()
  if (handle) return handle.startsWith('@') ? handle : `@${handle}`

  const addr = (identity.normalized_address || identity.external_id || '').trim()
  if (addr) {
    if (EMAIL_RE.test(addr)) return maskEmail(addr)
    if (PHONE_RE.test(addr)) return maskPhone(addr)
    if (!looksLikeUuid(addr)) return addr
  }
  return fallback
}

// ── Dates: exact, timezone-aware, and never "Invalid Date" ──

export function isValidDate(iso?: string | number | Date | null): boolean {
  if (iso === null || iso === undefined || iso === '') return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t)
}

export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!isValidDate(iso)) return ''
  const t = new Date(iso as string).getTime()
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`
  return `${Math.round(s / (7 * 86400))}w ago`
}

export function ageSeconds(iso?: string | null, now: number = Date.now()): number | null {
  if (!isValidDate(iso)) return null
  return Math.round((now - new Date(iso as string).getTime()) / 1000)
}

function safeTimeZone(timeZone?: string): string | undefined {
  if (!timeZone) return undefined
  try {
    // Throws RangeError for an invalid IANA zone.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return timeZone
  } catch {
    return undefined
  }
}

export interface ExactDateTime {
  valid: boolean
  absolute: string
  iso: string
  relative: string
  dayGroup: string
}

/**
 * Format a timestamp for the timeline. Returns `valid: false` with safe placeholders instead of
 * ever rendering "Invalid Date". Defaults to the operator's timezone; pass a customer timezone to
 * show customer-local time. ISO/UTC is always available via `iso`.
 */
export function formatExactDateTime(
  iso?: string | null,
  opts: { timeZone?: string; locale?: string; now?: number } = {},
): ExactDateTime {
  if (!isValidDate(iso)) {
    return { valid: false, absolute: '—', iso: '', relative: '', dayGroup: '' }
  }
  const date = new Date(iso as string)
  const timeZone = safeTimeZone(opts.timeZone)
  const locale = opts.locale || undefined
  const absolute = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
  }).format(date)
  return {
    valid: true,
    absolute,
    iso: date.toISOString(),
    relative: relativeTime(iso, opts.now),
    dayGroup: dayGroup(iso, { timeZone, now: opts.now }),
  }
}

/** Today / Yesterday / full date — for timeline separators. */
export function dayGroup(iso?: string | null, opts: { timeZone?: string; now?: number } = {}): string {
  if (!isValidDate(iso)) return ''
  const timeZone = safeTimeZone(opts.timeZone)
  const date = new Date(iso as string)
  const now = new Date(opts.now ?? Date.now())
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}),
  }).format(d)
  const target = dayKey(date)
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - 86400000))
  if (target === today) return 'Today'
  if (target === yesterday) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}),
  }).format(date)
}
