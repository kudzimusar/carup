import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, MessageSquare, Search, Send, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationThreads']>>['threads'][number]
type ThreadDetail = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationThread']>>
type NotificationSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationNotifications']>>['notifications'][number]
type CommunicationPreferences = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationPreferences']>>['preferences']>

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
}

type ConversationDetail = Omit<ThreadDetail, 'messages'> & {
  participants?: Array<{ id: string; stakeholder_role?: string; display_name?: string | null; is_self?: boolean }>
  self_participant_id?: string
  messages: ConversationMessage[]
}

type ConversationFilter = 'all' | 'unread' | 'marketplace' | 'support' | 'other'

function threadLabel(thread: ConversationThread) {
  if (thread.business_workflow === 'marketplace' || thread.thread_type === 'marketplace_inquiry') return 'Marketplace conversation'
  return (thread.business_workflow || thread.conversation_type || thread.thread_type || 'Conversation').replaceAll('_', ' ')
}

function participantLabel(detail: ConversationDetail | null) {
  if (!detail?.participants?.length) return null
  const others = detail.participants.filter((p) => !p.is_self && p.stakeholder_role !== 'buyer_unresolved')
  return others.map((p) => p.display_name || p.stakeholder_role || 'Participant').join(', ') || null
}

function matchesFilter(thread: ConversationThread, filter: ConversationFilter) {
  if (filter === 'all') return true
  if (filter === 'unread') return Number(thread.unread_count || 0) > 0
  const workflow = String(thread.business_workflow || thread.conversation_type || thread.thread_type || '').toLowerCase()
  if (filter === 'marketplace') return workflow === 'marketplace' || workflow === 'marketplace_inquiry'
  if (filter === 'support') return workflow === 'support'
  return !['marketplace', 'marketplace_inquiry', 'support'].includes(workflow)
}

export default function Communications() {
  const {
    fetchCommunicationThreads,
    fetchCommunicationThread,
    fetchCommunicationNotifications,
    fetchCommunicationPreferences,
    sendCommunicationMessage,
    updateCommunicationPreferences,
    markCommunicationNotificationRead,
  } = useCarUpApi()
  const [threads, setThreads] = useState<ConversationThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [notifications, setNotifications] = useState<NotificationSummary[]>([])
  const [preferences, setPreferences] = useState<CommunicationPreferences | null>(null)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [status, setStatus] = useState<string | null>(null)

  const unreadCount = useMemo(
    () => threads.reduce((total, thread) => total + Number(thread.unread_count || 0), 0),
    [threads],
  )

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return threads.filter((thread) => {
      if (!matchesFilter(thread, filter)) return false
      if (!query) return true
      const latest = thread.latest_message?.text || thread.latest_message_text || ''
      return [
        threadLabel(thread),
        thread.business_workflow,
        thread.conversation_type,
        thread.thread_type,
        thread.status,
        thread.primary_channel,
        thread.participant_role,
        thread.marketplace_listing_id,
        latest,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [filter, search, threads])

  const loadThreads = useCallback(async () => {
    const response = await fetchCommunicationThreads().catch(() => ({ threads: [] }))
    const next = (response.threads || []) as ConversationThread[]
    setThreads(next)
    setActiveId((current) => current || next[0]?.id || null)
    return next
  }, [fetchCommunicationThreads])

  const loadSideData = useCallback(async () => {
    const [notificationRes, prefRes] = await Promise.all([
      fetchCommunicationNotifications().catch(() => ({ notifications: [] })),
      fetchCommunicationPreferences().catch(() => ({ preferences: null })),
    ])
    setNotifications(notificationRes.notifications || [])
    setPreferences(prefRes.preferences || null)
  }, [fetchCommunicationNotifications, fetchCommunicationPreferences])

  useEffect(() => {
    void loadThreads()
    void loadSideData()
  }, [loadSideData, loadThreads])

  useEffect(() => {
    if (!activeId) {
      setDetail(null)
      return
    }
    let active = true
    fetchCommunicationThread(activeId)
      .then((result) => { if (active) setDetail(result as ConversationDetail) })
      .catch(() => { if (active) setDetail(null) })
    return () => { active = false }
  }, [activeId, fetchCommunicationThread])

  async function submitReply() {
    if (!activeId || !message.trim()) return
    setStatus('Sending…')
    try {
      await sendCommunicationMessage(activeId, { channel: 'in_app', message: message.trim() })
      const refreshed = await fetchCommunicationThread(activeId)
      setDetail(refreshed as ConversationDetail)
      await loadThreads()
      setMessage('')
      setStatus('Sent through CarUp')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send message')
    }
  }

  async function savePreferences() {
    const saved = await updateCommunicationPreferences(preferences || {})
    setPreferences(saved.preferences)
    setStatus('Preferences saved')
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Communications</h1>
          <p className="text-gray-500">Your CarUp conversations across Marketplace and connected services</p>
        </div>
        <Badge className="bg-orange-100 text-orange-700">{unreadCount} unread</Badge>
      </div>

      <div className="grid min-h-[620px] gap-5 lg:grid-cols-[320px_minmax(0,1fr)_290px]">
        <Card className="border-0 card-shadow">
          <CardHeader className="space-y-3 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-5 w-5 text-orange-500" /> Conversations</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations"
                className="pl-9"
                data-testid="communication-search"
              />
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as ConversationFilter)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter conversations"
              data-testid="communication-filter"
            >
              <option value="all">All conversations</option>
              <option value="unread">Unread</option>
              <option value="marketplace">Marketplace</option>
              <option value="support">Support</option>
              <option value="other">Other workflows</option>
            </select>
          </CardHeader>
          <CardContent className="space-y-2 px-3">
            {threads.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-gray-500">
                No conversations yet. Marketplace inquiries and other CarUp workflows will appear here.
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-gray-500">
                No conversations match this search or filter.
              </div>
            ) : filteredThreads.map((thread) => {
              const latest = thread.latest_message?.text || thread.latest_message_text || 'No messages yet'
              const selected = thread.id === activeId
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setActiveId(thread.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-orange-300 bg-orange-50' : 'hover:bg-gray-50'}`}
                  data-testid={`communication-thread-${thread.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold capitalize">{threadLabel(thread)}</p>
                    {Number(thread.unread_count || 0) > 0 && <Badge>{thread.unread_count}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600">{latest}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{thread.participant_role || thread.status || 'participant'}</span>
                    <span>{thread.primary_channel || 'CarUp'}</span>
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base">
              {detail ? threadLabel(detail.thread as ConversationThread) : 'Select a conversation'}
            </CardTitle>
            {detail && (
              <div className="space-y-1 text-xs text-gray-500">
                {participantLabel(detail) && <p>With {participantLabel(detail)}</p>}
                {(detail.thread as ConversationThread).marketplace_listing_id && (
                  <p>Listing: {(detail.thread as ConversationThread).marketplace_listing_id}</p>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex min-h-[520px] flex-col p-0">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {!detail ? (
                <p className="text-sm text-gray-500">Choose a conversation to read and reply.</p>
              ) : detail.messages.length === 0 ? (
                <p className="text-sm text-gray-500">No messages yet.</p>
              ) : detail.messages.map((item) => {
                const self = Boolean(item.author?.is_self)
                const text = item.text ?? item.content_text ?? ''
                return (
                  <div key={item.id} className={`flex ${self ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${self ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
                      {!self && item.author && (
                        <p className="mb-1 text-[11px] font-semibold opacity-70">
                          {item.author.display_name || item.author.stakeholder_role || 'Participant'}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-sm">{text}</p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] opacity-60">
                        <span>{item.channel || 'CarUp'}</span>
                        {item.ai_generated && <span>AI-derived</span>}
                        {item.status && <span>{item.status}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {detail && (
              <div className="border-t p-4">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Reply in CarUp…"
                  rows={3}
                  data-testid="communication-reply-text"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">CarUp keeps the conversation context even when delivery continues through WhatsApp or another permitted channel.</p>
                  <Button onClick={submitReply} disabled={!message.trim()} className="shrink-0 gap-2" data-testid="communication-reply-send">
                    <Send className="h-4 w-4" /> Reply
                  </Button>
                </div>
                {status && <p className="mt-2 text-xs text-gray-500">{status}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-5">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-5 w-5 text-orange-500" /> Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {notifications.length === 0 ? <p className="text-sm text-gray-500">No notifications.</p> : notifications.slice(0, 5).map((notification) => (
                <button key={notification.id} onClick={() => markCommunicationNotificationRead(notification.id)} className="w-full rounded-lg border p-3 text-left hover:bg-gray-50">
                  <p className="text-sm font-medium">{notification.title || notification.notification_type}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{notification.message}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-5 w-5 text-orange-500" /> Channels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ['email_enabled', 'Email'],
                ['push_enabled', 'Push'],
                ['in_app_enabled', 'In-app'],
                ['whatsapp_enabled', 'WhatsApp'],
                ['sms_enabled', 'SMS'],
                ['marketing_enabled', 'Marketing'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <Label htmlFor={key}>{label}</Label>
                  <Switch id={key} checked={Boolean(preferences?.[key])} onCheckedChange={(checked) => setPreferences((prev) => ({ ...(prev || {}), [key]: checked }))} />
                </div>
              ))}
              <p className="text-[11px] text-gray-500">Transactional and marketing consent remain separate. Turning on a channel does not automatically opt you into campaigns.</p>
              <Button onClick={savePreferences} variant="secondary" className="w-full">Save preferences</Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
