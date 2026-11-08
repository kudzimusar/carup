/**
 * CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D4.
 * After uploading the completed workbook the applicant saw only "BRANCHES: 2 row(s)". This groups what
 * CarUp actually read, per tab and row, in the workbook's own column labels, and marks where a value
 * differs from the research candidate the applicant's prefilled workbook carried. Mirrors the
 * activation carry-over rule: the first branch row is the researched branch; comparison ignores case
 * and surrounding spaces.
 */
export type DraftReviewPreview = {
  research_candidates: Record<string, Record<string, string>> | null
  field_labels: Record<string, Record<string, string>>
}
export type DraftReviewLine = { key: string; label: string; value: string; research?: string; changed: boolean }
export type DraftReviewGroup = { tab: string; row: number; title: string; lines: DraftReviewLine[] }

/** Server-issued references the applicant never typed; shown elsewhere, not as "your answers". */
const REFERENCE_ONLY = new Set(['claim_reference', 'source_seed_id', 'agreement_version', 'agreement_hash'])
const norm = (value: unknown) => String(value ?? '').trim()

export function draftReviewGroups(
  tabRows: Record<string, Array<Record<string, string>>> | undefined,
  preview?: DraftReviewPreview | null,
): { groups: DraftReviewGroup[]; changedCount: number } {
  const labels = preview?.field_labels ?? {}
  const research = preview?.research_candidates ?? null
  const groups: DraftReviewGroup[] = []
  let changedCount = 0
  // Workbook (contract) tab order first — BUSINESS, BRANCHES, … — whatever order the draft was stored in.
  const contractOrder = Object.keys(labels)
  const tabs = Object.entries(tabRows ?? {}).sort(([a], [b]) => {
    const ia = contractOrder.indexOf(a), ib = contractOrder.indexOf(b)
    return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib)
  })
  for (const [tab, rows] of tabs) {
    if (tab.startsWith('README') || !Array.isArray(rows)) continue
    rows.forEach((row, index) => {
      const candidates = research && index === 0 ? research[tab] ?? {} : {}
      const ordered = [...Object.keys(labels[tab] ?? {}), ...Object.keys(row ?? {}), ...Object.keys(candidates)]
      const lines: DraftReviewLine[] = []
      for (const key of new Set(ordered)) {
        if (REFERENCE_ONLY.has(key)) continue
        const value = norm(row?.[key])
        const candidate = key in candidates ? norm(candidates[key]) : ''
        if (!value && !candidate) continue
        const changed = candidate !== '' && value.toLocaleLowerCase() !== candidate.toLocaleLowerCase()
        if (changed) changedCount += 1
        lines.push({ key, label: labels[tab]?.[key] ?? key.replace(/_/g, ' '), value,
          ...(changed ? { research: candidate } : {}), changed })
      }
      if (lines.length) groups.push({ tab, row: index + 1,
        title: tab.replace(/_/g, ' ') + (rows.length > 1 ? ` · row ${index + 1}` : ''), lines })
    })
  }
  return { groups, changedCount }
}
