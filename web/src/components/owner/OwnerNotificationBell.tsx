import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type OwnerNotification = {
  id: string
  read?: boolean
  title?: string
  message?: string
  notification_type?: string
  created_at?: string | null
}

function formatWhen(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Canonical owner notification center trigger.
 *
 * Reads and mutations both use Communications 2.0 so the badge, panel and persisted read state
 * share one backend contract. Failed reads are rendered as unavailable (never a fake zero), and a
 * failed read mutation never clears the local unread indicator.
 */
export default function OwnerNotificationBell() {
  const { fetchCommunicationNotifications, markCommunicationNotificationRead } = useCarUpApi()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<OwnerNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetchCommunicationNotifications()
      setNotifications((response?.notifications || []) as OwnerNotification[])
      setLoadError(false)
    } catch {
      // Preserve truthfulness: an unread count is unknown on transport/backend failure, not zero.
      setNotifications([])
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [fetchCommunicationNotifications])

  useEffect(() => {
    // Initial loading state is already true. Do not synchronously write state from the effect;
    // all loader mutations occur after the awaited Communications read settles.
    void load()
  }, [load, location.pathname])

  const unread = useMemo(() => notifications.filter((notification) => !notification.read), [notifications])

  async function markRead(id: string) {
    try {
      await markCommunicationNotificationRead(id)
      setNotifications((current) => current.map((notification) => (
        notification.id === id ? { ...notification, read: true } : notification
      )))
    } catch {
      toast.error('Could not mark this notification as read. Its unread state was kept.')
    }
  }

  async function markAllRead() {
    if (!unread.length || markingAll) return
    setMarkingAll(true)
    const succeeded = new Set<string>()
    let failed = 0
    await Promise.all(unread.map(async (notification) => {
      try {
        await markCommunicationNotificationRead(notification.id)
        succeeded.add(notification.id)
      } catch {
        failed += 1
      }
    }))
    if (succeeded.size) {
      setNotifications((current) => current.map((notification) => (
        succeeded.has(notification.id) ? { ...notification, read: true } : notification
      )))
    }
    if (failed) toast.error(`${failed} notification${failed === 1 ? '' : 's'} could not be marked as read.`)
    setMarkingAll(false)
  }

  async function togglePanel() {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      await load()
    }
  }

  function retryLoad() {
    setLoading(true)
    void load()
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        type="button"
        onClick={() => { void togglePanel() }}
        aria-label={loadError ? 'Notifications unavailable' : unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-expanded={open}
        data-testid="owner-notification-bell"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {!loading && !loadError && unread.length > 0 && (
          <span
            className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-black leading-4 text-white ring-2 ring-white"
            data-testid="owner-notification-count"
          >
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
        {!loading && loadError && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" data-testid="owner-notification-error-dot" />
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-12 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          data-testid="owner-notification-center"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-black text-slate-900">Notifications</p>
              <p className="text-[11px] text-slate-500">
                {loading ? 'Loading live activity…' : loadError ? 'Live notification data unavailable' : `${unread.length} unread`}
              </p>
            </div>
            {!loadError && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={loading || unread.length === 0 || markingAll}
                onClick={() => { void markAllRead() }}
                className="gap-1.5 text-xs"
              >
                {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                Mark all read
              </Button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications
              </div>
            ) : loadError ? (
              <div className="px-4 py-8 text-center" data-testid="owner-notification-unavailable">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-500" />
                <p className="mt-2 text-sm font-semibold text-slate-700">Notifications are unavailable right now</p>
                <p className="mt-1 text-xs text-slate-500">CarUp could not confirm your live notification state. No zero count has been assumed.</p>
                <Button variant="outline" size="sm" type="button" className="mt-4 gap-1.5" onClick={retryLoad}>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">No notifications to show</p>
                <p className="mt-1 text-xs text-slate-500">New CarUp account and vehicle activity will appear here.</p>
              </div>
            ) : (
              notifications.slice(0, 8).map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => { if (!notification.read) void markRead(notification.id) }}
                  className={`w-full rounded-xl border p-3 text-left transition ${notification.read ? 'border-transparent bg-white hover:bg-slate-50' : 'border-orange-100 bg-orange-50/70 hover:bg-orange-50'}`}
                  data-testid={`owner-notification-${notification.id}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-slate-300' : 'bg-orange-500'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800">{notification.title || notification.notification_type || 'CarUp update'}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{notification.message || 'Open Communications for details.'}</p>
                      {formatWhen(notification.created_at) && <p className="mt-1.5 text-[10px] text-slate-400">{formatWhen(notification.created_at)}</p>}
                    </div>
                    {!notification.read && <Badge className="bg-orange-100 text-[9px] text-orange-700 hover:bg-orange-100">New</Badge>}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 p-2">
            <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
              <Link to="/dashboard/communications" onClick={() => setOpen(false)}>Open Communications center</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
