/**
 * CARUP-MVP-STAB-01 F-027 — what Marketplace Pulse says when it has no figures to show.
 *
 * Seller rollups are produced only by POST /api/internal/intelligence/rollup, and nothing schedules it
 * yet (computation is deferred to V2). For an owner with vehicles the seller pulse therefore answers
 * `availability: 'unavailable'` with `reason: 'never_computed'`, and the backend's envelope `message`
 * says the period "could not be read" — which made a capability that is simply not computed look
 * like a fault. The reason, not the message, decides the wording here:
 *
 *  - never computed       → "Not available yet" (valid MVP behaviour, not an error);
 *  - a run still going    → "Not available yet", still being calculated;
 *  - no vehicles          → the backend's "Publish a vehicle…" guidance;
 *  - anything else        → a failure, stated as one. An unrecognised reason is treated as a
 *                           failure rather than guessed into a reassuring state.
 *
 * Every branch is words. None of them is a figure, so none of them can read as zero.
 */
import type { IntelligenceEnvelope } from './intelligenceDisplay'

export type PulseNoticeKind = 'not_computed' | 'computing' | 'no_listings' | 'not_applicable' | 'failed'

export interface PulseNotice {
  kind: PulseNoticeKind
  message: string
}

export const PULSE_NOT_COMPUTED_MESSAGE =
  "Not available yet — Marketplace insights aren't being calculated for your listings yet."
export const PULSE_COMPUTING_MESSAGE =
  'Not available yet — Marketplace insights for this period are still being calculated.'
export const PULSE_FAILED_MESSAGE =
  'Marketplace insights could not be loaded right now. This is a loading problem, not a zero.'
const PULSE_NO_LISTINGS_MESSAGE = 'Publish a vehicle to start receiving Marketplace insights.'

/** Reasons the rollup read gives for a window nobody has computed (rollupFreshness / getSellerPulse). */
const NOT_COMPUTED_REASONS: ReadonlySet<string> = new Set(['never_computed', 'not_computed'])

/**
 * Classify a pulse that has no readable figures. `payload` is null when the request itself failed.
 */
export function describePulseNotice(payload: IntelligenceEnvelope | null): PulseNotice {
  if (!payload) return { kind: 'failed', message: PULSE_FAILED_MESSAGE }
  const reason = String(payload.reason ?? '')
  if (payload.availability === 'not_applicable') {
    if (reason === 'no_listings') return { kind: 'no_listings', message: payload.message || PULSE_NO_LISTINGS_MESSAGE }
    return { kind: 'not_applicable', message: payload.message || 'Not applicable yet.' }
  }
  if (payload.availability === 'unavailable') {
    if (NOT_COMPUTED_REASONS.has(reason)) return { kind: 'not_computed', message: PULSE_NOT_COMPUTED_MESSAGE }
    if (reason === 'last_run_running') return { kind: 'computing', message: PULSE_COMPUTING_MESSAGE }
  }
  return { kind: 'failed', message: PULSE_FAILED_MESSAGE }
}
