// Queue backlog workspace for the Command Center (plan §5 — Queues section).
// A responsive grid of queue cards: each shows the queue label + a large backlog count and is a
// router link straight into the inbox filtered to that queue (`${basePath}?filter=${value}`), so an
// operator can triage the biggest backlog first. Queues with work (count > 0) are highlighted so the
// eye lands on them. Presentational — the page supplies the queue counts.

import { Link } from 'react-router-dom'
import { Inbox, LayoutGrid } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface QueueOverviewProps {
  queues: Array<{ value: string; label: string; count: number }>
  /** Base path of the Command Center inbox, e.g. "/admin/communications". */
  basePath: string
}

export function QueueOverview({ queues, basePath }: QueueOverviewProps) {
  const total = queues.reduce((sum, queue) => sum + (queue.count || 0), 0)
  return (
    <Card className="border-0 card-shadow" data-testid="queue-overview">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <LayoutGrid className="w-4 h-4" aria-hidden /> Queues
          {total > 0 && <Badge variant="secondary" className="ml-auto">{total}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {queues.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500" data-testid="queue-overview-empty">
            <Inbox className="w-7 h-7 mx-auto mb-1 text-gray-300" aria-hidden /> No queues configured.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {queues.map((queue) => {
              const active = queue.count > 0
              return (
                <Link
                  key={queue.value}
                  to={`${basePath}?filter=${queue.value}`}
                  data-testid={`queue-card-${queue.value}`}
                  data-active={active ? 'true' : undefined}
                  aria-label={`${queue.label}: ${queue.count} in queue`}
                  className={`flex flex-col justify-between rounded-xl border p-3 min-h-[92px] transition-colors ${
                    active
                      ? 'border-orange-200 bg-orange-50 hover:bg-orange-100'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span className="text-xs font-medium text-gray-600 truncate">{queue.label}</span>
                  <span className={`mt-2 text-3xl font-semibold leading-none tabular-nums ${active ? 'text-orange-600' : 'text-gray-300'}`}>
                    {queue.count}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
