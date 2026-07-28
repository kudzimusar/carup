/**
 * Pure helpers for the SafeTrade Operations console (ST-3, Issue #127).
 *
 * Kept out of the component file so the module exports components only (react-refresh keeps fast
 * refresh working), and so the health rule can be unit-tested without rendering anything.
 */
import type { SafeTradeOutboxBacklog } from '@/types'

/** Human-readable age. Used in TEXT so a stalled queue is never signalled by colour alone. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(Number(seconds))) return 'unknown'
  const s = Math.max(0, Math.round(Number(seconds)))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hr`
  return `${Math.round(h / 24)} days`
}

/**
 * A backlog is only healthy if its HEAD is fresh.
 *
 * Judging by count alone gets both cases wrong in opposite directions: 250 events queued 4 seconds
 * ago is a busy, working drainer, while 3 events whose oldest has been waiting four hours is a
 * drainer that has stopped. Age is the signal; count is not.
 */
export const OUTBOX_STALL_WARN_SECONDS = 900

export function outboxHealth(backlog: SafeTradeOutboxBacklog | null): 'ok' | 'warn' | 'error' | 'unknown' {
  if (!backlog) return 'unknown'
  if (backlog.deadLettered > 0) return 'error'
  if ((backlog.oldestPendingAgeSeconds ?? 0) >= OUTBOX_STALL_WARN_SECONDS) return 'warn'
  return 'ok'
}
