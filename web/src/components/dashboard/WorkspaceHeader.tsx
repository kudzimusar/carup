import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface WorkspaceCrumb {
  label: string
  href?: string
}

export function WorkspaceHeader({
  eyebrow = 'Seller workspace',
  title,
  subtitle,
  backHref = '/dashboard',
  backLabel = 'Seller home',
  breadcrumbs = [],
  status,
  action,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  backHref?: string
  backLabel?: string
  breadcrumbs?: WorkspaceCrumb[]
  status?: ReactNode
  action?: ReactNode
}) {
  return (
    <header
      className="border-b border-slate-200 bg-white pb-6"
      data-testid="workspace-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={backHref}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          data-testid="workspace-back-link"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
        {status}
      </div>

      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mt-5">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1.5">
                {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />}
                {crumb.href ? (
                  <Link className="hover:text-orange-700" to={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">{eyebrow}</p>
          <h1 className="mt-2 text-4xl font-black leading-[0.95] tracking-[-0.05em] text-slate-950 sm:text-5xl">
            {title}
          </h1>
          {subtitle && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  )
}
