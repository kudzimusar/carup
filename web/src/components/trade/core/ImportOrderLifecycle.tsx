import { AlertTriangle, Check, CircleDashed, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PARTY_LABELS, STATE_GUIDE, positionOf, type OrderPosition } from './importOrderLifecycle'

/**
 * RX-06 — the ONE lifecycle presentation for an Import Order (every Trade surface uses this).
 * ≥ md: a seven-phase rail with the current phase's canonical sub-states as ticks.
 * < md: a vertical stepper with the current phase expanded (a usable phone structure, not a squeezed bar).
 * Earlier phases read "earlier stage" — completed OR not needed (transitions can skip phases) — never as
 * dated work. Exceptions and unknown statuses never place the order on the rail.
 */
export function ImportOrderLifecycle({ status, className, testId = 'trade-lifecycle' }: {
  status: string | null | undefined
  className?: string
  testId?: string
}) {
  const pos = positionOf(status)
  return (
    <section aria-label="Import order lifecycle" className={cn('min-w-0', className)} data-testid={testId} data-status={pos.status || 'unknown'}>
      {(pos.exception || !pos.known) && <LifecycleNotice pos={pos} />}
      <DesktopRail pos={pos} />
      <PhoneStepper pos={pos} />
    </section>
  )
}

function LifecycleNotice({ pos }: { pos: OrderPosition }) {
  const flagged = pos.exception === 'FLAGGED_FOR_REVIEW'
  return (
    <p className={cn('mb-3 flex items-start gap-2 rounded-control px-3 py-2 text-sm',
      pos.exception === 'CANCELLED' ? 'bg-status-neutral-soft text-carup-text' : 'bg-status-warning-soft text-carup-text')}
      role="status" data-testid="trade-lifecycle-notice">
      {pos.known ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" /> : <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />}
      <span>
        {pos.known && pos.guide
          ? <><strong className="font-semibold">{pos.guide.label}.</strong> {pos.guide.meaning} {flagged ? '' : 'The rail cannot show where the order stood before this status; the activity history records it.'}</>
          : <>This order has a status CarUp does not recognise (<code className="text-xs">{pos.status || 'none'}</code>), so it is not placed on the lifecycle.</>}
      </span>
    </p>
  )
}

function DesktopRail({ pos }: { pos: OrderPosition }) {
  return (
    <ol className="relative hidden gap-1.5 md:flex" aria-label="Phases">
      {pos.phases.map(({ phase, progress, currentState }, i) => {
        const isCurrent = progress === 'current'
        return (
          <li key={phase.key} className="min-w-0 flex-1" aria-current={isCurrent ? 'step' : undefined} data-progress={progress}>
            <div className={cn('h-1.5 rounded-full',
              progress === 'passed' ? 'bg-carup-text' : isCurrent ? '' : progress === 'unknown' ? 'bg-carup-line [background-image:repeating-linear-gradient(90deg,transparent_0_4px,var(--carup-color-bg)_4px_6px)]' : 'bg-carup-line')}
              style={isCurrent ? { background: 'var(--carup-raw-orange-signal)' } : undefined} />
            <p className={cn('mt-2 flex items-center gap-1 text-xs', progress === 'upcoming' || progress === 'unknown' ? 'text-carup-text-3' : 'font-semibold text-carup-text')}>
              {progress === 'passed' ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                : isCurrent ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--carup-raw-orange-signal)' }} />
                : <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{phase.label}</span>
            </p>
            <span className="sr-only">{progressText(progress)}{` (phase ${i + 1} of ${pos.phases.length})`}</span>
            {isCurrent && currentState && (
              <div className="mt-1.5">
                <SubStateTicks states={phase.states} current={currentState} />
                <p className="mt-1 text-xs text-carup-text-2" data-testid="trade-lifecycle-current-state">{STATE_GUIDE[currentState].label}</p>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function PhoneStepper({ pos }: { pos: OrderPosition }) {
  return (
    <ol className="space-y-0 md:hidden" aria-label="Phases">
      {pos.phases.map(({ phase, progress, currentState }, i) => {
        const isCurrent = progress === 'current'
        const last = i === pos.phases.length - 1
        return (
          <li key={phase.key} className="relative flex gap-3" aria-current={isCurrent ? 'step' : undefined} data-progress={progress}>
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className={cn('mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                progress === 'passed' ? 'border-carup-text bg-carup-text text-carup-bg-raised' : isCurrent ? 'border-transparent' : 'border-carup-line-strong')}
                style={isCurrent ? { background: 'var(--carup-raw-orange-signal)' } : undefined}>
                {progress === 'passed' && <Check className="h-3 w-3" />}
              </span>
              {!last && <span className={cn('w-0.5 flex-1', progress === 'passed' ? 'bg-carup-text' : 'bg-carup-line')} />}
            </div>
            <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-3')}>
              <p className={cn('text-sm', progress === 'upcoming' || progress === 'unknown' ? 'text-carup-text-3' : 'font-semibold text-carup-text')}>
                {phase.label}<span className="sr-only"> — {progressText(progress)}</span>
              </p>
              {isCurrent && currentState && (
                <div className="mt-1.5 rounded-control bg-carup-bg-surface p-2.5">
                  <p className="text-sm font-semibold text-carup-text" data-testid="trade-lifecycle-current-state-phone">{STATE_GUIDE[currentState].label}</p>
                  <p className="mt-0.5 text-xs text-carup-text-2">{STATE_GUIDE[currentState].meaning}</p>
                  <SubStateTicks states={phase.states} current={currentState} className="mt-2" />
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function SubStateTicks({ states, current, className }: { states: string[]; current: string; className?: string }) {
  if (states.length < 2) return null
  const at = states.indexOf(current)
  return (
    <div className={cn('flex items-center gap-1', className)} aria-label={`Step ${at + 1} of ${states.length} in this phase`} role="img">
      {states.map((s, i) => (
        <span key={s} className={cn('h-1 flex-1 rounded-full', i < at ? 'bg-carup-text-2' : i === at ? '' : 'bg-carup-line')}
          style={i === at ? { background: 'var(--carup-raw-orange-signal)' } : undefined} />
      ))}
    </div>
  )
}

function progressText(p: string): string {
  return p === 'passed' ? 'earlier stage (completed or not needed)' : p === 'current' ? 'current stage' : p === 'unknown' ? 'not known' : 'not started'
}

/** "Usually with …" — the party a canonical state waits on (never a named person). */
export function UsuallyWith({ status, className }: { status: string | null | undefined; className?: string }) {
  const pos = positionOf(status)
  if (!pos.guide || pos.guide.usuallyWith === 'none') return null
  return <span className={cn('text-xs text-carup-text-3', className)} data-testid="trade-usually-with">Usually with: <strong className="font-semibold text-carup-text-2">{PARTY_LABELS[pos.guide.usuallyWith]}</strong></span>
}
