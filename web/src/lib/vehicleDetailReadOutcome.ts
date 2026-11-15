/**
 * TI-27 — Vehicle Detail read-outcome truth.
 *
 * Vehicle Detail (`/marketplace/:id` and `/marketplace/listing/:id`) answers from up to four
 * independent reads. Before this module the page reduced all of them to a single question — "did a
 * vehicle object appear?" — and so a backend outage rendered as "doesn't exist or has been removed",
 * and an outage on a chassis-numbered listing rendered as "Sign in to look up by plate" (the guest
 * lookup refusal is policy, not an answer about the vehicle, and it survived the outage to become
 * the page's only explanation).
 *
 * This module keeps every read's outcome and decides what may honestly be said:
 *
 *   - ABSENCE is claimed only when BOTH governing reads answered "not found": the public listing
 *     read and the canonical passport read. A failed, refused, rate-limited or unanswered read can
 *     never be promoted to absence.
 *   - `/api/vehicles/:vin/details` is deliberately NOT a governing read: it uses PostgREST
 *     `.single()`, so a VIN with no row comes back as HTTP 500 rather than 404 (observed on staging
 *     for both VIN-shaped and non-VIN identifiers). Its 5xx therefore cannot overturn two
 *     definitive 404s — and, symmetrically, its 404 alone never establishes absence.
 *   - The guest plate/temporary-identifier refusal (`LOOKUP_REQUIRES_AUTHENTICATION`) is
 *     non-enumerable by design: it says nothing about whether the vehicle exists. It can only ever
 *     ADD an option ("sign in to search by plate") to an otherwise-established absence.
 *   - "Not found" copy stays non-enumerable too: the listing service returns the same 404 for a
 *     missing, unpublished or private listing, so the page says "no public listing", never
 *     "doesn't exist".
 */
import { SessionExpiredError } from '@/lib/apiClient'

export type ReadSource = 'lookup' | 'vehicle' | 'passport' | 'listing'

export type ReadOutcome =
  | { kind: 'ok' }
  /** 404 / 410, or 400 (the identifier cannot name a vehicle). */
  | { kind: 'not-found' }
  /** Guest plate / temporary-identifier lookup refused by policy — non-enumerable. */
  | { kind: 'sign-in-required' }
  /** 409: more than one vehicle matches the identifier. */
  | { kind: 'ambiguous' }
  /** 401 from the session middleware: the presented session is no longer valid. */
  | { kind: 'session-expired' }
  | { kind: 'forbidden' }
  | { kind: 'rate-limited' }
  /** 408 / 504, or the page-level watchdog fired before the read answered. */
  | { kind: 'timeout' }
  | { kind: 'server'; status: number }
  /** The request never produced an HTTP response (offline, DNS, refused, CORS, aborted). */
  | { kind: 'network' }
  /** Any other failure the page cannot interpret. Never treated as an answer. */
  | { kind: 'unknown' }

export type ReadLedger = Partial<Record<ReadSource, ReadOutcome>>

/** Outcomes that mean "the service did not answer" rather than "the service answered no". */
const TRANSIENT_KINDS = new Set<ReadOutcome['kind']>(['server', 'network', 'timeout', 'rate-limited'])

export function isTransient(outcome: ReadOutcome | undefined): boolean {
  return !!outcome && TRANSIENT_KINDS.has(outcome.kind)
}

/** Interpret an error thrown by `apiRequest` (via `useCarUpApi`) without inventing an answer. */
export function classifyReadError(err: unknown): ReadOutcome {
  if (err instanceof SessionExpiredError || (err as { name?: unknown } | null)?.name === 'SessionExpiredError') {
    return { kind: 'session-expired' }
  }
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status === 'number') {
    const code = (err as { code?: unknown }).code
    if (status === 401 && code === 'LOOKUP_REQUIRES_AUTHENTICATION') return { kind: 'sign-in-required' }
    if (status === 401) return { kind: 'session-expired' }
    if (status === 403) return { kind: 'forbidden' }
    if (status === 404 || status === 410 || status === 400) return { kind: 'not-found' }
    if (status === 409) return { kind: 'ambiguous' }
    if (status === 429) return { kind: 'rate-limited' }
    if (status === 408 || status === 504) return { kind: 'timeout' }
    if (status >= 500) return { kind: 'server', status }
    return { kind: 'unknown' }
  }
  // fetch() rejects with a TypeError when no HTTP response exists at all
  // ("Failed to fetch" / "Load failed" / "NetworkError when attempting to fetch resource").
  if (err instanceof TypeError) return { kind: 'network' }
  if ((err as { name?: unknown } | null)?.name === 'AbortError') return { kind: 'network' }
  return { kind: 'unknown' }
}

export type VehicleDetailFailureKind =
  /** Both governing reads answered: no public listing at this address. */
  | 'not-found'
  /** As not-found, but more than one vehicle matched a plate-style identifier. */
  | 'ambiguous'
  /** A read was refused for this account. */
  | 'forbidden'
  /** The presented session expired mid-read; the public view reloads as a guest. */
  | 'session-expired'
  /** CarUp could not give an answer. Never a claim about the vehicle. */
  | 'unavailable'

export type UnavailableCause = 'server' | 'network' | 'timeout' | 'rate-limited' | 'unknown'

export interface VehicleDetailFailure {
  kind: VehicleDetailFailureKind
  /** Only for `unavailable`: what kind of non-answer dominated. */
  cause?: UnavailableCause
  /**
   * The identifier is not a VIN and the guest lookup was refused by policy. Signing in can widen
   * the search (plate / temporary ID); it is offered, never presented as the reason for the page.
   */
  signInWidensSearch: boolean
}

/**
 * Decide what the page may say when no vehicle could be rendered.
 *
 * `options.stalled` is the page watchdog: the reads have not all answered within the budget.
 * `options.offline` is `navigator.onLine === false` at decision time.
 */
export function classifyVehicleDetailFailure(
  ledger: ReadLedger,
  options: { stalled?: boolean; offline?: boolean } = {},
): VehicleDetailFailure {
  const { lookup, vehicle, passport, listing } = ledger
  const signInWidensSearch = lookup?.kind === 'sign-in-required'
  const outcomes = [lookup, vehicle, passport, listing].filter((o): o is ReadOutcome => !!o)

  // 1. Absence: both governing reads answered "not found". A /details 5xx cannot overturn this
  //    (it reports a missing row as 500), a hung /details read cannot either (the watchdog), and a
  //    refused lookup is not evidence either way.
  const governingAbsence = listing?.kind === 'not-found' && passport?.kind === 'not-found'
  if (governingAbsence) {
    if (lookup?.kind === 'ambiguous') return { kind: 'ambiguous', signInWidensSearch: false }
    return { kind: 'not-found', signInWidensSearch }
  }

  // 2. A refusal for this account is a real answer, but only about access — never about existence.
  if (outcomes.some((o) => o.kind === 'forbidden')) return { kind: 'forbidden', signInWidensSearch: false }

  // 3. The presented session died while reading. Auth is already cleared by the API client and the
  //    reads re-run as a guest; say so instead of guessing.
  if (outcomes.some((o) => o.kind === 'session-expired')) return { kind: 'session-expired', signInWidensSearch: false }

  // 4. Everything else is a non-answer. Name the dominant cause; never fall back to absence.
  let cause: UnavailableCause = 'unknown'
  if (options.stalled || outcomes.some((o) => o.kind === 'timeout')) cause = 'timeout'
  else if (options.offline || outcomes.some((o) => o.kind === 'network')) cause = 'network'
  else if (outcomes.some((o) => o.kind === 'rate-limited')) cause = 'rate-limited'
  else if (outcomes.some((o) => o.kind === 'server')) cause = 'server'
  return { kind: 'unavailable', cause, signInWidensSearch }
}

/**
 * A vehicle rendered, but the public listing read did not answer — so price, seller and buyer
 * actions may be missing for a reason that is ours, not the seller's. (A listing 404 next to a
 * resolved passport is a legitimate passport-only view and is not partial.)
 */
export function listingReadIsPartial(ledger: ReadLedger): boolean {
  return isTransient(ledger.listing)
}

/** Plain-language status for one read, for the "What CarUp checked" ledger. No HTTP jargon. */
export function describeReadOutcome(outcome: ReadOutcome | undefined): string {
  if (!outcome) return 'Not checked'
  switch (outcome.kind) {
    case 'ok': return 'Answered'
    case 'not-found': return 'No public record'
    case 'sign-in-required': return 'Plate & temporary-ID search needs sign-in'
    case 'ambiguous': return 'More than one match'
    case 'session-expired': return 'Session ended'
    case 'forbidden': return 'Not available to this account'
    case 'rate-limited': return 'Too many requests — paused'
    case 'timeout': return 'No reply in time'
    case 'server': return 'Service error'
    case 'network': return 'Unreachable'
    case 'unknown': return 'No usable answer'
  }
}

export const READ_SOURCE_LABELS: Record<ReadSource, string> = {
  listing: 'Marketplace listing',
  passport: 'Vehicle passport',
  lookup: 'Identifier search',
  vehicle: 'Vehicle record',
}

/** Display order: the two governing reads first. */
export const READ_SOURCE_ORDER: ReadSource[] = ['listing', 'passport', 'lookup', 'vehicle']

/** Page watchdog thresholds. The client has no request timeout, so the page keeps its own budget. */
export const VEHICLE_DETAIL_SLOW_NOTICE_MS = 8_000
export const VEHICLE_DETAIL_TIMEOUT_MS = 20_000
