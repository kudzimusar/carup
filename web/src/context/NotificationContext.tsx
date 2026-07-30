import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAccountScopedNotifications } from '@/hooks/useAccountScopedNotifications'
import type { PresentedUserNotification } from '@/lib/userNotifications'

type NotificationContextValue = {
  notifications: PresentedUserNotification[]
  unreadCount: number
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const EMPTY_NOTIFICATION_CONTEXT: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: '',
  refresh: async () => {},
}

const NotificationContext = createContext<NotificationContextValue>(EMPTY_NOTIFICATION_CONTEXT)

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

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext)
}
