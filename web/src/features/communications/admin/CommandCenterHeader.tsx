// Command Center operations strip (docs §5 header). Presentational.
//
// CA-OWNER-02 (H2): the conversation figures are the server's TRUTH (GET /metrics → truth), not raw thread stamps.
// Staging showed "654 open / 654 unassigned / 653 overdue" — almost all certification and UAT history, "overdue" by the
// creation-time stamp of conversations nobody was waiting on. The strip now shows operational work (open, awaiting
// reply, overdue, no individual assignee, oldest waiting), needs-review apart, and how many non-operational records are
// filtered out of the working inbox. When the truth could not be computed it says "unavailable" — never 0. Dead-letter
// is a labelled technical delivery figure. Worker / provider health is unchanged.

import { AlertTriangle, CheckCircle2, Clock, Filter, HelpCircle, MessageSquare, ShieldAlert, UserX, XCircle, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { relativeTime } from '../communicationFormatting'
import type { MetricsTruth } from '../conversationTruth'
import type { WorkerHealthLike } from './WorkerHealthPanel'

type Tone = 'default' | 'danger' | 'good' | 'muted' | 'review'

function StatPill({ label, value, tone = 'default', icon: Icon, testId }: { label: string; value: string | number; tone?: Tone; icon?: LucideIcon; testId?: string }) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'good'
      ? 'border-green-200 bg-green-50 text-green-700'
      : tone === 'muted'
        ? 'border-gray-200 bg-gray-50 text-gray-500'
        : tone === 'review'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-gray-200 bg-white text-gray-700'
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${toneClass}`} data-testid={testId}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      <span className="text-xs">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export interface CommandCenterHeaderProps {
  /** GET /metrics → `truth`. null/undefined while loading; `{ available: false }` when it could not be computed. */
  truth?: MetricsTruth | null
  /** notification_queue dead-letters — a technical delivery figure, not conversation work. null = not loaded. */
  deadLetterCount?: number | null
  deadLetterLatestAt?: string | null
  health?: WorkerHealthLike | null
}

function ConversationFigures({ truth }: { truth?: MetricsTruth | null }) {
  if (!truth) return <Skeleton className="h-8 w-72 rounded-lg" data-testid="cc-truth-loading" />
  if (truth.available === false) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status" data-testid="cc-truth-unavailable">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
        Conversation figures unavailable — the classification could not be read. Refresh to retry.
      </div>
    )
  }
  const op = truth.operational
  const review = truth.needs_review
  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Operational conversations" data-testid="cc-operational">
        <span className="text-xs font-medium text-gray-500">Operational</span>
        <StatPill label="Open" value={op.open} icon={MessageSquare} />
        <StatPill label="Awaiting reply" value={op.awaiting_reply} tone={op.awaiting_reply > 0 ? 'default' : 'muted'} icon={Clock} />
        <StatPill label="Overdue" value={op.overdue} tone={op.overdue > 0 ? 'danger' : 'good'} icon={AlertTriangle} />
        <StatPill label="No individual assignee" value={op.no_individual_assignee} tone={op.no_individual_assignee > 0 ? 'default' : 'muted'} icon={UserX} />
        {op.oldest_awaiting_since && (
          <StatPill label="Oldest waiting" value={relativeTime(op.oldest_awaiting_since) || '—'} tone="muted" icon={Clock} />
        )}
      </div>
      <StatPill
        label="Needs provenance review"
        value={`${review.open} open · ${review.awaiting_reply} awaiting reply`}
        tone={review.open > 0 ? 'review' : 'muted'}
        icon={HelpCircle}
        testId="cc-needs-review"
      />
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500" data-testid="cc-filtered-out">
        <Filter className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="font-semibold tabular-nums">{truth.non_operational_open}</span> filtered out of the working inbox
        <span className="sr-only"> (certification, automation and historical records)</span>
      </div>
    </>
  )
}

export function CommandCenterHeader({ truth, deadLetterCount, deadLetterLatestAt, health }: CommandCenterHeaderProps) {
  const slaBreaching = health?.queue.sla_breaching ?? 0
  const slaThreshold = health?.queue.sla_threshold_seconds ?? 60
  const telegramOk = health?.telegram?.available === true && health?.telegram?.mode === 'real'
  const oldest = health?.queue.oldest_queued_seconds
  const deadLetters = typeof deadLetterCount === 'number' ? deadLetterCount : null
  const newest = deadLetterLatestAt ? relativeTime(deadLetterLatestAt) : ''
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="command-center-strip">
      <ConversationFigures truth={truth} />
      <StatPill
        label="Delivery dead-letters"
        value={deadLetters === null ? '—' : `${deadLetters}${newest ? ` · newest ${newest}` : ''}`}
        tone={deadLetters === null ? 'muted' : deadLetters > 0 ? 'danger' : 'good'}
        icon={ShieldAlert}
        testId="cc-dead-letter"
      />
      <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
      {health ? (
        <>
          <StatPill label="Queue" value={health.queue.depth} tone="muted" icon={Zap} />
          {oldest != null && (
            <StatPill label="Oldest" value={`${oldest}s`} tone={oldest > slaThreshold ? 'danger' : 'muted'} icon={Clock} />
          )}
          <StatPill label={`SLA breach (${slaThreshold}s)`} value={slaBreaching} tone={slaBreaching > 0 ? 'danger' : 'good'} icon={AlertTriangle} />
          <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${telegramOk ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
            {telegramOk ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> : <XCircle className="w-3.5 h-3.5" aria-hidden />}
            Telegram <strong>{telegramOk ? 'real' : health.telegram?.mode ?? 'unknown'}</strong>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5" aria-hidden /> Cron {health.scheduler.job_config?.schedule ?? (health.scheduler.pg_cron_available ? '* * * * *' : 'pending')}
              </div>
            </TooltipTrigger>
            <TooltipContent>Supabase pg_cron drives worker delivery. {health.scheduler.pg_cron_available ? 'Extension active.' : 'pg_cron not yet enabled.'}</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <Skeleton className="h-8 w-48 rounded-lg" />
      )}
    </div>
  )
}
