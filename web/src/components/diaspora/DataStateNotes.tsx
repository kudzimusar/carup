/**
 * The two states a list can be in when it has nothing to show, and they are not
 * the same statement.
 *
 * "None recorded" is a fact about the business. "Could not be loaded" is a fact
 * about the request. Collapsing the second into the first is the single most
 * common defect the I0 audit found across CarUp, and on the diaspora surfaces it
 * had real consequences: a failed reservation fetch read as nobody having
 * reserved space, a failed reconciliation check read as everything reconciled,
 * and a failed interrupted-import fetch hid a warning telling an operator not to
 * retry.
 *
 * This pattern was already written correctly once, inside DiasporaOrderPassport.
 * It is lifted here unchanged so every surface can use the same one rather than
 * reimplementing it, and so `null` (unreadable) stays distinguishable from `[]`
 * (genuinely empty) at the call site.
 */
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export function EmptyNote({ testId, children = 'None recorded' }: { testId: string; children?: ReactNode }) {
  return <p className="text-sm text-muted-foreground" data-testid={testId}>{children}</p>
}

export function UnavailableNote({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid={testId}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}
