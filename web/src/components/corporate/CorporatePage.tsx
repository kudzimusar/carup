/**
 * CA-K3-01 — the page frame every Corporate destination uses: plane → breadcrumb → title →
 * management question → context (CA-UX-01 §7.3), plus section and cross-plane building blocks.
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CORPORATE_PLANES, CORPORATE_ROOT, destinationById, type CorporateDestinationId, type CorporatePlaneId, type OperateLink } from '@/config/corporate/navigation'
import { CorporateContextBar } from './CorporateContext'
import { NO_CONTEXT_SUPPORT, useCorporateContext, type PageContextSupport } from '@/lib/corporate/corporateContextState'

const PLANE_STYLE: Record<CorporatePlaneId, string> = {
  corporate_intelligence: 'border-slate-300 bg-slate-900 text-white',
  business_operations: 'border-slate-500 bg-white text-slate-900',
  platform_security: 'border-sky-300 bg-sky-50 text-sky-900',
}

export function PlaneIndicator({ plane, className }: { plane: CorporatePlaneId; className?: string }) {
  const p = CORPORATE_PLANES[plane]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', PLANE_STYLE[plane], className)}
      data-testid="plane-indicator"
      data-plane={plane}
    >
      <span aria-hidden="true" className="font-mono">{p.marker}</span>
      <span>{p.label}</span>
    </span>
  )
}

export function CorporatePage({
  id,
  intro,
  support = NO_CONTEXT_SUPPORT,
  children,
}: {
  id: CorporateDestinationId
  intro?: React.ReactNode
  support?: PageContextSupport
  children: React.ReactNode
}) {
  const d = destinationById(id)
  const { setPageSupport } = useCorporateContext()
  useEffect(() => { setPageSupport(support) }, [setPageSupport, support])
  useEffect(() => { document.title = `${d.label} · CarUp Corporate Admin` }, [d.label])
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6" data-testid={`corporate-page-${id}`} data-plane={d.plane}>
      <header className="space-y-3 border-b border-slate-200 pb-5">
        <PlaneIndicator plane={d.plane} />
        <nav aria-label="Breadcrumb" data-testid="corporate-breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            <li><Link className="rounded hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500" to={CORPORATE_ROOT}>Corporate Admin</Link></li>
            {id !== 'overview' && (
              <>
                <li aria-hidden="true"><ChevronRight className="h-3 w-3" /></li>
                <li aria-current="page" className="text-slate-700">{d.label}</li>
              </>
            )}
          </ol>
        </nav>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{d.label}</h1>
          <p className="mt-1 text-sm text-slate-600" data-testid="management-question">{d.question}</p>
        </div>
        {intro && <div className="max-w-3xl text-sm leading-relaxed text-slate-600">{intro}</div>}
        <CorporateContextBar />
      </header>
      {children}
    </div>
  )
}

export function Section({
  title,
  label,
  description,
  children,
  className,
  testId,
}: {
  title: string
  /** Short section key (e.g. "A") shown as an eyebrow. */
  label?: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  testId?: string
}) {
  const headingId = `sec-${(testId ?? title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  return (
    <section aria-labelledby={headingId} className={cn('space-y-3', className)} data-testid={testId}>
      <div>
        {label && <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-600">{label}</p>}
        <h2 id={headingId} className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Explicit cross-plane jumps to existing operational surfaces. Each names the queue it opens and the
 * plane it lands in; none of them is presented as a KPI drill-down, and no mutation control is
 * copied onto the Corporate page.
 */
export function OperateLinks({ links, from, title = 'Operate — existing operational surfaces' }: { links: readonly OperateLink[]; from: CorporatePlaneId; title?: string }) {
  if (links.length === 0) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white" data-testid="operate-links">
      <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">{title}</p>
      <ul className="divide-y divide-slate-100">
        {links.map((l) => {
          const cross = l.plane !== from
          return (
            <li key={`${l.route}-${l.label}`}>
              <Link
                to={l.route}
                className="group flex min-h-[44px] items-start justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-500"
                data-testid="operate-link"
                data-cross-plane={cross ? 'true' : 'false'}
                data-destination-plane={l.plane}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{l.label}</span>
                  <span className="block text-xs text-slate-500">{l.description}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {cross ? 'Leaves ' : 'Stays in '}{CORPORATE_PLANES[from].label}
                    {cross ? ` → opens in ${CORPORATE_PLANES[l.plane].label}` : ''} · current operational Admin
                  </span>
                </span>
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-700" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A short governed statement panel (e.g. "Corporate accounting system of record not yet established."). */
export function StatementPanel({ children, tone = 'neutral', testId }: { children: React.ReactNode; tone?: 'neutral' | 'blocked'; testId?: string }) {
  return (
    <div
      className={cn('rounded-md border px-4 py-3 text-sm', tone === 'blocked' ? 'border-slate-300 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white text-slate-700')}
      data-testid={testId}
    >
      {children}
    </div>
  )
}
