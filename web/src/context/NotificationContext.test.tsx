import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  user: { id: 'user-shared', name: 'Shared User', role: 'owner' },
  isAuthenticated: true,
  loading: false,
}))
const fetchNotifications = vi.hoisted(() => vi.fn())

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchNotifications }),
}))

const { NotificationProvider, useNotifications } = await import('./NotificationContext')

function Probe({ id }: { id: string }) {
  const { notifications, unreadCount } = useNotifications()
  return <div data-testid={id}>{`${notifications.map(item => item.id).join(',')}:${unreadCount}`}</div>
}

describe('NotificationProvider shared account state', () => {
  it('performs one account-scoped request and gives every consumer the same snapshot', async () => {
    fetchNotifications.mockResolvedValueOnce([
      {
        id: 'notification-1',
        title: 'Import documents pending',
        message: 'Upload the required documents',
        is_read: false,
        created_at: '2026-07-30T08:00:00.000Z',
      },
    ])

    render(
      <NotificationProvider>
        <Probe id="consumer-a" />
        <Probe id="consumer-b" />
      </NotificationProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('consumer-a').textContent).toBe('notification-1:1'))
    expect(screen.getByTestId('consumer-b').textContent).toBe('notification-1:1')
    expect(fetchNotifications).toHaveBeenCalledTimes(1)
  })
})
