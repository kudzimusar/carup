// Per-message technical/audit drawer body for the Command Center conversation timeline (plan §6).
// Presentational: when the operator turns on "technical" mode, each message can expand this compact
// metadata sheet exposing the RAW ISO timestamp (visible exact value + machine-readable <time>),
// direction, channel, delivery status, and the provider/correlation/sender ids auditors need. The
// timeline supplies a single message; only the fields that are present render, and a message with no
// technical metadata collapses to a small placeholder line.

import { formatExactDateTime } from '../communicationFormatting'

export interface MessageTechnical {
  id: string
  direction?: string | null
  channel?: string | null
  status?: string | null
  created_at?: string | null
  provider_message_id?: string | null
  correlation_id?: string | null
  sender_user_id?: string | null
}

export interface MessageTechnicalDetailsProps {
  message: MessageTechnical
  /** Customer-local timezone for the exact timestamp (falls back to the viewer's). */
  timeZone?: string
}

interface TechnicalRow {
  key: string
  label: string
  value: string
  /** Break long, unbreakable ids so they never overflow the two-column grid. */
  breakAll?: boolean
}

export function MessageTechnicalDetails({ message, timeZone }: MessageTechnicalDetailsProps) {
  const dt = formatExactDateTime(message.created_at, { timeZone })

  // Only surface fields that are actually present — raw technical values (no friendly relabelling)
  // so auditors see exactly what the message row holds.
  const rows: TechnicalRow[] = []
  if (message.direction) rows.push({ key: 'direction', label: 'Direction', value: message.direction })
  if (message.channel) rows.push({ key: 'channel', label: 'Channel', value: message.channel })
  if (message.status) rows.push({ key: 'status', label: 'Delivery status', value: message.status })
  if (message.provider_message_id) {
    rows.push({ key: 'provider_message_id', label: 'Provider message id', value: message.provider_message_id, breakAll: true })
  }
  if (message.correlation_id) {
    rows.push({ key: 'correlation_id', label: 'Correlation id', value: message.correlation_id, breakAll: true })
  }
  if (message.sender_user_id) {
    rows.push({ key: 'sender_user_id', label: 'Sender user id', value: message.sender_user_id, breakAll: true })
  }

  const hasAny = !!message.created_at || rows.length > 0
  if (!hasAny) {
    return (
      <p className="text-[10px] text-gray-400" data-testid="message-technical-empty">No technical metadata.</p>
    )
  }

  return (
    <dl
      className="rounded border bg-gray-50 p-2 text-[10px] font-mono grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
      data-testid="message-technical"
    >
      {message.created_at && (
        <div className="contents">
          <dt className="text-gray-400">Created at</dt>
          {/* Exact, VISIBLE formatted value AND the raw ISO, kept machine-readable via <time>. */}
          <dd className="text-gray-600 break-all" data-testid="message-technical-created_at">
            <time dateTime={message.created_at} title={message.created_at}>{dt.absolute}</time>
            <span className="block text-gray-400">{message.created_at}</span>
          </dd>
        </div>
      )}
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-gray-400">{row.label}</dt>
          <dd className={row.breakAll ? 'text-gray-600 break-all' : 'text-gray-600'} data-testid={`message-technical-${row.key}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
