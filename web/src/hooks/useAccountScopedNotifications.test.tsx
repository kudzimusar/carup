import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAccountScopedNotifications } from './useAccountScopedNotifications'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const row = (id: string, message: string) => ({
  id,
  message,
  created_at: '2026-07-30T08:00:00.000Z',
})

describe('useAccountScopedNotifications', () => {
  it('never carries a previous account response into a new account', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const fetchNotifications = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const { result, rerender } = renderHook(
      ({ userId }) => useAccountScopedNotifications({ userId, enabled: true, fetchNotifications }),
      { initialProps: { userId: 'user-a' } },
    )
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(1))

    rerender({ userId: 'user-b' })
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2))
    expect(result.current.items).toEqual([])

    await act(async () => first.resolve([row('a-1', 'Private A')]))
    expect(result.current.items).toEqual([])

    await act(async () => second.resolve([row('b-1', 'Private B')]))
    await waitFor(() => expect(result.current.items.map(item => item.id)).toEqual(['b-1']))
  })

  it('invalidates an in-flight response after logout', async () => {
    const pending = deferred<unknown>()
    const fetchNotifications = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(
      ({ enabled }) => useAccountScopedNotifications({
        userId: enabled ? 'user-a' : null,
        enabled,
        fetchNotifications,
      }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(1))
    rerender({ enabled: false })
    await act(async () => pending.resolve([row('a-1', 'Private A')]))
    expect(result.current.items).toEqual([])
  })
})
