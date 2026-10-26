/**
 * T11-CAP-LR01-R2 — how the customer's Car Arrival Progress page WORDS what the Journey composes.
 *
 * Pure functions, no network, no layout. The page is a view over the projection: it records nothing and decides nothing, and every sentence here
 * keeps three things apart that the product exists to keep apart —
 *   · what the SOURCE reported ("Completed" is the sender's statement about its own work),
 *   · what CarUp itself recorded or observed, and
 *   · what is simply not recorded (which is never "nothing has happened").
 * Nothing in this file names a source, a vehicle, a carrier or a port: where a source is named, the name arrives in the data.
 */
import type {
  CapOrigin, Journey, JourneyParty, JourneyProgress, JourneyProgressGroup, JourneySpecItem,
} from '@/hooks/useTradeLogisticsApi'

/** Who stands behind a record, in words. The source's name is data (`source_label`); this code never supplies one. */
export function originLabel(origin: CapOrigin | string, sourceLabel?: string | null): string {
  if (origin === 'carup') return 'Recorded by CarUp'
  if (origin === 'owner_declared') return 'Declared by you'
  // The projection's own fallback for a record that carries no source name is the words "an external record", so the sentence reads the same either way.
  const who = (sourceLabel || '').trim()
  return `Reported by ${who || 'an external record'}`
}

/** A party's lines in the order a postal label reads. Anything not recorded is simply absent — never "Unknown". */
export function partyLines(p: Pick<JourneyParty, 'address' | 'city' | 'country' | 'phone' | 'email'>): string[] {
  const place = [p.city, p.country].filter((v) => v && String(v).trim()).join(', ')
  return [p.address, place || null, p.phone, p.email].map((v) => (v && String(v).trim() ? String(v).trim() : null)).filter((v): v is string => v !== null)
}

const STATE_BADGE: Record<string, { label: string; tone: string }> = {
  reported_completed: { label: 'Completed (reported)', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  reported_in_progress: { label: 'In progress (reported)', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  carup_recorded: { label: 'Recorded by CarUp', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  reported_to_carup: { label: 'Reported to CarUp', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  not_recorded: { label: 'Nothing recorded', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
}

/** A stage's badge. A state this page does not know is said to be unknown — never defaulted to "completed" or to "not started". */
export function progressStateBadge(state: string | null | undefined): { label: string; tone: string } {
  return (state && STATE_BADGE[state]) || { label: 'Status not recognised', tone: 'border-slate-300 bg-slate-50 text-slate-700' }
}

/** A single step's chip. "Completed" on a reported step is the sender's word, and is worded as such by the badge, the note and the source line. */
export function progressRowTone(status: string | null | undefined): string {
  switch (status) {
    case 'completed': return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'recorded': return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'in_progress': case 'pending': case 'reported': case 'supplied': case 'document_received': return 'border-sky-300 bg-sky-50 text-sky-900'
    case 'cancelled': return 'border-red-300 bg-red-50 text-red-900'
    default: return 'border-slate-300 bg-slate-50 text-slate-700'
  }
}

type SummarySource = Pick<Journey, 'state'> & { sections?: { progress?: JourneyProgress } }

/**
 * The headline at the top of the page when a sender has REPORTED progress. A shipment that CarUp's own record shows as "set up — nothing moving yet" is
 * not a journey that "hasn't started" if the sender reports every step as completed; and the sender's report is not CarUp's observation. So both are
 * said, side by side, each attributed: this headline is the sender's, and the page then prints CarUp's own movement sentence beneath it, verbatim.
 * Null when nothing was reported — the page then says only what CarUp's own record says.
 */
export function reportedProgressSummary(journey: SummarySource): { badge: string; sentence: string } | null {
  const progress = journey.sections?.progress
  if (!progress || progress.availability !== 'composed' || progress.totals.reported_rows <= 0) return null
  const groups = progress.groups
  const total = groups.length
  const complete = groups.filter((g) => g.state === 'reported_completed').length
  const reporter = progress.sources.find((s) => s.origin === 'external_report')?.source_label
  const who = reporter && reporter !== 'an external record' ? reporter : 'The source of this record'
  const badge = complete === total ? `All ${total} steps reported complete` : `${complete} of ${total} steps reported complete`
  const sentence = complete === total
    ? `${who} reports every step of this journey as completed: ${groups.map((g) => g.title).join(', ')}. That is the sender's report; it is not CarUp's own observation of the vessel or the cargo.`
    : `${who} reports ${complete} of ${total} steps as completed. That is the sender's report; it is not CarUp's own observation of the vessel or the cargo.`
  return { badge, sentence }
}

/** The text of a progress row's time. A time the source did not supply is said not to have been supplied. */
export function progressTimeText(row: { time: { value: string } | null; time_note: string | null }, format: (iso: string) => string): string {
  return row.time ? format(row.time.value) : (row.time_note || 'No date recorded')
}

/** Counts for a stage heading: "7 steps reported". CarUp's own steps are counted separately so the two are never summed into one claim. */
export function progressGroupCounts(group: Pick<JourneyProgressGroup, 'reported_count' | 'carup_count'>): string {
  const plural = (n: number) => (n === 1 ? '1 step' : `${n} steps`)
  const parts = [group.reported_count ? `${plural(group.reported_count)} reported` : null, group.carup_count ? `${plural(group.carup_count)} recorded by CarUp` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'No steps recorded'
}

/**
 * Which specification rows to draw, in the order the projection sent them, with the marker that says "as recorded, not independently verified".
 * An item the projection flagged `reported` carries the marker; one it did not is CarUp-verified (or a vehicle record under a verified passport).
 */
export function specRows(items: JourneySpecItem[] | undefined): Array<JourneySpecItem & { marker: boolean }> {
  return (items || []).map((item) => ({ ...item, marker: item.reported === true }))
}

/** Document labels for the customer. T8's display name is used when present; the type code is never shown as a label. */
export function documentActionLabel(displayName: string | null | undefined, kind: 'view' | 'download'): string {
  const name = (displayName || '').trim() || 'document'
  return kind === 'view' ? `View ${name}` : `Download ${name}`
}
