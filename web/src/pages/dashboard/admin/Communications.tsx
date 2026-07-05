import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Clock, Inbox as InboxIcon, Loader2, MessageCircle,
  MessageSquare, RefreshCcw, Search, Send, ShieldAlert, UserCheck, XCircle, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { DeliveryStateBadge } from '@/features/communications/admin/DeliveryStateBadge'
import { MessageBubble } from '@/features/communications/admin/MessageBubble'
import { dayGroup } from '@/features/communications/communicationFormatting'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['threads'][number]
type MessageSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThread']>>['messages'][number]
type DeadLetterNotification = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationDeadLetters']>>['notifications'][number]
type Metrics = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationMetrics']>>
type WorkerHealth = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationWorkerHealth']>>
type SmokeResult = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['sendCommunicationProviderSmokeTest']>>
type ThreadCounts = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['counts']>
type ReplyStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'
type SlaLevel = 'none' | 'ok' | 'due' | 'breach'

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

function threadTitle(thread?: ThreadSummary | null): string {
  return prettyLabel(thread?.thread_type) || 'Conversation'
}

function threadRef(thread?: ThreadSummary | null): string {
  if (!thread) return ''
  return thread.marketplace_listing_id || thread.escrow_id || thread.financing_application_id
    || (thread.subject_id ? `${thread.subject_type || 'ref'}:${thread.subject_id}` : '')
    || (thread.thread_key ? String(thread.thread_key).slice(0, 14) : String(thread.id).slice(0, 8))
}

function priorityVariant(p?: string): 'destructive' | 'secondary' | 'outline' {
  const s = String(p || '').toLowerCase()
  if (s === 'urgent' || s === 'high') return 'destructive'
  if (s === 'low') return 'outline'
  return 'secondary'
}

function threadSla(thread?: ThreadSummary | null): { level: SlaLevel; label: string } {
  const due = thread?.sla_due_at
  if (!due || ['resolved', 'closed', 'spam'].includes(String(thread?.status))) return { level: 'none', label: '' }
  const dueTime = new Date(due).getTime()
  if (Number.isNaN(dueTime)) return { level: 'none', label: '' }
  const diffMs = dueTime - Date.now()
  const mins = Math.max(0, Math.round(Math.abs(diffMs) / 60000))
  if (diffMs < 0) return { level: 'breach', label: `SLA overdue ${mins}m` }
  if (diffMs < 15 * 60000) return { level: 'due', label: `SLA due in ${mins}m` }
  return { level: 'ok', label: `SLA in ${mins}m` }
}

function hasQueuedOrProcessing(msgs: MessageSummary[]) {
  return msgs.some((m) => m.direction === 'outbound' && ['queued', 'processing', 'retry_scheduled'].includes(String(m.status || '')))
}

// Delegates to the shared DeliveryStateBadge so every surface uses one label/tone source.
function deliveryBadge(status?: string) {
  return <DeliveryStateBadge status={status} />
}

function StatPill({ label, value, tone = 'default', icon: Icon }: { label: string; value: string | number; tone?: 'default' | 'danger' | 'good' | 'muted'; icon?: LucideIcon }) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'good'
      ? 'border-green-200 bg-green-50 text-green-700'
      : tone === 'muted'
        ? 'border-gray-200 bg-gray-50 text-gray-500'
        : 'border-gray-200 bg-white text-gray-700'
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${toneClass}`}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="text-xs">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
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
  const [selected, setSelected] = useState<ThreadSummary | null>(null)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [deadLetters, setDeadLetters] = useState<DeadLetterNotification[]>([])
  const [metrics, setMetrics] = useState<Metrics>({})
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverCounts, setServerCounts] = useState<ThreadCounts | null>(null)
  const [filter, setFilter] = useState<string>('awaiting_human')
  const [search, setSearch] = useState('')
  const [teamPick, setTeamPick] = useState('')

  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>('idle')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyCorrelationId, setReplyCorrelationId] = useState<string | null>(null)
  const [replyClientMessageId, setReplyClientMessageId] = useState(() => newClientMessageId())

  const [assignee, setAssignee] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const [smokeTo, setSmokeTo] = useState('818081201356')
  const [smokeBusy, setSmokeBusy] = useState(false)
  const [smokeResult, setSmokeResult] = useState<SmokeResult | null>(null)

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

  const visibleThreads = useMemo(() => {
    const byFilter = filter === 'all' ? threads : threads.filter((t) => String(t.status) === filter)
    const q = search.trim().toLowerCase()
    if (!q) return byFilter
    return byFilter.filter((t) => [t.thread_type, t.thread_key, t.id, threadRef(t), t.assigned_team]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [threads, filter, search])

  const fetchDashboard = useCallback(async () => {
    // Fetch a wide window (no status filter) so tab counts + filtering are computed client-side.
    // Track a thread-fetch failure separately so we can surface it instead of showing an empty inbox.
    let threadRes: { threads: ThreadSummary[]; counts?: ThreadCounts } = { threads: [] }
    let threadsFailed = false
    try {
      threadRes = await fetchAdminCommunicationThreads({ limit: '300' })
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
    }
    setDeadLetters(deadRes.notifications || [])
    setMetrics(metricRes || {})
  }, [fetchDashboard])

  const refreshWorkerHealth = useCallback(async () => {
    fetchCommunicationWorkerHealth().then(setWorkerHealth).catch(() => null)
  }, [fetchCommunicationWorkerHealth])

  // Initial load
  useEffect(() => {
    let mounted = true
    fetchDashboard().then(({ threadRes, deadRes, metricRes, threadsFailed }) => {
      if (!mounted) return
      setLoadError(threadsFailed ? 'Could not load threads — press Refresh to retry.' : null)
      if (!threadsFailed) setThreads(threadRes.threads || [])
      setDeadLetters(deadRes.notifications || [])
      setMetrics(metricRes || {})
      setLoading(false)
    })
    refreshWorkerHealth()
    return () => { mounted = false }
  }, [fetchDashboard, refreshWorkerHealth])

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
    setSelected(thread)
    setMessages([])
    setReplyStatus('idle')
    setReplyError(null)
    setReplyCorrelationId(null)
    setInternalNote(false)
    setTeamPick('')
    const detail = await fetchAdminCommunicationThread(thread.id).catch(() => null)
    // Ignore a stale response if a newer openThread started while this fetch was in flight.
    if (openTokenRef.current !== token) return
    if (detail) {
      setSelected(detail.thread)
      setMessages(detail.messages || [])
    }
  }, [fetchAdminCommunicationThread])

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

  const runSmokeTest = useCallback(async () => {
    const to = smokeTo.trim()
    if (!to) return
    setSmokeBusy(true)
    setSmokeResult(null)
    try {
      const res = await sendCommunicationProviderSmokeTest({ channel: 'whatsapp', to })
      setSmokeResult(res)
    } catch (err) {
      setSmokeResult({ ok: false, error: 'request_failed', message: err instanceof Error ? err.message : 'Request failed' })
    } finally {
      setSmokeBusy(false)
      refreshWorkerHealth()
    }
  }, [smokeTo, sendCommunicationProviderSmokeTest, refreshWorkerHealth])

  const slaBreaching = workerHealth?.queue?.sla_breaching ?? 0
  const telegramMode = workerHealth?.telegram?.mode ?? null
  const telegramOk = workerHealth?.telegram?.available === true && telegramMode === 'real'
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
        <div className="flex flex-wrap items-center gap-2">
          <StatPill label="Open" value={Number(metrics.open_threads ?? threads.filter((t) => !['resolved', 'closed', 'spam'].includes(String(t.status))).length)} icon={MessageSquare} />
          <StatPill label="Unassigned" value={unassigned} tone={unassigned > 0 ? 'default' : 'muted'} icon={UserCheck} />
          <StatPill label="Overdue" value={overdue} tone={overdue > 0 ? 'danger' : 'good'} icon={AlertTriangle} />
          <StatPill label="Dead-letter" value={deadLetterCount} tone={deadLetterCount > 0 ? 'danger' : 'good'} icon={ShieldAlert} />
          <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
          {workerHealth ? (
            <>
              <StatPill label="Queue" value={workerHealth.queue.depth} tone="muted" icon={Zap} />
              {workerHealth.queue.oldest_queued_seconds != null && (
                <StatPill label="Oldest" value={`${workerHealth.queue.oldest_queued_seconds}s`} tone={workerHealth.queue.oldest_queued_seconds > (workerHealth.queue.sla_threshold_seconds ?? 60) ? 'danger' : 'muted'} icon={Clock} />
              )}
              <StatPill label={`SLA breach (${workerHealth.queue.sla_threshold_seconds ?? 60}s)`} value={slaBreaching} tone={slaBreaching > 0 ? 'danger' : 'good'} icon={AlertTriangle} />
              <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${telegramOk ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
                {telegramOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                Telegram <strong>{telegramOk ? 'real' : telegramMode ?? 'unknown'}</strong>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                    <Clock className="w-3.5 h-3.5" /> Cron {workerHealth.scheduler.job_config?.schedule ?? (workerHealth.scheduler.pg_cron_available ? '* * * * *' : 'pending')}
                  </div>
                </TooltipTrigger>
                <TooltipContent>Supabase pg_cron drives worker delivery. {workerHealth.scheduler.pg_cron_available ? 'Extension active.' : 'pg_cron not yet enabled.'}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Skeleton className="h-8 w-48 rounded-lg" />
          )}
        </div>

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
            </CardHeader>
            <CardContent className="p-0">
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
                <ScrollArea className="h-[560px]">
                  {threads.length >= 300 && (
                    <p className="px-3 py-2 text-[11px] text-amber-600 bg-amber-50 border-b">Showing the 300 most recently active threads. Use search to narrow.</p>
                  )}
                  {visibleThreads.map((thread) => {
                    const sla = threadSla(thread)
                    const isSelected = selected?.id === thread.id
                    return (
                      <button
                        key={thread.id}
                        onClick={() => openThread(thread)}
                        className={`w-full text-left p-3 border-b hover:bg-gray-50 transition-colors ${isSelected ? 'bg-orange-50 border-l-2 border-l-orange-500' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center">
                            <ChannelIcon channel={thread.primary_channel} size={16} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-sm truncate">{threadTitle(thread)}</p>
                              <Badge variant={priorityVariant(thread.priority)} className="text-[10px] shrink-0 capitalize">{thread.priority}</Badge>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 truncate font-mono">{threadRef(thread)}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[10px] capitalize">{prettyLabel(thread.status)}</Badge>
                              {!thread.assigned_admin_id && !thread.assigned_team && (
                                <span className="text-[10px] text-amber-600 font-medium">Unassigned</span>
                              )}
                              {sla.level === 'breach' && <span className="text-[10px] text-red-600 font-medium flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{sla.label}</span>}
                              {sla.level === 'due' && <span className="text-[10px] text-amber-600 font-medium">{sla.label}</span>}
                              <span className="text-[10px] text-gray-400 ml-auto">{relativeTime(thread.last_message_at || thread.updated_at)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
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
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <ChannelIcon channel={selected.primary_channel} size={18} />
                        {threadTitle(selected)}
                      </CardTitle>
                      <p className="text-xs text-gray-400 font-mono mt-1 truncate">{threadRef(selected)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <Badge variant="outline" className="capitalize">{prettyLabel(selected.status)}</Badge>
                      <Badge variant={priorityVariant(selected.priority)} className="capitalize">{selected.priority}</Badge>
                      {selected.ai_mode && <Badge variant="secondary" className="capitalize">AI: {selected.ai_mode}</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
                    <span className="flex items-center gap-1 text-gray-500"><UserCheck className="w-3.5 h-3.5" /> {assignedLabel}</span>
                    {selectedSla.level === 'breach' && <span className="flex items-center gap-1 text-red-600 font-medium"><AlertTriangle className="w-3.5 h-3.5" />{selectedSla.label}</span>}
                    {selectedSla.level === 'due' && <span className="flex items-center gap-1 text-amber-600 font-medium"><Clock className="w-3.5 h-3.5" />{selectedSla.label}</span>}
                    {selectedSla.level === 'ok' && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />{selectedSla.label}</span>}
                  </div>
                </CardHeader>

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
            <Card className="border-0 card-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> Delivery recovery
                  {deadLetters.length > 0 && <Badge variant="destructive" className="ml-auto">{deadLetters.length}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {deadLetters.length === 0 ? (
                  <div className="text-center py-4 text-sm text-gray-500">
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-green-500" />
                    No failed deliveries.
                  </div>
                ) : (
                  <>
                    {deadLetters.slice(0, 5).map((item) => (
                      <div key={item.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm capitalize truncate">{prettyLabel(item.notification_type)}</p>
                          {item.channel && <Badge variant="outline" className="text-[10px] shrink-0">{item.channel}</Badge>}
                        </div>
                        <p className="text-xs text-red-600 mt-0.5 truncate" title={item.last_error_message || item.last_error_code || ''}>
                          {item.last_error_code || 'delivery_failed'}{item.last_error_message ? ` — ${item.last_error_message}` : ''}
                        </p>
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => runRecoveryAction(`retry-${item.id}`, () => retryCommunicationDeadLetter(item.id))} disabled={busyAction === `retry-${item.id}`}>
                            {busyAction === `retry-${item.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />} Retry
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => runRecoveryAction(`cancel-${item.id}`, () => cancelCommunicationDeadLetter(item.id, 'admin_cancelled'))} disabled={busyAction === `cancel-${item.id}`}>Cancel</Button>
                        </div>
                      </div>
                    ))}
                    {deadLetters.length > 5 && <p className="text-xs text-gray-400 text-center pt-1">+{deadLetters.length - 5} more failed</p>}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Worker & SLA health */}
            {workerHealth && (
              <Card className="border-0 card-shadow">
                <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><Zap className="w-4 h-4" /> Worker &amp; SLA</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Queue depth</span><strong>{workerHealth.queue.depth}</strong></div>
                  <div className="flex justify-between"><span className="text-gray-500">SLA breaches</span><strong className={slaBreaching > 0 ? 'text-red-600' : ''}>{slaBreaching}</strong></div>
                  {workerHealth.queue.oldest_queued_seconds != null && (
                    <div className="flex justify-between"><span className="text-gray-500">Oldest queued</span><strong>{workerHealth.queue.oldest_queued_seconds}s</strong></div>
                  )}
                  <div className="flex justify-between items-center"><span className="text-gray-500">Telegram</span>
                    <span className={telegramOk ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{workerHealth.telegram?.provider ?? 'n/a'} ({workerHealth.telegram?.mode ?? '—'})</span>
                  </div>
                  <div className="flex justify-between"><span className="text-gray-500">Cron</span><strong className="font-mono text-xs">{workerHealth.scheduler.job_config?.schedule ?? (workerHealth.scheduler.pg_cron_available ? '* * * * *' : 'pending')}</strong></div>
                  <p className="text-xs text-gray-400 pt-1">Auto-refreshes every {IDLE_POLL_INTERVAL_MS / 1000}s · {DELIVERY_POLL_INTERVAL_MS / 1000}s while delivering.</p>
                </CardContent>
              </Card>
            )}

            {/* Provider smoke test */}
            <Card className="border-0 card-shadow">
              <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><MessageCircle className="w-4 h-4" /> WhatsApp smoke test</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-gray-500">Sends one real WhatsApp message through the engine. The server refuses fake adapters, so a green result means a real Meta request was made.</p>
                <Input value={smokeTo} onChange={(e) => setSmokeTo(e.target.value)} placeholder="Recipient E.164 e.g. 818081201356" aria-label="Smoke test recipient phone number in E.164" className="h-9" />
                <Button size="sm" className="w-full gap-1" disabled={smokeBusy || !smokeTo.trim()} onClick={runSmokeTest}>
                  {smokeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  {smokeBusy ? 'Sending…' : 'Send WhatsApp smoke test'}
                </Button>
                {smokeResult && (
                  <div className={`text-xs rounded p-2 ${smokeResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                    {smokeResult.ok ? (
                      <>
                        <div className="font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Sent via {smokeResult.provider}</div>
                        <div className="break-all">provider_message_id: {smokeResult.delivery?.provider_message_id}</div>
                        <div>status: {smokeResult.delivery?.status}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium flex items-center gap-1"><XCircle className="w-3 h-3" />{smokeResult.error || 'Failed'}</div>
                        <div className="break-words">{smokeResult.message || smokeResult.delivery?.error_message}</div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  )
}
