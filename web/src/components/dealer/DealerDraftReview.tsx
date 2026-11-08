import { Fragment } from 'react'
import { draftReviewGroups, type DraftReviewPreview } from '@/lib/dealerDraftReview'

/**
 * Owner UAT D4: before freezing the application, the applicant reviews exactly what CarUp read from the
 * uploaded workbook, in the workbook's own column labels, with every value that differs from the
 * research candidate their prefilled workbook carried called out. Read-only; nothing here is verified.
 */
export function DealerDraftReview({ tabRows, preview }: {
  tabRows: Record<string, Array<Record<string, string>>> | undefined
  preview?: DraftReviewPreview | null
}) {
  const { groups, changedCount } = draftReviewGroups(tabRows, preview)
  if (!groups.length) return null
  return (
    <section aria-labelledby="dealer-draft-review-title" data-testid="dealer-draft-review" className="mt-3 space-y-3">
      <h4 id="dealer-draft-review-title" className="font-semibold">Review what CarUp read from your workbook</h4>
      <p className="text-gray-600">
        {preview?.research_candidates
          ? changedCount
            ? `${changedCount} value(s) differ from the research details in your prefilled workbook. They are marked below and an independent reviewer will check them.`
            : 'No value differs from the research details in your prefilled workbook.'
          : 'The research comparison is unavailable right now; your saved answers are shown below.'}
        {' '}Nothing here is verified or public. To change a value, correct the workbook and upload it again.
      </p>
      {groups.map((group) => {
        const changed = group.lines.filter((line) => line.changed).length
        return (
          <details key={group.tab + ':' + group.row} open={group.tab === 'BUSINESS' || group.tab === 'BRANCHES'}
            className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              {group.title} · {group.lines.length} value(s){changed ? ` · ${changed} changed from research` : ''}
            </summary>
            <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              {group.lines.map((line) => (
                <Fragment key={line.key}>
                  <dt className="text-gray-600">{line.label}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {line.value || <em className="text-gray-600">blank</em>}
                    {line.changed && (
                      <span data-testid="dealer-draft-changed"
                        className="mt-1 block rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                        Changed from research: “{line.research}”
                      </span>
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </details>
        )
      })}
    </section>
  )
}
