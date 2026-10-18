// Conversation header for the Command Center (Phase 12 split / docs §8).
// Identity + primary channel/provider, workflow status, priority, AI mode, owner/assignment, and
// SLA at a glance. Presentational — the page passes precomputed display props.
//
// CA-OWNER-02: the title is the conversation's CUSTOMER (the same heading as its inbox row, H3), the line under it is the
// subject, a non-operational conversation carries its provenance badge (H1), and the SLA line is truth's label for every
// state (H2).

import { AlertTriangle, CheckCircle2, Clock, MinusCircle, PauseCircle, UserCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { CATEGORY_TONE_CLASS, type CategoryTone } from '../conversationTruth'
import type { RowSlaLevel } from './ConversationRow'

export interface ConversationHeaderProps {
  channel?: string | null
  title: string
  reference?: string
  statusLabel: string
  priority?: string
  priorityVariant?: 'destructive' | 'secondary' | 'outline'
  aiMode?: string | null
  assignedLabel: string
  slaLabel?: string
  slaLevel?: RowSlaLevel
  /** Provenance category of a NON-operational conversation — omitted for operational work. */
  categoryLabel?: string
  categoryTone?: CategoryTone
}

export function ConversationHeader({
  channel, title, reference, statusLabel, priority, priorityVariant = 'secondary',
  aiMode, assignedLabel, slaLabel, slaLevel = 'none', categoryLabel, categoryTone = 'historical',
}: ConversationHeaderProps) {
  return (
    <CardHeader className="pb-3 border-b">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <CardTitle className="text-lg flex items-center gap-2" data-testid="conversation-heading">
            <ChannelIcon channel={channel} size={18} />
            {title}
          </CardTitle>
          {reference && <p className="text-xs text-gray-500 mt-1 truncate" data-testid="conversation-subject">{reference}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {categoryLabel && (
            <Badge variant="outline" className={CATEGORY_TONE_CLASS[categoryTone]} data-testid="header-category" data-category-tone={categoryTone}>{categoryLabel}</Badge>
          )}
          <Badge variant="outline" className="capitalize">{statusLabel}</Badge>
          {priority && <Badge variant={priorityVariant} className="capitalize">{priority}</Badge>}
          {aiMode && <Badge variant="secondary" className="capitalize">AI: {aiMode}</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
        <span className="flex items-center gap-1 text-gray-500"><UserCheck className="w-3.5 h-3.5" aria-hidden /> {assignedLabel}</span>
        {slaLevel === 'breach' && <span className="flex items-center gap-1 text-red-600 font-medium"><AlertTriangle className="w-3.5 h-3.5" aria-hidden />{slaLabel}</span>}
        {slaLevel === 'due' && <span className="flex items-center gap-1 text-amber-600 font-medium"><Clock className="w-3.5 h-3.5" aria-hidden />{slaLabel}</span>}
        {slaLevel === 'ok' && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden />{slaLabel}</span>}
        {slaLevel === 'paused' && <span className="flex items-center gap-1 text-gray-500 font-medium"><PauseCircle className="w-3.5 h-3.5" aria-hidden />{slaLabel || 'SLA paused'}</span>}
        {slaLevel === 'none' && slaLabel && <span className="flex items-center gap-1 text-gray-500" data-testid="header-sla-none"><MinusCircle className="w-3.5 h-3.5" aria-hidden />{slaLabel}</span>}
      </div>
    </CardHeader>
  )
}
