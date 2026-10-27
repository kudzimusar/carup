import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'
import type { WorkspaceCrumb } from './workspaceModel'
import { WS_STYLE } from './workspaceStyles'

/**
 * Where this page sits: `Trade & Imports / Import Orders / 2018 Honda Vezel / Import journey`.
 *
 * The last crumb is the page itself: plain text marked `aria-current="page"`, never a link (so it
 * is not announced as a dimmed link). Every earlier crumb that has an `href` is a real, enabled
 * link; one without an `href` is shown as text, so a trail can never offer a step the caller was
 * not allowed to link to — the audit's rule that breadcrumbs obey the page's own authorization.
 * The trail wraps rather than truncates: a vehicle or frame identifier is never clipped.
 */
export function WorkspaceBreadcrumbs({
  items,
  tone = 'light',
  className,
}: {
  items: WorkspaceCrumb[]
  tone?: 'light' | 'dark'
  className?: string
}) {
  if (!items.length) return null
  const dark = tone === 'dark'
  const last = items.length - 1

  return (
    <Breadcrumb aria-label="Breadcrumb" data-testid="workspace-breadcrumbs" className={className}>
      <BreadcrumbList
        className={cn(
          'gap-x-2 gap-y-0 text-[10px] font-black uppercase leading-4 tracking-[0.16em] sm:gap-x-2.5',
          // AA (4.5:1) on the surfaces these sit on: slate-600 on white/gray-50, slate-400 on the dark shell.
          dark ? 'text-slate-400' : 'text-slate-600',
        )}
      >
        {items.map((crumb, index) => {
          const isLast = index === last
          return (
            // The shadcn separator is itself an <li>, so it is a sibling of the item, never a child.
            <Fragment key={`${index}-${crumb.label}`}>
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  <span
                    aria-current="page"
                    data-testid="workspace-crumb-current"
                    className={cn('inline-flex min-h-9 items-center break-words font-black', dark ? 'text-white' : 'text-slate-950')}
                  >
                    {crumb.label}
                  </span>
                ) : !crumb.href ? (
                  // An ancestor the caller was not allowed (or had no page) to link to: text, never a dead link.
                  <span className="inline-flex min-h-9 items-center break-words" data-testid="workspace-crumb-text">
                    {crumb.label}
                  </span>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      to={crumb.href}
                      className={cn(
                        'inline-flex min-h-9 items-center break-words',
                        dark ? 'hover:text-orange-400' : 'hover:text-orange-700',
                        WS_STYLE.focus,
                      )}
                    >
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator className="text-slate-300">/</BreadcrumbSeparator>}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
