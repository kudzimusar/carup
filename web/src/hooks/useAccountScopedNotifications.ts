import { useCallback, useEffect, useRef, useState } from 'react'
import { presentUserNotifications, type PresentedUserNotification } from '@/lib/userNotifications'

type Snapshot = { userId: string; items: PresentedUserNotification[] }
type Failure = { userId: string; message: string }

export function useAccountScopedNotifications({
  userId,
  enabled,
  fetchNotifications,
}: {
  userId?: string | null
  enabled: boolean
  fetchNotifications: () => Promise<unknown>
}) {
  const generation = useRef(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return
    const requestUserId = userId
    const requestGeneration = ++generation.current
    setLoadingUserId(requestUserId)
    setFailure(null)
    try {
      const items = presentUserNotifications(await fetchNotifications())
      if (generation.current === requestGeneration) setSnapshot({ userId: requestUserId, items })
    } catch (error) {
      if (generation.current === requestGeneration) {
        setFailure({
          userId: requestUserId,
          message: error instanceof Error ? error.message : 'Unable to load notifications',
        })
      }
    } finally {
      if (generation.current === requestGeneration) setLoadingUserId(null)
    }
  }, [enabled, fetchNotifications, userId])

  useEffect(() => {
    if (!enabled || !userId) {
      generation.current += 1
      return
    }
    // The request is account-scoped and generation-guarded; stale responses cannot update a new user.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    return () => { generation.current += 1 }
  }, [enabled, refresh, userId])

  const items = snapshot && snapshot.userId === userId ? snapshot.items : []
  const error = failure && failure.userId === userId ? failure.message : ''

  return {
    items,
    loading: loadingUserId === userId,
    error,
    refresh,
  }
}
