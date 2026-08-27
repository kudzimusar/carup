/**
 * CarUp Intelligence 1.0 — I7 display contract for the web.
 *
 * The backend never returns a bare number. Every metric arrives inside an
 * availability envelope, and this module is the ONLY place that unwraps one, so a
 * surface cannot accidentally render "unavailable" as 0 — the fake-zero defect
 * catalogued across a dozen existing CarUp dashboards in the I0 audit.
 *
 * The rule these helpers encode: a value is shown only when the backend says
 * `value`. Everything else becomes words that mean what they say.
 */

export type Availability = 'value' | 'insufficient_data' | 'unavailable' | 'not_applicable'

export interface MetricEnvelope {
  availability: Availability
  value: number | null
  unit?: string
  reason?: string | null
  basis?: string
  capped?: boolean
  note?: string
}

export interface IntelligenceEnvelope {
  ok?: boolean
  availability?: Availability
  reason?: string | null
  message?: string
  calculation_version?: string
  as_of?: string | null
  window_days?: number
  listings_owned?: number
  metrics?: Record<string, MetricEnvelope>
  conversion?: Record<string, MetricEnvelope>
  coverage?: { days_with_data: number; days_requested: number }
  completeness?: ListingCompleteness
  lost_opportunity?: LostOpportunity
  next_best_actions?: NextBestAction[]
}

export interface ListingCompleteness {
  calculation_version: string
  percent: number
  earned_points: number
  total_points: number
  groups: Array<{
    key: string; label: string; weight: number; earned: number
    complete: boolean; missing_fields: string[]; guidance: string | null
  }>
  not_measurable: Array<{ key: string; label: string; reason: string; detail: string }>
  media_facts?: { image_count: number; has_primary: boolean }
  displayed_separately: {
    trust: { state: string; band: string | null; score: number | null }
    transaction_readiness: { safe_pay_ready: boolean; inspection_ready: boolean; publication_status: string | null }
  }
}

export interface LostOpportunity {
  calculation_version: string
  total_missed_searches: number
  dimensions: Array<{ filter: string; missing_field: string; missed_searches: number; message: string }>
  not_yet_measurable: Array<{ filter: string; reason: string; detail: string }>
  searches_considered: number
}

export interface NextBestAction {
  priority: 'high' | 'medium'
  basis: string
  action: string
  evidence: Record<string, unknown>
  message: string | null
}

/** Wording for each non-value state. Deliberately plain: no metric-speak. */
const UNAVAILABLE_TEXT: Record<Exclude<Availability, 'value'>, string> = {
  insufficient_data: 'Not enough activity yet',
  unavailable: 'Not available',
  not_applicable: 'Not applicable',
}

/**
 * Render a metric for display.
 *
 * Returns the formatted number ONLY for `value`. A missing envelope is treated as
 * unavailable rather than as zero — an absent metric is a thing we did not
 * measure, never a thing that did not happen.
 */
export function displayMetric(metric?: MetricEnvelope | null): string {
  if (!metric || metric.availability !== 'value' || metric.value === null || metric.value === undefined) {
    const state = (metric?.availability ?? 'unavailable') as Availability
    return state === 'value' ? UNAVAILABLE_TEXT.unavailable : UNAVAILABLE_TEXT[state as Exclude<Availability, 'value'>]
  }
  if (metric.unit === 'percent') return `${metric.value}%`
  return metric.value.toLocaleString()
}

/** True only when a real measured number is available to show. */
export function hasValue(metric?: MetricEnvelope | null): boolean {
  return Boolean(metric && metric.availability === 'value' && metric.value !== null && metric.value !== undefined)
}

/**
 * A short qualifier that keeps a number honest — the peak-day basis for a window
 * unique, or the fact that a ratio was capped. Both are cases where the bare
 * number would imply more than CarUp actually knows.
 */
export function metricQualifier(metric?: MetricEnvelope | null): string | null {
  if (!metric || metric.availability !== 'value') return null
  if (metric.basis === 'peak_day') return 'busiest day in this period'
  if (metric.capped) return metric.note || 'Some activity arrived through a channel that skips this step'
  return null
}

/** Whether the whole payload carries readable intelligence at all. */
export function envelopeIsReadable(payload?: IntelligenceEnvelope | null): boolean {
  return Boolean(payload && payload.availability === 'value' && payload.metrics)
}

/**
 * The message to show when a payload carries no metrics.
 *
 * Distinguishes "we could not read this" from "you have nothing listed yet" —
 * they call for completely different actions from the seller, and collapsing them
 * into one empty state is how a broken read starts looking like a quiet market.
 */
export function envelopeMessage(payload?: IntelligenceEnvelope | null): string {
  if (!payload) return 'Intelligence could not be loaded. These figures are NOT zero.'
  if (payload.message) return payload.message
  if (payload.availability === 'unavailable') {
    return 'Intelligence for this period could not be read. These figures are NOT zero.'
  }
  if (payload.availability === 'not_applicable') return 'Not applicable yet.'
  return 'No intelligence available for this period.'
}

/** "as of 09:00 today" — so a stale rollup is visible rather than implied fresh. */
export function formatAsOf(asOf?: string | null): string | null {
  if (!asOf) return null
  const parsed = new Date(asOf)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Coverage sentence, shown only when the window is partially measured.
 *
 * An honest zero and a gap in measurement look identical on a chart, so the gap
 * is stated in words instead.
 */
export function coverageNote(payload?: IntelligenceEnvelope | null): string | null {
  const coverage = payload?.coverage
  if (!coverage || coverage.days_requested <= 0) return null
  if (coverage.days_with_data >= coverage.days_requested) return null
  return `Measured on ${coverage.days_with_data} of the last ${coverage.days_requested} days.`
}

/**
 * Trust for display. `not_evaluated` and `unavailable` are distinct states and
 * neither may render as a number or as a low score.
 */
export function displayTrust(trust?: ListingCompleteness['displayed_separately']['trust'] | null): string {
  if (!trust) return 'Not evaluated'
  switch (trust.state) {
    case 'evaluated':
      return trust.score !== null && trust.score !== undefined
        ? `${trust.score}${trust.band ? ` · ${trust.band}` : ''}`
        : 'Evaluated'
    case 'stale': return 'Evaluation out of date'
    case 'unavailable': return 'Evaluation unavailable'
    default: return 'Not evaluated'
  }
}
