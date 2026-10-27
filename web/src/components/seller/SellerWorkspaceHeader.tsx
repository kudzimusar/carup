import type { ReactNode } from 'react'
import { CarUpWorkspaceBar } from '@/components/workspace/CarUpWorkspaceBar'
import { WorkspaceBreadcrumbs } from '@/components/workspace/WorkspaceBreadcrumbs'
import { WorkspaceParentLink } from '@/components/workspace/WorkspaceParentLink'
import type { WorkspaceCrumb, WorkspaceId } from '@/components/workspace/workspaceModel'

export function SellerWorkspaceHeader({
  eyebrow = 'Seller workspace',
  title,
  description,
  backHref = '/dashboard',
  backLabel = 'Seller / Owner home',
  objectIdentity,
  statusLabel,
  primaryAction,
  workspace,
  breadcrumbs,
}: {
  eyebrow?: string
  title: string
  description: string
  backHref?: string
  backLabel?: string
  objectIdentity?: string | null
  statusLabel?: string | null
  primaryAction?: ReactNode
  /** R3: which CarUp workspace this page belongs to. Draws the workspace bar above the parent link. */
  workspace?: WorkspaceId
  /** R3: the trail to this page. The last crumb is the page itself. */
  breadcrumbs?: WorkspaceCrumb[]
}) {
  return (
    <header className="border-b border-slate-200 pb-7" data-testid="seller-workspace-header">
      {workspace ? <CarUpWorkspaceBar active={workspace} className="mb-3" /> : null}
      {breadcrumbs && breadcrumbs.length > 0 ? <WorkspaceBreadcrumbs items={breadcrumbs} className="mb-1" /> : null}
      <WorkspaceParentLink href={backHref} label={backLabel} />

      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">{eyebrow}</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          {(objectIdentity || statusLabel) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500">
              {objectIdentity && <span data-testid="seller-workspace-object">{objectIdentity}</span>}
              {statusLabel && (
                <span className="border-l-2 border-orange-500 pl-3 text-slate-700" data-testid="seller-workspace-status">
                  {statusLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {primaryAction && <div className="shrink-0" data-testid="seller-workspace-primary-action">{primaryAction}</div>}
      </div>
    </header>
  )
}
