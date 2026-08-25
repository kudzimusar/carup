import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCarUpApi } from '@/hooks/useCarUpApi'

type OwnerNotification = {
  id: string
  read?: boolean
  title?: string
  message?: string
  created_at?: string
}

/**
 * Owner notification bell — reads the canonical `/notifications/me` contract.
 *
 * Three truthfulness rules, ported from the Owner-experience work and re-pointed onto the canonical
 * notification contract:
 *
 *  1. **A failed read is not "zero".** If the fetch fails, the bell shows an explicit unavailable
 *     state rather than a confident empty inbox — "we could not load your notifications" and "you have
 *     none" are different facts, and only one of them is known.
 *  2. **No local read-state fabrication.** `/notifications/me` is read-only today: there is no
 *     server-side mark-as-read endpoint for it (only the separate Communications contract has one).
 *     So this bell does not offer a mark-read control and never flips `read` in the browser — clearing
 *     an unread badge with no server acknowledgement would be the browser asserting a fact it cannot
 *     know. The unread count is exactly what the server last reported.
 *  3. **Unauthenticated means none.** Notifications are per-user; with no session there is nothing to
 *     show, and nothing is invented.
 */
export function OwnerNotificationBell() {
  const { fetchNotifications } = useCarUpApi()
  const [notifications, setNotifications] = useState<OwnerNotification[]>([])
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchNotifications()
      .then((rows) => {
        if (cancelled) return
        setNotifications(Array.isArray(rows) ? (rows as OwnerNotification[]) : [])
        setLoadError(false)
      })
      .catch(() => {
        if (cancelled) return
        // Unknown, not zero.
        setNotifications([])
        setLoadError(true)
      })
    return () => { cancelled = true }
  }, [fetchNotifications])

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            loadError
              ? 'Notifications, count unavailable'
              : unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : 'Notifications'
          }
          data-testid="owner-notification-bell"
        >
          <Bell className="w-5 h-5" />
          {/* An amber dot marks "unavailable" — never a fabricated 0 badge. */}
          {loadError && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500"
              data-testid="owner-notification-unavailable-dot"
            />
          )}
          {!loadError && unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-semibold flex items-center justify-center"
              data-testid="owner-notification-count"
            >
              {unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <div className="px-3 py-2 font-semibold text-sm border-b">Notifications</div>

        {loadError && (
          <div className="px-3 py-4 text-xs text-amber-700" data-testid="owner-notification-unavailable">
            Notifications are unavailable right now. This is a loading failure, not an empty inbox.
          </div>
        )}

        {!loadError && notifications.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-500" data-testid="owner-notification-empty">
            No notifications yet.
          </div>
        )}

        {!loadError && notifications.slice(0, 6).map((n) => (
          <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1 p-3">
            <div className="flex items-center gap-2 w-full">
              <span className={`w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-gray-300' : 'bg-orange-500'}`} />
              <span className="font-medium text-sm flex-1">{n.title || 'Notification'}</span>
            </div>
            {n.message && <p className="text-xs text-gray-500 ml-4 line-clamp-2">{n.message}</p>}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/communications" className="text-center text-orange-600 text-sm cursor-pointer">
            Open Communications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default OwnerNotificationBell
