import { describe, expect, it } from 'vitest'
import { presentUserNotification, presentUserNotifications } from './userNotifications'

describe('user notification presentation', () => {
  it('uses live row content, timestamp, reference, and a safe action route', () => {
    const notification = presentUserNotification({
      id: 'notification-1',
      title: 'Document reviewed',
      message: 'Commercial invoice verified.',
      read: false,
      created_at: '2026-07-30T06:00:00.000Z',
      payload: {
        order_reference: 'IMP-2026-0042',
        action_url: '/diaspora/imports/order-42/documents',
      },
    })

    expect(notification.displayTitle).toBe('Document reviewed')
    expect(notification.displayMessage).toBe('Commercial invoice verified.')
    expect(notification.displayTimestamp).not.toBe('Time not recorded')
    expect(notification.reference).toBe('IMP-2026-0042')
    expect(notification.href).toBe('/diaspora/imports/order-42/documents')
  })

  it('rejects non-internal action routes and derives a scoped import-order route', () => {
    const notification = presentUserNotification({
      id: 'notification-2',
      notification_type: 'import_update',
      message_content: 'Order updated.',
      payload: {
        action_url: 'external-order-page',
        import_order_id: 'order 7',
      },
    })

    expect(notification.displayTitle).toBe('Import Update')
    expect(notification.href).toBe('/diaspora/imports/order%207')
  })

  it('drops malformed rows instead of fabricating notification entries', () => {
    expect(presentUserNotifications([null, {}, { id: '' }, { id: 'valid', message: 'Hello' }]))
      .toHaveLength(1)
  })
})
