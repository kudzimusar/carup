/**
 * RX06-LR05 — what an external party REPORTS about a journey, summarised plainly and kept apart from CarUp's own
 * record: how many stages it reports complete (and which), who reports it (as the data names them), as of when, and
 * how many of its steps carry no date. Used by Journey & arrival and by the Vehicle Passport's "Trade & imports" card,
 * so both say it the same way. Pure: no network, no layout.
 */
import type { JourneyProgress } from './journeyTypes'

export interface ReportedSummary {
  /** Stages the reporter marks complete, out of all stages. */
  complete: number
  total: number
  completedTitles: string[]
  /** The reporter's name as the data carries it; null when the data names no one. */
  source: string | null
  /** Sentence-start form of the reporter: the name, or "An external record" (never an invented "exporter"). */
  sourceSentence: string
  /** When the report was observed, if the data says. */
  asOf: string | null
  /** Reported steps (CarUp's own steps are not counted here), and how many of them carry no date. */
  rows: number
  undated: number
}

const UNNAMED = 'an external record'

export function reportedSummary(progress: JourneyProgress | undefined): ReportedSummary | null {
  if (!progress || progress.availability !== 'composed' || progress.totals.reported_rows <= 0) return null
  const completed = progress.groups.filter(g => g.state === 'reported_completed')
  const external = progress.sources.find(s => s.origin === 'external_report')
  const name = (external?.source_label || '').trim()
  const source = name && name.toLowerCase() !== UNNAMED ? name : null
  const reportedRows = progress.groups.flatMap(g => g.rows.filter(r => r.origin !== 'carup'))
  return {
    complete: completed.length,
    total: progress.groups.length,
    completedTitles: completed.map(g => g.title),
    source,
    sourceSentence: source ?? 'An external record',
    asOf: external?.observed_at ?? null,
    rows: reportedRows.length,
    undated: reportedRows.filter(r => !r.time).length,
  }
}

/** The one line a summary card shows: what is reported, and that CarUp has not confirmed it. */
export function reportedLine(summary: ReportedSummary | null): string | null {
  if (!summary) return null
  return `${summary.sourceSentence} reports ${summary.complete} of ${summary.total} stages complete. CarUp has not confirmed them.`
}
