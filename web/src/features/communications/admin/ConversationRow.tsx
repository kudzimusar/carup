// One inbox row for the Command Center (Phase 12 split / docs §7).
// Identity/context-first: real channel icon + human title + reference, workflow status, priority,
// assignment, SLA, and last-activity time. Optional multi-select checkbox (sibling to the open
// button, so the markup stays valid and accessible). Presentational — the page passes precomputed
// display props, so this stays pure and unit-testable. A raw UUID is never the title (upstream).
//
// CA-OWNER-02: the title is the conversation's CUSTOMER (H3), the reference line is its subject, and the
// badge line carries the provenance category of a non-operational conversation (H1) and the SLA label from
// truth for every state (H2) — "Waiting on the customer" is as much an answer as "Overdue".

import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ChannelIcon } from '../ChannelIcon'
import { CATEGORY_TONE_CLASS, type CategoryTone } from '../conversationTruth'

export type RowSlaLevel = 'none' | 'ok' | 'due' | 'breach' | 'paused'

export interface ConversationRowProps {
  channel?: string | null
  title: string
  reference?: string
  /** Latest message preview line (identity-first inbox). */
  preview?: string
  /** Unread inbound message count (from the projection's last_read_at). */
  unreadCount?: number
  statusLabel: string
  priority?: string
  priorityVariant?: 'destructive' | 'secondary' | 'outline'
  unassigned?: boolean
  slaLabel?: string
  slaLevel?: RowSlaLevel
  /** Provenance category of a NON-operational conversation (H1) — omitted for operational work. */
  categoryLabel?: string
  categoryTone?: CategoryTone
  timeLabel?: string
  selected?: boolean
  onSelect: () => void
  /** When provided, a multi-select checkbox is shown. */
  checked?: boolean
  onToggle?: () => void
}

const SLA_LABEL_CLASS: Record<RowSlaLevel, string> = {
  breach: 'text-red-600 font-medium',
  due: 'text-amber-600 font-medium',
  ok: 'text-green-700',
  paused: 'text-gray-500 font-medium',
  none: 'text-gray-400',
}

export function ConversationRow({
  channel, title, reference, preview, unreadCount = 0, statusLabel, priority, priorityVariant = 'secondary',
  unassigned = false, slaLabel, slaLevel = 'none', categoryLabel, categoryTone = 'historical', timeLabel, selected = false, onSelect,
  checked, onToggle,
}: ConversationRowProps) {
  const sla = slaLabel || (slaLevel === 'paused' ? 'SLA paused' : '')
  const hasUnread = unreadCount > 0
  return (
    <div className={`flex items-stretch border-b ${selected ? 'bg-orange-50 border-l-2 border-l-orange-500' : ''}`} data-unread={hasUnread ? 'true' : undefined}>
      {onToggle && (
        <div className="flex items-center pl-2.5">
          <Checkbox checked={!!checked} onCheckedChange={() => onToggle()} aria-label={`Select thread: ${title}${reference ? ` (${reference})` : ''}`} />
        </div>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        className="flex-1 min-w-0 text-left p-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center">
            <ChannelIcon channel={channel} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'font-semibold'}`}>{title}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                {hasUnread && (
                  <span
                    className="min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums"
                    aria-label={`${unreadCount} unread`}
                    data-testid="row-unread"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                {priority && <Badge variant={priorityVariant} className="text-[10px] capitalize">{priority}</Badge>}
              </div>
            </div>
            {preview && <p className={`text-xs mt-0.5 truncate ${hasUnread ? 'text-gray-700' : 'text-gray-500'}`} data-testid="row-preview">{preview}</p>}
            {reference && <p className="text-[11px] text-gray-500 mt-0.5 truncate" data-testid="row-subject">{reference}</p>}
            {/* One line (the virtualized row has a fixed height): long SLA labels truncate, the full text stays in the title. */}
            <div className="flex items-center gap-2 mt-1.5 flex-nowrap overflow-hidden">
              <Badge variant="outline" className="text-[10px] capitalize shrink-0">{statusLabel}</Badge>
              {categoryLabel && (
                <Badge variant="outline" className={`text-[10px] shrink-0 ${CATEGORY_TONE_CLASS[categoryTone]}`} data-testid="row-category" data-category-tone={categoryTone}>
                  {categoryLabel}
                </Badge>
              )}
              {unassigned && <span className="text-[10px] text-amber-600 font-medium shrink-0">Unassigned</span>}
              {sla && (
                <span className={`text-[10px] flex items-center gap-0.5 min-w-0 ${SLA_LABEL_CLASS[slaLevel]}`} data-testid="row-sla" data-sla-level={slaLevel} title={sla}>
                  {slaLevel === 'breach' && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />}
                  <span className="truncate">{sla}</span>
                </span>
              )}
              {timeLabel && <span className="text-[10px] text-gray-400 ml-auto shrink-0">{timeLabel}</span>}
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
