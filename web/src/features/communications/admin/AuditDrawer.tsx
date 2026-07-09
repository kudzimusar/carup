// Communication audit trail drawer for the Command Center (plan §8).
// Presentational timeline of communication_audit_events for a thread: each row shows the VISIBLE
// exact date/time (+timezone) and relative time, a human event label with semantic tone, the actor,
// channel, and summary; an optional technical section exposes correlation/message/notification ids
// and raw metadata for auditors. The page supplies the events + the `showTechnical` toggle.

import { FileClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { formatExactDateTime } from '../communicationFormatting'
import {
  auditActorLabel, auditEventLabel, auditEventTone, auditTechnicalRows, type AuditEvent, type AuditTone,
} from './auditPresentation'

const TONE_CLASS: Record<AuditTone, string> = {
  neutral: 'bg-gray-400',
  positive: 'bg-green-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  info: 'bg-blue-500',
}

export interface AuditDrawerProps {
  events: AuditEvent[]
  /** Reveal correlation/message ids + raw metadata for each event. */
  showTechnical?: boolean
  /** Customer-local timezone for the exact timestamps (falls back to the viewer's). */
  timeZone?: string
  loading?: boolean
  max?: number
}

export function AuditDrawer({ events, showTechnical = false, timeZone, loading = false, max = 50 }: AuditDrawerProps) {
  const shown = events.slice(0, max)
  return (
    <Card className="border-0 card-shadow" data-testid="audit-drawer">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileClock className="w-4 h-4" aria-hidden /> Audit trail
          {events.length > 0 && <Badge variant="outline" className="ml-auto">{events.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading audit trail…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No audit events recorded yet.</p>
        ) : (
          <ol className="relative">
            {shown.map((event) => {
              const dt = formatExactDateTime(event.created_at, { timeZone })
              const tech = showTechnical ? auditTechnicalRows(event) : []
              return (
                <li key={event.id} className="flex gap-3 pb-4 last:pb-0" data-testid="audit-event" data-event-type={event.event_type}>
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${TONE_CLASS[auditEventTone(event.event_type)]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{auditEventLabel(event.event_type)}</span>
                      {event.channel && <ChannelIcon channel={event.channel} size={13} decorative />}
                      <span className="text-[11px] text-gray-500">{auditActorLabel(event)}</span>
                    </div>
                    {/* Exact, VISIBLE timestamp (not hover) + relative time. */}
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      <time dateTime={dt.iso} title={dt.iso}>{dt.absolute}</time>
                      {dt.relative && <span className="ml-1.5">· {dt.relative}</span>}
                    </div>
                    {event.summary && <p className="text-xs text-gray-600 mt-1 break-words">{event.summary}</p>}
                    {tech.length > 0 && (
                      <dl className="mt-1.5 rounded border bg-gray-50 p-2 text-[10px] font-mono grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5" data-testid="audit-technical">
                        {tech.map((row) => (
                          <div key={row.key} className="contents">
                            <dt className="text-gray-400">{row.key}</dt>
                            <dd className="text-gray-600 break-all">{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {events.length > max && <p className="text-xs text-gray-400 text-center pt-1">+{events.length - max} older events</p>}
      </CardContent>
    </Card>
  )
}
