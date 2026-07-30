import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertCircle, Bell, ExternalLink, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { buildLoginRedirect } from '@/lib/returnTo'
import { presentUserNotifications, type PresentedUserNotification } from '@/lib/userNotifications'

export default function NotificationCenter() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const { fetchNotifications } = useCarUpApi()
  const [notifications, setNotifications] = useState<PresentedUserNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (!isAuthenticated || !user || inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      setNotifications(presentUserNotifications(await fetchNotifications()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notifications')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [fetchNotifications, isAuthenticated, user])

  useEffect(() => {
    // The loader immediately exposes a truthful pending state before awaiting the account-scoped request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!authLoading && isAuthenticated) void load()
  }, [authLoading, isAuthenticated, load])

  if (!authLoading && !isAuthenticated) {
    return <Navigate to={buildLoginRedirect('/notifications')} replace />
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8" data-testid="notification-center-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-6 w-6 text-orange-600" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-950">Notifications</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">Account-scoped updates for {user?.name || 'your account'}.</p>
        </div>
        <Button asChild variant="outline"><Link to="/dashboard">Return to dashboard</Link></Button>
      </div>

      {loading && (
        <div className="mt-8 flex items-center gap-2 text-sm text-orange-700" data-testid="notification-center-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading notifications…
        </div>
      )}

      {!loading && error && (
        <Alert className="mt-8 border-red-200 bg-red-50" data-testid="notification-center-error">
          <AlertCircle className="h-4 w-4 text-red-700" aria-hidden="true" />
          <AlertTitle>Unable to load notifications</AlertTitle>
          <AlertDescription>
            <span className="block">{error}</span>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && notifications.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center" data-testid="notification-center-empty">
          <Bell className="mx-auto h-7 w-7 text-gray-400" aria-hidden="true" />
          <p className="mt-3 font-medium text-gray-900">No notifications yet</p>
          <p className="mt-1 text-sm text-gray-500">New account and trade updates will appear here.</p>
        </div>
      )}

      {!loading && !error && notifications.length > 0 && (
        <div className="mt-8 space-y-3" data-testid="notification-center-list">
          {notifications.map((notification) => (
            <article
              key={notification.id}
              className={`rounded-lg border bg-white p-4 ${notification.read ? 'border-gray-200' : 'border-orange-200 shadow-sm'}`}
              data-testid="notification-center-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!notification.read && <span className="h-2 w-2 rounded-full bg-orange-500" aria-label="Unread" />}
                    <h2 className="font-semibold text-gray-950">{notification.displayTitle}</h2>
                    {notification.reference && <Badge variant="outline">{notification.reference}</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{notification.displayMessage}</p>
                  <time className="mt-2 block text-xs text-gray-500" dateTime={notification.created_at || undefined}>
                    {notification.displayTimestamp}
                  </time>
                </div>
                {notification.href && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={notification.href} data-testid="notification-center-action">
                      Open <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
