// One timeline message for the Command Center (Phase 12 split + Phase 7 dates + P1.5).
// The NORMAL (non-technical) bubble shows all human-readable context VISIBLY (never hover-only):
// branded channel icon + friendly label, direction, sender identity, delivery state, and the exact
// calendar date + time + timezone abbreviation alongside a relative label. Raw ids / ISO timestamps /
// correlation / provider payload metadata live in the technical drawer (MessageTechnicalDetails).
// Pure/presentational — safe to unit-test.

import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeliveryStateBadge } from './DeliveryStateBadge'
import { ChannelIcon } from '../ChannelIcon'
import { channelLabel } from '../channelRegistry'
import { ageSeconds, formatExactDateTime, titleCase } from '../communicationFormatting'

export interface TimelineMessage {
  id: string
  direction?: string | null
  channel?: string | null
  status?: string | null
  content_text?: string | null
  created_at?: string | null
  provider_message_id?: string | null
  sender_user_id?: string | null
}

export interface MessageBubbleProps {
  message: TimelineMessage
  /** Human sender label (e.g. the customer's name inbound, or the agent outbound). */
  senderLabel?: string
  slaThresholdSeconds?: number
  timeZone?: string
  /** Injectable clock for tests; defaults (inside the formatting helpers) to Date.now(). */
  now?: number
}

function DirectionLabel({ dir }: { dir: string }) {
  const label = dir === 'outbound' ? 'Outbound' : dir === 'internal' ? 'Internal' : 'Inbound'
  return <span className="uppercase tracking-wide">{label}</span>
}

// Visible date/time/timezone + relative line — never hidden behind hover or technical mode.
function StampLine({ iso, now, timeZone }: { iso?: string | null; now?: number; timeZone?: string }) {
  const dt = formatExactDateTime(iso, { timeZone, now })
  return (
    <span className="text-[10px] text-gray-500" data-testid="message-stamp">
      <time dateTime={dt.iso || undefined}>{dt.absolute}</time>
      {dt.relative && <span className="text-gray-400"> · {dt.relative}</span>}
    </span>
  )
}

export function MessageBubble({ message, senderLabel, slaThresholdSeconds = 60, timeZone, now }: MessageBubbleProps) {
  const dir = String(message.direction || '')
  const isOutbound = dir === 'outbound'
  const isInternal = dir === 'internal'
  const sender = senderLabel || (message.sender_user_id ? `User ${String(message.sender_user_id).slice(0, 8)}` : null)
  const age = isOutbound ? ageSeconds(message.created_at, now) : null
  const slaBreach = isOutbound
    && ['queued', 'processing'].includes(String(message.status || ''))
    && age != null && age > slaThresholdSeconds

  if (isInternal) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-direction="internal">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" aria-hidden /> Internal note · not sent to user
            {sender && <span className="text-amber-600 normal-case font-normal">· {sender}</span>}
          </span>
          <StampLine iso={message.created_at} now={now} timeZone={timeZone} />
        </div>
        <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
      </div>
    )
  }

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`} data-direction={dir}>
      <div className={`max-w-[82%] rounded-lg p-3 ${isOutbound ? 'bg-orange-50 border border-orange-100' : 'bg-white border'}`}>
        {/* Visible metadata: channel icon + friendly label, direction, sender. */}
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 flex-wrap">
          <ChannelIcon channel={message.channel} size={12} decorative />
          <span>{channelLabel(message.channel) || titleCase(message.channel)}</span>
          <span aria-hidden>·</span>
          <DirectionLabel dir={dir} />
          {sender && (<><span aria-hidden>·</span><span className="text-gray-600 font-medium normal-case">{sender}</span></>)}
        </div>
        <p className="text-sm mt-1 whitespace-pre-wrap">{message.content_text}</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <StampLine iso={message.created_at} now={now} timeZone={timeZone} />
          {isOutbound && <DeliveryStateBadge status={message.status} />}
          {slaBreach && (
            <Badge variant="destructive" className="text-[10px] gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden />{age}s · past SLA
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}
