/**
 * RX06-LR06 U10-S1 — the institutional workbench's honest failed-read state (unified presentation only).
 *
 * A read that failed is never an empty queue and never a zero: it says the records could not be read, that nothing
 * has changed, and offers a retry. A refusal (403) is said so, without a retry. It grants nothing and decides nothing.
 */
import { Button } from '@/components/ui/button'

export function ReadFailedNotice({ subject, refused, onRetry, testId }: {
  /** Plural noun, e.g. "claims", "fraud alerts". */
  subject: string
  refused: boolean
  onRetry?: () => void
  testId: string
}) {
  return (
    <div className="rounded-xl border border-red-100 bg-white p-6 text-center" role="status" data-testid={testId} data-refused={refused}>
      <h3 className="text-base font-semibold text-gray-900">
        {refused ? `This account cannot read ${subject}` : `The ${subject} could not be loaded`}
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        {refused
          ? 'CarUp refused this account access to them. Nothing has changed.'
          : 'This is not an empty list: CarUp could not read them just now. Nothing has changed.'}
      </p>
      {!refused && onRetry && (
        <Button variant="outline" className="mt-3" onClick={onRetry} data-testid={`${testId}-retry`}>Try again</Button>
      )}
    </div>
  )
}
