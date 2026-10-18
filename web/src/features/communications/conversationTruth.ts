// CA-OWNER-02 — how the Command Center presents a conversation's TRUTH (the server's verdict, never re-judged here).
//
// The server (backend/services/communication/conversationTruth.js) classifies every conversation by the K2B
// provenance of its real customer and decides whether a service level applies at all. This module only names those
// verdicts for people: the classification views, the badge a non-operational row carries, the SLA label ("Overdue ·
// default 8h first-response target" — never "SLA overdue 41892m"), the customer as the ONE heading, and the subject
// line under it. Pure and unit-tested.

import { titleCase } from './communicationFormatting'

export type ConversationCategory = 'operational' | 'needs_review' | 'certification' | 'automation' | 'historical'
export type ConversationView = 'active' | ConversationCategory | 'all'
export type SlaTruthState = 'live' | 'overdue' | 'paused' | 'not_applicable' | 'certification' | 'historical'

export interface ThreadSlaTruth {
  state: SlaTruthState
  reason: string | null
  due_at: string | null
  due_source: 'default_priority_target' | 'service_target' | 'sla_policy' | null
  awaiting_since: string | null
}

/** `thread.truth` on every Command Center list / detail row. */
export interface ThreadTruth {
  category: ConversationCategory
  class: string | null
  rule: string | null
  basis: string | null
  open?: boolean
  sla: ThreadSlaTruth
  awaiting_reply: boolean
  no_individual_assignee: boolean
  latest_inbound_at?: string | null
  latest_outbound_at?: string | null
}

/** `thread.customer` — the conversation's ONE primary identity (never the seller, never an address). */
export interface ConversationCustomer {
  display_name: string
  source: string
  identity_id?: string | null
}

export interface ConversationSeller {
  display_name: string | null
}

export type ViewCounts = Record<ConversationView, number>

export interface WorkBucket {
  open: number
  awaiting_reply: number
  overdue: number
  live: number
  no_individual_assignee: number
  oldest_awaiting_since: string | null
}

/** GET /api/admin/communications/metrics → `truth`. `available: false` means "unavailable" — never zero. */
export type MetricsTruth =
  | { available: false }
  | {
    available: true
    as_of?: string
    total_open: number
    operational: WorkBucket
    needs_review: WorkBucket
    non_operational_open: number
    by_category: Record<ConversationCategory, number>
    view_counts: ViewCounts
  }

/** GET /threads/:id → `reply_channel`: the server's reply-channel authority (channels only). */
export interface ReplyChannelAuthority {
  default_channel: string | null
  deliverable: string[]
  basis: string
}

export const DEFAULT_CONVERSATION_VIEW: ConversationView = 'active'

export const CONVERSATION_VIEW_OPTIONS: ReadonlyArray<{ value: ConversationView; label: string }> = [
  { value: 'active', label: 'Active work (operational + needs review)' },
  { value: 'operational', label: 'Operational' },
  { value: 'needs_review', label: 'Needs provenance review' },
  { value: 'certification', label: 'Certification & UAT' },
  { value: 'automation', label: 'Automation & smoke tests' },
  { value: 'historical', label: 'Historical' },
  { value: 'all', label: 'All' },
]

export type CategoryTone = 'review' | 'certification' | 'automation' | 'historical'

/** Badge colours per category tone (shared by the inbox row and the conversation header). */
export const CATEGORY_TONE_CLASS: Record<CategoryTone, string> = {
  review: 'border-amber-300 bg-amber-50 text-amber-800',
  certification: 'border-violet-200 bg-violet-50 text-violet-700',
  automation: 'border-sky-200 bg-sky-50 text-sky-700',
  historical: 'border-gray-200 bg-gray-100 text-gray-600',
}

const CATEGORY_BADGES: Record<Exclude<ConversationCategory, 'operational'>, { label: string; tone: CategoryTone }> = {
  needs_review: { label: 'Needs review', tone: 'review' },
  certification: { label: 'Certification & UAT', tone: 'certification' },
  automation: { label: 'Automation', tone: 'automation' },
  historical: { label: 'Historical', tone: 'historical' },
}

interface TruthBearing {
  truth?: ThreadTruth | null
}

/** The small badge a NON-operational row carries (null for operational work, or when unclassified). */
export function categoryBadge(thread?: TruthBearing | null): { label: string; tone: CategoryTone; category: ConversationCategory } | null {
  const category = thread?.truth?.category
  if (!category || category === 'operational') return null
  const badge = CATEGORY_BADGES[category]
  return badge ? { ...badge, category } : null
}

/** "29d 2h", "8h", "15m" — a human duration, never thousands of minutes. */
export function humanDuration(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  if (minutes < 1) return 'under 1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest ? `${days}d ${rest}h` : `${days}d`
}

export type TruthSlaLevel = 'none' | 'ok' | 'due' | 'breach' | 'paused'

interface SlaBearing extends TruthBearing {
  created_at?: string | null
}

function targetLabel(source: ThreadSlaTruth['due_source'], dueAt: string | null, createdAt?: string | null): string {
  if (source === 'sla_policy') return 'SLA policy target'
  if (source === 'service_target') return 'reply target'
  const due = Date.parse(dueAt || '')
  const created = Date.parse(createdAt || '')
  if (!Number.isNaN(due) && !Number.isNaN(created) && due > created) return `default ${humanDuration(due - created)} first-response target`
  return 'default first-response target'
}

function notApplicableLabel(reason: string | null): string {
  const text = String(reason || '')
  if (/no customer message/i.test(text)) return 'No customer message waiting'
  if (/no reply target/i.test(text)) return 'Customer waiting · no reply target recorded'
  if (/waiting on the customer/i.test(text)) return 'Waiting on the customer'
  if (/assistant/i.test(text)) return 'With the AI assistant'
  if (/closed/i.test(text)) return 'Closed — no SLA'
  return 'No SLA'
}

/**
 * The SLA label and level a row, the conversation header and the SLA worklist show — read from truth.sla only.
 * An unclassified conversation (truth unavailable) makes no SLA claim.
 */
export function threadSlaTruth(thread: SlaBearing | null | undefined, now: number = Date.now()): { level: TruthSlaLevel; label: string; state: SlaTruthState | null } {
  const truth = thread?.truth
  if (!truth) return { level: 'none', label: '', state: null }
  const { sla } = truth
  switch (sla.state) {
    case 'overdue':
      return { level: 'breach', label: `Overdue · ${targetLabel(sla.due_source, sla.due_at, thread?.created_at)}`, state: sla.state }
    case 'live': {
      const remaining = (Date.parse(sla.due_at || '') || now) - now
      return { level: remaining < 15 * 60_000 ? 'due' : 'ok', label: `Live · due in ${humanDuration(Math.max(0, remaining))}`, state: sla.state }
    }
    case 'paused':
      return { level: 'paused', label: 'Paused', state: sla.state }
    case 'certification':
      return { level: 'none', label: truth.category === 'automation' ? 'Automation record — no SLA' : 'Certification record — no SLA', state: sla.state }
    case 'historical':
      return { level: 'none', label: 'Historical record — no SLA', state: sla.state }
    default:
      return { level: 'none', label: notApplicableLabel(sla.reason), state: sla.state }
  }
}

interface IdentityBearing {
  customer?: ConversationCustomer | null
  identity_display_name?: string | null
  identity_address?: string | null
  identity_external_id?: string | null
  thread_type?: string | null
}

/** The conversation's ONE heading: its customer. Rows the server could not judge keep the legacy projection title. */
export function customerHeading(thread?: IdentityBearing | null): string {
  const name = String(thread?.customer?.display_name || '').trim()
  if (name) return name
  const legacy = String(thread?.identity_display_name || '').trim()
  if (legacy) return legacy
  const address = String(thread?.identity_address || thread?.identity_external_id || '').trim()
  if (address) return address
  return titleCase(thread?.thread_type) || 'Conversation'
}

interface OpenableThread {
  id: string
  truth?: ThreadTruth | null
  customer?: ConversationCustomer | null
  seller?: ConversationSeller | null
}

/**
 * The thread an opened conversation shows: the detail's full row ON TOP of the inbox row it was opened from, so the
 * row's identity projection (identity_*, unread) is never lost, and the verdict / customer / seller survive a detail
 * that could not judge them (truth: null) — the opened conversation keeps the same identity as its row.
 */
export function mergeOpenedThread<R extends OpenableThread, D extends OpenableThread>(row: R | null | undefined, detail: D): R & D {
  const base = (row && String(row.id) === String(detail.id) ? row : {}) as R
  const merged = { ...base, ...detail } as R & D
  if (!detail.truth && base.truth) merged.truth = base.truth
  if (!detail.customer && base.customer) merged.customer = base.customer
  if (!detail.seller && base.seller) merged.seller = base.seller
  return merged
}

interface SubjectBearing {
  thread_type?: string | null
  subject_type?: string | null
  subject_id?: string | null
  marketplace_listing_id?: string | null
  escrow_id?: string | null
  financing_application_id?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const shortRef = (value: string) => (UUID_RE.test(value) ? value.slice(0, 8) : value)

/** The line under the heading: what the conversation is ABOUT — "Marketplace inquiry · listing <ref>". */
export function threadSubject(thread?: SubjectBearing | null): string {
  if (!thread) return ''
  const type = titleCase(thread.thread_type)
  const typeLabel = type ? type.charAt(0) + type.slice(1).toLowerCase() : ''
  let reference = ''
  if (thread.marketplace_listing_id) reference = `listing ${thread.marketplace_listing_id}`
  else if (thread.escrow_id) reference = `escrow ${thread.escrow_id}`
  else if (thread.financing_application_id) reference = `financing ${thread.financing_application_id}`
  else if (thread.subject_id) {
    const kind = thread.subject_type === 'marketplace_inquiry' ? 'inquiry' : String(thread.subject_type || 'reference').replace(/_/g, ' ')
    reference = `${kind} ${shortRef(String(thread.subject_id))}`
  }
  return [typeLabel, reference].filter(Boolean).join(' · ')
}
