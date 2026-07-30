import { createContext, useContext } from 'react'
import type { PresentedUserNotification } from '@/lib/userNotifications'

export type NotificationContextValue = {
  notifications: PresentedUserNotification[]
  unreadCount: number
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

export const EMPTY_NOTIFICATION_CONTEXT: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: '',
  refresh: async () => {},
}

export const NotificationContext = createContext<NotificationContextValue>(EMPTY_NOTIFICATION_CONTEXT)

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext)
}
