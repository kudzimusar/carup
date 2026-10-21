import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Bell, ChevronLeft, Languages, MessageSquare, Search, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { threadLabel } from './threadLabel'
import {
  useCommunicationProductApi,
  type CommunicationAiDerivation,
  type CommunicationMessagePart,
  type CommunicationProductAnalytics,
} from '@/hooks/useCommunicationProductApi'
import { CommunicationMessagePartView } from '@/components/communications/CommunicationMessagePartView'
import { CommunicationMultimodalComposer } from '@/components/communications/CommunicationMultimodalComposer'
import { ConversationPerformance, type AnalyticsReadState } from '@/features/communications/ConversationPerformance'
import { DeliveryPreferencesCard } from '@/features/communications/DeliveryPreferencesCard'
import {
  INBOX_TWO_PANE_QUERY,
  resolveInboxSelection,
  unreadConversationCount,
  unreadConversationsLabel,
  type ThreadsReadState,
} from '@/features/communications/inboxSelection'
import { useMediaQuery } from '@/lib/useMediaQuery'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationThreads']>>['threads'][number]
type ThreadDetail = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationThread']>>
type NotificationSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationNotifications']>>['notifications'][number]
type AccountActivitySummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationAccountActivity']>>['activity'][number]

type ConversationThread = ThreadSummary & {
  subject_type?: string
  subject_id?: string
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

/** A conversation read, keyed by the thread it was read for — so one thread's messages can never sit under another's selection. */
type DetailRead =
  | { threadId: string; state: 'ready'; detail: ConversationDetail }
  | { threadId: string; state: 'failed' }

/**
 * CARUP-MVP-STAB-01 F-017 — from md the list and the conversation are bounded panes of one height:
 * the viewport less the shell above the grid, never shorter than a usable conversation. lg loses the
 * compact bottom bar, so less is subtracted there.
 */
const PANE_HEIGHT = 'md:h-[calc(100dvh-15rem)] md:min-h-[560px] lg:h-[calc(100dvh-13rem)]'

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
    markCommunicationThreadRead,
    fetchCommunicationNotifications,
    fetchCommunicationAccountActivity,
    resendVerificationEmail,
    fetchCommunicationPreferences,
    sendCommunicationMessage,
    updateCommunicationPreferences,
    markCommunicationNotificationRead,
    user,
  } = useCarUpApi()
  const {
    fetchAnalytics,
    fetchAiHealth,
    suggestReply,
    summarize,
    translate,
    nextBestAction,
  } = useCommunicationProductApi()

  // F-017: the open conversation lives in the URL (?thread=<id>) — linkable, survives a reload, and
  // Back clears it. The inbox opens one by itself only while two panes are visible (from md).
  const [searchParams, setSearchParams] = useSearchParams()
  const twoPane = useMediaQuery(INBOX_TWO_PANE_QUERY)
  const [threads, setThreads] = useState<ConversationThread[]>([])
  const [threadsState, setThreadsState] = useState<ThreadsReadState>('loading')
  const [detailRead, setDetailRead] = useState<DetailRead | null>(null)
  const [notifications, setNotifications] = useState<NotificationSummary[]>([])
  const [accountActivity, setAccountActivity] = useState<AccountActivitySummary[]>([])
  const [analytics, setAnalytics] = useState<CommunicationProductAnalytics | null>(null)
  // OC-NATIVE-FINAL-02-R1 D4: a failed analytics read is a failure, not "nothing has accumulated yet".
  const [analyticsState, setAnalyticsState] = useState<AnalyticsReadState>('loading')
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiResult, setAiResult] = useState<CommunicationAiDerivation | null>(null)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('Japanese')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [status, setStatus] = useState<string | null>(null)

  const requestedId = searchParams.get('thread')
  const threadIds = useMemo(() => threads.map((thread) => thread.id), [threads])
  const { activeId, autoSelectId, unresolved } = resolveInboxSelection({ requestedId, threadIds, threadsState, twoPane })
  // A deep link is honoured while the list is still being read, so a phone shows that conversation
  // loading rather than flashing the list first.
  const conversationOpen = Boolean(activeId) || (Boolean(requestedId) && threadsState === 'loading')
  const currentRead = detailRead && detailRead.threadId === activeId ? detailRead : null
  const detail = currentRead?.state === 'ready' ? currentRead.detail : null

  // The badge counts conversations with something unread — not the sum of unread messages.
  const unreadConversations = useMemo(() => unreadConversationCount(threads), [threads])
  const messagesRef = useRef<HTMLDivElement | null>(null)

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

  const latestMessage = useMemo(() => {
    if (!detail?.messages?.length) return null
    return [...detail.messages].reverse().find((item) => String(item.text ?? item.content_text ?? '').trim()) || null
  }, [detail])

  const loadThreads = useCallback(async () => {
    try {
      const response = await fetchCommunicationThreads()
      setThreads((response.threads || []) as ConversationThread[])
      setThreadsState('ready')
    } catch {
      // A failed refresh keeps the list already on screen; a failed FIRST read is not an empty inbox.
      setThreadsState((current) => (current === 'ready' ? current : 'failed'))
    }
  }, [fetchCommunicationThreads])

  // Delivery preferences are not side data: DeliveryPreferencesCard reads them itself, so a failed
  // read is its own state rather than an empty object turned into editable all-off switches (F-018).
  const loadSideData = useCallback(async () => {
    const [notificationRes, accountActivityRes, analyticsRes] = await Promise.all([
      fetchCommunicationNotifications().catch(() => ({ notifications: [] })),
      fetchCommunicationAccountActivity().catch(() => ({ activity: [] })),
      fetchAnalytics().catch(() => ({ analytics: null })),
    ])
    setNotifications(notificationRes.notifications || [])
    setAccountActivity(accountActivityRes.activity || [])
    setAnalytics(analyticsRes.analytics)
    setAnalyticsState(analyticsRes.analytics ? 'ready' : 'unavailable')
    const health = await fetchAiHealth().catch(() => ({ ai: { available: false } }))
    setAiAvailable(Boolean(health.ai?.available))
  }, [fetchAnalytics, fetchAiHealth, fetchCommunicationAccountActivity, fetchCommunicationNotifications])

  const refreshActiveConversation = useCallback(async () => {
    if (!activeId) return
    const refreshed = await fetchCommunicationThread(activeId)
    setDetailRead({ threadId: activeId, state: 'ready', detail: refreshed as ConversationDetail })
    await Promise.all([loadThreads(), loadSideData()])
  }, [activeId, fetchCommunicationThread, loadSideData, loadThreads])

  useEffect(() => {
    let active = true
    fetchCommunicationThreads()
      .then((response) => {
        if (!active) return
        setThreads((response.threads || []) as ConversationThread[])
        setThreadsState('ready')
      })
      .catch(() => { if (active) setThreadsState('failed') })
    Promise.all([
      fetchCommunicationNotifications().catch(() => ({ notifications: [] })),
      fetchCommunicationAccountActivity().catch(() => ({ activity: [] })),
      fetchAnalytics().catch(() => ({ analytics: null })),
      fetchAiHealth().catch(() => ({ ai: { available: false } })),
    ]).then(([notificationRes, accountActivityRes, analyticsRes, health]) => {
      if (!active) return
      setNotifications(notificationRes.notifications || [])
      setAccountActivity(accountActivityRes.activity || [])
      setAnalytics(analyticsRes.analytics)
      setAnalyticsState(analyticsRes.analytics ? 'ready' : 'unavailable')
      setAiAvailable(Boolean(health.ai?.available))
    })
    return () => { active = false }
  }, [fetchAiHealth, fetchAnalytics, fetchCommunicationAccountActivity, fetchCommunicationNotifications, fetchCommunicationThreads])

  // Two panes visible and no ?thread=: open the most recent conversation AND pin it into the URL
  // (replace, not push), so a later reload of the list cannot silently switch to — and mark read —
  // a different thread. Never on a phone: there the list is the screen until the person chooses.
  useEffect(() => {
    if (!autoSelectId) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('thread', autoSelectId)
      return next
    }, { replace: true })
  }, [autoSelectId, setSearchParams])

  // Keep the newest message in view when a conversation opens or a reply lands.
  useEffect(() => {
    const list = messagesRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [detail])

  useEffect(() => {
    if (!activeId) return
    let active = true
    fetchCommunicationThread(activeId)
      .then(async (result) => {
        if (!active) return
        setDetailRead({ threadId: activeId, state: 'ready', detail: result as ConversationDetail })
        setAiResult(null)
        // Persist the read receipt before clearing the badge. Zeroing unread_count locally made the
        // conversation look read while last_read_at never moved, so the count came straight back on
        // the next load — and a failed mutation would have claimed a read state the server never had.
        try {
          await markCommunicationThreadRead(activeId)
          if (!active) return
          setThreads((current) => current.map((thread) => (
            thread.id === activeId ? { ...thread, unread_count: 0 } : thread
          )))
        } catch {
          // Leave the unread badge alone: it is the honest state until the server agrees.
        }
      })
      .catch(() => { if (active) setDetailRead({ threadId: activeId, state: 'failed' }) })
    return () => { active = false }
  }, [activeId, fetchCommunicationThread, markCommunicationThreadRead])

  // Choosing a conversation is navigation (push), so the browser's Back retraces it.
  function selectThread(threadId: string) {
    setAiResult(null)
    if (threadId === requestedId) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('thread', threadId)
      return next
    })
  }

  // Phones: "Back to conversations" clears ?thread= and shows the list again.
  function showConversationList() {
    setAiResult(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('thread')
      return next
    })
  }

  function retryThreads() {
    setThreadsState('loading')
    void loadThreads()
  }

  async function submitReply() {
    if (!activeId || !message.trim()) return
    setStatus('Sending…')
    try {
      await sendCommunicationMessage(activeId, { channel: 'in_app', message: message.trim() })
      await refreshActiveConversation()
      setMessage('')
      setAiResult(null)
      setStatus('Sent through CarUp')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send message')
    }
  }

  async function runAi(kind: AiAction) {
    if (!activeId || !aiAvailable) return
    if (kind === 'translate' && (!latestMessage?.id || !targetLanguage.trim())) return
    setAiBusy(kind)
    setStatus(null)
    try {
      const response = kind === 'suggest'
        ? await suggestReply(activeId, latestMessage?.id || null)
        : kind === 'summary'
          ? await summarize(activeId)
          : kind === 'translate'
            ? await translate(activeId, String(latestMessage?.id), targetLanguage.trim())
            : await nextBestAction(activeId)
      setAiResult(response.derivation)
      if (kind === 'suggest' && response.derivation.output_text) {
        setMessage(response.derivation.output_text)
        setStatus('AI suggestion loaded — review it before sending.')
      } else if (kind === 'next') {
        setStatus('Next action is advisory only — no action was executed.')
      }
      const analyticsRes = await fetchAnalytics().catch(() => null)
      if (analyticsRes?.analytics) {
        setAnalytics(analyticsRes.analytics)
        setAnalyticsState('ready')
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'AI assist could not complete')
    } finally {
      setAiBusy(null)
    }
  }

  async function requestAnotherVerificationEmail() {
    const email = String(user?.email || '').trim()
    if (!email) {
      setStatus('Your signed-in account does not expose an Email address.')
      return
    }
    setStatus('Requesting another verification Email…')
    try {
      await resendVerificationEmail(email)
      setStatus('Verification Email requested. Check Inbox and Spam/Junk; the Account & security card will show delivery status.')
      const refreshed = await fetchCommunicationAccountActivity().catch(() => ({ activity: [] }))
      setAccountActivity(refreshed.activity || [])
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not request another verification Email')
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Communications</h1>
          <p className="text-gray-500">Your CarUp conversations across Marketplace and connected services</p>
        </div>
        {/* A count only once the list has been read: a pending or failed read is not "0 unread". */}
        {threadsState === 'ready' && (
          <Badge className="bg-orange-100 text-orange-700" data-testid="communication-unread-conversations">
            {unreadConversationsLabel(unreadConversations)}
          </Badge>
        )}
      </div>

      {unresolved && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="communication-thread-not-found">
          That conversation isn&apos;t in your inbox. Choose one from your conversations.
        </p>
      )}

      {/* CARUP-MVP-STAB-01 F-017 — phones (< md): the list OR the conversation, with Back.
          Tablets (md–xl, incl. 900×800 and 1024 beside the sidebar): a bounded, independently
          scrolling 300px list beside the conversation; the details move below both.
          Desktop (≥ xl): three columns. One DOM instance of each pane, toggled by class only. */}
      <div
        className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)] md:items-start xl:grid-cols-[320px_minmax(0,1fr)_290px]"
        data-testid="communication-layout"
        data-view={conversationOpen ? 'conversation' : 'list'}
      >
        <Card
          className={`${conversationOpen ? 'hidden md:flex' : 'flex'} min-w-0 gap-0 border-0 py-0 card-shadow ${PANE_HEIGHT}`}
          data-testid="communication-list-pane"
        >
          <CardHeader className="shrink-0 space-y-3 pb-3 pt-6">
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-5 w-5 text-orange-500" /> Conversations</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="pl-9" data-testid="communication-search" />
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
          <CardContent className="space-y-2 px-3 pb-4 md:min-h-0 md:flex-1 md:overflow-y-auto" data-testid="communication-thread-list">
            {threadsState === 'loading' ? (
              <p className="p-2 text-sm text-gray-500" data-testid="communication-threads-loading">Loading conversations…</p>
            ) : threadsState === 'failed' ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-gray-600" data-testid="communication-threads-failed">
                <p>Your conversations could not be loaded. This is not an empty inbox.</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={retryThreads}>Try again</Button>
              </div>
            ) : threads.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-gray-500">No conversations yet. Marketplace inquiries and other CarUp workflows will appear here.</div>
            ) : filteredThreads.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-gray-500">No conversations match this search or filter.</div>
            ) : filteredThreads.map((thread) => {
              const latest = thread.latest_message?.text || thread.latest_message_text || 'No messages yet'
              const selected = thread.id === activeId
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => selectThread(thread.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-orange-300 bg-orange-50' : 'hover:bg-gray-50'}`}
                  data-testid={`communication-thread-${thread.id}`}
                  data-marketplace-listing-id={thread.marketplace_listing_id || undefined}
                >
                  {/* Identity wraps or clamps to two lines — never a one-line truncation. */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 line-clamp-2 break-words text-sm font-semibold capitalize" data-testid={`communication-thread-title-${thread.id}`}>{threadLabel(thread)}</p>
                    {Number(thread.unread_count || 0) > 0 && <Badge className="shrink-0">{thread.unread_count}</Badge>}
                  </div>
                  {thread.marketplace_listing_id && (
                    <p className="mt-0.5 break-all text-[11px] text-gray-500" data-testid={`communication-thread-listing-${thread.id}`}>Listing {thread.marketplace_listing_id}</p>
                  )}
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

        <Card
          className={`${conversationOpen ? 'flex' : 'hidden md:flex'} min-w-0 gap-0 border-0 py-0 card-shadow ${PANE_HEIGHT}`}
          data-testid="communication-conversation-pane"
        >
          <CardHeader className="shrink-0 border-b pb-3 pt-4">
            <div className="md:hidden">
              <Button type="button" variant="ghost" size="sm" className="-ml-2 h-10 gap-1 px-2" onClick={showConversationList} data-testid="communication-back">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back to conversations
              </Button>
            </div>
            <CardTitle className="break-words text-base leading-snug" data-testid="communication-conversation-title">
              {detail
                ? threadLabel(detail.thread as ConversationThread)
                : currentRead?.state === 'failed'
                  ? 'Conversation unavailable'
                  : conversationOpen ? 'Loading conversation…' : 'Select a conversation'}
            </CardTitle>
            {detail && (
              <div className="space-y-1 text-xs text-gray-500">
                {participantLabel(detail) && <p className="break-words">With {participantLabel(detail)}</p>}
                {(detail.thread as ConversationThread).marketplace_listing_id && (
                  <p className="break-all" data-testid="communication-active-listing">Listing: {(detail.thread as ConversationThread).marketplace_listing_id}</p>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {/* Phones: the page scrolls and this region is capped. From md the pane is bounded, so
                this region takes the remaining height and scrolls on its own; the composer stays put. */}
            <div ref={messagesRef} className="max-h-[60vh] min-h-[200px] space-y-3 overflow-y-auto p-4 md:max-h-none md:min-h-0 md:flex-1" data-testid="communication-messages">
              {!activeId && !conversationOpen ? (
                <p className="text-sm text-gray-500">Choose a conversation to read and reply.</p>
              ) : currentRead?.state === 'failed' ? (
                <p className="text-sm text-gray-500" data-testid="communication-conversation-failed">This conversation could not be loaded right now.</p>
              ) : !detail ? (
                <p className="text-sm text-gray-500">Loading conversation…</p>
              ) : detail.messages.length === 0 ? (
                <p className="text-sm text-gray-500">No messages yet.</p>
              ) : detail.messages.map((item) => {
                const self = Boolean(item.author?.is_self)
                const text = item.text ?? item.content_text ?? ''
                return (
                  <div key={item.id} className={`flex ${self ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${self ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
                      {!self && item.author && (
                        <p className="mb-1 text-[11px] font-semibold opacity-70">{item.author.display_name || item.author.stakeholder_role || 'Participant'}</p>
                      )}
                      {text && <p className="whitespace-pre-wrap text-sm" data-testid="communication-message-text">{text}</p>}
                      {(item.parts || []).map((part) => (
                        <CommunicationMessagePartView key={part.id} threadId={String(activeId)} part={part} onDerived={setAiResult} />
                      ))}
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

            {aiResult?.output_text && (
              <div className="mx-4 mb-3 max-h-40 shrink-0 overflow-y-auto rounded-xl border border-dashed bg-gray-50 p-3" data-testid="communication-ai-derived">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="h-4 w-4 text-orange-500" /> AI-derived {aiResult.derivation_type.replaceAll('_', ' ')}
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{aiResult.output_text}</p>
                <p className="mt-2 text-[11px] text-gray-500">Derived assistance only. The original conversation or artifact remains unchanged.</p>
              </div>
            )}

            {detail && activeId && (
              <div className="shrink-0 border-t p-4" data-testid="communication-composer">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={!aiAvailable || Boolean(aiBusy)} onClick={() => void runAi('suggest')}>
                    <Sparkles className="mr-1 h-4 w-4" /> {aiBusy === 'suggest' ? 'Drafting…' : 'Suggest reply'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!aiAvailable || Boolean(aiBusy)} onClick={() => void runAi('summary')}>
                    {aiBusy === 'summary' ? 'Summarizing…' : 'Summarize'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!aiAvailable || Boolean(aiBusy)} onClick={() => void runAi('next')}>
                    {aiBusy === 'next' ? 'Thinking…' : 'Next action'}
                  </Button>
                  <div className="flex min-w-[210px] flex-1 items-center gap-2">
                    <Input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} placeholder="Translation language" className="h-9" />
                    <Button type="button" size="sm" variant="outline" disabled={!aiAvailable || Boolean(aiBusy) || !latestMessage?.id || !targetLanguage.trim()} onClick={() => void runAi('translate')}>
                      <Languages className="mr-1 h-4 w-4" /> {aiBusy === 'translate' ? 'Translating…' : 'Translate latest'}
                    </Button>
                  </div>
                  {!aiAvailable && <span className="text-[11px] text-gray-500">AI assist activates when the configured provider is available.</span>}
                </div>

                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Reply in CarUp…" rows={3} data-testid="communication-reply-text" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <CommunicationMultimodalComposer
                    threadId={activeId}
                    caption={message}
                    onStatus={setStatus}
                    onSent={async () => {
                      await refreshActiveConversation()
                      setMessage('')
                      setAiResult(null)
                    }}
                  />
                  <Button onClick={submitReply} disabled={!message.trim()} className="shrink-0 gap-2" data-testid="communication-reply-send">
                    <Send className="h-4 w-4" /> Reply
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500">Attach images, documents, audio/video, a voice note or location without leaving the canonical CarUp conversation. AI suggestions and media interpretations never send or execute automatically.</p>
                {status && <p data-testid="communication-status" className="mt-2 text-xs text-gray-500">{status}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account-level details. Phones: under the list, hidden while a conversation is open.
            Tablets: a two-column band below both panes, so the conversation keeps its width.
            Desktop: the third column. */}
        <aside
          className={`${conversationOpen ? 'hidden md:grid' : 'grid'} min-w-0 content-start gap-5 md:col-span-2 md:grid-cols-2 xl:col-span-1 xl:grid-cols-1`}
          data-testid="communication-details"
          aria-label="Communication details"
        >
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-5 w-5 text-orange-500" /> Conversation performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ConversationPerformance state={analyticsState} analytics={analytics} />
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow" data-testid="account-security-activity">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-5 w-5 text-orange-500" /> Account & security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {accountActivity.length === 0 ? (
                <p className="text-sm text-gray-500">No account Email activity recorded yet.</p>
              ) : accountActivity.slice(0, 5).map((activity) => (
                <div key={activity.id} className="rounded-lg border p-3" data-testid={`account-activity-${activity.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{activity.title}</p>
                    <Badge variant="outline" className="capitalize">{activity.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{activity.summary}</p>
                  <p className="mt-2 text-[11px] text-gray-400">
                    Email · {activity.delivered_at || activity.sent_at || activity.created_at || 'time unavailable'}
                  </p>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void requestAnotherVerificationEmail()}
                data-testid="resend-verification-email"
              >
                Send another verification Email
              </Button>
              <p className="text-[11px] text-gray-500">
                Security Emails are visible here as delivery activity only. Verification/reset links and tokens never appear in reply-capable conversations.
              </p>
            </CardContent>
          </Card>

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

          {/* F-018: read, never assumed; one preference per save; a channel looks operational only
              while the runtime can deliver on it. */}
          <DeliveryPreferencesCard read={fetchCommunicationPreferences} save={updateCommunicationPreferences} />
        </aside>
      </div>
    </div>
  )
}
