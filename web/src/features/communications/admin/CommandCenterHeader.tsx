// Command Center operations strip (docs §5 header): queue depth, oldest-queued age, SLA breaches,
// unassigned, dead letters, Telegram mode, and cron cadence at a glance. Presentational.

import { AlertTriangle, CheckCircle2, Clock, MessageSquare, ShieldAlert, UserCheck, XCircle, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorkerHealthLike } from './WorkerHealthPanel'

type Tone = 'default' | 'danger' | 'good' | 'muted'

function StatPill({ label, value, tone = 'default', icon: Icon }: { label: string; value: string | number; tone?: Tone; icon?: LucideIcon }) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'good'
      ? 'border-green-200 bg-green-50 text-green-700'
      : tone === 'muted'
        ? 'border-gray-200 bg-gray-50 text-gray-500'
        : 'border-gray-200 bg-white text-gray-700'
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${toneClass}`}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      <span className="text-xs">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export interface CommandCenterHeaderProps {
  openCount: number
  unassigned: number
  overdue: number
  deadLetterCount: number
  health?: WorkerHealthLike | null
}

export function CommandCenterHeader({ openCount, unassigned, overdue, deadLetterCount, health }: CommandCenterHeaderProps) {
  const slaBreaching = health?.queue.sla_breaching ?? 0
  const slaThreshold = health?.queue.sla_threshold_seconds ?? 60
  const telegramOk = health?.telegram?.available === true && health?.telegram?.mode === 'real'
  const oldest = health?.queue.oldest_queued_seconds
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatPill label="Open" value={openCount} icon={MessageSquare} />
      <StatPill label="Unassigned" value={unassigned} tone={unassigned > 0 ? 'default' : 'muted'} icon={UserCheck} />
      <StatPill label="Overdue" value={overdue} tone={overdue > 0 ? 'danger' : 'good'} icon={AlertTriangle} />
      <StatPill label="Dead-letter" value={deadLetterCount} tone={deadLetterCount > 0 ? 'danger' : 'good'} icon={ShieldAlert} />
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
