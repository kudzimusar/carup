// Worker + SLA + scheduler health panel for the Command Center ops rail (docs §9).
// Presentational — the page supplies the worker-health payload.

import { Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface WorkerHealthLike {
  queue: { depth: number; oldest_queued_seconds?: number | null; sla_breaching?: number; sla_threshold_seconds?: number }
  telegram?: { provider?: string; mode?: string; available?: boolean } | null
  scheduler: { job_config?: { schedule?: string } | null; pg_cron_available?: boolean }
}

export interface WorkerHealthPanelProps {
  health: WorkerHealthLike
  idlePollSeconds?: number
  deliveryPollSeconds?: number
}

export function WorkerHealthPanel({ health, idlePollSeconds, deliveryPollSeconds }: WorkerHealthPanelProps) {
  const slaBreaching = health.queue.sla_breaching ?? 0
  const telegramOk = health.telegram?.available === true && health.telegram?.mode === 'real'
  const cron = health.scheduler.job_config?.schedule ?? (health.scheduler.pg_cron_available ? '* * * * *' : 'pending')
  return (
    <Card className="border-0 card-shadow">
      <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><Zap className="w-4 h-4" aria-hidden /> Worker &amp; SLA</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Queue depth</span><strong>{health.queue.depth}</strong></div>
        <div className="flex justify-between"><span className="text-gray-500">SLA breaches</span><strong className={slaBreaching > 0 ? 'text-red-600' : ''}>{slaBreaching}</strong></div>
        {health.queue.oldest_queued_seconds != null && (
          <div className="flex justify-between"><span className="text-gray-500">Oldest queued</span><strong>{health.queue.oldest_queued_seconds}s</strong></div>
        )}
        <div className="flex justify-between items-center"><span className="text-gray-500">Telegram</span>
          <span className={telegramOk ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{health.telegram?.provider ?? 'n/a'} ({health.telegram?.mode ?? '—'})</span>
        </div>
        <div className="flex justify-between"><span className="text-gray-500">Cron</span><strong className="font-mono text-xs">{cron}</strong></div>
        {(idlePollSeconds || deliveryPollSeconds) && (
          <p className="text-xs text-gray-400 pt-1">Auto-refreshes every {idlePollSeconds}s · {deliveryPollSeconds}s while delivering.</p>
        )}
      </CardContent>
    </Card>
  )
}
