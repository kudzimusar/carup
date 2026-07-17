// Global audit search surface for the Command Center (plan §8).
// A thread-independent view over communication_audit_events: a row of event-type filter chips plus a
// timeline of matching events (newest first as supplied). Each row shows a semantic tone dot, the
// human event label, the actor, the VISIBLE exact timestamp (+ relative time) inside a <time>, the
// summary, and — when the event is tied to a thread — an "Open thread" jump. Presentational: the page
// owns the query, supplies the filtered events, and handles navigation.

import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatExactDateTime } from '../communicationFormatting'
import { auditActorLabel, auditEventLabel, auditEventTone, type AuditEvent, type AuditTone } from './auditPresentation'

const TONE_CLASS: Record<AuditTone, string> = {
  neutral: 'bg-gray-400',
  positive: 'bg-green-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  info: 'bg-blue-500',
}

// Fixed, high-signal set of event types operators search by (matches auditPresentation labels).
const EVENT_TYPE_FILTERS = ['reply_sent', 'assigned', 'escalated', 'resolved', 'dead_lettered', 'smoke_test'] as const

function chipClass(isActive: boolean): string {
  return `flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
    isActive ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
  }`
}

export interface AuditSearchProps {
  /** Matching audit events, newest first — rendered in the given order. */
  events: AuditEvent[]
  /** Active event-type filter; '' means "All". */
  eventType: string
  onEventTypeChange: (value: string) => void
  /** Jump to the conversation an event belongs to. */
  onOpenThread: (threadId: string) => void
  loading?: boolean
}

export function AuditSearch({ events, eventType, onEventTypeChange, onOpenThread, loading = false }: AuditSearchProps) {
  return (
    <Card className="border-0 card-shadow" data-testid="audit-search">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="w-4 h-4" aria-hidden /> Audit search
          {events.length > 0 && <Badge variant="outline" className="ml-auto">{events.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Event-type filter chips — "All" clears the filter. */}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter audit events by type">
          <button
            type="button"
            onClick={() => onEventTypeChange('')}
            aria-pressed={eventType === ''}
            data-active={eventType === '' ? 'true' : undefined}
            className={chipClass(eventType === '')}
          >
            All
          </button>
          {EVENT_TYPE_FILTERS.map((type) => {
            const isActive = eventType === type
            return (
              <button
                key={type}
                type="button"
                onClick={() => onEventTypeChange(type)}
                aria-pressed={isActive}
                data-active={isActive ? 'true' : undefined}
                className={chipClass(isActive)}
              >
                {auditEventLabel(type)}
              </button>
            )
          })}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading audit events…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No audit events found.</p>
        ) : (
          <ol className="relative">
            {events.map((event) => {
              const dt = formatExactDateTime(event.created_at)
              return (
                <li
                  key={event.id}
                  className="flex gap-3 pb-4 last:pb-0"
                  data-testid="audit-search-row"
                  data-event-type={event.event_type}
                >
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${TONE_CLASS[auditEventTone(event.event_type)]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{auditEventLabel(event.event_type)}</span>
                      <span className="text-[11px] text-gray-500">{auditActorLabel(event)}</span>
                    </div>
                    {/* Exact, VISIBLE timestamp (not hover-only) + relative time. */}
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      <time dateTime={dt.iso} title={dt.iso}>{dt.absolute}</time>
                      {dt.relative && <span className="ml-1.5">· {dt.relative}</span>}
                    </div>
                    {event.summary && <p className="text-xs text-gray-600 mt-1 break-words">{event.summary}</p>}
                    {event.thread_id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 mt-1 px-2 text-[11px]"
                        onClick={() => onOpenThread(event.thread_id!)}
                        data-testid="audit-search-open-thread"
                      >
                        Open thread
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
