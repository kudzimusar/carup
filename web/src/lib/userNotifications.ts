export interface UserNotificationRecord {
  id: string
  title?: string | null
  message?: string | null
  message_content?: string | null
  read?: boolean | null
  created_at?: string | null
  notification_type?: string | null
  type?: string | null
  thread_id?: string | null
  payload?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export interface PresentedUserNotification extends UserNotificationRecord {
  displayTitle: string
  displayMessage: string
  displayTimestamp: string
  reference: string | null
  href: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return null
}

function labelize(value?: string | null): string {
  if (!value) return 'Notification'
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function safeInternalHref(value: unknown): string | null {
  const href = text(value)
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null
  return href
}

function recordValue(record: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

export function presentUserNotification(record: UserNotificationRecord): PresentedUserNotification {
  const payload = record.payload || null
  const metadata = record.metadata || null
  const reference = firstText(
    recordValue(payload, 'order_reference', 'orderReference', 'order_ref', 'reference'),
    recordValue(metadata, 'order_reference', 'orderReference', 'order_ref', 'reference'),
  )

  const explicitHref = safeInternalHref(
    recordValue(payload, 'action_url', 'actionUrl', 'href', 'route')
      ?? recordValue(metadata, 'action_url', 'actionUrl', 'href', 'route'),
  )
  const importOrderId = firstText(
    recordValue(payload, 'import_order_id', 'importOrderId', 'order_id', 'orderId'),
    recordValue(metadata, 'import_order_id', 'importOrderId', 'order_id', 'orderId'),
  )
  const stockItemId = firstText(
    recordValue(payload, 'stock_item_id', 'stockItemId'),
    recordValue(metadata, 'stock_item_id', 'stockItemId'),
  )
  const href = explicitHref
    ?? (importOrderId ? `/diaspora/imports/${encodeURIComponent(importOrderId)}` : null)
    ?? (stockItemId ? `/diaspora/stock/${encodeURIComponent(stockItemId)}/passport` : null)
    ?? (record.thread_id ? '/dashboard/communications' : null)

  const createdAt = record.created_at ? new Date(record.created_at) : null
  const displayTimestamp = createdAt && !Number.isNaN(createdAt.getTime())
    ? createdAt.toLocaleString()
    : 'Time not recorded'

  return {
    ...record,
    displayTitle: firstText(record.title) || labelize(record.notification_type || record.type),
    displayMessage: firstText(record.message, record.message_content) || 'No additional details were provided.',
    displayTimestamp,
    reference,
    href,
  }
}

export function presentUserNotifications(rows: unknown): PresentedUserNotification[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row): row is UserNotificationRecord => Boolean(row && typeof row === 'object' && text((row as UserNotificationRecord).id)))
    .map(presentUserNotification)
}
