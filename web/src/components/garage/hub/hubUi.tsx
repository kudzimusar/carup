import { useId, type ReactNode } from 'react'
import type { CaseHub } from '@/lib/garageBusiness'

/**
 * Shared plumbing for the Garage operating hub panels.
 *
 * A panel gets the ONE read model (`hub`), whether an action is already running (`busy`), a runner that
 * performs an action and then re-reads the hub (`run`), and the current refusal (`error`) so it can show
 * the server's own words beside the thing that was refused. A panel never patches local state to fake an
 * outcome — `run` refetches the hub, and what comes back is what is shown.
 */

export type HubScope = 'case' | 'request' | 'estimate' | 'assignment' | 'start' | 'work' | 'complete' | 'parts' | 'closeout'
export type HubError = { scope: HubScope; message: string }

/** Performs `fn`, then refetches the hub. Resolves true when `fn` succeeded (so a form can close itself). */
export type HubRun = (scope: HubScope, fn: () => Promise<unknown>, success: string) => Promise<boolean>

export type HubPanelProps = {
  hub: CaseHub
  busy: boolean
  run: HubRun
  error: HubError | null
}

/** An open band, not a card: DESIGN.md §4.3 / §20 — sections are separated by a rule, not boxed. */
export function HubSection({ id, title, hint, testId, children }: {
  id: string
  title: string
  hint?: string
  testId?: string
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} data-testid={testId ?? `${id}-section`} className="border-t border-gray-200 pt-6 space-y-4">
      <div>
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-sm text-gray-600 mt-1">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** The server's refusal, verbatim, beside the panel it belongs to. */
export function ScopedError({ scope, error }: { scope: HubScope; error: HubError | null }) {
  if (!error || error.scope !== scope) return null
  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 break-words" role="alert" data-testid="case-action-error">
      {error.message}
    </p>
  )
}

export function FormError({ message, testId }: { message: string | null; testId: string }) {
  if (!message) return null
  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 break-words" role="alert" data-testid={testId}>
      {message}
    </p>
  )
}

export const INPUT_CLASS = 'w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm bg-white'
export const TEXTAREA_CLASS = 'w-full rounded-lg border border-gray-300 p-3 text-sm bg-white'
