import { Bell } from 'lucide-react'
import type { JourneyImportantUpdate } from '@/hooks/useTradeLogisticsApi'
import { when } from '../journeyDisplay'
import { originLabel } from '../capDisplay'

/**
 * §23.1 — the current meaningful update, where a REAL record exists. When none does, nothing is drawn: this page never manufactures an update, and
 * "there is nothing to say" is not an item.
 */
export function ImportantUpdate({ update }: { update: JourneyImportantUpdate | undefined }) {
  if (!update || update.availability !== 'composed') return null
  return (
    <section id="cap-important-update" aria-labelledby="cap-important-update-heading" className="mt-5 min-w-0 rounded-xl border border-orange-200 bg-orange-50 p-4 sm:p-5" data-testid="cap-important-update">
      <h2 id="cap-important-update-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-800">
        <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Latest update
      </h2>
      <p className="mt-2 min-w-0 break-words text-base font-semibold text-slate-950" data-testid="cap-important-update-title">{update.title}</p>
      {update.detail ? <p className="mt-1 min-w-0 break-words text-sm text-slate-700" data-testid="cap-important-update-detail">{update.detail}</p> : null}
      <p className="mt-2 min-w-0 break-words text-xs text-slate-700" data-testid="cap-important-update-source">
        {originLabel(update.origin, update.source_label)}{update.as_of ? ` · ${update.origin === 'carup' ? '' : 'as of '}${when(update.as_of)}` : ''}
      </p>
    </section>
  )
}
