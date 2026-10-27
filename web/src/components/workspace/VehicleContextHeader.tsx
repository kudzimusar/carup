import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { WS_STYLE } from './workspaceStyles'

/**
 * "What am I working on?" for a page that is ABOUT a vehicle but is not the Passport itself — an
 * import order, its documents, its shipment, the import journey. The vehicle is named once, the
 * same way everywhere, and the way to its Passport is an explicit link.
 *
 * The caller decides whether the viewer may open the Passport and passes `passportHref` only then:
 * this component never infers ownership, so a participant who is not the owner is shown the title
 * the page was authorised to show and no link. The frame / VIN wraps; it is never truncated.
 */
export function VehicleContextHeader({
  title,
  identifier,
  detail,
  passportHref,
  passportLabel = 'View Vehicle Passport',
  thumbnail,
  children,
  className,
}: {
  title: string
  /** VIN / frame number, printed in full. */
  identifier?: string | null
  /** A line of real facts (route, colour…). Omit rather than pad. */
  detail?: string | null
  passportHref?: string | null
  passportLabel?: string
  thumbnail?: ReactNode
  /** Anything that belongs beside the identity, e.g. capability chips. */
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label="Vehicle"
      data-testid="vehicle-context"
      className={cn('flex flex-col gap-4 border-y border-slate-200 py-5 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="flex min-w-0 items-center gap-4">
        {thumbnail ? <div className="h-16 w-24 shrink-0 overflow-hidden bg-slate-100">{thumbnail}</div> : null}
        <div className="min-w-0">
          <p className={WS_STYLE.eyebrowQuiet}>Vehicle</p>
          <h2 className={cn('mt-1 text-xl sm:text-2xl', WS_STYLE.display)} data-testid="vehicle-context-title">{title}</h2>
          {identifier ? (
            <p className="mt-1 break-all font-mono text-xs text-slate-500" data-testid="vehicle-context-identifier">{identifier}</p>
          ) : null}
          {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
          {children}
        </div>
      </div>
      {passportHref ? (
        <Link
          to={passportHref}
          data-testid="vehicle-context-passport-link"
          className={cn(WS_STYLE.secondaryAction, 'shrink-0 justify-center', WS_STYLE.focus)}
        >
          {passportLabel}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  )
}
