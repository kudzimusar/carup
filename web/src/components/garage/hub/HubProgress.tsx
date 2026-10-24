import { AlertTriangle, CheckCircle2, Circle, CircleDot, MinusCircle } from 'lucide-react'
import { NEXT_ACTION_LABEL, type CaseHub } from '@/lib/garageBusiness'
import { HUB_STEP_STATE_LABEL, hubSteps, nextStepIsSomeoneElses, visibleNextAction, type HubStepState } from '@/lib/garageWorkspace'

const STATE_STYLE: Record<HubStepState, string> = {
  done: 'text-green-700',
  current: 'text-orange-700 font-semibold',
  upcoming: 'text-gray-500',
  blocked: 'text-red-700 font-semibold',
  optional: 'text-gray-500',
  closed: 'text-gray-400',
}

function StepIcon({ state }: { state: HubStepState }) {
  const cls = 'w-4 h-4 shrink-0 mt-0.5'
  if (state === 'done') return <CheckCircle2 className={`${cls} text-green-600`} aria-hidden="true" />
  if (state === 'current') return <CircleDot className={`${cls} text-orange-500`} aria-hidden="true" />
  if (state === 'blocked') return <AlertTriangle className={`${cls} text-red-600`} aria-hidden="true" />
  if (state === 'optional' || state === 'closed') return <MinusCircle className={`${cls} text-gray-300`} aria-hidden="true" />
  return <Circle className={`${cls} text-gray-300`} aria-hidden="true" />
}

/**
 * The headline (what this job is waiting for, from the server's `next_action`) and the whole journey as a
 * list of steps. Each step's state is stated from recorded facts; a step is never "done" because a later
 * one happened to start. A viewer who sees no money gets no invoice or payment step.
 */
export function HubProgress({ hub }: { hub: CaseHub }) {
  const next = visibleNextAction(hub)
  const steps = hubSteps(hub)
  return (
    <section aria-label="Where this job stands" className="space-y-4" data-testid="hub-progress">
      <div className="border-l-4 border-orange-500 pl-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">What this job is waiting for</p>
        <p className="text-lg font-semibold mt-1" data-testid="case-next-action">{NEXT_ACTION_LABEL[next]}</p>
        {nextStepIsSomeoneElses(hub) && (
          <p className="text-sm text-gray-600 mt-1" data-testid="next-step-not-yours">
            This step is for a garage administrator, so there is nothing for you to press here.
          </p>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Steps of this job" data-testid="hub-steps">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm" data-testid={`step-${s.key}`} data-state={s.state}>
            <StepIcon state={s.state} />
            <span className="min-w-0">
              <span className={STATE_STYLE[s.state]}>{s.label}</span>
              <span className="text-gray-500"> — {HUB_STEP_STATE_LABEL[s.state]}</span>
              {s.detail && <span className="block text-xs text-gray-500 break-words">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
