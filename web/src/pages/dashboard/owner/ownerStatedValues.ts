/**
 * Owner-surface stated-value helpers — Issue #164 Phase 4.
 *
 * Extracted from OwnerDashboard.tsx so that page exports only its component: a module that mixes
 * components with other exports breaks react-refresh, and the repo's lint-regression gate blocks it.
 * The shared home is also the honest one — OwnerDashboard, MyGarage, MyListings and SavedCars are
 * the same surface in different layouts, and a per-page copy of "what a trust claim is" is how they
 * drifted apart before. All four are statically imported by App.tsx into one bundle, so the shared
 * import adds no chunk.
 */

export type OwnerTrustClaim = {
  /** A number ONLY in the `evaluated` state. Null everywhere else, and null never becomes 0. */
  score: number | null
  state: string
  headline: string
}

/** Band vocabulary, verbatim from the authority. No 'Excellent'/'Good'/'Fair' tier is invented. */
const TRUST_BAND_LABELS: Record<string, string> = {
  high: 'High trust',
  moderate: 'Moderate trust',
  low: 'Low trust',
  insufficient_evidence: 'Insufficient evidence',
}

const TRUST_STATE_LABELS: Record<string, string> = {
  evaluated: 'Evaluated',
  stale: 'Assessment out of date',
  not_evaluated: 'Not evaluated',
  unavailable: 'Trust assessment unavailable',
}

/**
 * Narrowing only. Nothing here computes a score, applies a threshold, or lets another field on the
 * row stand in for one — in particular the row's own `trust_score`, which is what these pages read
 * before and which no page may read again.
 */
export function readOwnerTrustClaim(row: unknown): OwnerTrustClaim {
  const raw = (row as { trust?: unknown } | null | undefined)?.trust
  const trust = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const state = typeof trust?.evaluation_state === 'string' ? trust.evaluation_state : 'unavailable'
  // Fails closed. A score arriving under a stale or not_evaluated state is still not printed, so a
  // route that ever published an ungoverned number shows the lifecycle state instead of the number.
  const score = state === 'evaluated' && typeof trust?.score === 'number' && Number.isFinite(trust.score)
    ? (trust.score as number)
    : null
  const band = typeof trust?.band === 'string' ? trust.band : null
  const headline = score !== null
    ? (TRUST_BAND_LABELS[band ?? ''] ?? band ?? TRUST_STATE_LABELS.evaluated)
    : (TRUST_STATE_LABELS[state] ?? TRUST_STATE_LABELS.unavailable)
  return { score, state, headline }
}

/**
 * A recorded 0 is a fact — Phase 1's FIELD_STATES counts 0 and false as `recorded`, because a
 * genuine zero-mileage import is not a missing odometer. Only null/undefined is missing, and
 * missing renders as words. `vehicle.mileage?.toLocaleString() + ' km'` rendered a bare " km".
 */
export function statedMileage(km: unknown): string {
  return typeof km === 'number' && Number.isFinite(km) ? `${km.toLocaleString()} km` : 'Mileage not recorded'
}

/** Same rule for money: a real 0 prints, an absent price is named rather than shown as $0 or $. */
export function statedPrice(amount: unknown): string {
  return typeof amount === 'number' && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : 'Price not recorded'
}

/** `new Date('').toLocaleDateString()` is the string "Invalid Date"; an absent date says so. */
export function statedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
}
