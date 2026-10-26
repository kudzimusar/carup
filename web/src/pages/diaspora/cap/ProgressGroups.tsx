import { ListChecks } from 'lucide-react'
import type { JourneyProgress } from '@/hooks/useTradeLogisticsApi'
import { originLabel, progressGroupCounts, progressRowTone, progressStateBadge, progressTimeText } from '../capDisplay'
import { when } from '../journeyDisplay'
import { CapSection, Unshown } from './ui'

/**
 * §23.8 — the five stages with the real action rows under each.
 *
 * One shape draws both origins: a row the sender REPORTED and a row CarUp itself RECORDED. They are told apart by their words, never by a hidden
 * format — "Completed" on a reported row is the sender's statement about its own work (the note says so), and a time the source never supplied is
 * said to be unsupplied. A stage with no rows is "Nothing recorded", which is not "not started".
 */
export function ProgressGroups({ progress }: { progress: JourneyProgress | undefined }) {
  if (!progress) return null
  const icon = <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (progress.availability !== 'composed') {
    return <CapSection id="cap-progress" title="Progress" icon={icon}><Unshown availability={progress.availability} note={progress.note} testId="cap-progress-unshown" /></CapSection>
  }
  return (
    <CapSection id="cap-progress" title="Progress" icon={icon}>
      <ol className="mt-3 space-y-4">
        {progress.groups.map((g) => {
          const badge = progressStateBadge(g.state)
          return (
            <li key={g.code} className="min-w-0 rounded-lg border border-slate-200 p-3 sm:p-4" data-testid={`cap-progress-${g.code}`}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 break-words text-base font-semibold text-slate-900">{g.title}</h3>
                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.tone}`} data-testid={`cap-progress-state-${g.code}`}>{badge.label}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{progressGroupCounts(g)}</p>
              {g.rows.length ? (
                <ul className="mt-3 divide-y divide-slate-100">
                  {g.rows.map((r) => (
                    <li key={`${r.origin}-${r.sequence}`} className="min-w-0 py-2.5 first:pt-0 last:pb-0" data-testid={`cap-progress-row-${g.code}-${r.origin}-${r.sequence}`}>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 break-words text-sm text-slate-900">
                          <span className="font-semibold">{r.action_taker.display_label}</span>
                          <span className="text-slate-500"> — </span>{r.text}
                        </p>
                        <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${progressRowTone(r.status)}`}>{r.status_label}</span>
                      </div>
                      <p className="mt-0.5 min-w-0 break-words text-xs text-slate-500">
                        {progressTimeText(r, when)} · {originLabel(r.origin, r.source_label)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 min-w-0 break-words text-sm text-slate-600" data-testid={`cap-progress-empty-${g.code}`}>Nothing has been recorded for this stage. That does not mean it has not happened.</p>
              )}
            </li>
          )
        })}
      </ol>
      {progress.sources.length ? (
        <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-progress-sources">
          {progress.sources.map((s) => `${originLabel(s.origin, s.source_label)}${s.observed_at ? `, as of ${when(s.observed_at)}` : ''} (${s.row_count} ${s.row_count === 1 ? 'step' : 'steps'})`).join(' · ')}
        </p>
      ) : null}
      <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="cap-progress-note">{progress.note}</p>
    </CapSection>
  )
}
