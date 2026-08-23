/**
 * Explaining a publication refusal — Issue #164 Phase 8, Cluster F.
 *
 * ## Why this exists
 *
 * The publication gate is correct and must stay correct: `POST /api/vehicles/:vin/publish` returns
 * 400 for Golden B and the vehicle stays draft. What failed the physical UAT was the EXPLANATION.
 * The owner saw only:
 *
 *   "Listing is not publishable yet. Resolve the blocking requirements first."
 *
 * `evaluateCompleteness` splits unmet blocking requirements into two disjoint buckets:
 * `blocking_gaps` (status `missing`) and `pending_gaps` (status `pending_review`). Golden B's only
 * unmet requirement is an ownership document that HAS been uploaded and is awaiting review, so it is
 * in `pending_gaps` and `blocking_gaps` is `[]`. Both publish handlers read only `blocking_gaps` and
 * gated on its length, so the one case that actually occurs fell straight through to the generic
 * sentence — a refusal that named nothing.
 *
 * The two buckets get DIFFERENT words on purpose. "Missing: ownership document" tells an owner who
 * already uploaded it that CarUp lost their file; "Awaiting verification" tells them the truth, which
 * is that there is nothing more for them to do yet.
 */

export type PublicationGap = { key?: string; label?: string; requirement?: string } | string

export type PublicationRefusal = {
  data?: {
    blocking_gaps?: PublicationGap[]
    pending_gaps?: PublicationGap[]
    completeness_percent?: number | null
  }
  message?: string
}

const MAX_NAMED = 3

function nameOf(gap: PublicationGap): string {
  if (typeof gap === 'string') return gap
  return gap.label || gap.requirement || gap.key || 'requirement'
}

function namesOf(gaps: PublicationGap[]): string {
  const named = gaps.map(nameOf).slice(0, MAX_NAMED).join(', ')
  return gaps.length > MAX_NAMED ? `${named}…` : named
}

/**
 * Turn a refusal into the most specific true sentence available.
 *
 * Order matters: a MISSING requirement is actionable by the owner right now, so it leads. A PENDING
 * one is on CarUp, and saying so prevents an owner re-uploading a document that is already in the
 * queue. The generic server sentence remains the last resort, for a refusal that genuinely carried
 * no structure — but it is no longer what Golden B produces.
 */
export function describePublicationRefusal(error: unknown): string {
  const err = error as PublicationRefusal
  const blocking = Array.isArray(err?.data?.blocking_gaps) ? err.data.blocking_gaps : []
  const pending = Array.isArray(err?.data?.pending_gaps) ? err.data.pending_gaps : []

  if (blocking.length && pending.length) {
    return `Not publishable yet. Missing: ${namesOf(blocking)}. Awaiting verification: ${namesOf(pending)}.`
  }
  if (blocking.length) {
    return `Not publishable yet. Missing: ${namesOf(blocking)}`
  }
  if (pending.length) {
    return `Not publishable yet. Awaiting CarUp verification: ${namesOf(pending)}. `
      + 'Nothing more is needed from you until that review completes.'
  }
  return err?.message || 'Could not update publication status.'
}
