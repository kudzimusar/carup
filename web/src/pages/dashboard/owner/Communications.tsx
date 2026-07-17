import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, MessageSquare, Send, Share2, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type ThreadSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationThreads']>>['threads'][number]
type NotificationSummary = Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationNotifications']>>['notifications'][number]
type CommunicationPreferences = NonNullable<Awaited<ReturnType<ReturnType<typeof useCarUpApi>['fetchCommunicationPreferences']>>['preferences']>

export default function Communications() {
  const {
    fetchCommunicationThreads,
    fetchCommunicationNotifications,
    fetchCommunicationPreferences,
    createCommunicationThread,
    sendCommunicationMessage,
    updateCommunicationPreferences,
    createCommunicationShare,
    markCommunicationNotificationRead,
  } = useCarUpApi()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [notifications, setNotifications] = useState<NotificationSummary[]>([])
  const [preferences, setPreferences] = useState<CommunicationPreferences | null>(null)
  const [message, setMessage] = useState('')
  const [shareListing, setShareListing] = useState('')
  const [shareCode, setShareCode] = useState('')
  const [shareResult, setShareResult] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const latestThread = threads[0]
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  const loadCommunications = useCallback(() => {
    let mounted = true
    Promise.all([
      fetchCommunicationThreads().catch(() => ({ threads: [] })),
      fetchCommunicationNotifications().catch(() => ({ notifications: [] })),
      fetchCommunicationPreferences().catch(() => ({ preferences: null })),
    ]).then(([threadRes, notificationRes, prefRes]) => {
      if (!mounted) return
      setThreads(threadRes.threads || [])
      setNotifications(notificationRes.notifications || [])
      setPreferences(prefRes.preferences || null)
    })
    return () => { mounted = false }
  }, [fetchCommunicationNotifications, fetchCommunicationPreferences, fetchCommunicationThreads])

  useEffect(() => loadCommunications(), [loadCommunications])

  async function submitSupport() {
    if (!message.trim()) return
    setStatus('Sending')
    try {
      let thread = latestThread
      if (!thread) {
        const created = await createCommunicationThread({ thread_type: 'support', channel: 'web_chat', metadata: { source: 'web_support_entry' } })
        thread = created.thread
      }
      await sendCommunicationMessage(thread.id, { channel: 'web_chat', message })
      const refreshed = await fetchCommunicationThreads()
      setThreads(refreshed.threads || [])
      setMessage('')
      setStatus('Sent')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send message')
    }
  }

  async function savePreferences() {
    const saved = await updateCommunicationPreferences(preferences || {})
    setPreferences(saved.preferences)
    setStatus('Preferences saved')
  }

  async function createShare() {
    if (!shareListing.trim()) return
    const result = await createCommunicationShare({ channel: 'whatsapp', listing_id: shareListing.trim(), referral_code: shareCode.trim() || undefined })
    setShareResult(result.share_url || result.listing_url || null)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Communications</h1>
          <p className="text-gray-500">Notifications, support threads, sharing, and channel preferences</p>
        </div>
        <Badge className="bg-orange-100 text-orange-700">{unreadCount} unread</Badge>
      </div>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
        <section className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><MessageSquare className="w-5 h-5 text-orange-500" /> Support Chat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-gray-50 p-3 min-h-32">
                {threads.length === 0 ? (
                  <p className="text-sm text-gray-500">No communication threads yet.</p>
                ) : threads.slice(0, 4).map((thread) => (
                  <div key={thread.id} className="flex items-center justify-between border-b last:border-b-0 py-2">
                    <div>
                      <p className="font-medium text-sm">{thread.thread_type?.replaceAll('_', ' ')}</p>
                      <p className="text-xs text-gray-500">{thread.status} · {thread.primary_channel || 'in-app'}</p>
                    </div>
                    <Badge variant="secondary">{thread.priority}</Badge>
                  </div>
                ))}
              </div>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask a question or request human support" />
              <Button onClick={submitSupport} className="gap-2"><Send className="w-4 h-4" /> Send</Button>
              {status && <p className="text-sm text-gray-500">{status}</p>}
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><Share2 className="w-5 h-5 text-orange-500" /> Marketplace Share</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
              <Input value={shareListing} onChange={(e) => setShareListing(e.target.value)} placeholder="Listing ID or VIN" />
              <Input value={shareCode} onChange={(e) => setShareCode(e.target.value)} placeholder="Referral code" />
              <Button onClick={createShare}>Create</Button>
              {shareResult && <p className="sm:col-span-3 text-sm break-all text-gray-600">{shareResult}</p>}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><Bell className="w-5 h-5 text-orange-500" /> Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? <p className="text-sm text-gray-500">No notifications yet.</p> : notifications.slice(0, 6).map((notification) => (
                <button key={notification.id} onClick={() => markCommunicationNotificationRead(notification.id)} className="w-full text-left rounded-lg border p-3 hover:bg-gray-50">
                  <p className="font-medium text-sm">{notification.title || notification.notification_type}</p>
                  <p className="text-xs text-gray-500 mt-1">{notification.message}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="w-5 h-5 text-orange-500" /> Preferences</CardTitle>
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
              <Button onClick={savePreferences} variant="secondary" className="w-full">Save preferences</Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
