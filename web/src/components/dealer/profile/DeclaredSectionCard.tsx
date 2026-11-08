import { useId, useState, type ComponentType } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { declaredFieldLabel } from './dealerProfileLabels'

/** Values longer than this are clamped to three lines until the reader asks for the rest. */
const LONG_VALUE = 140

/**
 * One dealer-declared storefront section (e.g. Buyer assurance) as a compact card. Every value is
 * always in the DOM — "Read more" only lifts the visual line clamp — so nothing reviewed for display
 * is hidden from search, assistive technology or print.
 */
export function DeclaredSectionCard({
  title,
  icon: Icon,
  fields,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  fields: Record<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const entries = Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.trim())
  const clampable = entries.length > 0 && entries.some(([, value]) => value.length > LONG_VALUE)
  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="min-w-0 text-base font-bold text-slate-950 [overflow-wrap:anywhere]">{title}</h3>
      </div>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No details are published for this section.</p>
      ) : (
        <dl id={bodyId} className="mt-4 space-y-3">
          {entries.map(([field, value]) => (
            <div key={field} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{declaredFieldLabel(field)}</dt>
              <dd
                className={cn(
                  'mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]',
                  !expanded && clampable && 'line-clamp-3',
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {clampable && (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 self-start rounded-md text-sm font-semibold text-orange-700 hover:text-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
        </button>
      )}
    </article>
  )
}
