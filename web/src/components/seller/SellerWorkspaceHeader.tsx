import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function SellerWorkspaceHeader({
  eyebrow = 'Seller workspace',
  title,
  description,
  backHref = '/dashboard',
  backLabel = 'Seller / Owner home',
  objectIdentity,
  statusLabel,
  primaryAction,
}: {
  eyebrow?: string
  title: string
  description: string
  backHref?: string
  backLabel?: string
  objectIdentity?: string | null
  statusLabel?: string | null
  primaryAction?: ReactNode
}) {
  return (
    <header className="border-b border-slate-200 pb-7" data-testid="seller-workspace-header">
      <Link
        to={backHref}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Link>

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
