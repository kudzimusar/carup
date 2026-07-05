import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Inbox as InboxIcon, Loader2,
  MessageSquare, RefreshCcw, Search, Send, ShieldAlert, UserCheck, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelIcon } from '@/features/communications/ChannelIcon'
import { channelLabel } from '@/features/communications/channelRegistry'
import { priorityVariant, threadRef, threadSla, threadTitle } from '@/features/communications/threadPresentation'
import { BulkActionBar } from '@/features/communications/admin/BulkActionBar'
import { ChannelFilterBar } from '@/features/communications/admin/ChannelFilterBar'
import { CommandCenterHeader } from '@/features/communications/admin/CommandCenterHeader'
import { ConversationHeader } from '@/features/communications/admin/ConversationHeader'
import { ConversationRow } from '@/features/communications/admin/ConversationRow'
import { DeliveryRecoveryPanel } from '@/features/communications/admin/DeliveryRecoveryPanel'
import { DeliveryStateBadge } from '@/features/communications/admin/DeliveryStateBadge'
import { MessageBubble } from '@/features/communications/admin/MessageBubble'
import { ProviderHealthPanel } from '@/features/communications/admin/ProviderHealthPanel'
import { ProviderSmokeTestPanel } from '@/features/communications/admin/ProviderSmokeTestPanel'
import { WorkerHealthPanel } from '@/features/communications/admin/WorkerHealthPanel'
import { dayGroup } from '@/features/communications/communicationFormatting'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['threads'][number]
type MessageSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThread']>>['messages'][number]
type DeadLetterNotification = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationDeadLetters']>>['notifications'][number]
type Metrics = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationMetrics']>>
type WorkerHealth = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationWorkerHealth']>>
type ThreadCounts = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['counts']>
type ThreadPage = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['page']>
const PAGE_LIMIT = '100'
type ReplyStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'

const DELIVERY_POLL_INTERVAL_MS = 5_000   // while a reply is queued/processing
const IDLE_POLL_INTERVAL_MS = 30_000      // background refresh cadence

const FILTERS = [
  { value: 'awaiting_human', label: 'Awaiting human' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
] as const

const TEAMS = ['support', 'finance', 'safepay', 'trust_safety', 'marketplace'] as const

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

// Delegates to the shared DeliveryStateBadge so every surface uses one label/tone source.
function deliveryBadge(status?: string) {
  return <DeliveryStateBadge status={status} />
}


export default function AdminCommunications() {
  const {
    user,
    fetchAdminCommunicationThreads,
    fetchCommunicationDeadLetters,
    fetchAdminCommunicationMetrics,
    fetchAdminCommunicationThread,
    fetchCommunicationWorkerHealth,
    sendCommunicationProviderSmokeTest,
    adminReplyCommunicationThread,
    assignCommunicationThread,
    escalateCommunicationThread,
    resolveCommunicationThread,
    retryCommunicationDeadLetter,
    cancelCommunicationDeadLetter,
  } = useCarUpApi()

  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<ThreadSummary | null>(null)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [deadLetters, setDeadLetters] = useState<DeadLetterNotification[]>([])
  const [metrics, setMetrics] = useState<Metrics>({})
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverCounts, setServerCounts] = useState<ThreadCounts | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>(() => searchParams.get('filter') || 'awaiting_human')
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [teamPick, setTeamPick] = useState('')
  const [channelFilter, setChannelFilter] = useState<string | null>(null)

  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>('idle')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyCorrelationId, setReplyCorrelationId] = useState<string | null>(null)
  const [replyClientMessageId, setReplyClientMessageId] = useState(() => newClientMessageId())

  const [assignee, setAssignee] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)


  const selectedRef = useRef<ThreadSummary | null>(null)
  const openTokenRef = useRef(0)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // Tab badge counts prefer the server's whole-window counts (accurate beyond the fetched page);
  // fall back to client-side counts over the loaded threads when the server counts are absent.
  const counts = useMemo(() => {
    if (serverCounts) {
      const c: Record<string, number> = { all: serverCounts.total }
      for (const f of FILTERS) if (f.value !== 'all') c[f.value] = serverCounts.by_workflow?.[f.value] ?? 0
      return c
    }
    const c: Record<string, number> = { all: threads.length }
    for (const f of FILTERS) if (f.value !== 'all') c[f.value] = 0
    for (const t of threads) {
      const s = String(t.status || '')
      if (s in c) c[s] += 1
    }
    return c
  }, [threads, serverCounts])

  const channelCounts = useMemo(() => {
    if (serverCounts?.by_channel) return serverCounts.by_channel
    const c: Record<string, number> = {}
    for (const t of threads) {
      const ch = String(t.primary_channel || '').toLowerCase()
      if (ch) c[ch] = (c[ch] || 0) + 1
    }
    return c
  }, [serverCounts, threads])

  const visibleThreads = useMemo(() => {
    let rows = filter === 'all' ? threads : threads.filter((t) => String(t.status) === filter)
    if (channelFilter) rows = rows.filter((t) => String(t.primary_channel || '').toLowerCase() === channelFilter)
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((t) => [t.thread_type, t.thread_key, t.id, threadRef(t), t.assigned_team]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [threads, filter, search, channelFilter])

  const fetchDashboard = useCallback(async () => {
    // Fetch a wide window (no status filter) so tab counts + filtering are computed client-side.
    // Track a thread-fetch failure separately so we can surface it instead of showing an empty inbox.
    let threadRes: { threads: ThreadSummary[]; counts?: ThreadCounts; page?: ThreadPage } = { threads: [] }
    let threadsFailed = false
    try {
      threadRes = await fetchAdminCommunicationThreads({ limit: PAGE_LIMIT })
    } catch {
      threadsFailed = true
    }
    const [deadRes, metricRes] = await Promise.all([
      fetchCommunicationDeadLetters().catch(() => ({ notifications: [] })),
      fetchAdminCommunicationMetrics().catch(() => ({})),
    ])
    return { threadRes, deadRes, metricRes, threadsFailed }
  }, [fetchAdminCommunicationMetrics, fetchAdminCommunicationThreads, fetchCommunicationDeadLetters])

  const load = useCallback(async () => {
    const { threadRes, deadRes, metricRes, threadsFailed } = await fetchDashboard()
    setLoadError(threadsFailed ? 'Could not load threads — press Refresh to retry.' : null)
    if (!threadsFailed) {
      setThreads(threadRes.threads || [])
      setServerCounts(threadRes.counts ?? null)
      setNextCursor(threadRes.page?.next_cursor ?? null)
    }
    setDeadLetters(deadRes.notifications || [])
    setMetrics(metricRes || {})
  }, [fetchDashboard])

  const refreshWorkerHealth = useCallback(async () => {
    fetchCommunicationWorkerHealth().then(setWorkerHealth).catch(() => null)
  }, [fetchCommunicationWorkerHealth])

  // Cursor pagination: append the next server page (dedup by id) without disturbing selection/draft.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetchAdminCommunicationThreads({ limit: PAGE_LIMIT, cursor: nextCursor })
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
  }, [nextCursor, loadingMore, fetchAdminCommunicationThreads])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setBulkNote(null)
  }, [])
  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setBulkNote(null) }, [])

  // Initial load
  useEffect(() => {
    let mounted = true
    fetchDashboard().then(({ threadRes, deadRes, metricRes, threadsFailed }) => {
      if (!mounted) return
      setLoadError(threadsFailed ? 'Could not load threads — press Refresh to retry.' : null)
      if (!threadsFailed) {
        setThreads(threadRes.threads || [])
        setServerCounts(threadRes.counts ?? null)
        setNextCursor(threadRes.page?.next_cursor ?? null)
      }
      setDeadLetters(deadRes.notifications || [])
      setMetrics(metricRes || {})
      setLoading(false)
    })
    refreshWorkerHealth()
    return () => { mounted = false }
  }, [fetchDashboard, refreshWorkerHealth])

  // Persist filter / search / selected thread to the URL so the inbox is deep-linkable and
  // survives refresh (replace, not push, to avoid history spam).
  useEffect(() => {
    const next = new URLSearchParams()
    if (filter && filter !== 'awaiting_human') next.set('filter', filter)
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
      setMessages([])
      setReplyStatus('idle')
      setReplyError(null)
      setReplyCorrelationId(null)
      setInternalNote(false)
      setTeamPick('')
    }
    const detail = await fetchAdminCommunicationThread(thread.id).catch(() => null)
    // Ignore a stale response if a newer openThread started while this fetch was in flight.
    if (openTokenRef.current !== token) return
    if (detail) {
      setSelected(detail.thread)
      setMessages(detail.messages || [])
    }
  }, [fetchAdminCommunicationThread])

  // Open a deep-linked thread (?thread=<id>) once on mount so shared links land on the conversation.
  const deepLinkedRef = useRef(false)
  useEffect(() => {
    if (deepLinkedRef.current) return
    // Mark handled on the first run regardless — otherwise a later URL change (from selecting a
    // thread, which writes ?thread=<id>) would re-enter this and re-open with a bare {id} stub.
    deepLinkedRef.current = true
    const threadId = searchParams.get('thread')
    if (!threadId) return
    let cancelled = false
    // Defer out of the effect body so the open (and its state updates) run asynchronously.
    Promise.resolve().then(() => { if (!cancelled) void openThread({ id: threadId } as ThreadSummary) })
    return () => { cancelled = true }
  }, [searchParams, openThread])

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
    try {
      await fn()
      await load()
    } finally {
      setBusyAction(null)
    }
  }, [load])

  const assignToMe = () => runAction('assign-me', () => assignCommunicationThread(selected!.id, { assigned_admin_id: user?.id, assigned_team: selected!.assigned_team }))
  const assignToAdminId = () => runAction('assign-id', () => assignCommunicationThread(selected!.id, { assigned_admin_id: assignee || undefined, assigned_team: selected!.assigned_team || 'support' }))
  const assignToTeam = (team: string) => runAction('assign-team', () => assignCommunicationThread(selected!.id, { assigned_team: team }))
  const escalate = () => runAction('escalate', () => escalateCommunicationThread(selected!.id, { reason_code: 'admin_escalation', severity: 'high', assigned_team: selected!.assigned_team || 'support' }))
  const resolve = () => runAction('resolve', () => resolveCommunicationThread(selected!.id, 'Resolved from admin command center.'))


  const overdue = Number(metrics.overdue_threads ?? 0)
  const unassigned = Number(metrics.unassigned_threads ?? 0)
  const deadLetterCount = Number(metrics.dead_letter_count ?? deadLetters.length)
  const selectedSla = threadSla(selected)
  const assignedLabel = selected?.assigned_admin_id
    ? `Admin ${String(selected.assigned_admin_id).slice(0, 8)}`
    : selected?.assigned_team ? prettyLabel(selected.assigned_team) : 'Unassigned'

  return (
    <TooltipProvider delayDuration={200}>
      <div className="max-w-7xl mx-auto space-y-5">
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

        <div className="grid lg:grid-cols-[340px_1fr_300px] gap-5 items-start">
          {/* ── Inbox ── */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><InboxIcon className="w-4 h-4" /> Inbox</CardTitle>
                <span className="text-xs text-gray-400">{visibleThreads.length} shown</span>
              </div>
              <div className="grid grid-cols-5 gap-1" role="group" aria-label="Filter threads by status">
                {FILTERS.map((f) => {
                  const isActive = filter === f.value
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFilter(f.value)}
                      aria-pressed={isActive}
                      title={f.label}
                      className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] border transition-colors ${isActive ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      <span className="truncate max-w-full">{f.label.split(' ')[0]}</span>
                      <span className={`text-[10px] font-semibold tabular-nums ${isActive ? 'opacity-90' : 'opacity-60'}`}>{counts[f.value] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search type, ref, team…" aria-label="Search threads" className="pl-8 h-9" />
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
                <ScrollArea
                  className="h-[560px] focus:outline-none"
                  tabIndex={0}
                  role="group"
                  aria-label="Thread inbox — use up and down arrows to navigate"
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
                >
                  {visibleThreads.map((thread) => {
                    const sla = threadSla(thread)
                    return (
                      <ConversationRow
                        key={thread.id}
                        channel={thread.primary_channel}
                        title={threadTitle(thread)}
                        reference={threadRef(thread)}
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
                  })}
                  {nextCursor && (
                    <div className="p-3 text-center border-t">
                      <Button size="sm" variant="outline" className="w-full gap-1" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </Button>
                    </div>
                  )}
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* ── Conversation + audited reply + handoff ── */}
          <Card className="border-0 card-shadow min-h-[620px]">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-[620px] text-center px-6">
                <MessageSquare className="w-10 h-10 text-gray-300 mb-3" />
                <p className="font-medium text-gray-600">Select a thread</p>
                <p className="text-sm text-gray-400 mt-1">Review the timeline, hand it off, and send an audited reply.</p>
              </div>
            ) : (
              <>
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

                <CardContent className="space-y-4 pt-4">
                  {/* Timeline */}
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
                          nodes.push(<MessageBubble key={message.id} message={message} slaThresholdSeconds={60} />)
                          return nodes
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Audited reply composer */}
                  <div className="space-y-2">
                    <div className="text-xs">
                      {internalNote ? (
                        <span className="flex items-center gap-1 text-amber-700 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> Internal note · saved to the thread, not sent to the customer
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-600">
                          Reply via <ChannelIcon channel={selected.primary_channel} size={14} decorative /> <strong>{channelLabel(selected.primary_channel)}</strong> to the customer
                        </span>
                      )}
                    </div>
                    <Textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={internalNote ? 'Write an internal note (not sent to the user)…' : 'Write a user-visible reply…'}
                      disabled={replyStatus === 'sending'}
                      className={internalNote ? 'border-amber-300 focus-visible:ring-amber-300' : ''}
                      rows={3}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                        <Switch checked={internalNote} onCheckedChange={setInternalNote} aria-label="Internal note (not sent to the user)" />
                        Internal note
                      </label>
                      <Button onClick={sendReply} className="gap-2" disabled={!reply.trim() || replyStatus === 'sending'}>
                        {replyStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {replyStatus === 'sending' ? 'Sending…' : internalNote ? 'Add internal note' : 'Send reply'}
                      </Button>
                      {replyStatus !== 'idle' && replyStatus !== 'failed' && replyStatus !== 'sending' && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-500">
                          Reply {deliveryBadge(replyStatus === 'delivered' ? 'delivered' : replyStatus)}
                        </span>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-auto text-[10px] text-gray-300 font-mono cursor-default hidden sm:block">idem {replyClientMessageId.slice(0, 8)}</span>
                        </TooltipTrigger>
                        <TooltipContent>Idempotency key — resubmitting the same key will not double-send.</TooltipContent>
                      </Tooltip>
                    </div>
                    {replyError && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <p className="flex items-center gap-1"><XCircle className="w-4 h-4" /> {replyError}</p>
                        {replyCorrelationId && <p className="mt-1 text-xs font-mono">Correlation ID: {replyCorrelationId}</p>}
                        <p className="mt-1 text-xs text-red-500">Your draft was preserved — press Send to retry.</p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Handoff */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Handoff</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" className="gap-1" onClick={assignToMe} disabled={busyAction === 'assign-me' || !user?.id}>
                        {busyAction === 'assign-me' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />} Assign to me
                      </Button>
                      <Select value={teamPick} onValueChange={(team) => { setTeamPick(team); void assignToTeam(team).finally(() => setTeamPick('')) }}>
                        <SelectTrigger className="h-9 w-[150px]" aria-label="Assign to team"><SelectValue placeholder="Assign to team…" /></SelectTrigger>
                        <SelectContent>
                          {TEAMS.map((t) => <SelectItem key={t} value={t} className="capitalize">{prettyLabel(t)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="gap-1" onClick={escalate} disabled={busyAction === 'escalate'}>
                        {busyAction === 'escalate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Escalate
                      </Button>
                      <Button size="sm" variant="secondary" className="gap-1" onClick={resolve} disabled={busyAction === 'resolve'}>
                        {busyAction === 'resolve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Resolve
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assign to admin user ID" aria-label="Assign to admin user ID" className="h-9" />
                      <Button size="sm" variant="outline" onClick={assignToAdminId} disabled={busyAction === 'assign-id' || !assignee.trim()}>Assign</Button>
                    </div>
                  </div>
                </CardContent>
              </>
            )}
          </Card>

          {/* ── Ops rail ── */}
          <aside className="space-y-5">
            {/* Delivery recovery */}
            <DeliveryRecoveryPanel
              items={deadLetters}
              busyAction={busyAction}
              onRetry={(id) => runRecoveryAction(`retry-${id}`, () => retryCommunicationDeadLetter(id))}
              onCancel={(id) => runRecoveryAction(`cancel-${id}`, () => cancelCommunicationDeadLetter(id, 'admin_cancelled'))}
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
              defaultRecipient="818081201356"
              onDone={refreshWorkerHealth}
            />
          </aside>
        </div>
      </div>
    </TooltipProvider>
  )
}
