/**
 * Trade OS T9 — how warehouse facts are allowed to be worded on screen.
 *
 * A pure module, deliberately. Two reasons: `react-refresh/only-export-components` means a component
 * file may export nothing else, and — more importantly — these sentences are the part of T9 that a
 * customer actually reads. They are worth testing on their own, without rendering anything.
 *
 * The rules encoded here:
 *
 *   · unknown is written as unknown, never as 0 and never as a dash that reads like a zero;
 *   · a difference is stated as a difference and never as a cost;
 *   · warehouse vocabulary ("CONDITIONALLY_RECEIVED") is translated into what actually happened;
 *   · nothing may be said that belongs to a later phase — no "ready to load", no "shipped".
 */
import type { WarehouseActual, WarehouseDiscrepancy, WarehouseEstimate } from '@/hooks/useTradeLogisticsApi'

/** The four states an intake can be in, in the words a person would use. */
export const INTAKE_STATUS_UI: Record<string, { label: string; tone: string }> = {
  EXPECTED: { label: 'Expected — not arrived', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  RECEIVED: { label: 'Received', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  CONDITIONALLY_RECEIVED: { label: 'Received with a note', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  REFUSED: { label: 'Not taken in', tone: 'border-red-300 bg-red-50 text-red-900' },
}

/**
 * The receiver's bounded vocabulary, in plain words.
 *
 * "unverifiable" is the interesting one: it means the receiver could not tell, which is a real and
 * useful thing to record — and quite different from "fine".
 */
export const CONDITION_UI: Record<string, { label: string; detail: string }> = {
  good: { label: 'No problems noted', detail: 'The person receiving it did not see anything wrong.' },
  minor_damage: { label: 'Minor damage noted', detail: 'The person receiving it saw some damage.' },
  major_damage: { label: 'Major damage noted', detail: 'The person receiving it saw significant damage.' },
  incomplete: { label: 'Something appeared missing', detail: 'The person receiving it thought part of the consignment was not there.' },
  unverifiable: { label: 'Could not be checked', detail: 'The person receiving it was not able to tell what condition it was in.' },
}

export const CONDITION_OPTIONS = Object.keys(CONDITION_UI)

export const SUBJECT_LABEL: Record<string, string> = {
  cargo_reservation: 'container booking',
  logistics_request: 'shipping request',
}

/**
 * A volume, or the honest absence of one.
 *
 * `null` never becomes "0.000 CBM". A reader who sees a number believes somebody measured it.
 */
export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Not known'
  return `${Number(value).toFixed(3)} CBM`
}

export function formatWeight(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Not known'
  return `${Number(value).toFixed(unit === 't' ? 3 : 1)} ${unit || 'kg'}`
}

export function formatDimensions(actual: WarehouseActual | null): string {
  if (!actual || actual.length_value === null || actual.width_value === null || actual.height_value === null) return 'Not measured'
  return `${actual.length_value} × ${actual.width_value} × ${actual.height_value} ${actual.dimension_unit}`
}

/**
 * What the estimate line should say, including how complete it is.
 *
 * A partial estimate is the case that most needs words rather than a number: "3.0 CBM" beside
 * "two items nobody measured" is the difference between an estimate and a guess.
 */
export function describeEstimate(estimate: WarehouseEstimate): { headline: string; caveat: string | null } {
  if (estimate.completeness === 'UNKNOWN') {
    return { headline: 'No volume was estimated', caveat: 'Nothing was stated for this cargo, so there is nothing to compare a measurement against.' }
  }
  const headline = formatVolume(estimate.volume_cbm)
  if (estimate.completeness === 'PARTIAL') {
    const missing = estimate.items_total - estimate.items_with_volume
    return {
      headline: `At least ${headline}`,
      caveat: `${missing} of ${estimate.items_total} cargo items had no stated volume, so this is a floor rather than a total.`,
    }
  }
  return { headline, caveat: null }
}

/**
 * The difference, said as a difference.
 *
 * There is no branch of this function that produces an amount of money. That is the whole point of
 * §10: T9 may say the cargo is 0.8 CBM larger; only a T6 commercial action can say it costs anything.
 */
export function describeDiscrepancy(d: WarehouseDiscrepancy): { headline: string; detail: string; tone: 'neutral' | 'attention' } {
  if (d.status === 'NOT_MEASURED') {
    return { headline: 'Not measured yet', detail: 'The warehouse has not measured this cargo, so there is nothing to compare.', tone: 'neutral' }
  }
  if (d.status === 'NOT_COMPARABLE') {
    return { headline: 'Cannot be compared', detail: d.reason || 'There is no complete estimate to compare the measurement against.', tone: 'neutral' }
  }
  if (d.status === 'MATCHES') {
    return { headline: 'Matches the estimate', detail: 'What the warehouse measured is the same as what was booked.', tone: 'neutral' }
  }
  const parts: string[] = []
  if (d.volume && d.volume.direction !== 'SAME') {
    const sign = d.volume.difference_cbm > 0 ? '+' : ''
    parts.push(`${sign}${d.volume.difference_cbm.toFixed(3)} CBM against an estimate of ${d.volume.estimated_cbm.toFixed(3)}`)
  }
  if (d.weight && d.weight.direction !== 'SAME') {
    const sign = d.weight.difference_kg > 0 ? '+' : ''
    parts.push(`${sign}${d.weight.difference_kg.toFixed(1)} kg against an estimate of ${d.weight.estimated_kg.toFixed(1)} kg`)
  }
  return {
    headline: d.volume?.direction === 'LARGER' ? 'Larger than estimated' : d.volume?.direction === 'SMALLER' ? 'Smaller than estimated' : 'Differs from the estimate',
    detail: parts.join(' · '),
    tone: 'attention',
  }
}

/** A short human reference from an id, matching the server's own shortening. */
export const shortRef = (id: string): string => String(id).replace(/-/g, '').slice(0, 8).toUpperCase()

export const shortDate = (iso: string | null | undefined): string =>
  (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded')
