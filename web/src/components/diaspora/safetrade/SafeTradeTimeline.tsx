/**
 * SafeTradeTimeline — the 16-phase lifecycle, derived from the authoritative current state + the
 * backend audit events (GET /:id/timeline). It distinguishes current / completed / blocked /
 * unavailable phases with accessible TEXT (never color alone), attaches observed timestamps/source
 * where the backend provided them, and NEVER fabricates a completed stage the backend did not record.
 */
import { CheckCircle2, Circle, CircleDot, Ban } from 'lucide-react'
import { deriveTimeline, type SafeTradePhaseStatus } from './safeTradeHelpers'
import type { SafeTradeState, SafeTradeTimelineEvent } from '@/types'

export interface SafeTradeTimelineProps {
  currentState: SafeTradeState | null
  events: SafeTradeTimelineEvent[]
  testId?: string
}

const STATUS_TEXT: Record<SafeTradePhaseStatus, string> = {
  completed: 'Completed',
  current: 'Current',
  blocked: 'Blocked',
  unavailable: 'Not yet reached',
}

function PhaseIcon({ status }: { status: SafeTradePhaseStatus }) {
  const cls = 'h-4 w-4 motion-reduce:transition-none'
  if (status === 'completed') return <CheckCircle2 className={`${cls} text-emerald-600`} aria-hidden="true" />
  if (status === 'current') return <CircleDot className={`${cls} text-orange-600`} aria-hidden="true" />
  if (status === 'blocked') return <Ban className={`${cls} text-red-600`} aria-hidden="true" />
  return <Circle className={`${cls} text-gray-300`} aria-hidden="true" />
}

export function SafeTradeTimeline({ currentState, events, testId = 'safetrade-timeline' }: SafeTradeTimelineProps) {
  const phases = deriveTimeline(currentState, events)

  return (
    <section aria-label="SafeTrade lifecycle timeline" data-testid={testId}>
      <h3 className="text-sm font-semibold text-gray-900">Lifecycle</h3>
      <ol className="mt-3 space-y-2" role="list">
        {phases.map((phase) => (
          <li
            key={phase.state}
            className="flex items-start gap-3"
            data-testid={`${testId}-phase`}
            data-state={phase.state}
            data-status={phase.status}
            aria-current={phase.status === 'current' ? 'step' : undefined}
          >
            <span className="mt-0.5 flex-shrink-0">
              <PhaseIcon status={phase.status} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-gray-900">{phase.label}</span>
                {/* Accessible TEXT status — never color-only. */}
                <span className="text-xs text-gray-500" data-testid={`${testId}-phase-status`}>
                  {STATUS_TEXT[phase.status]}
                </span>
              </div>
              {phase.timestamp && (
                <p className="mt-0.5 text-xs text-gray-400" data-testid={`${testId}-phase-time`}>
                  {formatTimestamp(phase.timestamp)}
                  {phase.source ? ` · source: ${phase.source}` : ''}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default SafeTradeTimeline
