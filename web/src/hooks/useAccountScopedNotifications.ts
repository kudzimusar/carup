import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { presentUserNotifications, type PresentedUserNotification } from '@/lib/userNotifications'

type StoreState = {
  userId: string | null
  items: PresentedUserNotification[]
  loading: boolean
  error: string
  generation: number
  inFlight: Promise<void> | null
}

let store: StoreState = {
  userId: null,
  items: [],
  loading: false,
  error: '',
  generation: 0,
  inFlight: null,
}

const listeners = new Set<() => void>()

function publish(next: StoreState) {
  store = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return store
}

function clearAccount() {
  publish({
    userId: null,
    items: [],
    loading: false,
    error: '',
    generation: store.generation + 1,
    inFlight: null,
  })
}

async function loadAccount(userId: string, fetchNotifications: () => Promise<unknown>) {
  if (store.userId !== userId) {
    publish({
      userId,
      items: [],
      loading: false,
      error: '',
      generation: store.generation + 1,
      inFlight: null,
    })
  }
  if (store.userId === userId && store.inFlight) return store.inFlight

  const generation = store.generation + 1
  const request = Promise.resolve().then(async () => {
    try {
      const items = presentUserNotifications(await fetchNotifications())
      if (store.userId === userId && store.generation === generation) {
        publish({ ...store, items, loading: false, error: '', inFlight: null })
      }
    } catch (error) {
      if (store.userId === userId && store.generation === generation) {
        publish({
          ...store,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load notifications',
          inFlight: null,
        })
      }
    }
  })

  publish({
    ...store,
    userId,
    loading: true,
    error: '',
    generation,
    inFlight: request,
  })
  return request
}

export function useAccountScopedNotifications({
  userId,
  enabled,
  fetchNotifications,
}: {
  userId?: string | null
  enabled: boolean
  fetchNotifications: () => Promise<unknown>
}) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return
    await loadAccount(userId, fetchNotifications)
  }, [enabled, fetchNotifications, userId])

  useEffect(() => {
    if (!enabled || !userId) {
      if (store.userId !== null) clearAccount()
      return
    }
    void refresh()
  }, [enabled, refresh, userId])

  return {
    items: snapshot.userId === userId ? snapshot.items : [],
    loading: snapshot.userId === userId && snapshot.loading,
    error: snapshot.userId === userId ? snapshot.error : '',
    refresh,
  }
}
