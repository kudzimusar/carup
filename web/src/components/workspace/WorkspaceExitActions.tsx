import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { WS_STYLE } from './workspaceStyles'

export interface WorkspaceAction {
  label: string
  href: string
  /** `primary` = the next step in this workspace; `secondary` = a sibling or adjacent capability. */
  emphasis?: 'primary' | 'secondary'
  testId?: string
}

/**
 * "What can I do next, and what else can I legitimately open from here?" — a labelled row of real
 * links. It is the page's answer to the audit's dead-end finding: every action is an explicit
 * control with a destination, so no one needs the browser Back button to leave.
 *
 * An empty list renders nothing at all (never an empty landmark), because an action the viewer is
 * not authorised to take must be absent, not disabled.
 */
export function WorkspaceExitActions({
  label,
  actions,
  className,
}: {
  /** The landmark name, e.g. "Elsewhere for this vehicle". */
  label: string
  actions: WorkspaceAction[]
  className?: string
}) {
  if (!actions.length) return null
  return (
    <nav
      aria-label={label}
      data-testid="workspace-exit-actions"
      className={cn('flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:flex-wrap sm:items-center', className)}
    >
      {actions.map((action) => {
        const primary = action.emphasis === 'primary'
        return (
          <Link
            key={`${action.href}|${action.label}`}
            to={action.href}
            data-testid={action.testId}
            className={cn(
              'inline-flex items-center justify-center gap-2 text-sm',
              primary ? WS_STYLE.primaryAction : WS_STYLE.secondaryAction,
              WS_STYLE.focus,
            )}
          >
            {action.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )
      })}
    </nav>
  )
}
