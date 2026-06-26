import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Clock, Loader2, MessageSquare, RefreshCcw, Send, UserCheck, XCircle, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThreads']>>['threads'][number]
type MessageSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationThread']>>['messages'][number]
type DeadLetterNotification = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationDeadLetters']>>['notifications'][number]
type Metrics = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchAdminCommunicationMetrics']>>
type WorkerHealth = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationWorkerHealth']>>
type StatCard = { label: string; value: string | number; icon: LucideIcon }
type ReplyStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'

const DELIVERY_POLL_INTERVAL_MS = 5_000   // while a reply is queued/processing
const IDLE_POLL_INTERVAL_MS = 30_000      // background refresh cadence

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

function deliveryBadge(status?: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'delivered') return <Badge variant="default" className="text-xs capitalize">Delivered</Badge>
  if (s === 'sent') return <Badge variant="secondary" className="text-xs capitalize">Sent</Badge>
  if (s === 'dead_letter' || s === 'failed') return <Badge variant="destructive" className="text-xs capitalize gap-1"><XCircle className="w-3 h-3" />Failed</Badge>
  if (s === 'retry_scheduled') return <Badge variant="outline" className="text-xs capitalize">Retry scheduled</Badge>
  if (s === 'processing') return <Badge variant="secondary" className="text-xs capitalize gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing</Badge>
  if (s === 'queued') return <Badge variant="outline" className="text-xs capitalize gap-1"><Clock className="w-3 h-3" />Queued</Badge>
  return null
}

function hasQueuedOrProcessing(msgs: MessageSummary[]) {
  return msgs.some((m) => m.direction === 'outbound' && ['queued', 'processing', 'retry_scheduled'].includes(String(m.status || '')))
}

function ageSeconds(isoTs?: string | null): number | null {
  if (!isoTs) return null
  return Math.round((Date.now() - new Date(isoTs).getTime()) / 1000)
}

export default function AdminCommunications() {
  const {
    fetchAdminCommunicationThreads,
    fetchCommunicationDeadLetters,
    fetchAdminCommunicationMetrics,
    fetchAdminCommunicationThread,
    fetchCommunicationWorkerHealth,
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
  const [reply, setReply] = useState('')
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>('idle')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyCorrelationId, setReplyCorrelationId] = useState<string | null>(null)
  const [replyClientMessageId, setReplyClientMessageId] = useState(() => newClientMessageId())
  const [assignee, setAssignee] = useState('')
  const [filter, setFilter] = useState('awaiting_human')
  const selectedRef = useRef<ThreadSummary | null>(null)
  selectedRef.current = selected

  const activeThreads = useMemo(() => threads.filter((t) => t.status !== 'resolved' && t.status !== 'closed'), [threads])

  const fetchDashboard = useCallback(async () => {
    const [threadRes, deadRes, metricRes] = await Promise.all([
      fetchAdminCommunicationThreads(filter ? { status: filter } : undefined).catch(() => ({ threads: [] })),
      fetchCommunicationDeadLetters().catch(() => ({ notifications: [] })),
      fetchAdminCommunicationMetrics().catch(() => ({})),
    ])
    return { threadRes, deadRes, metricRes }
  }, [fetchAdminCommunicationMetrics, fetchAdminCommunicationThreads, fetchCommunicationDeadLetters, filter])

  const load = useCallback(async () => {
    const { threadRes, deadRes, metricRes } = await fetchDashboard()
    setThreads(threadRes.threads || [])
    setDeadLetters(deadRes.notifications || [])
    setMetrics(metricRes || {})
  }, [fetchDashboard])

  const refreshWorkerHealth = useCallback(async () => {
    fetchCommunicationWorkerHealth().then(setWorkerHealth).catch(() => null)
  }, [fetchCommunicationWorkerHealth])

  // Initial load
  useEffect(() => {
    let mounted = true
    fetchDashboard().then(({ threadRes, deadRes, metricRes }) => {
      if (!mounted) return
      setThreads(threadRes.threads || [])
      setDeadLetters(deadRes.notifications || [])
      setMetrics(metricRes || {})
    })
    refreshWorkerHealth()
    return () => { mounted = false }
  }, [fetchDashboard, refreshWorkerHealth])

  // Auto-refresh: poll aggressively when reply is in-flight, slowly otherwise
  useEffect(() => {
    const waiting = hasQueuedOrProcessing(messages)
    const intervalMs = waiting ? DELIVERY_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
    const id = setInterval(async () => {
      const cur = selectedRef.current
      if (cur) {
        const detail = await fetchAdminCommunicationThread(cur.id).catch(() => null)
        if (detail) {
          setMessages(detail.messages || [])
          // Once all outbound messages are no longer queued, update reply status
          if (waiting && !hasQueuedOrProcessing(detail.messages || [])) {
            const lastOutbound = [...(detail.messages || [])].reverse().find((m) => m.direction === 'outbound')
            if (lastOutbound) setReplyStatus(mapReplyStatus(undefined, lastOutbound.status))
          }
        }
      }
      refreshWorkerHealth()
    }, intervalMs)
    return () => clearInterval(id)
  }, [messages, fetchAdminCommunicationThread, refreshWorkerHealth])

  const openThread = useCallback(async (thread: ThreadSummary) => {
    setSelected(thread)
    const detail = await fetchAdminCommunicationThread(thread.id)
    setSelected(detail.thread)
    setMessages(detail.messages || [])
    setReplyStatus('idle')
    setReplyError(null)
    setReplyCorrelationId(null)
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
      })
      setReply('')
      setReplyClientMessageId(newClientMessageId())
      await openThread(selected)
      setReplyStatus(mapReplyStatus(result.notification?.status, result.message?.status))
    } catch (error) {
      const apiError = error as Error & { requestId?: string; correlationId?: string }
      setReplyStatus('failed')
      setReplyError(apiError.message || 'Reply failed.')
      setReplyCorrelationId(apiError.requestId || apiError.correlationId || null)
    }
  }

  async function assign() {
    if (!selected) return
    await assignCommunicationThread(selected.id, { assigned_admin_id: assignee || undefined, assigned_team: selected.assigned_team || 'support' })
    await load()
    await openThread(selected)
  }

  async function escalate() {
    if (!selected) return
    await escalateCommunicationThread(selected.id, { reason_code: 'admin_escalation', severity: 'high', assigned_team: selected.assigned_team || 'support' })
    await load()
    await openThread(selected)
  }

  async function resolve() {
    if (!selected) return
    await resolveCommunicationThread(selected.id, 'Resolved from admin command center.')
    await load()
    await openThread(selected)
  }

  const stats: StatCard[] = [
    { label: 'Open', value: Number(metrics.open_threads ?? activeThreads.length), icon: MessageSquare },
    { label: 'Unassigned', value: Number(metrics.unassigned_threads ?? 0), icon: UserCheck },
    { label: 'Overdue', value: Number(metrics.overdue_threads ?? 0), icon: AlertTriangle },
    { label: 'Dead letter', value: Number(metrics.dead_letter_count ?? deadLetters.length), icon: Bell },
  ]

  const slaBreaching = workerHealth?.queue?.sla_breaching ?? 0
  const telegramMode = workerHealth?.telegram?.mode ?? null
  const telegramOk = workerHealth?.telegram?.available === true && telegramMode === 'real'

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Communication Command Center</h1>
          <p className="text-gray-500">Inbox, handoff, SLA, delivery recovery, and audited replies</p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4" /> Refresh</Button>
      </div>

      {/* Worker health banner */}
      {workerHealth && (
        <div className={`rounded-lg border px-4 py-2 flex flex-wrap items-center gap-3 text-sm ${slaBreaching > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
          <Zap className={`w-4 h-4 ${slaBreaching > 0 ? 'text-red-500' : 'text-green-500'}`} />
          <span className="font-medium">Worker</span>
          <span>Queued: <strong>{workerHealth.queue.queued}</strong></span>
          <span>Processing: <strong>{workerHealth.queue.processing}</strong></span>
          <span>Retry: <strong>{workerHealth.queue.retry_scheduled}</strong></span>
          {workerHealth.queue.oldest_queued_seconds != null && (
            <span>Oldest: <strong>{workerHealth.queue.oldest_queued_seconds}s</strong></span>
          )}
          {slaBreaching > 0 && (
            <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />{slaBreaching} breaching {workerHealth.queue.sla_threshold_seconds}s SLA</Badge>
          )}
          <span className={`ml-auto flex items-center gap-1 ${telegramOk ? 'text-green-700' : 'text-red-600'}`}>
            Telegram: <strong>{telegramOk ? 'real' : workerHealth.telegram?.mode ?? 'unknown'}</strong>
            {telegramOk ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          </span>
          <span className="text-gray-400 text-xs">Cron: {workerHealth.scheduler.cadence}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-0 card-shadow">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
              <Icon className="w-5 h-5 text-orange-500" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {['awaiting_human', 'escalated', 'assigned', 'open', ''].map((value) => (
          <Button key={value || 'all'} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
            {value || 'all'}
          </Button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[360px_1fr_300px] gap-6">
        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Inbox</CardTitle></CardHeader>
          <CardContent className="p-0">
            {threads.length === 0 ? <p className="p-4 text-sm text-gray-500">No threads for this filter.</p> : threads.map((thread) => (
              <button key={thread.id} onClick={() => openThread(thread)} className={`w-full text-left p-4 border-b hover:bg-gray-50 ${selected?.id === thread.id ? 'bg-orange-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm capitalize">{thread.thread_type?.replaceAll('_', ' ')}</p>
                  <Badge variant={thread.priority === 'urgent' || thread.priority === 'high' ? 'destructive' : 'secondary'}>{thread.priority}</Badge>
                </div>
                <p className="text-xs text-gray-500 mt-1">{thread.status} · {thread.primary_channel || 'in_app'}</p>
                <p className="text-xs text-gray-400 mt-1 truncate">{thread.marketplace_listing_id || thread.escrow_id || thread.financing_application_id || thread.id}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow min-h-[560px]">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{selected ? selected.thread_key : 'Select a thread'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? <p className="text-sm text-gray-500">Choose a thread to review timeline, assignment, and replies.</p> : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge>{selected.status}</Badge>
                  <Badge variant="secondary">{selected.ai_mode}</Badge>
                  {selected.assigned_team && <Badge variant="outline">{selected.assigned_team}</Badge>}
                </div>
                <div className="rounded-lg border bg-gray-50 p-3 space-y-3 max-h-80 overflow-auto">
                  {messages.length === 0 ? <p className="text-sm text-gray-500">No messages loaded.</p> : messages.map((message) => {
                    const isOutbound = message.direction === 'outbound'
                    const ageSec = isOutbound ? ageSeconds((message as any).created_at) : null
                    const isSlaBreaching = isOutbound && ['queued', 'processing'].includes(String(message.status || '')) && ageSec != null && ageSec > 60
                    return (
                      <div key={message.id} className={`rounded-lg p-3 ${message.direction === 'inbound' ? 'bg-white' : message.direction === 'internal' ? 'bg-amber-50' : 'bg-orange-50'}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-xs uppercase tracking-wide text-gray-400">{message.direction} · {message.channel}</p>
                          <div className="flex items-center gap-1">
                            {deliveryBadge(message.status)}
                            {isSlaBreaching && (
                              <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle className="w-3 h-3" />{ageSec}s — past SLA</Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
                      </div>
                    )
                  })}
                </div>
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a user-visible reply"
                  disabled={replyStatus === 'sending'}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={sendReply} className="gap-2" disabled={!reply.trim() || replyStatus === 'sending'}>
                    {replyStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {replyStatus === 'sending' ? 'Sending' : 'Reply'}
                  </Button>
                  <Button onClick={escalate} variant="outline">Escalate</Button>
                  <Button onClick={resolve} variant="secondary" className="gap-2"><CheckCircle2 className="w-4 h-4" /> Resolve</Button>
                  {replyStatus !== 'idle' && replyStatus !== 'failed' && (
                    <Badge variant={replyStatus === 'delivered' ? 'default' : 'secondary'} className="capitalize">{replyStatus}</Badge>
                  )}
                  {replyStatus === 'failed' && (
                    <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Failed</Badge>
                  )}
                </div>
                {replyError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <p>{replyError}</p>
                    {replyCorrelationId && <p className="mt-1 text-xs">Correlation ID: {replyCorrelationId}</p>}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Assignment</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Admin user ID" />
              <Button onClick={assign} variant="secondary" className="w-full">Assign</Button>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Dead Letter</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {deadLetters.length === 0 ? <p className="text-sm text-gray-500">No failed notifications.</p> : deadLetters.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <p className="font-medium text-sm">{item.notification_type}</p>
                  <p className="text-xs text-gray-500">{item.last_error_code}</p>
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="outline" onClick={() => retryCommunicationDeadLetter(item.id)}>Retry</Button>
                    <Button size="sm" variant="ghost" onClick={() => cancelCommunicationDeadLetter(item.id, 'admin_cancelled')}>Cancel</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {workerHealth && (
            <Card className="border-0 card-shadow">
              <CardHeader className="pb-3"><CardTitle className="text-lg">Worker Health</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Queue depth</span><strong>{workerHealth.queue.depth}</strong></div>
                <div className="flex justify-between"><span className="text-gray-500">Dead letter</span><strong>{workerHealth.queue.dead_letter}</strong></div>
                <div className="flex justify-between"><span className="text-gray-500">Telegram</span>
                  <span className={telegramOk ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {workerHealth.telegram?.provider ?? 'not configured'} ({workerHealth.telegram?.mode ?? '—'})
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-500">Schedule</span><strong>{workerHealth.scheduler.cadence}</strong></div>
                {workerHealth.queue.oldest_queued_seconds != null && (
                  <div className="flex justify-between"><span className="text-gray-500">Oldest queued</span><strong>{workerHealth.queue.oldest_queued_seconds}s</strong></div>
                )}
                <p className="text-xs text-gray-400 pt-1">Auto-refreshes every {IDLE_POLL_INTERVAL_MS / 1000}s · {DELIVERY_POLL_INTERVAL_MS / 1000}s when queued</p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
