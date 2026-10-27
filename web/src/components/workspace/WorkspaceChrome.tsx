import { cn } from '@/lib/utils'
import { CarUpWorkspaceBar } from './CarUpWorkspaceBar'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'
import { WorkspaceExitActions, type WorkspaceAction } from './WorkspaceExitActions'
import { WorkspaceParentLink } from './WorkspaceParentLink'
import type { WorkspaceCrumb, WorkspaceId } from './workspaceModel'

/**
 * The orientation block at the top of a business page that does not use the large Seller header:
 * which workspace this is (the bar), where in it (the trail), and the one-tap way up (the parent
 * link). It answers "where am I / what am I working on / where did I come from" before any
 * content, on every width, and is identical in the owner shell and the Trade shell.
 */
export function WorkspaceChrome({
  workspace,
  breadcrumbs,
  parent,
  exits,
  className,
}: {
  workspace: WorkspaceId
  breadcrumbs?: WorkspaceCrumb[]
  /** The explicit parent. Omit when the caller may not link to it — a trail then ends in text. */
  parent?: { href: string; label: string } | null
  /** Adjacent capabilities, as quiet links on the parent link's row. An empty list renders nothing. */
  exits?: { label: string; actions: WorkspaceAction[] } | null
  className?: string
}) {
  const hasExits = Boolean(exits && exits.actions.length > 0)
  return (
    <div data-testid="workspace-chrome" data-workspace={workspace} className={cn('space-y-1', className)}>
      <CarUpWorkspaceBar active={workspace} />
      {breadcrumbs && breadcrumbs.length > 0 ? <WorkspaceBreadcrumbs items={breadcrumbs} className="pt-1" /> : null}
      {parent || hasExits ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6">
          {parent ? <WorkspaceParentLink href={parent.href} label={parent.label} /> : null}
          {exits && hasExits ? <WorkspaceExitActions variant="inline" label={exits.label} actions={exits.actions} /> : null}
        </div>
      ) : null}
    </div>
  )
}
