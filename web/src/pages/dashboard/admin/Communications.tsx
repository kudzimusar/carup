import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CommandCenterNav } from '@/features/communications/admin/CommandCenterNav'
import { COMMAND_CENTER_SECTIONS, type CommandCenterSection } from '@/features/communications/admin/commandCenterSections'
import {
  AlertTriangle, ChevronLeft, Inbox as InboxIcon, Loader2, MessageSquare, PauseCircle, PlayCircle, RefreshCcw, Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { priorityVariant, threadPreview, threadRef, threadSla, threadTitle, threadUnreadCount } from '@/features/communications/threadPresentation'
import { BulkActionBar } from '@/features/communications/admin/BulkActionBar'
import { ChannelFilterBar } from '@/features/communications/admin/ChannelFilterBar'
import { CommandCenterHeader } from '@/features/communications/admin/CommandCenterHeader'
import { ConversationHeader } from '@/features/communications/admin/ConversationHeader'
import { ConversationRow } from '@/features/communications/admin/ConversationRow'
import { HandoffBar } from '@/features/communications/admin/HandoffBar'
import { MessageBubble } from '@/features/communications/admin/MessageBubble'
import { ProviderHealthPanel } from '@/features/communications/admin/ProviderHealthPanel'
import { ProviderTelemetryPanel } from '@/features/communications/admin/ProviderTelemetryPanel'
import type { ProviderTelemetry } from '@/features/communications/admin/ProviderTelemetryPanel'
import { ProviderSmokeTestPanel } from '@/features/communications/admin/ProviderSmokeTestPanel'
import { AuditDrawer } from '@/features/communications/admin/AuditDrawer'
import type { AuditEvent } from '@/features/communications/admin/auditPresentation'
import { ContextRail } from '@/features/communications/admin/ContextRail'
import type { ContextIdentity, ContextRef, ContextReassignment } from '@/features/communications/admin/ContextRail'
import { RecoveryView } from '@/features/communications/admin/RecoveryView'
import type { RecoveryNotification } from '@/features/communications/admin/RecoveryView'
import { MessageTechnicalDetails } from '@/features/communications/admin/MessageTechnicalDetails'
import { VirtualList } from '@/features/communications/admin/VirtualList'
import { QueueOverview } from '@/features/communications/admin/QueueOverview'
import { SlaWorklist } from '@/features/communications/admin/SlaWorklist'
import type { SlaWorklistThread } from '@/features/communications/admin/SlaWorklist'
import { AuditSearch } from '@/features/communications/admin/AuditSearch'
import { SettingsView } from '@/features/communications/admin/SettingsView'
import type { SettingsSlaPolicy } from '@/features/communications/admin/SettingsView'
import { DeliveryAttemptList } from '@/features/communications/admin/DeliveryAttemptList'
import type { DeliveryAttempt } from '@/features/communications/admin/DeliveryAttemptList'
import { ReplyComposer } from '@/features/communications/admin/ReplyComposer'
import { WorkerHealthPanel } from '@/features/communications/admin/WorkerHealthPanel'
import { dayGroup } from '@/features/communications/communicationFormatting'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['threads'][number]
type MessageSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThread']>>['messages'][number]
type DeadLetterNotification = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationDeadLetters']>>['notifications'][number]
type Metrics = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationMetrics']>>
type WorkerHealth = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationWorkerHealth']>>
type ThreadCounts = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['counts']>
const PAGE_LIMIT = '100'
type ReplyStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'

const DELIVERY_POLL_INTERVAL_MS = 5_000   // while a reply is queued/processing
const IDLE_POLL_INTERVAL_MS = 30_000      // background refresh cadence
const INBOX_ROW_HEIGHT = 112              // fixed row height for the virtualized inbox (bounded DOM)

// Operational workflow queues (docs §5). Default is All active; awaiting_ai is discoverable as
// "AI handling" so no one needs to know a hidden technical status. Counts prefer server aggregates.
const DEFAULT_QUEUE = 'all_active'
const FILTERS = [
  { value: 'all_active', label: 'All active', short: 'Active', count: 'all_active' },
  { value: 'awaiting_human', label: 'Needs human', short: 'Human', count: 'awaiting_human' },
  { value: 'awaiting_ai', label: 'AI handling', short: 'AI', count: 'awaiting_ai' },
  { value: 'mine', label: 'Assigned to me', short: 'Mine', count: 'mine' },
  { value: 'unassigned', label: 'Unassigned', short: 'Unassigned', count: 'unassigned' },
  { value: 'awaiting_user', label: 'Awaiting customer', short: 'Customer', count: 'awaiting_user' },
  { value: 'escalated', label: 'Escalated', short: 'Escalated', count: 'escalated' },
  { value: 'sla_breach', label: 'SLA breach', short: 'SLA', count: 'sla_breach' },
  { value: 'failed', label: 'Failed/dead letter', short: 'Failed', count: 'failed_risk' },
  { value: 'resolved', label: 'Resolved', short: 'Resolved', count: 'resolved' },
] as const

// Map a workflow queue to server query params. The DB does the filtering/search/sort/pagination —
// the client never windows or re-filters rows locally (docs §7; item 2).
function queueToParams(queue: string): Record<string, string | undefined> {
  switch (queue) {
    case 'awaiting_human':
    case 'awaiting_ai':
    case 'awaiting_user':
    case 'escalated':
      return { status: queue, include_terminal: 'false' }
    case 'resolved':
      return { status: 'resolved', include_terminal: 'true' }
    case 'mine':
      return { assigned: 'mine', include_terminal: 'false' }
    case 'unassigned':
      return { assigned: 'unassigned', include_terminal: 'false' }
    case 'sla_breach':
      return { sla: 'breach', include_terminal: 'false' }
    case 'failed':
      return { failed_only: 'true', include_terminal: 'true' }
    case 'all_active':
    default:
      return { include_terminal: 'false' }
  }
}

const TEAMS = ['support', 'finance', 'safepay', 'trust_safety', 'marketplace'] as const

// Map the inbox SLA badge level to the ContextRail's richer state vocabulary.
function slaLevelToState(level: string): string {
  const map: Record<string, string> = { breach: 'breached', due: 'due_soon', ok: 'healthy', paused: 'paused', none: 'not_applicable' }
  return map[level] || 'not_applicable'
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `admin-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function mapReplyStatus(notificationStatus?: unknown, messageStatus?: unknown): ReplyStatus {
  const status = String(notificationStatus || messageStatus || 'queued').toLowerCase()
  if (status === 'delivered') return 'delivered'
  if (status === 'sent') return 'sent'
  if (status === 'failed' || status === 'dead_letter') return 'failed'
  return 'queued'
}

function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function prettyLabel(t?: string | null): string {
  if (!t) return ''
  return t.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function hasQueuedOrProcessing(msgs: MessageSummary[]) {
  return msgs.some((m) => m.direction === 'outbound' && ['queued', 'processing', 'retry_scheduled'].includes(String(m.status || '')))
}


export default function AdminCommunications() {
  const {
    user,
    fetchAdminCommunicationThreads,
    fetchCommunicationDeadLetters,
    fetchAdminCommunicationMetrics,
    fetchAdminCommunicationThread,
    markAdminCommunicationThreadRead,
    fetchAdminCommunicationThreadAudit,
    fetchCommunicationAudit,
    fetchCommunicationSlaPolicies,
    fetchCommunicationWorkerHealth,
    fetchCommunicationProviders,
    sendCommunicationProviderSmokeTest,
    adminReplyCommunicationThread,
    assignCommunicationThread,
    escalateCommunicationThread,
    resolveCommunicationThread,
    reopenCommunicationThread,
    pauseCommunicationThreadSla,
    resumeCommunicationThreadSla,
    retryCommunicationDeadLetter,
    cancelCommunicationDeadLetter,
    fetchCommunicationRecovery,
    bulkRetryCommunicationRecovery,
    requeueCommunicationDeadLetter,
  } = useCarUpApi()

  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  // Nested-route section (item 5). The route may be /admin/communications[/:section] or the
  // /dashboard/... variant; derive the base path so section tabs link correctly, and resolve the
  // active section (defaulting to inbox, incl. the /inbox/:threadId deep-link form).
  const routeParams = useParams<{ section?: string; threadId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const basePath = location.pathname.includes('/dashboard/admin/communications') ? '/dashboard/admin/communications' : '/admin/communications'
  const section: CommandCenterSection = (COMMAND_CENTER_SECTIONS as readonly string[]).includes(routeParams.section || '')
    ? (routeParams.section as CommandCenterSection)
    : 'inbox'
  // Only the inbox uses the triage layout; queues/sla/recovery/audit/providers/settings are dedicated
  // operational workspaces (P1.10) — a section is never a mere alias of the inbox.
  const isInboxLike = section === 'inbox'
  const [selected, setSelected] = useState<ThreadSummary | null>(null)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [showAuditTechnical, setShowAuditTechnical] = useState(false)
  const [showTimelineTechnical, setShowTimelineTechnical] = useState(false)
  const [showMobileDetails, setShowMobileDetails] = useState(false)
  const [identities, setIdentities] = useState<ContextIdentity[]>([])
  const [linkedIdentities, setLinkedIdentities] = useState<ContextIdentity[]>([])
  const [deliveryAttempts, setDeliveryAttempts] = useState<DeliveryAttempt[]>([])
  const [preferences, setPreferences] = useState<Parameters<typeof ContextRail>[0]['preferences']>(null)
  const [deadLetters, setDeadLetters] = useState<DeadLetterNotification[]>([])
  const [recovery, setRecovery] = useState<{ categories: Record<string, RecoveryNotification[]>; counts: Record<string, number> }>({ categories: {}, counts: {} })
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics>({})
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null)
  const [providers, setProviders] = useState<{ channels: ProviderTelemetry[]; staleLocks: number }>({ channels: [], staleLocks: 0 })
  const [slaThreads, setSlaThreads] = useState<SlaWorklistThread[]>([])
  const [auditSearchEvents, setAuditSearchEvents] = useState<AuditEvent[]>([])
  const [auditSearchType, setAuditSearchType] = useState('')
  const [slaPolicies, setSlaPolicies] = useState<SettingsSlaPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverCounts, setServerCounts] = useState<ThreadCounts | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>(() => searchParams.get('filter') || DEFAULT_QUEUE)
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [channelFilter, setChannelFilter] = useState<string | null>(null)

  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>('idle')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyCorrelationId, setReplyCorrelationId] = useState<string | null>(null)
  const [replyClientMessageId, setReplyClientMessageId] = useState(() => newClientMessageId())
  const [busyAction, setBusyAction] = useState<string | null>(null)


  const selectedRef = useRef<ThreadSummary | null>(null)
  const openTokenRef = useRef(0)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // Debounce the search box so each keystroke doesn't fire a server query.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  // The server query for the current queue + search + channel. The DB filters/searches/sorts and
  // returns the matching page plus whole-result counts — the client never re-filters locally (item 2).
  const queryParams = useMemo<Record<string, string | undefined>>(() => {
    const p: Record<string, string | undefined> = { ...queueToParams(filter), limit: PAGE_LIMIT }
    const q = debouncedSearch.trim()
    if (q) p.search = q
    if (channelFilter) p.channel = channelFilter
    return p
  }, [filter, debouncedSearch, channelFilter])

  const fetchThreadPage = useCallback((extra?: Record<string, string | undefined>) => {
    return fetchAdminCommunicationThreads({ ...queryParams, ...extra })
  }, [fetchAdminCommunicationThreads, queryParams])

  // Identity of the active query. loadMore captures this and drops its result if the query changed
  // mid-flight, so a slow "Load more" can never append the previous queue's rows into a new queue.
  const queryKey = useMemo(() => JSON.stringify(queryParams), [queryParams])
  const queryKeyRef = useRef(queryKey)
  useEffect(() => { queryKeyRef.current = queryKey }, [queryKey])

  // Tab badge counts come from the server's whole-result aggregates (accurate beyond the fetched
  // page). Fallback (server counts absent): only the active queue's loaded size is known.
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    if (serverCounts) {
      const sc = serverCounts as unknown as Record<string, unknown>
      for (const f of FILTERS) {
        const top = sc[f.count]
        c[f.value] = typeof top === 'number' ? top : (serverCounts.by_workflow?.[f.count] ?? 0)
      }
      return c
    }
    for (const f of FILTERS) c[f.value] = f.value === filter ? threads.length : 0
    return c
  }, [threads, serverCounts, filter])

  const channelCounts = useMemo(() => serverCounts?.by_channel ?? {}, [serverCounts])

  // The server already returns exactly the rows for the active queue/search/channel — render as-is.
  const visibleThreads = threads

  const refreshWorkerHealth = useCallback(async () => {
    fetchCommunicationWorkerHealth().then(setWorkerHealth).catch(() => null)
  }, [fetchCommunicationWorkerHealth])

  // Keep the currently-open thread's unread badge cleared even when a fresh page arrives before the
  // fire-and-forget mark-read has committed server-side (avoids a transient badge flicker).
  const clearSelectedUnread = useCallback((rows: ThreadSummary[]) => {
    const id = selectedRef.current?.id
    return id ? rows.map((t) => (t.id === id ? { ...t, unread_count: 0 } : t)) : rows
  }, [])

  // Full refresh (Refresh button + after mutations): re-run the current query + ops panels.
  const load = useCallback(async () => {
    await Promise.all([
      fetchThreadPage().then((res) => {
        setThreads(clearSelectedUnread(res.threads || []))
        setServerCounts(res.counts ?? null)
        setNextCursor(res.page?.next_cursor ?? null)
        setLoadError(null)
      }).catch(() => setLoadError('Could not load threads — press Refresh to retry.')),
      fetchCommunicationDeadLetters().then((r) => setDeadLetters(r.notifications || [])).catch(() => undefined),
      fetchCommunicationRecovery().then((r) => setRecovery({ categories: r.categories || {}, counts: r.counts || {} })).catch(() => undefined),
      fetchAdminCommunicationMetrics().then((r) => setMetrics(r || {})).catch(() => undefined),
    ])
  }, [fetchThreadPage, clearSelectedUnread, fetchCommunicationDeadLetters, fetchCommunicationRecovery, fetchAdminCommunicationMetrics])

  // Cursor pagination: append the next server page (dedup by id) without disturbing selection/draft.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    const startKey = queryKeyRef.current
    setLoadingMore(true)
    try {
      const res = await fetchThreadPage({ cursor: nextCursor })
      // The query (queue/search/channel) changed while this page was in flight — drop it so we never
      // append another queue's rows or overwrite the new query's cursor.
      if (queryKeyRef.current !== startKey) return
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.id))
        return [...prev, ...(res.threads || []).filter((t) => !seen.has(t.id))]
      })
      setNextCursor(res.page?.next_cursor ?? null)
      if (res.counts) setServerCounts(res.counts)
    } catch {
      /* keep the already-loaded threads on failure */
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, fetchThreadPage])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setBulkNote(null)
  }, [])
  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setBulkNote(null) }, [])

  // Reload the inbox page (page 1) whenever the active queue / search / channel changes. Runs on
  // mount too, so this is the single source of thread loading. Server-side filter+search+sort+count.
  useEffect(() => {
    let active = true
    void (async () => {
      setListLoading(true)
      try {
        const res = await fetchThreadPage()
        if (!active) return
        setThreads(clearSelectedUnread(res.threads || []))
        setServerCounts(res.counts ?? null)
        setNextCursor(res.page?.next_cursor ?? null)
        setLoadError(null)
      } catch {
        if (active) setLoadError('Could not load threads — press Refresh to retry.')
      } finally {
        if (active) { setLoading(false); setListLoading(false) }
      }
    })()
    return () => { active = false }
  }, [fetchThreadPage, clearSelectedUnread])

  // One-time ops panels (dead-letter recovery, recovery categories, metrics, worker health) — query-independent.
  useEffect(() => {
    fetchCommunicationDeadLetters().then((r) => setDeadLetters(r.notifications || [])).catch(() => setDeadLetters([]))
    fetchCommunicationRecovery().then((r) => setRecovery({ categories: r.categories || {}, counts: r.counts || {} })).catch(() => undefined)
    fetchAdminCommunicationMetrics().then((r) => setMetrics(r || {})).catch(() => undefined)
    refreshWorkerHealth()
  }, [fetchCommunicationDeadLetters, fetchCommunicationRecovery, fetchAdminCommunicationMetrics, refreshWorkerHealth])

  // Per-channel provider telemetry — fetched when the Providers surface is active (P1.4).
  useEffect(() => {
    if (section !== 'providers') return
    fetchCommunicationProviders()
      .then((r) => setProviders({ channels: r.channels || [], staleLocks: Number(r.worker?.stale_locks ?? 0) }))
      .catch(() => undefined)
  }, [section, fetchCommunicationProviders])

  // SLA worklist (P1.10): threads sorted by SLA urgency, fetched when the SLA surface is active.
  useEffect(() => {
    if (section !== 'sla') return
    fetchAdminCommunicationThreads({ sort: 'sla', include_terminal: 'false', limit: '100' })
      .then((r) => setSlaThreads((r.threads || []).map((t): SlaWorklistThread => {
        const sla = threadSla(t)
        return { id: t.id, title: threadTitle(t), channel: t.primary_channel, reference: threadRef(t), slaLabel: sla.label, slaState: slaLevelToState(sla.level) }
      })))
      .catch(() => undefined)
  }, [section, fetchAdminCommunicationThreads])

  // Global audit search (P1.10) — refetched on the event-type filter.
  useEffect(() => {
    if (section !== 'audit') return
    fetchCommunicationAudit(auditSearchType ? { event_type: auditSearchType } : undefined)
      .then((r) => setAuditSearchEvents(r.events || []))
      .catch(() => undefined)
  }, [section, auditSearchType, fetchCommunicationAudit])

  // Read-only SLA policies for the Settings surface (P1.10).
  useEffect(() => {
    if (section !== 'settings') return
    fetchCommunicationSlaPolicies().then((r) => setSlaPolicies(r.policies || [])).catch(() => undefined)
  }, [section, fetchCommunicationSlaPolicies])

  // Persist filter / search / selected thread to the URL so the inbox is deep-linkable and
  // survives refresh (replace, not push, to avoid history spam).
  useEffect(() => {
    const next = new URLSearchParams()
    if (filter && filter !== DEFAULT_QUEUE) next.set('filter', filter)
    if (search.trim()) next.set('q', search.trim())
    if (selected?.id) next.set('thread', selected.id)
    setSearchParams(next, { replace: true })
  }, [filter, search, selected?.id, setSearchParams])

  // Auto-refresh: poll fast while a reply is in-flight, slowly otherwise.
  useEffect(() => {
    let active = true
    const waiting = hasQueuedOrProcessing(messages)
    const intervalMs = waiting ? DELIVERY_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
    const id = setInterval(async () => {
      const cur = selectedRef.current
      if (cur) {
        const detail = await fetchAdminCommunicationThread(cur.id).catch(() => null)
        // Drop the response if we unmounted or the admin switched threads mid-fetch.
        if (active && detail && selectedRef.current?.id === cur.id) {
          setMessages(detail.messages || [])
          if (waiting && !hasQueuedOrProcessing(detail.messages || [])) {
            const lastOutbound = [...(detail.messages || [])].reverse().find((m) => m.direction === 'outbound')
            if (lastOutbound) setReplyStatus(mapReplyStatus(undefined, lastOutbound.status))
          }
        }
      }
      if (active) refreshWorkerHealth()
    }, intervalMs)
    return () => { active = false; clearInterval(id) }
  }, [messages, fetchAdminCommunicationThread, refreshWorkerHealth])

  const openThread = useCallback(async (thread: ThreadSummary) => {
    const token = ++openTokenRef.current
    // Only reset the composer when switching to a DIFFERENT thread. Re-opening the same thread
    // (e.g. a handoff/dead-letter refresh) must NOT clear the reply draft or flip the internal-note
    // toggle — otherwise a drafted internal note could be re-sent to the customer as a public reply.
    const sameThread = selectedRef.current?.id === thread.id
    setSelected(thread)
    if (!sameThread) {
      setShowMobileDetails(false)
      setMessages([])
      setAuditEvents([])
      setIdentities([])
      setLinkedIdentities([])
      setDeliveryAttempts([])
      setPreferences(null)
      setReplyStatus('idle')
      setReplyError(null)
      setReplyCorrelationId(null)
      setInternalNote(false)
    }
    const [detail, audit] = await Promise.all([
      fetchAdminCommunicationThread(thread.id).catch(() => null),
      fetchAdminCommunicationThreadAudit(thread.id).catch(() => ({ events: [] as AuditEvent[] })),
    ])
    // Ignore a stale response if a newer openThread started while this fetch was in flight.
    if (openTokenRef.current !== token) return
    if (detail) {
      setSelected(detail.thread)
      setMessages(detail.messages || [])
      setIdentities((detail.identities || []) as ContextIdentity[])
      setLinkedIdentities((detail.linked_identities || []) as ContextIdentity[])
      setDeliveryAttempts((detail.delivery_attempts || []) as DeliveryAttempt[])
      setPreferences((detail.preferences || null) as Parameters<typeof ContextRail>[0]['preferences'])
    }
    setAuditEvents(audit.events || [])
    // Mark the thread read for this agent and optimistically clear its unread badge in the list
    // (item 9). Fire-and-forget. Mark when the row is known-unread OR when unread is UNKNOWN — a
    // deep-linked stub ({id} with no unread_count) must still clear server-side unread for the agent.
    if (thread.unread_count === undefined || Number(thread.unread_count) > 0) {
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread_count: 0 } : t)))
      void markAdminCommunicationThreadRead(thread.id).catch(() => undefined)
    }
  }, [fetchAdminCommunicationThread, fetchAdminCommunicationThreadAudit, markAdminCommunicationThreadRead])

  // Open a deep-linked thread (?thread=<id>) once on mount so shared links land on the conversation.
  const deepLinkedRef = useRef(false)
  useEffect(() => {
    if (deepLinkedRef.current) return
    // Mark handled on the first run regardless — otherwise a later URL change (from selecting a
    // thread, which writes ?thread=<id>) would re-enter this and re-open with a bare {id} stub.
    deepLinkedRef.current = true
    // Accept both the path form (/inbox/:threadId, item 5) and the ?thread=<id> query alias.
    const threadId = routeParams.threadId || searchParams.get('thread')
    if (!threadId) return
    // Defer the open out of the effect body (its setState must not run synchronously here), but with
    // NO cancel-cleanup: under React StrictMode a cleanup would cancel the only scheduled open, so the
    // deep link never resolved. openThread's own openToken guard handles staleness on later navigation.
    void Promise.resolve().then(() => openThread({ id: threadId } as ThreadSummary))
  }, [searchParams, routeParams.threadId, openThread])

  // Bulk actions fan out per-thread (no bulk endpoint) and report partial failures.
  const runBulk = useCallback(async (label: string, fn: (id: string) => Promise<unknown>) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkBusy(true)
    setBulkNote(null)
    let ok = 0
    let failed = 0
    for (const id of ids) {
      try { await fn(id); ok += 1 } catch { failed += 1 }
    }
    setBulkBusy(false)
    setBulkNote(`${label} ${ok}${failed ? ` · ${failed} failed` : ''}`)
    setSelectedIds(new Set())
    await load()
    const cur = selectedRef.current
    if (cur) await openThread(cur)
  }, [selectedIds, load, openThread])

  async function sendReply() {
    if (!selected || !reply.trim() || replyStatus === 'sending') return
    setReplyStatus('sending')
    setReplyError(null)
    setReplyCorrelationId(null)
    try {
      const result = await adminReplyCommunicationThread(selected.id, {
        message: reply,
        channel: selected.primary_channel || 'in_app',
        client_message_id: replyClientMessageId,
        internal: internalNote,
      })
      setReply('')
      setReplyClientMessageId(newClientMessageId())
      const wasInternal = internalNote
      setInternalNote(false)
      await openThread(selected)
      // Refresh the inbox list + tab counts so the replied thread's new status is reflected.
      await load()
      setReplyStatus(wasInternal ? 'delivered' : mapReplyStatus(result.notification?.status, result.message?.status))
    } catch (error) {
      const apiError = error as Error & { requestId?: string; correlationId?: string }
      setReplyStatus('failed')
      setReplyError(apiError.message || 'Reply failed.')
      setReplyCorrelationId(apiError.requestId || apiError.correlationId || null)
    }
  }

  // Runs a thread-scoped mutation (assign/escalate/resolve), then refreshes the dashboard and
  // re-opens the selected thread so its header + timeline reflect the change.
  const runAction = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusyAction(name)
    try {
      await fn()
      await load()
      const cur = selectedRef.current
      if (cur) await openThread(cur)
    } finally {
      setBusyAction(null)
    }
  }, [load, openThread])

  // Ops-rail actions (delivery recovery) refresh the dashboard only — they must not re-open or
  // reset the selected thread's composer (internal-note toggle, reply status).
  const runRecoveryAction = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusyAction(name)
    setRecoveryNote(null)
    try {
      await fn()
      await load()
    } finally {
      setBusyAction(null)
    }
  }, [load])

  // Guarded bulk retry (item 11): acts only on the explicit ids, reports partial failures.
  const runBulkRetry = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setBusyAction('bulk-retry')
    setRecoveryNote(null)
    try {
      const res = await bulkRetryCommunicationRecovery(ids)
      setRecoveryNote(`Retried ${res.retried}/${res.total}${res.failed ? ` · ${res.failed} failed` : ''}`)
      await load()
    } catch (error) {
      setRecoveryNote((error as Error).message || 'Bulk retry failed.')
    } finally {
      setBusyAction(null)
    }
  }, [bulkRetryCommunicationRecovery, load])

  const assignToMe = () => runAction('assign-me', () => assignCommunicationThread(selected!.id, { assigned_admin_id: user?.id, assigned_team: selected!.assigned_team }))
  const assignToTeam = (team: string) => runAction('assign-team', () => assignCommunicationThread(selected!.id, { assigned_team: team }))
  const escalate = () => runAction('escalate', () => escalateCommunicationThread(selected!.id, { reason_code: 'admin_escalation', severity: 'high', assigned_team: selected!.assigned_team || 'support' }))
  const resolve = () => runAction('resolve', () => resolveCommunicationThread(selected!.id, 'Resolved from admin command center.'))
  // Resolve is one click, so the operator needs a way back. The server already supports it; only
  // the affordance was missing, which left a mis-resolved thread unrecoverable from the UI.
  const reopen = () => runAction('reopen', () => reopenCommunicationThread(selected!.id, 'Reopened from admin command center.'))
  const pauseSla = () => runAction('sla-pause', () => pauseCommunicationThreadSla(selected!.id, 'paused_by_admin'))
  const resumeSla = () => runAction('sla-resume', () => resumeCommunicationThreadSla(selected!.id))


  const overdue = Number(metrics.overdue_threads ?? 0)
  const unassigned = Number(metrics.unassigned_threads ?? 0)
  const deadLetterCount = Number(metrics.dead_letter_count ?? deadLetters.length)
  const selectedSla = threadSla(selected)
  const assignedLabel = selected?.assigned_admin_id
    ? `Admin ${String(selected.assigned_admin_id).slice(0, 8)}`
    : selected?.assigned_team ? prettyLabel(selected.assigned_team) : 'Unassigned'

  return (
    <TooltipProvider delayDuration={200}>
      <div className="max-w-7xl mx-auto space-y-5" data-testid="command-center">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Communication Command Center</h1>
            <p className="text-gray-500 text-sm">Triage the inbox, hand off threads, watch SLAs, recover failed deliveries, and send audited replies.</p>
          </div>
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4" /> Refresh</Button>
        </div>

        {/* Operations strip: queue + SLA + provider health at a glance */}
        <CommandCenterHeader
          openCount={Number(metrics.open_threads ?? threads.filter((t) => !['resolved', 'closed', 'spam'].includes(String(t.status))).length)}
          unassigned={unassigned}
          overdue={overdue}
          deadLetterCount={deadLetterCount}
          health={workerHealth}
        />

        {/* Section navigation (item 5): deep-linkable Command Center surfaces. */}
        <CommandCenterNav
          basePath={basePath}
          active={section}
          badges={{ recovery: recovery.counts?.total || 0, sla: serverCounts?.sla_breach || 0 }}
        />

        {isInboxLike && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr_320px] gap-5 items-start">
          {/* ── Inbox ── (mobile master-detail: hidden once a thread is open; always shown on desktop) */}
          <Card className={`border-0 card-shadow ${selected ? 'hidden lg:block' : 'block'}`} data-testid="inbox-pane">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><InboxIcon className="w-4 h-4" /> Inbox</CardTitle>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  {listLoading && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                  {visibleThreads.length} shown
                </span>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter threads by workflow queue">
                {FILTERS.map((f) => {
                  const isActive = filter === f.value
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFilter(f.value)}
                      aria-pressed={isActive}
                      title={f.label}
                      data-testid={`queue-${f.value}`}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] border transition-colors ${isActive ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      {f.label}
                      <span className={`text-[10px] font-semibold tabular-nums ${isActive ? 'opacity-90' : 'opacity-60'}`}>{counts[f.value] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, message, ref…" aria-label="Search threads" className="pl-8 h-9" />
              </div>
              <ChannelFilterBar counts={channelCounts} active={channelFilter} onSelect={setChannelFilter} />
            </CardHeader>
            <CardContent className="p-0">
              <BulkActionBar
                count={selectedIds.size}
                busy={bulkBusy}
                resultNote={bulkNote}
                onAssignToMe={() => runBulk('Assigned', (id) => assignCommunicationThread(id, { assigned_admin_id: user?.id }))}
                onResolve={() => runBulk('Resolved', (id) => resolveCommunicationThread(id, 'Resolved from admin command center (bulk).'))}
                onClear={clearSelection}
              />
              {loadError ? (
                <div className="p-6 text-center text-sm">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-400" />
                  <p className="text-red-600">{loadError}</p>
                  <Button size="sm" variant="outline" className="mt-3 gap-1" onClick={load}><RefreshCcw className="w-3.5 h-3.5" /> Retry</Button>
                </div>
              ) : loading ? (
                <div className="p-4 space-y-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                </div>
              ) : visibleThreads.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">
                  <InboxIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No threads match this filter.
                </div>
              ) : (
                <VirtualList
                  items={visibleThreads}
                  itemHeight={INBOX_ROW_HEIGHT}
                  height={560}
                  ariaLabel="Thread inbox — use up and down arrows to navigate"
                  getKey={(thread) => thread.id}
                  scrollToIndex={selected ? visibleThreads.findIndex((t) => t.id === selected.id) : null}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                    e.preventDefault()
                    if (visibleThreads.length === 0) return
                    const idx = visibleThreads.findIndex((t) => t.id === selected?.id)
                    const nextIdx = e.key === 'ArrowDown'
                      ? Math.min(visibleThreads.length - 1, idx < 0 ? 0 : idx + 1)
                      : Math.max(0, idx < 0 ? 0 : idx - 1)
                    void openThread(visibleThreads[nextIdx])
                  }}
                  renderItem={(thread) => {
                    const sla = threadSla(thread)
                    return (
                      <ConversationRow
                        channel={thread.primary_channel}
                        title={threadTitle(thread)}
                        reference={threadRef(thread)}
                        preview={threadPreview(thread)}
                        unreadCount={threadUnreadCount(thread)}
                        statusLabel={prettyLabel(thread.status)}
                        priority={thread.priority}
                        priorityVariant={priorityVariant(thread.priority)}
                        unassigned={!thread.assigned_admin_id && !thread.assigned_team}
                        slaLabel={sla.label}
                        slaLevel={sla.level}
                        timeLabel={relativeTime(thread.last_message_at || thread.updated_at)}
                        selected={selected?.id === thread.id}
                        onSelect={() => openThread(thread)}
                        checked={selectedIds.has(thread.id)}
                        onToggle={() => toggleSelect(thread.id)}
                      />
                    )
                  }}
                  footer={nextCursor ? (
                    <div className="p-3 text-center border-t">
                      <Button size="sm" variant="outline" className="w-full gap-1" onClick={loadMore} disabled={loadingMore} data-testid="load-more">
                        {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </Button>
                    </div>
                  ) : null}
                />
              )}
            </CardContent>
          </Card>

          {/* ── Conversation + audited reply + handoff ── (mobile: shown only when a thread is open) */}
          <Card className={`border-0 card-shadow min-h-[620px] ${selected ? 'block' : 'hidden lg:block'}`} data-testid="conversation-pane">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-[620px] text-center px-6">
                <MessageSquare className="w-10 h-10 text-gray-300 mb-3" />
                <p className="font-medium text-gray-600">Select a thread</p>
                <p className="text-sm text-gray-400 mt-1">Review the timeline, hand it off, and send an audited reply.</p>
              </div>
            ) : (
              <>
                {/* Mobile/tablet nav: back to inbox + a details drawer toggle (hidden on desktop). */}
                <div className="flex items-center justify-between gap-2 px-4 pt-3 lg:hidden">
                  <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => { setSelected(null); setShowMobileDetails(false) }} data-testid="mobile-back">
                    <ChevronLeft className="w-4 h-4" aria-hidden /> Inbox
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" aria-pressed={showMobileDetails} onClick={() => setShowMobileDetails((v) => !v)} data-testid="mobile-details-toggle">
                    {showMobileDetails ? 'Hide details' : 'Details'}
                  </Button>
                </div>
                <ConversationHeader
                  channel={selected.primary_channel}
                  title={threadTitle(selected)}
                  reference={threadRef(selected)}
                  statusLabel={prettyLabel(selected.status)}
                  priority={selected.priority}
                  priorityVariant={priorityVariant(selected.priority)}
                  aiMode={selected.ai_mode}
                  assignedLabel={assignedLabel}
                  slaLabel={selectedSla.label}
                  slaLevel={selectedSla.level}
                />

                {/* SLA pause/resume (item 10). Paused threads freeze the clock with a reason. */}
                {!['resolved', 'closed', 'spam'].includes(String(selected.status)) && (
                  <div className="flex items-center gap-2 px-6 pt-3 text-xs" data-testid="sla-control">
                    {selected.sla_paused_at ? (
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={resumeSla} disabled={busyAction === 'sla-resume'}>
                        {busyAction === 'sla-resume' ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <PlayCircle className="w-3.5 h-3.5" aria-hidden />} Resume SLA
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={pauseSla} disabled={busyAction === 'sla-pause'}>
                        {busyAction === 'sla-pause' ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <PauseCircle className="w-3.5 h-3.5" aria-hidden />} Pause SLA
                      </Button>
                    )}
                    {selected.sla_paused_at && <span className="text-gray-500">Paused{selected.sla_pause_reason ? ` · ${prettyLabel(selected.sla_pause_reason)}` : ''}</span>}
                  </div>
                )}

                <CardContent className="space-y-4 pt-4">
                  {/* Timeline + technical/audit drawer toggle (item 6) */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">Conversation timeline</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      aria-pressed={showTimelineTechnical}
                      onClick={() => setShowTimelineTechnical((v) => !v)}
                      data-testid="timeline-technical-toggle"
                    >
                      {showTimelineTechnical ? 'Hide technical' : 'Show technical'}
                    </Button>
                  </div>
                  <ScrollArea className="h-[300px] rounded-lg border bg-gray-50/60 p-3">
                    {messages.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">No messages in this thread yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {messages.flatMap((message, i) => {
                          const day = dayGroup(message.created_at)
                          const prevDay = i > 0 ? dayGroup(messages[i - 1].created_at) : ''
                          const nodes = []
                          if (day && day !== prevDay) {
                            nodes.push(<div key={`sep-${message.id}`} className="text-center text-[10px] uppercase tracking-wide text-gray-400 py-1">{day}</div>)
                          }
                          nodes.push(
                            <MessageBubble
                              key={message.id}
                              message={message}
                              slaThresholdSeconds={60}
                              timeZone={preferences?.timezone || undefined}
                              senderLabel={message.direction === 'inbound' ? threadTitle(selected) : (message.direction === 'outbound' ? 'Agent' : undefined)}
                            />,
                          )
                          if (showTimelineTechnical) {
                            const msgAttempts = deliveryAttempts.filter((a) => a.message_id === message.id)
                            nodes.push(
                              <div key={`tech-${message.id}`} className="ml-2 pl-2 border-l-2 border-gray-200 space-y-1.5">
                                <MessageTechnicalDetails message={message as Parameters<typeof MessageTechnicalDetails>[0]['message']} />
                                {msgAttempts.length > 0 && <DeliveryAttemptList attempts={msgAttempts} compact />}
                              </div>,
                            )
                          }
                          return nodes
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Audited reply composer — sticks to the bottom so it never covers the timeline. */}
                  <div className="sticky bottom-0 bg-white pt-2 -mx-1 px-1 z-10" data-testid="reply-composer-sticky">
                    <ReplyComposer
                      channel={selected.primary_channel}
                      reply={reply}
                      onReplyChange={setReply}
                      internalNote={internalNote}
                      onInternalNoteChange={setInternalNote}
                      status={replyStatus}
                      error={replyError}
                      correlationId={replyCorrelationId}
                      idempotencyKey={replyClientMessageId}
                      onSend={sendReply}
                    />
                  </div>

                  <Separator />

                  {/* Handoff */}
                  <HandoffBar
                    teams={TEAMS}
                    busyAction={busyAction}
                    canAssignToMe={!!user?.id}
                    onAssignToMe={assignToMe}
                    onAssignTeam={assignToTeam}
                    onAssignAdminId={(id) => runAction('assign-id', () => assignCommunicationThread(selected!.id, { assigned_admin_id: id || undefined, assigned_team: selected!.assigned_team || 'support' }))}
                    onEscalate={escalate}
                    onResolve={resolve}
                    canReopen={['resolved', 'closed'].includes(String(selected?.status || ''))}
                    onReopen={reopen}
                  />
                </CardContent>
              </>
            )}
          </Card>

          {/* ── Ops / context rail ── (mobile: a details drawer toggled from the conversation) */}
          <aside className={`space-y-5 ${showMobileDetails ? 'block' : 'hidden'} lg:block`} data-testid="ops-rail">
            {/* Customer identity + context + SLA + consent for the selected thread (item 7) */}
            {selected && (
              <ContextRail
                identity={{
                  display_name: selected.identity_display_name || identities[0]?.display_name,
                  normalized_address: selected.identity_address || identities[0]?.normalized_address,
                  external_id: selected.identity_external_id || identities[0]?.external_id,
                  channel: selected.identity_channel || identities[0]?.channel || selected.primary_channel,
                  provider: selected.identity_provider || identities[0]?.provider,
                  verified: selected.identity_verified ?? identities[0]?.verified,
                  consent_status: preferences?.consent_status || identities[0]?.consent_status,
                } as ContextIdentity}
                linkedIdentities={linkedIdentities}
                contextRefs={[
                  selected.marketplace_listing_id ? { label: 'Listing', value: String(selected.marketplace_listing_id) } : null,
                  selected.escrow_id ? { label: 'Escrow', value: String(selected.escrow_id) } : null,
                  selected.financing_application_id ? { label: 'Financing', value: String(selected.financing_application_id) } : null,
                  selected.subject_id ? { label: prettyLabel(selected.subject_type) || 'Reference', value: String(selected.subject_id) } : null,
                ].filter(Boolean) as ContextRef[]}
                assignedLabel={assignedLabel}
                team={selected.assigned_team}
                reassignmentHistory={auditEvents
                  .filter((e) => e.event_type === 'assigned' || e.event_type === 'reassigned')
                  .map((e): ContextReassignment => ({ at: e.created_at, summary: e.summary || prettyLabel(e.event_type), actor: e.actor_id }))}
                slaLabel={selectedSla.label}
                slaState={slaLevelToState(selectedSla.level)}
                preferences={preferences}
              />
            )}

            {/* Audit trail for the selected thread (visible timeline + technical drawer) */}
            {selected && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    aria-pressed={showAuditTechnical}
                    onClick={() => setShowAuditTechnical((v) => !v)}
                    data-testid="audit-technical-toggle"
                  >
                    {showAuditTechnical ? 'Hide technical' : 'Show technical'}
                  </Button>
                </div>
                <AuditDrawer events={auditEvents} showTechnical={showAuditTechnical} />
              </div>
            )}

            {/* Full delivery recovery (item 11): categorised, guarded bulk retry + requeue */}
            <RecoveryView
              categories={recovery.categories as Record<string, RecoveryNotification[]>}
              counts={recovery.counts}
              busyAction={busyAction}
              bulkNote={recoveryNote}
              onRetry={(id) => runRecoveryAction(`retry-${id}`, () => retryCommunicationDeadLetter(id))}
              onCancel={(id) => runRecoveryAction(`cancel-${id}`, () => cancelCommunicationDeadLetter(id, 'admin_cancelled'))}
              onRequeue={(id, dest) => runRecoveryAction(`requeue-${id}`, () => requeueCommunicationDeadLetter(id, { to: dest }))}
              onBulkRetry={runBulkRetry}
              onOpenThread={(id) => navigate(`${basePath}/inbox/${id}`)}
            />

            {/* Worker & SLA health */}
            {workerHealth && (
              <WorkerHealthPanel
                health={workerHealth}
                idlePollSeconds={IDLE_POLL_INTERVAL_MS / 1000}
                deliveryPollSeconds={DELIVERY_POLL_INTERVAL_MS / 1000}
              />
            )}

            {/* Per-channel provider health (registry-driven; future channels shown as Planned) */}
            <ProviderHealthPanel adapters={workerHealth?.adapters} />

            {/* Provider smoke test */}
            <ProviderSmokeTestPanel
              onSend={(payload) => sendCommunicationProviderSmokeTest(payload)}
              environmentLabel={typeof window !== 'undefined' ? window.location.hostname : 'staging'}
              onDone={refreshWorkerHealth}
            />
          </aside>
        </div>
        )}

        {/* ── Recovery section (item 5/11): full-width categorised recovery ── */}
        {section === 'recovery' && (
          <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start" data-testid="section-view-recovery">
            <RecoveryView
              categories={recovery.categories as Record<string, RecoveryNotification[]>}
              counts={recovery.counts}
              busyAction={busyAction}
              bulkNote={recoveryNote}
              onRetry={(id) => runRecoveryAction(`retry-${id}`, () => retryCommunicationDeadLetter(id))}
              onCancel={(id) => runRecoveryAction(`cancel-${id}`, () => cancelCommunicationDeadLetter(id, 'admin_cancelled'))}
              onRequeue={(id, dest) => runRecoveryAction(`requeue-${id}`, () => requeueCommunicationDeadLetter(id, { to: dest }))}
              onBulkRetry={runBulkRetry}
              onOpenThread={(id) => navigate(`${basePath}/inbox/${id}`)}
            />
            <aside className="space-y-5">
              {workerHealth && (
                <WorkerHealthPanel health={workerHealth} idlePollSeconds={IDLE_POLL_INTERVAL_MS / 1000} deliveryPollSeconds={DELIVERY_POLL_INTERVAL_MS / 1000} />
              )}
            </aside>
          </div>
        )}

        {/* ── Providers section (item 5/12): live provider ops telemetry + health + smoke test ── */}
        {section === 'providers' && (
          <div className="grid md:grid-cols-2 gap-5 items-start" data-testid="section-view-providers">
            <ProviderTelemetryPanel channels={providers.channels} staleLocks={providers.staleLocks} />
            <div className="space-y-5">
              <ProviderHealthPanel adapters={workerHealth?.adapters} />
              {workerHealth && (
                <WorkerHealthPanel health={workerHealth} idlePollSeconds={IDLE_POLL_INTERVAL_MS / 1000} deliveryPollSeconds={DELIVERY_POLL_INTERVAL_MS / 1000} />
              )}
              <ProviderSmokeTestPanel
                onSend={(payload) => sendCommunicationProviderSmokeTest(payload)}
                environmentLabel={typeof window !== 'undefined' ? window.location.hostname : 'staging'}
                onDone={refreshWorkerHealth}
              />
            </div>
          </div>
        )}

        {/* ── Audit section (item 5/8): the selected thread's full audit trail ── */}
        {/* ── Queues workspace (P1.10): backlog overview ── */}
        {section === 'queues' && (
          <div data-testid="section-view-queues">
            <QueueOverview basePath={basePath} queues={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] ?? 0 }))} />
          </div>
        )}

        {/* ── SLA workspace (P1.10): SLA worklist/overview ── */}
        {section === 'sla' && (
          <div data-testid="section-view-sla">
            <SlaWorklist
              threads={slaThreads}
              counts={{ breached: serverCounts?.sla_breach ?? 0 }}
              onOpen={(id) => navigate(`${basePath}/inbox/${id}`)}
            />
          </div>
        )}

        {/* ── Audit workspace (P1.10): GLOBAL audit search — no thread selection required ── */}
        {section === 'audit' && (
          <div className="max-w-3xl" data-testid="section-view-audit">
            <AuditSearch
              events={auditSearchEvents}
              eventType={auditSearchType}
              onEventTypeChange={setAuditSearchType}
              onOpenThread={(id) => navigate(`${basePath}/inbox/${id}`)}
            />
          </div>
        )}

        {/* ── Settings workspace (P1.10): read-only routing/SLA/channel reference ── */}
        {section === 'settings' && (
          <div className="max-w-3xl" data-testid="section-view-settings">
            <SettingsView
              policies={slaPolicies}
              idlePollSeconds={IDLE_POLL_INTERVAL_MS / 1000}
              deliveryPollSeconds={DELIVERY_POLL_INTERVAL_MS / 1000}
              defaultQueue={DEFAULT_QUEUE}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
