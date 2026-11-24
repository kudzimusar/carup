/**
 * RX04-C2 — owner Communications, unified presentation (flag ON only; the accepted view is unchanged).
 *
 * Presentation only. Every read, send, mark-read, AI assist and preference save is the container's
 * own handler, passed in unchanged — this file adds no communications authority. What it changes is
 * the shape: an inbox that works like a phone app (list → conversation, a composer that stays within
 * reach, a back button) and a two-pane inbox on desktop, with notifications, account Email activity
 * and contact preferences one tab away instead of squeezed into a third column.
 *
 * Truth rules kept: a failed read is never shown as an empty list (the container reports which reads
 * failed), unread counts are only the server's, AI assist is offered only when the provider says it
 * is available, and AI output is always labelled as derived and never sent on its own.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  ChevronRight,
  Inbox,
  Languages,
  LifeBuoy,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
} from 'lucide-react'
import type { useCarUpApi } from '@/hooks/useCarUpApi'
import type { CommunicationAiDerivation, CommunicationMessagePart, CommunicationProductAnalytics } from '@/hooks/useCommunicationProductApi'
import { CommunicationMessagePartView } from '@/components/communications/CommunicationMessagePartView'
import { CommunicationMultimodalComposer } from '@/components/communications/CommunicationMultimodalComposer'
import { DataState } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { deliveryLabel } from '@/features/communications/communicationFormatting'
import { resolveThreadSubject } from './communicationSubject'

type Api = ReturnType<typeof useCarUpApi>
type ThreadSummary = Awaited<ReturnType<Api['fetchCommunicationThreads']>>['threads'][number]
type ThreadDetail = Awaited<ReturnType<Api['fetchCommunicationThread']>>
type NotificationSummary = Awaited<ReturnType<Api['fetchCommunicationNotifications']>>['notifications'][number]
type AccountActivitySummary = Awaited<ReturnType<Api['fetchCommunicationAccountActivity']>>['activity'][number]
type CommunicationPreferences = NonNullable<Awaited<ReturnType<Api['fetchCommunicationPreferences']>>['preferences']>

type ConversationThread = ThreadSummary & {
  business_workflow?: string
  conversation_type?: string
  participant_role?: string
  unread_count?: number
  latest_message?: { id?: string; text?: string; created_at?: string; channel?: string; ai_generated?: boolean } | null
}
type ConversationMessage = ThreadDetail['messages'][number] & {
  text?: string
  author?: { id?: string; stakeholder_role?: string; display_name?: string | null; is_self?: boolean } | null
  ai_generated?: boolean
  parts?: CommunicationMessagePart[]
}
type ConversationDetail = Omit<ThreadDetail, 'messages'> & {
  participants?: Array<{ id: string; stakeholder_role?: string; display_name?: string | null; is_self?: boolean }>
  self_participant_id?: string
  read_at?: string | null
  messages: ConversationMessage[]
}
type ConversationFilter = 'all' | 'unread' | 'marketplace' | 'support' | 'other'
type AiAction = 'suggest' | 'summary' | 'translate' | 'next'

/** The side reads the container tells apart from an empty answer. */
export type CommunicationSideRead = 'notifications' | 'activity' | 'preferences' | 'analytics' | 'ai'

export interface CommunicationsViewProps {
  initialReadDone: boolean
  threadsUnavailable: boolean
  threads: ConversationThread[]
  filteredThreads: ConversationThread[]
  unreadCount: number
  activeId: string | null
  detail: ConversationDetail | null
  threadReadFailedId: string | null
  notifications: NotificationSummary[]
  accountActivity: AccountActivitySummary[]
  preferences: CommunicationPreferences | null
  analytics: CommunicationProductAnalytics | null
  failedReads: CommunicationSideRead[]
  aiAvailable: boolean
  aiResult: CommunicationAiDerivation | null
  aiBusy: string | null
  targetLanguage: string
  canTranslate: boolean
  message: string
  search: string
  filter: ConversationFilter
  status: string | null
  threadLabel: (thread: ConversationThread) => string
  participants: string | null
  onSearch: (value: string) => void
  onFilter: (value: ConversationFilter) => void
  onSelectThread: (threadId: string) => void
  onMessage: (value: string) => void
  onTargetLanguage: (value: string) => void
  onReply: () => void
  onRunAi: (kind: AiAction) => void
  onDerived: (derivation: CommunicationAiDerivation) => void
  onStatus: (message: string | null) => void
  onComposerSent: () => Promise<void>
  onRetryThreads: () => void
  onRetrySideData: () => void
  onResendVerification: () => void
  onPreferenceChange: (key: string, checked: boolean) => void
  onSavePreferences: () => Promise<void>
  /** RX06-LR06 (N3): the explicit mark-read action, and its state. Opening a conversation never marks it read. */
  onMarkRead?: () => void
  markReadState?: 'idle' | 'pending' | 'failed'
  onMarkNotificationRead: (id: string) => Promise<unknown>
}

type Tab = 'inbox' | 'notifications' | 'account' | 'preferences'

const H2 = 'text-[17px] font-semibold tracking-[-0.01em] text-carup-text'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3'
const FIELD = `min-h-11 w-full rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 text-[14px] text-carup-text placeholder:text-carup-text-3 ${OWNER_FOCUS}`
const CHIP = `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-carup-bg-raised px-3.5 text-[13px] font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 disabled:cursor-not-allowed disabled:opacity-50 ${OWNER_FOCUS}`
/** Sits just above the phone task bar (48px tabs + 6px top padding + safe-area bottom padding). */
const ABOVE_TASK_BAR = 'bottom-[calc(3.45rem+max(env(safe-area-inset-bottom),0.35rem))]'

const CHANNELS: Array<{ group: string; items: Array<[string, string]> }> = [
  { group: 'What CarUp may send you', items: [['transactional_enabled', 'Transactional updates'], ['marketing_enabled', 'Marketing']] },
  { group: 'How CarUp may reach you', items: [['email_enabled', 'Email'], ['push_enabled', 'Push'], ['in_app_enabled', 'In-app'], ['whatsapp_enabled', 'WhatsApp'], ['sms_enabled', 'SMS']] },
]

function shortWhen(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(date)
}

function fullWhen(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Message time: just the time today, otherwise day, month and time. */
function messageWhen(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const sameDay = date.toDateString() === new Date().toDateString()
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' }).format(date)
}

const CHANNEL_LABELS: Record<string, string> = { in_app: 'In-app', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', push: 'Push' }
function channelLabel(value?: string | null): string {
  if (!value) return 'CarUp'
  return CHANNEL_LABELS[value.toLowerCase()] ?? value.replaceAll('_', ' ')
}

function workflowOf(thread: ConversationThread) {
  return String(thread.business_workflow || thread.conversation_type || thread.thread_type || '').toLowerCase()
}

function WorkflowIcon({ thread, className }: { thread: ConversationThread; className?: string }) {
  const workflow = workflowOf(thread)
  if (workflow === 'marketplace' || workflow === 'marketplace_inquiry') return <Store className={className} aria-hidden="true" />
  if (workflow === 'support') return <LifeBuoy className={className} aria-hidden="true" />
  return <MessageSquare className={className} aria-hidden="true" />
}

function activityTone(status: string) {
  const s = status.toLowerCase()
  if (['delivered', 'opened', 'clicked'].includes(s)) return 'bg-status-success-soft text-status-success'
  if (['failed', 'bounced', 'rejected', 'complained', 'suppressed'].includes(s)) return 'bg-status-danger-soft text-status-danger'
  if (['queued', 'pending', 'sending', 'requested'].includes(s)) return 'bg-status-warning-soft text-status-warning'
  if (s === 'sent') return 'bg-status-info-soft text-status-info'
  return 'bg-status-neutral-soft text-status-neutral'
}

function StatusLine({ status, className = '' }: { status: string | null; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={`text-[13px] leading-5 text-carup-text-2 empty:hidden ${className}`}>
      {status}
    </p>
  )
}

function Panel({ children, testId, labelledBy }: { children: ReactNode; testId?: string; labelledBy: string }) {
  return (
    <section className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6" data-testid={testId} aria-labelledby={labelledBy}>
      {children}
    </section>
  )
}

export function CommunicationsView(props: CommunicationsViewProps) {
  const {
    initialReadDone, threadsUnavailable, threads, filteredThreads, unreadCount, activeId, detail, threadReadFailedId,
    notifications, accountActivity, preferences, analytics, failedReads, aiAvailable, aiResult, aiBusy, targetLanguage,
    canTranslate, message, search, filter, status, threadLabel, participants,
  } = props
  const [tab, setTab] = useState<Tab>('inbox')
  // Phones show one screen at a time: the inbox list, or the open conversation.
  const [pane, setPane] = useState<'list' | 'thread'>('list')
  const [assistOpen, setAssistOpen] = useState(false)
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const failed = (read: CommunicationSideRead) => failedReads.includes(read)
  const inboxMeasured = initialReadDone && !threadsUnavailable
  const unreadNotifications = notifications.filter(n => n.read === false && !readNotificationIds.includes(n.id)).length
  const activeThread = detail ? (detail.thread as ConversationThread) : null
  const activeSummary = threads.find(t => String(t.id) === String(activeId)) ?? null
  const activeSubject = resolveThreadSubject(activeThread ?? activeSummary) ?? resolveThreadSubject(activeSummary)
  const detailState: 'none' | 'loading' | 'error' | 'ready' = !activeId
    ? 'none'
    : threadReadFailedId === activeId
      ? 'error'
      : detail && activeThread && String(activeThread.id) === String(activeId)
        ? 'ready'
        : 'loading'
  const messageCount = detailState === 'ready' ? detail?.messages.length ?? 0 : 0

  // Open on the newest message, the way a phone chat does.
  useEffect(() => {
    if (detailState !== 'ready') return
    const desktop = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches
    if (desktop) {
      const scroller = scrollerRef.current
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      return
    }
    if (pane === 'thread' && typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ block: 'end' })
  }, [detailState, activeId, messageCount, pane])

  function openThread(threadId: string) {
    props.onSelectThread(threadId)
    setPane('thread')
    setAssistOpen(false)
    if (typeof window.scrollTo === 'function') {
      try { window.scrollTo({ top: 0 }) } catch { /* jsdom */ }
    }
  }

  function chooseTab(next: Tab) {
    setTab(next)
    setPane('list')
  }

  async function markRead(id: string) {
    setNotificationError(null)
    try {
      await props.onMarkNotificationRead(id)
      setReadNotificationIds(current => (current.includes(id) ? current : [...current, id]))
    } catch {
      setNotificationError('That notification could not be marked as read. Please try again.')
    }
  }

  async function savePreferences() {
    setPreferencesError(null)
    setSavingPreferences(true)
    try {
      await props.onSavePreferences()
    } catch {
      setPreferencesError('Your preferences could not be saved. Please try again.')
    } finally {
      setSavingPreferences(false)
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Inbox; count?: number }> = [
    { id: 'inbox', label: 'Inbox', icon: Inbox, count: inboxMeasured ? unreadCount : undefined },
    { id: 'notifications', label: 'Notifications', icon: Bell, count: initialReadDone && !failed('notifications') ? unreadNotifications : undefined },
    { id: 'account', label: 'Security', icon: ShieldCheck },
    { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  ]

  /* ── Inbox: conversation list ─────────────────────────────────────────────────────────────── */
  const list = (
    <div className={`min-w-0 flex-col lg:flex lg:border-r lg:border-carup-line ${pane === 'thread' ? 'hidden' : 'flex'}`} aria-label="Conversations">
      <div className="space-y-2 border-b border-carup-line p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={event => props.onSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className={`${FIELD} pl-9`}
            data-testid="communication-search"
          />
        </div>
        <select
          value={filter}
          onChange={event => props.onFilter(event.target.value as ConversationFilter)}
          className={FIELD}
          aria-label="Filter conversations"
          data-testid="communication-filter"
        >
          <option value="all">All conversations</option>
          <option value="unread">Unread</option>
          <option value="marketplace">Marketplace</option>
          <option value="support">Support</option>
          <option value="other">Other workflows</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 lg:overflow-y-auto">
        {threadsUnavailable && (
          <div role="alert" className="m-3 rounded-card border border-status-warning bg-status-warning-soft p-4 text-[14px] leading-6 text-carup-text" data-testid="communication-threads-unavailable">
            Conversations could not be loaded right now. This is not an empty inbox — please try again shortly.
            <button type="button" onClick={props.onRetryThreads} className={`mt-2 flex min-h-11 items-center rounded-full bg-carup-bg-raised px-4 text-[13px] font-semibold text-carup-text ring-1 ring-carup-line-strong ${OWNER_FOCUS}`}>
              Try again
            </button>
          </div>
        )}
        {!initialReadDone ? (
          <div className="p-3"><DataState state="loading" subject="Conversations" /></div>
        ) : threads.length === 0 ? (
          threadsUnavailable ? null : (
            <div className="px-5 py-10 text-center" data-testid="communication-inbox-empty">
              <Inbox className="mx-auto h-9 w-9 text-carup-text-3" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-semibold text-carup-text">No conversations yet</p>
              <p className="mx-auto mt-1 max-w-xs text-[14px] leading-6 text-carup-text-2">Marketplace enquiries and other CarUp conversations will appear here.</p>
              <Link to="/marketplace" className={`${OWNER_SECONDARY_ACTION} mt-4`}>Browse the Marketplace</Link>
            </div>
          )
        ) : filteredThreads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-carup-text-2">No conversations match this search or filter.</p>
            <button type="button" onClick={() => { props.onSearch(''); props.onFilter('all') }} className={`${OWNER_SECONDARY_ACTION} mt-3`}>Clear search and filter</button>
          </div>
        ) : (
          <ul className="divide-y divide-carup-line">
            {filteredThreads.map(thread => {
              const latest = thread.latest_message?.text || thread.latest_message_text || 'No messages yet'
              const when = shortWhen(thread.latest_message?.created_at || thread.latest_message_at || thread.last_message_at)
              const unread = Number(thread.unread_count || 0)
              const selected = thread.id === activeId
              const rowSubject = resolveThreadSubject(thread)
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => openThread(thread.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex w-full items-start gap-3 px-3 py-3 text-left transition sm:px-4 ${selected ? 'lg:bg-carup-action-soft' : 'hover:bg-carup-bg-surface'} ${OWNER_FOCUS} focus-visible:ring-inset`}
                    data-testid={`communication-thread-${thread.id}`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-carup-bg-surface-2 text-carup-text-2">
                      <WorkflowIcon thread={thread} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[14px] capitalize text-carup-text ${unread > 0 ? 'font-bold' : 'font-semibold'}`}>{threadLabel(thread)}</span>
                        {when && <span className="shrink-0 text-[12px] tabular-nums text-carup-text-3">{when}</span>}
                      </span>
                      {rowSubject && (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-carup-text-3" data-testid={`communication-list-subject-${thread.id}`}>
                          {rowSubject.label}
                        </span>
                      )}
                      <span className={`mt-0.5 line-clamp-2 text-[13px] leading-5 ${unread > 0 ? 'text-carup-text' : 'text-carup-text-2'}`}>{latest}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[12px] text-carup-text-3">
                        <span className="truncate"><span className="capitalize">{(thread.participant_role || thread.status || 'participant').replaceAll('_', ' ')}</span> · {channelLabel(thread.primary_channel)}</span>
                        {unread > 0 && (
                          <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-carup-action px-1.5 text-[11px] font-bold text-carup-action-on" aria-label={`${unread} unread`}>
                            {unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  /* ── Inbox: the open conversation ─────────────────────────────────────────────────────────── */
  const assist = (
    <div className={`${assistOpen ? 'block' : 'hidden'} space-y-2 pb-2 lg:block`} data-testid="communication-ai-assist">
      {aiAvailable ? (
        <>
          <div className="-mx-1 flex flex-wrap gap-2 px-1">
            <button type="button" className={CHIP} disabled={Boolean(aiBusy)} onClick={() => props.onRunAi('suggest')}>
              <Sparkles className="h-4 w-4 text-carup-action" aria-hidden="true" /> {aiBusy === 'suggest' ? 'Drafting…' : 'Suggest reply'}
            </button>
            <button type="button" className={CHIP} disabled={Boolean(aiBusy)} onClick={() => props.onRunAi('summary')}>
              {aiBusy === 'summary' ? 'Summarizing…' : 'Summarize'}
            </button>
            <button type="button" className={CHIP} disabled={Boolean(aiBusy)} onClick={() => props.onRunAi('next')}>
              {aiBusy === 'next' ? 'Thinking…' : 'Next action'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={targetLanguage}
              onChange={event => props.onTargetLanguage(event.target.value)}
              placeholder="Translation language"
              aria-label="Translation language"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button type="button" className={CHIP} disabled={Boolean(aiBusy) || !canTranslate || !targetLanguage.trim()} onClick={() => props.onRunAi('translate')}>
              <Languages className="h-4 w-4" aria-hidden="true" /> {aiBusy === 'translate' ? 'Translating…' : 'Translate latest'}
            </button>
          </div>
          <p className="text-[12px] leading-5 text-carup-text-3">AI suggestions and media interpretations never send or execute automatically — review before you reply.</p>
        </>
      ) : (
        <p className="flex items-start gap-1.5 text-[12px] leading-5 text-carup-text-3" data-testid="communication-ai-off">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {failed('ai')
            ? 'AI assist is off: CarUp could not confirm the AI provider is available. You can still write and send your own reply.'
            : 'AI assist is off: the AI provider is not available right now. You can still write and send your own reply.'}
        </p>
      )}
    </div>
  )

  const thread = (
    <div className={`min-h-[calc(100dvh-3.5rem-3.8rem)] min-w-0 flex-col lg:flex lg:min-h-0 ${pane === 'thread' ? 'flex' : 'hidden'}`} aria-label="Conversation">
      <div className="sticky top-14 z-20 flex min-h-14 items-center gap-1 border-b border-carup-line bg-carup-bg-raised px-1.5 py-1.5 lg:static lg:px-5 lg:py-3">
        <button type="button" onClick={() => setPane('list')} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-carup-text hover:bg-carup-bg-surface lg:hidden ${OWNER_FOCUS}`} aria-label="Back to inbox">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate text-[16px] font-semibold tracking-[-0.01em] text-carup-text ${detailState === 'ready' ? 'capitalize' : ''}`}>
            {detailState === 'ready' && activeThread ? threadLabel(activeThread) : 'Conversation'}
          </h2>
          {detailState === 'ready' && participants && (
            <p className="truncate text-[12px] text-carup-text-3">With {participants}</p>
          )}
          {detailState === 'ready' && activeSubject && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-carup-text-3" data-testid="communication-thread-subject">
              <span className="truncate font-mono text-[11px]">{activeSubject.label}</span>
              {activeSubject.href && activeSubject.actionLabel && (
                <Link
                  to={activeSubject.href}
                  className={`inline-flex min-h-11 sm:min-h-7 items-center rounded-md px-1.5 -mx-1.5 font-semibold text-carup-action underline-offset-2 hover:underline ${OWNER_FOCUS}`}
                  data-testid="communication-thread-subject-link"
                >
                  {activeSubject.actionLabel}
                </Link>
              )}
            </div>
          )}
        </div>
        {detailState === 'ready' && Number(threads.find(t => t.id === activeId)?.unread_count || 0) > 0 && props.onMarkRead && (
          <button type="button" onClick={props.onMarkRead} disabled={props.markReadState === 'pending'}
            className={`inline-flex min-h-11 sm:min-h-9 shrink-0 items-center rounded-full border border-carup-line-strong px-3.5 py-1.5 text-[13px] font-semibold text-carup-text hover:bg-carup-bg-surface disabled:opacity-60 ${OWNER_FOCUS}`}
            data-testid="communication-mark-read">
            {props.markReadState === 'pending' ? 'Marking…' : 'Mark as read'}
          </button>
        )}
      </div>
      {detailState === 'ready' && props.markReadState === 'failed' && (
        <p role="status" className="border-b border-carup-line bg-carup-bg-raised px-4 py-2 text-[13px] text-carup-text-2" data-testid="communication-mark-read-failed">
          This conversation could not be marked read, so it still shows as unread. Try again.
        </p>
      )}

      <div ref={scrollerRef} className="flex-1 space-y-3 bg-carup-bg px-3 py-4 sm:px-5 lg:min-h-0 lg:overflow-y-auto">
        {detailState === 'none' && (
          <p className="mx-auto max-w-sm py-10 text-center text-[14px] leading-6 text-carup-text-2">
            {!initialReadDone
              ? 'Reading your conversations…'
              : threadsUnavailable
                ? 'Your conversations could not be loaded, so there is nothing to open yet.'
                : threads.length === 0
                  ? 'When you send or receive an enquiry, the conversation opens here.'
                  : 'Choose a conversation to read and reply.'}
          </p>
        )}
        {detailState === 'loading' && <DataState state="loading" subject="Conversation" />}
        {detailState === 'error' && (
          <DataState state="error" subject="Conversation" description="This conversation could not be loaded. Go back to your inbox, or reload the page to try again." />
        )}
        {detailState === 'ready' && detail && (detail.messages.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-carup-text-2">No messages yet.</p>
        ) : detail.messages.map(item => {
          const self = Boolean(item.author?.is_self)
          const text = item.text ?? item.content_text ?? ''
          const at = messageWhen(item.created_at)
          return (
            <div key={item.id} className={`flex ${self ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%] ${self ? 'rounded-br-md bg-carup-action text-carup-action-on' : 'rounded-bl-md bg-carup-bg-raised text-carup-text ring-1 ring-carup-line'}`}>
                {!self && item.author && (
                  <p className="mb-0.5 text-[12px] font-semibold text-carup-text-2">{item.author.display_name || item.author.stakeholder_role || 'Participant'}</p>
                )}
                {text && <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{text}</p>}
                {(item.parts || []).map(part => (
                  <CommunicationMessagePartView key={part.id} threadId={String(activeId)} part={part} onDerived={props.onDerived} />
                ))}
                <p className={`mt-1 flex flex-wrap gap-x-2 text-[11px] ${self ? 'text-carup-action-on' : 'text-carup-text-3'}`}>
                  {at && <span className="tabular-nums">{at}</span>}
                  <span>{channelLabel(item.channel)}</span>
                  {item.ai_generated && <span className="font-semibold">AI-derived</span>}
                  {item.status && <span>{deliveryLabel(item.status)}</span>}
                </p>
              </div>
            </div>
          )
        }))}
        {aiResult?.output_text && (
          <div className="rounded-card border border-dashed border-carup-line-strong bg-carup-bg-raised p-3.5" data-testid="communication-ai-derived">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-carup-text-2">
              <Sparkles className="h-4 w-4 text-carup-action" aria-hidden="true" /> AI-derived {aiResult.derivation_type.replaceAll('_', ' ')}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-6 text-carup-text">{aiResult.output_text}</p>
            <p className="mt-2 text-[12px] text-carup-text-3">Derived assistance only. The original conversation or artifact remains unchanged.</p>
          </div>
        )}
      </div>

      {detailState === 'ready' && activeId && (
        <div className={`sticky ${ABOVE_TASK_BAR} z-20 border-t border-carup-line bg-carup-bg-raised px-3 pb-3 pt-2.5 sm:px-4 lg:static lg:pb-4`} data-testid="communication-composer">
          {assist}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setAssistOpen(open => !open)}
              aria-expanded={assistOpen}
              aria-label="AI assist"
              title="AI assist"
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-1 ring-carup-line lg:hidden ${assistOpen ? 'bg-carup-action-soft text-carup-action-hover' : 'bg-carup-bg-raised text-carup-text-2'} ${OWNER_FOCUS}`}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </button>
            <label htmlFor="communication-reply" className="sr-only">Reply in CarUp</label>
            <textarea
              id="communication-reply"
              value={message}
              onChange={event => props.onMessage(event.target.value)}
              placeholder="Reply in CarUp…"
              rows={2}
              className={`${FIELD} min-h-[3.25rem] resize-none py-2.5 leading-6`}
              data-testid="communication-reply-text"
            />
            <button
              type="button"
              onClick={props.onReply}
              disabled={!message.trim()}
              aria-label="Reply"
              className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-carup-action px-3 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 ${OWNER_FOCUS}`}
              data-testid="communication-reply-send"
            >
              <Send className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Reply</span>
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:rounded-full">
            <CommunicationMultimodalComposer
              threadId={activeId}
              caption={message}
              onStatus={props.onStatus}
              onSent={props.onComposerSent}
            />
          </div>
          <StatusLine status={status} className="mt-2" />
        </div>
      )}
      {/* Phones scroll here on open: the newest message sits just above the composer, the composer just above the task bar. */}
      <div ref={endRef} className="scroll-mb-[calc(3.45rem+max(env(safe-area-inset-bottom),0.35rem))] lg:hidden" aria-hidden="true" />
    </div>
  )

  /* ── Inbox: conversation performance (operational analytics the page already reads) ─────── */
  const performance = (
    <section className="rounded-card bg-carup-bg-surface p-5 sm:p-6" aria-labelledby="communication-performance-title" data-testid="communication-performance">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
        <h2 id="communication-performance-title" className={H2}>Conversation performance</h2>
      </div>
      {!initialReadDone ? (
        <div className="mt-3"><DataState state="loading" subject="Conversation performance" /></div>
      ) : failed('analytics') ? (
        <div className="mt-3"><DataState state="error" subject="Conversation performance" description="These figures could not be loaded. They are not zero." action={{ label: 'Try again', onClick: props.onRetrySideData }} /></div>
      ) : !analytics ? (
        <p className="mt-2 text-[14px] text-carup-text-2">Figures will appear as your conversations build up.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ['Conversations', String(analytics.conversations.total)],
              ['Active', String(analytics.conversations.active)],
              ['Conversion', `${analytics.conversations.conversion_rate_pct}%`],
              ['Delivery success', `${analytics.delivery.success_rate_pct}%`],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-control bg-carup-bg-raised p-3 ring-1 ring-carup-line">
                <dt className="text-[12px] text-carup-text-3">{label}</dt>
                <dd className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-carup-text">{value}</dd>
              </div>
            ))}
          </dl>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] text-carup-text-2 sm:grid-cols-2">
            {analytics.response_time && <div className="flex justify-between gap-3"><dt>Median first response</dt><dd className="tabular-nums text-carup-text">{analytics.response_time.median_minutes} min</dd></div>}
            {analytics.marketplace && <div className="flex justify-between gap-3"><dt>Marketplace next step</dt><dd className="tabular-nums text-carup-text">{analytics.marketplace.inquiry_to_next_step_pct}%</dd></div>}
            {analytics.campaigns && <div className="flex justify-between gap-3"><dt>Campaign conversions</dt><dd className="tabular-nums text-carup-text">{analytics.campaigns.converted}</dd></div>}
            <div className="flex justify-between gap-3"><dt>AI assists</dt><dd className="tabular-nums text-carup-text">{analytics.ai.derivations}</dd></div>
            <div className="flex justify-between gap-3"><dt>Failed deliveries</dt><dd className="tabular-nums text-carup-text">{analytics.delivery.failed}</dd></div>
          </dl>
          <p className="mt-3 text-[12px] text-carup-text-3">Operational analytics are derived from canonical conversation, attribution and delivery events.</p>
        </>
      )}
    </section>
  )

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5" data-testid="communications-unified" data-presentation="rx04">
      <div className={`space-y-5 ${pane === 'thread' ? 'hidden lg:block' : ''}`}>
        <OwnerPageHeader
          title="Messages"
          description="Your conversations with buyers, sellers and CarUp — plus notifications, account Emails and how CarUp may contact you."
          meta={inboxMeasured ? `${threads.length === 1 ? '1 conversation' : `${threads.length} conversations`} · ${unreadCount} unread` : undefined}
          actions={<Link to="/marketplace" className={OWNER_SECONDARY_ACTION}><Store className="h-4 w-4" aria-hidden="true" /> Marketplace</Link>}
        />

        <div role="tablist" aria-label="Communications sections" className="grid grid-cols-4 gap-1 rounded-card bg-carup-bg-surface p-1 sm:inline-grid sm:w-auto sm:rounded-full">
          {tabs.map(t => {
            const selected = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`communication-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`communication-panel-${t.id}`}
                onClick={() => chooseTab(t.id)}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[12px] font-semibold transition sm:min-h-10 sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:text-[14px] ${selected ? 'bg-carup-bg-raised text-carup-text ring-1 ring-carup-line' : 'text-carup-text-2 hover:text-carup-text'} ${OWNER_FOCUS}`}
              >
                <span className="flex items-center gap-1">
                  <t.icon className="h-4 w-4" aria-hidden="true" />
                  {typeof t.count === 'number' && t.count > 0 && (
                    <span className="rounded-full bg-carup-action px-1.5 text-[10.5px] font-bold leading-4 text-carup-action-on sm:hidden" aria-hidden="true">{t.count}</span>
                  )}
                </span>
                <span className="max-w-full truncate">{t.label}</span>
                {typeof t.count === 'number' && t.count > 0 && (
                  <span className="hidden rounded-full bg-carup-action px-1.5 text-[11px] font-bold leading-5 text-carup-action-on sm:inline" aria-label={`${t.count} unread`}>{t.count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'inbox' && (
        <div role="tabpanel" id="communication-panel-inbox" aria-labelledby="communication-tab-inbox" className="space-y-6">
          <div className={`rounded-card bg-carup-bg-raised ring-1 ring-carup-line lg:grid lg:h-[calc(100dvh-21.5rem)] lg:min-h-[28rem] lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden ${pane === 'thread' ? '-mx-4 rounded-none ring-0 sm:mx-0 sm:rounded-card sm:ring-1' : ''}`}>
            {list}
            {thread}
          </div>
          <div className={pane === 'thread' ? 'hidden lg:block' : ''}>{performance}</div>
        </div>
      )}

      {tab === 'notifications' && (
        <div role="tabpanel" id="communication-panel-notifications" aria-labelledby="communication-tab-notifications">
          <Panel labelledBy="communication-notifications-title" testId="communication-notifications">
            <p className={EYEBROW}>From CarUp</p>
            <h2 id="communication-notifications-title" className={`mt-1 ${H2}`}>Notifications</h2>
            {!initialReadDone ? (
              <div className="mt-3"><DataState state="loading" subject="Notifications" /></div>
            ) : failed('notifications') ? (
              <div className="mt-3"><DataState state="error" subject="Notifications" description="Your notifications could not be loaded. This is not an empty list." action={{ label: 'Try again', onClick: props.onRetrySideData }} /></div>
            ) : notifications.length === 0 ? (
              <p className="mt-2 text-[14px] text-carup-text-2">No notifications.</p>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-carup-text-3">Tap a notification to mark it as read.</p>
                <ul className="mt-3 divide-y divide-carup-line">
                  {notifications.map(n => {
                    const unread = n.read === false && !readNotificationIds.includes(n.id)
                    const when = fullWhen(n.created_at)
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => void markRead(n.id)} className={`flex w-full items-start gap-3 py-3 text-left ${OWNER_FOCUS}`}>
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-carup-action' : 'bg-transparent'}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[14px] text-carup-text ${unread ? 'font-semibold' : 'font-medium'}`}>{n.title || n.notification_type}</span>
                            {n.message && <span className="mt-0.5 block text-[13px] leading-5 text-carup-text-2">{n.message}</span>}
                            <span className="mt-1 block text-[12px] text-carup-text-3">{[when, unread ? 'Unread' : n.read === true || readNotificationIds.includes(n.id) ? 'Read' : null].filter(Boolean).join(' · ')}</span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            {notificationError && <p role="alert" className="mt-3 rounded-control bg-status-danger-soft px-3 py-2 text-[13px] text-status-danger">{notificationError}</p>}
          </Panel>
        </div>
      )}

      {tab === 'account' && (
        <div role="tabpanel" id="communication-panel-account" aria-labelledby="communication-tab-account">
          <Panel labelledBy="communication-account-title" testId="account-security-activity">
            <p className={EYEBROW}>Account Emails</p>
            <h2 id="communication-account-title" className={`mt-1 ${H2}`}>Account &amp; security</h2>
            <p className="mt-1 max-w-2xl text-[14px] leading-6 text-carup-text-2">
              Security Emails are visible here as delivery activity only. Verification/reset links and tokens never appear in reply-capable conversations.
            </p>
            {!initialReadDone ? (
              <div className="mt-3"><DataState state="loading" subject="Account Email activity" /></div>
            ) : failed('activity') ? (
              <div className="mt-3"><DataState state="error" subject="Account Email activity" description="Your account Email activity could not be loaded. This is not a report that none was sent." action={{ label: 'Try again', onClick: props.onRetrySideData }} /></div>
            ) : accountActivity.length === 0 ? (
              <p className="mt-3 text-[14px] text-carup-text-2">No account Email activity recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-carup-line">
                {accountActivity.slice(0, 5).map(activity => (
                  <li key={activity.id} className="py-3" data-testid={`account-activity-${activity.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-[14px] font-semibold text-carup-text">{activity.title}</p>
                      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold capitalize ${activityTone(activity.status)}`}>{activity.status.replaceAll('_', ' ')}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-5 text-carup-text-2">{activity.summary}</p>
                    <p className="mt-1 text-[12px] text-carup-text-3">
                      Email · {fullWhen(activity.delivered_at || activity.sent_at || activity.created_at) || 'time unavailable'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-carup-line pt-4">
              <button type="button" onClick={props.onResendVerification} className={OWNER_SECONDARY_ACTION} data-testid="resend-verification-email">
                Send another verification Email
              </button>
              <StatusLine status={status} className="mt-2" />
            </div>
          </Panel>
        </div>
      )}

      {tab === 'preferences' && (
        <div role="tabpanel" id="communication-panel-preferences" aria-labelledby="communication-tab-preferences">
          <Panel labelledBy="communication-preferences-title" testId="communication-preferences">
            <p className={EYEBROW}>Channels &amp; consent</p>
            <h2 id="communication-preferences-title" className={`mt-1 ${H2}`}>How CarUp may contact you</h2>
            <p className="mt-1 max-w-2xl text-[14px] leading-6 text-carup-text-2">
              Transactional and marketing consent are independent. Channel availability never opts you into marketing, and delivery suppression does not delete the CarUp conversation.
            </p>
            {!initialReadDone ? (
              <div className="mt-3"><DataState state="loading" subject="Contact preferences" /></div>
            ) : failed('preferences') ? (
              <div className="mt-3"><DataState state="error" subject="Contact preferences" description="Your contact preferences could not be loaded, so they are not shown as on or off." action={{ label: 'Try again', onClick: props.onRetrySideData }} /></div>
            ) : (
              <>
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                  {CHANNELS.map(group => (
                    <div key={group.group}>
                      <p className={EYEBROW}>{group.group}</p>
                      <ul className="mt-1 divide-y divide-carup-line">
                        {group.items.map(([key, label]) => {
                          const raw = preferences?.[key]
                          const on = Boolean(raw)
                          const notSet = raw === undefined || raw === null
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                onClick={() => props.onPreferenceChange(key, !on)}
                                className={`flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left ${OWNER_FOCUS}`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-[14px] font-medium text-carup-text">{label}</span>
                                  {notSet && <span className="block text-[12px] text-carup-text-3">Not set yet — shown as off</span>}
                                </span>
                                <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${on ? 'bg-carup-action' : 'bg-carup-line-strong'}`} aria-hidden="true">
                                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-carup-bg-raised shadow-sm transition-[left] ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-carup-line pt-4">
                  <button type="button" onClick={() => void savePreferences()} disabled={savingPreferences} className={`${OWNER_PRIMARY_ACTION} disabled:opacity-60`}>
                    {savingPreferences ? 'Saving…' : 'Save preferences'}
                  </button>
                  <StatusLine status={status} />
                </div>
                {preferencesError && <p role="alert" className="mt-3 rounded-control bg-status-danger-soft px-3 py-2 text-[13px] text-status-danger">{preferencesError}</p>}
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
