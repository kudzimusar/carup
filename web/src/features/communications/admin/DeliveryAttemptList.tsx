// Provider delivery-attempt list for the Command Center (docs §3, §8).
// Presentational timeline of a message's `message_delivery_attempts` rows: each attempt shows its
// ordinal, the provider/channel, a status badge (delivery state is distinct from thread workflow
// state), the VISIBLE exact `started_at` timestamp, and — when present — the provider error, a
// "retry scheduled" line, and the provider message id. The page supplies the ordered attempts; the
// `compact` variant tightens density and drops the technical provider message id.

import { Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { deliveryLabel, formatExactDateTime, relativeTime, titleCase } from '../communicationFormatting'

export interface DeliveryAttempt {
  id: string
  attempt_number?: number
  provider?: string | null
  channel?: string | null
  provider_request_id?: string | null
  provider_message_id?: string | null
  status?: string | null
  error_code?: string | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  next_retry_at?: string | null
}

export interface DeliveryAttemptListProps {
  attempts: DeliveryAttempt[]
  /** Customer-local timezone for the exact timestamps (falls back to the viewer's). */
  timeZone?: string
  max?: number
  /** Tighten spacing and hide the technical provider message id. */
  compact?: boolean
}

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive'

// destructive for hard failures, secondary for a scheduled retry, default for a delivered/accepted
// attempt, outline for everything else (queued/processing/unknown).
function attemptBadgeVariant(status?: string | null): BadgeVariant {
  switch (String(status || '').toLowerCase()) {
    case 'failed':
    case 'dead_letter':
    case 'error':
      return 'destructive'
    case 'retry_scheduled':
      return 'secondary'
    case 'sent':
    case 'delivered':
    case 'read':
    case 'success':
    case 'succeeded':
      return 'default'
    default:
      return 'outline'
  }
}

// Sort by attempt_number ascending; fall back to started_at ascending. Rows with a number sort
// before number-less rows, and valid timestamps before invalid/missing ones, so ordering is stable.
function sortAttempts(attempts: DeliveryAttempt[]): DeliveryAttempt[] {
  return [...attempts].sort((a, b) => {
    const an = a.attempt_number
    const bn = b.attempt_number
    if (an != null && bn != null && an !== bn) return an - bn
    if (an != null && bn == null) return -1
    if (an == null && bn != null) return 1
    const at = a.started_at ? new Date(a.started_at).getTime() : NaN
    const bt = b.started_at ? new Date(b.started_at).getTime() : NaN
    const aValid = !Number.isNaN(at)
    const bValid = !Number.isNaN(bt)
    if (aValid && bValid && at !== bt) return at - bt
    if (aValid && !bValid) return -1
    if (!aValid && bValid) return 1
    return 0
  })
}

export function DeliveryAttemptList({ attempts, timeZone, max = 20, compact = false }: DeliveryAttemptListProps) {
  const sorted = sortAttempts(attempts)
  const shown = sorted.slice(0, max)
  return (
    <Card className="border-0 card-shadow" data-testid="delivery-attempt-list">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="w-4 h-4" aria-hidden /> Delivery attempts
          {sorted.length > 0 && <Badge variant="outline" className="ml-auto">{sorted.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className={compact ? 'space-y-1' : 'space-y-2'}>
        {shown.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No delivery attempts recorded.</p>
        ) : (
          <ol className={compact ? 'space-y-1' : 'space-y-2'}>
            {shown.map((attempt, index) => {
              const number = attempt.attempt_number ?? index + 1
              const status = attempt.status || ''
              const dt = formatExactDateTime(attempt.started_at, { timeZone })
              const retryRelative = relativeTime(attempt.next_retry_at)
              return (
                <li
                  key={attempt.id}
                  className={`rounded-lg border ${compact ? 'p-2' : 'p-3'}`}
                  data-testid="delivery-attempt"
                  data-attempt-status={status || undefined}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">Attempt {number}</span>
                    {attempt.provider && <span className="text-xs text-gray-500">{titleCase(attempt.provider)}</span>}
                    {attempt.channel && <ChannelIcon channel={attempt.channel} size={13} decorative />}
                    {status && (
                      <Badge variant={attemptBadgeVariant(status)} className="text-[10px] ml-auto shrink-0">
                        {deliveryLabel(status)}
                      </Badge>
                    )}
                  </div>
                  {/* Exact, VISIBLE timestamp (not hover-only) via a <time> element. */}
                  {dt.valid && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      <time dateTime={dt.iso} title={dt.iso}>{dt.absolute}</time>
                      {dt.relative && <span className="ml-1.5">· {dt.relative}</span>}
                    </div>
                  )}
                  {(attempt.error_code || attempt.error_message) && (
                    <p
                      className="text-xs text-red-600 mt-1 break-words"
                      title={attempt.error_message || attempt.error_code || ''}
                    >
                      {attempt.error_code || 'error'}
                      {attempt.error_message ? ` — ${attempt.error_message}` : ''}
                    </p>
                  )}
                  {attempt.next_retry_at && retryRelative && (
                    <p className="text-[11px] text-amber-600 mt-0.5">Retry scheduled {retryRelative}</p>
                  )}
                  {!compact && attempt.provider_message_id && (
                    <p
                      className="text-[10px] font-mono text-gray-400 mt-0.5 truncate"
                      title={attempt.provider_message_id}
                    >
                      {attempt.provider_message_id}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {sorted.length > max && (
          <p className="text-xs text-gray-400 text-center pt-1">+{sorted.length - max} more attempts</p>
        )}
      </CardContent>
    </Card>
  )
}
