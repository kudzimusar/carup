// One timeline message for the Command Center (Phase 12 split + Phase 7 dates).
// Distinguishes inbound / outbound / internal-note; shows exact timezone-aware timestamps (never
// "Invalid Date") with a relative label, delivery state (via DeliveryStateBadge), an SLA-past
// warning, and the provider message id for audit. Pure/presentational — safe to unit-test.

import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeliveryStateBadge } from './DeliveryStateBadge'
import { ageSeconds, formatExactDateTime, relativeTime } from '../communicationFormatting'

export interface TimelineMessage {
  id: string
  direction?: string | null
  channel?: string | null
  status?: string | null
  content_text?: string | null
  created_at?: string | null
  provider_message_id?: string | null
}

export interface MessageBubbleProps {
  message: TimelineMessage
  slaThresholdSeconds?: number
  timeZone?: string
  /** Injectable clock for tests; defaults (inside the formatting helpers) to Date.now(). */
  now?: number
}

export function MessageBubble({ message, slaThresholdSeconds = 60, timeZone, now }: MessageBubbleProps) {
  const dir = String(message.direction || '')
  const isOutbound = dir === 'outbound'
  const isInternal = dir === 'internal'
  const exact = formatExactDateTime(message.created_at, { timeZone, now }).absolute
  const rel = relativeTime(message.created_at, now)
  const age = isOutbound ? ageSeconds(message.created_at, now) : null
  const slaBreach = isOutbound
    && ['queued', 'processing'].includes(String(message.status || ''))
    && age != null && age > slaThresholdSeconds

  if (isInternal) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-direction="internal">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" aria-hidden /> Internal note · not sent to user
          </span>
          <time className="text-[10px] text-gray-400" title={exact} dateTime={message.created_at || undefined}>{rel}</time>
        </div>
        <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
      </div>
    )
  }

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`} data-direction={dir}>
      <div className={`max-w-[82%] rounded-lg p-3 ${isOutbound ? 'bg-orange-50 border border-orange-100' : 'bg-white border'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">{dir} · {message.channel}</span>
          <time className="text-[10px] text-gray-400" title={exact} dateTime={message.created_at || undefined}>{rel}</time>
        </div>
        <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
        {isOutbound && (
          <div className="flex items-center gap-1.5 mt-2">
            <DeliveryStateBadge status={message.status} />
            {slaBreach && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertTriangle className="w-3 h-3" aria-hidden />{age}s · past SLA
              </Badge>
            )}
            {message.provider_message_id && (
              <span className="text-[10px] text-gray-400 font-mono truncate max-w-[140px]" title="Provider message id (audit)">
                {message.provider_message_id}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
