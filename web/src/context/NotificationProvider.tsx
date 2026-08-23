import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAccountScopedNotifications } from '@/hooks/useAccountScopedNotifications'
import { NotificationContext } from '@/context/notificationState'

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const { fetchNotifications } = useCarUpApi()
  const state = useAccountScopedNotifications({
    userId: user?.id,
    enabled: !authLoading && isAuthenticated && Boolean(user),
    fetchNotifications,
  })

  return (
    <NotificationContext.Provider value={{
      notifications: state.items,
      unreadCount: state.items.filter(notification => !notification.read).length,
      loading: state.loading,
      error: state.error,
      refresh: state.refresh,
    }}>
      {children}
    </NotificationContext.Provider>
  )
}
