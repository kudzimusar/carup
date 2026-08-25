/**
 * Reading the governed location claim — Issue #164 Phase 8, Cluster B.
 *
 * ## Why this exists
 *
 * Phase 8 made location a CLAIM: the passport publishes `claims.location.{city,province,country}`,
 * each a `{value, state, source}` leaf. It is deliberately NOT a column on the vehicle projection —
 * `PUBLIC_VEHICLE_FIELDS` names no location column, so `vehicle.location` and `vehicle.province` are
 * `undefined` for every caller, anonymous or owner.
 *
 * Vehicle Detail never got the memo. It kept reading `d.location` / `d.province`, so it rendered
 * "Location not recorded" for Golden A while the very same response carried
 * `Bulawayo / Bulawayo Metropolitan / Zimbabwe` with `operator_recorded` provenance — and while
 * Landing and Marketplace, which read the composed summary field, printed the full line. One VIN,
 * three surfaces, two answers. That is the convergence defect this programme exists to close.
 *
 * This mirrors `composeLocationLabel` / `deriveLocationState` in
 * `backend/services/marketplace/listingSummaryService.js`. It is a READER, not a second authority:
 * it joins the leaves the server already marked recorded and invents nothing. The backend keeps
 * composing the marketplace summary line server-side; the passport publishes sealed claims instead,
 * because appending a flat `location` string beside a stated pair is exactly what `findBareClaims`
 * (INV-2) exists to prevent.
 */

export const LOCATION_STATES = {
  RECORDED: 'recorded',
  NOT_RECORDED: 'not_recorded',
  WITHHELD: 'withheld',
  NOT_APPLICABLE: 'not_applicable',
} as const

export type LocationState = (typeof LOCATION_STATES)[keyof typeof LOCATION_STATES]

export type ClaimLeaf = { value?: unknown; state?: unknown; source?: unknown } | null | undefined

export type LocationClaim = {
  city?: ClaimLeaf
  province?: ClaimLeaf
  country?: ClaimLeaf
} | null | undefined

function recordedText(leaf: ClaimLeaf): string | null {
  if (!leaf || typeof leaf !== 'object') return null
  if ((leaf as { state?: unknown }).state !== LOCATION_STATES.RECORDED) return null
  const value = (leaf as { value?: unknown }).value
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

/**
 * The one-line location a surface prints, assembled from the RECORDED parts only, or null.
 *
 * There is no fallback — not the registration country, not the seller's profile, not a country
 * literal. A listing with a recorded city and an unrecorded country reads "Harare" and stops there,
 * which is the whole of what is known.
 */
export function composeGovernedLocation(claim: LocationClaim): string | null {
  const parts = [claim?.city, claim?.province, claim?.country]
    .map(recordedText)
    .filter((part): part is string => !!part)
  return parts.length ? parts.join(', ') : null
}

/**
 * One state for the composed line. `withheld` outranks `not_recorded` for the same reason it does on
 * a single field: collapsing them would make "we hold nothing" and "you may not see it" render
 * identically, and absence would start reading as proof.
 */
export function deriveGovernedLocationState(claim: LocationClaim): LocationState {
  const leaves = [claim?.city, claim?.province, claim?.country]
  const stateOf = (leaf: ClaimLeaf) => (leaf && typeof leaf === 'object' ? (leaf as { state?: unknown }).state : undefined)
  if (leaves.some((leaf) => stateOf(leaf) === LOCATION_STATES.RECORDED)) return LOCATION_STATES.RECORDED
  if (leaves.some((leaf) => stateOf(leaf) === LOCATION_STATES.WITHHELD)) return LOCATION_STATES.WITHHELD
  return LOCATION_STATES.NOT_RECORDED
}

/**
 * The exact words each state gets. Every public surface uses these, because the first physical UAT
 * found the SAME governed absence rendered three different ways — Marketplace said "Location
 * unknown", Detail and Search said "Location not recorded", and Landing suppressed the row entirely
 * so an absent location was silent. Silence is the one rendering that lets absence read as proof.
 */
export const LOCATION_LABELS: Record<LocationState, string> = {
  [LOCATION_STATES.RECORDED]: '',
  [LOCATION_STATES.NOT_RECORDED]: 'Location not recorded',
  [LOCATION_STATES.WITHHELD]: 'Location withheld',
  [LOCATION_STATES.NOT_APPLICABLE]: 'Location not applicable',
}

/**
 * The single call a surface makes: the governed line, or the words for why there isn't one.
 *
 * `label` is always safe to render. `isRecorded` lets a surface style a real location differently
 * from a stated absence without re-deriving the rule.
 */
export function governedLocationLine(claim: LocationClaim): { label: string; isRecorded: boolean } {
  const composed = composeGovernedLocation(claim)
  if (composed) return { label: composed, isRecorded: true }
  return { label: LOCATION_LABELS[deriveGovernedLocationState(claim)], isRecorded: false }
}

/**
 * The same reader for a marketplace SUMMARY row, where the server already composed the line and
 * published its state alongside. Surfaces call this so a summary and a passport cannot drift apart.
 */
export function summaryLocationLine(
  location: unknown,
  locationState: unknown,
): { label: string; isRecorded: boolean } {
  const text = typeof location === 'string' ? location.trim() : ''
  if (text && locationState === LOCATION_STATES.RECORDED) return { label: text, isRecorded: true }
  const state = (typeof locationState === 'string'
    && (Object.values(LOCATION_STATES) as string[]).includes(locationState))
    ? locationState as LocationState
    : LOCATION_STATES.NOT_RECORDED
  return { label: LOCATION_LABELS[state], isRecorded: false }
}
