// PC01-K2B — the smallest shared vocabulary for Admin read truth.
//
// Admin surfaces count operational records only. They must still say that other records exist and
// why they are not counted, and a failed read must never look like an empty one. These two notes are
// the whole shared surface; page visuals are unchanged.

export interface ProvenanceSummary {
  raw: number
  operational: number
  excluded_non_operational: number
  unknown_requires_review: number
  by_class?: Record<string, number>
  view?: 'operational_only' | 'all_records'
}

const CLASS_LABEL: Record<string, string> = {
  uat: 'UAT',
  ci_automation: 'CI automation',
  golden_test: 'Golden test',
  proof_certification: 'Proof / certification',
  seed_demo: 'Seed / demo',
  legacy_synthetic: 'Legacy synthetic',
}

/** "Test / certification data excluded: N · Needs review: M" — counts only, never identities. */
export function ProvenanceNotice({ provenance, noun = 'records' }: { provenance?: ProvenanceSummary | null; noun?: string }) {
  if (!provenance) return null
  const excluded = provenance.excluded_non_operational || 0
  const review = provenance.unknown_requires_review || 0
  if (!excluded && !review) return null
  const breakdown = Object.entries(provenance.by_class || {})
    .filter(([cls, n]) => n > 0 && CLASS_LABEL[cls])
    .map(([cls, n]) => `${CLASS_LABEL[cls]} ${n}`)
    .join(' · ')
  return (
    <p
      className="text-xs text-gray-500"
      data-testid="provenance-notice"
      data-excluded={excluded}
      data-review={review}
      title={breakdown || undefined}
    >
      Test / certification data excluded: {excluded}
      {review > 0 && <> · Needs review (not counted): {review}</>}
      <span className="sr-only"> {noun} not counted as operational{breakdown ? ` (${breakdown})` : ''}</span>
    </p>
  )
}

/** A failed read, stated as such — distinct from an empty result. */
export function ReadFailedNotice({ what, detail }: { what: string; detail?: string | null }) {
  return (
    <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="read-failed-notice">
      {what} could not be loaded. This is not an empty list{detail ? ` — ${detail}` : ''}.
    </div>
  )
}
