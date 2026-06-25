import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Loader2, MessageSquare, RefreshCcw, Send, UserCheck, XCircle } from 'lucide-react'
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
type StatCard = { label: string; value: string | number; icon: LucideIcon }
type ReplyStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'

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

export default function AdminCommunications() {
  const {
    fetchAdminCommunicationThreads,
    fetchCommunicationDeadLetters,
    fetchAdminCommunicationMetrics,
    fetchAdminCommunicationThread,
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
  const [reply, setReply] = useState('')
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>('idle')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyCorrelationId, setReplyCorrelationId] = useState<string | null>(null)
  const [replyClientMessageId, setReplyClientMessageId] = useState(() => newClientMessageId())
  const [assignee, setAssignee] = useState('')
  const [filter, setFilter] = useState('awaiting_human')

  const activeThreads = useMemo(() => threads.filter((thread) => thread.status !== 'resolved' && thread.status !== 'closed'), [threads])

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

  useEffect(() => {
    let mounted = true
    fetchDashboard().then(({ threadRes, deadRes, metricRes }) => {
      if (!mounted) return
      setThreads(threadRes.threads || [])
      setDeadLetters(deadRes.notifications || [])
      setMetrics(metricRes || {})
    })
    return () => { mounted = false }
  }, [fetchDashboard])

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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Communication Command Center</h1>
          <p className="text-gray-500">Inbox, handoff, SLA, delivery recovery, and audited replies</p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4" /> Refresh</Button>
      </div>

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
                  {messages.length === 0 ? <p className="text-sm text-gray-500">No messages loaded.</p> : messages.map((message) => (
                    <div key={message.id} className={`rounded-lg p-3 ${message.direction === 'inbound' ? 'bg-white' : message.direction === 'internal' ? 'bg-amber-50' : 'bg-orange-50'}`}>
                      <p className="text-xs uppercase tracking-wide text-gray-400">{message.direction} · {message.channel} · {message.status}</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
                    </div>
                  ))}
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
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="w-3 h-3" />
                      Failed
                    </Badge>
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
        </aside>
      </div>
    </div>
  )
}
