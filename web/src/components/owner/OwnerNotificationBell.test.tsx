import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchCommunicationNotifications = vi.fn()
const markCommunicationNotificationRead = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchCommunicationNotifications,
    markCommunicationNotificationRead,
  }),
}))

const OwnerNotificationBell = (await import('./OwnerNotificationBell')).default

function renderBell() {
  return render(<MemoryRouter><OwnerNotificationBell /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCommunicationNotifications.mockResolvedValue({
    notifications: [
      { id: 'n1', title: 'Unread update', message: 'Action needed', read: false },
      { id: 'n2', title: 'Read update', message: 'Already seen', read: true },
    ],
  })
  markCommunicationNotificationRead.mockResolvedValue({ success: true })
})

describe('OwnerNotificationBell', () => {
  it('shows the real unread count from canonical Communications notifications', async () => {
    renderBell()
    await waitFor(() => expect(fetchCommunicationNotifications).toHaveBeenCalled())
    expect(screen.getByTestId('owner-notification-count').textContent).toBe('1')
  })

  it('persists a read mutation before clearing the local unread state', async () => {
    renderBell()
    await waitFor(() => expect(screen.getByTestId('owner-notification-count')).toBeTruthy())
    fireEvent.click(screen.getByTestId('owner-notification-bell'))
    const notification = await screen.findByTestId('owner-notification-n1')
    fireEvent.click(notification)

    await waitFor(() => expect(markCommunicationNotificationRead).toHaveBeenCalledWith('n1'))
    await waitFor(() => expect(screen.queryByTestId('owner-notification-count')).toBeNull())
  })

  it('keeps the notification unread when persistence fails', async () => {
    markCommunicationNotificationRead.mockRejectedValue(new Error('write failed'))
    renderBell()
    await waitFor(() => expect(screen.getByTestId('owner-notification-count')).toBeTruthy())
    fireEvent.click(screen.getByTestId('owner-notification-bell'))
    fireEvent.click(await screen.findByTestId('owner-notification-n1'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByTestId('owner-notification-count').textContent).toBe('1')
  })

  it('marks every unread notification through the persisted endpoint', async () => {
    fetchCommunicationNotifications.mockResolvedValue({
      notifications: [
        { id: 'n1', title: 'First', read: false },
        { id: 'n2', title: 'Second', read: false },
      ],
    })
    renderBell()
    await waitFor(() => expect(screen.getByTestId('owner-notification-count').textContent).toBe('2'))
    fireEvent.click(screen.getByTestId('owner-notification-bell'))
    fireEvent.click(await screen.findByRole('button', { name: /mark all read/i }))

    await waitFor(() => expect(markCommunicationNotificationRead).toHaveBeenCalledTimes(2))
    expect(markCommunicationNotificationRead).toHaveBeenCalledWith('n1')
    expect(markCommunicationNotificationRead).toHaveBeenCalledWith('n2')
    await waitFor(() => expect(screen.queryByTestId('owner-notification-count')).toBeNull())
  })
})
