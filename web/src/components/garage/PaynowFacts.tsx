import { dateTimeLabel } from '@/lib/garageWorkspace'
import type { PaynowFacts as Facts } from '@/lib/pay05Paynow'

/**
 * CARUP-PAY-05-R1 — one Paynow payment's truth in its separate parts: what Paynow reported, what CarUp counted, any review,
 * what to do next, and when Paynow was last read. "Check payment status" asks Paynow again; everything else is CarUp's last read.
 */
export default function PaynowFacts({ facts, className = '' }: { facts: Facts | null | undefined; className?: string }) {
  if (!facts) return null
  return (
    <dl className={`grid gap-x-3 gap-y-1 text-xs text-gray-800 sm:grid-cols-[auto_1fr] ${className}`} data-testid="paynow-facts">
      <dt className="font-medium">Paynow reports</dt>
      <dd data-testid="paynow-fact-provider">{facts.provider}</dd>
      <dt className="font-medium">On this invoice</dt>
      <dd data-testid="paynow-fact-allocation">{facts.allocation}</dd>
      <dt className="font-medium">Review</dt>
      <dd data-testid="paynow-fact-review">{facts.review ?? 'None'}</dd>
      {facts.next_step && (
        <>
          <dt className="font-medium">What to do</dt>
          <dd data-testid="paynow-fact-next">{facts.next_step}</dd>
        </>
      )}
      <dt className="font-medium">Last read from Paynow</dt>
      <dd data-testid="paynow-fact-read">{facts.last_read_at ? dateTimeLabel(facts.last_read_at) : 'Not yet'}</dd>
    </dl>
  )
}
