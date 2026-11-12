/**
 * RX-02A S1-3 — TrustLens contract registry (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.2).
 * Kept in a non-component module so the component file stays fast-refresh clean.
 *
 * R1-04: labels describe EVALUATION COVERAGE ONLY. No label may claim or imply
 * independent verification of vehicle facts — the exact backend semantics of each
 * state are subject to Truth-owner confirmation; until then the wording stays
 * coverage-neutral ("evaluated", never "verified").
 */
export type TrustLensState = 'evaluated' | 'partial' | 'stale' | 'not-evaluated' | 'insufficient-data' | 'unavailable'

export const TRUST_LENS_LABELS: Record<TrustLensState, string> = {
  evaluated: 'Evaluated',
  partial: 'Partially evaluated',
  stale: 'Out of date',
  'not-evaluated': 'Not evaluated',
  'insufficient-data': 'Insufficient data',
  unavailable: 'Unavailable',
}
