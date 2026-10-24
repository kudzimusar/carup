import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ESTIMATE_STATUS_LABEL, formatMoney, type CustomerEstimate, type EstimateLineCategory, type OwnerAuthorization } from '@/lib/garageBusiness'
import { requestDate } from '@/lib/serviceRequests'

/**
 * One estimate as the CUSTOMER sees it.
 *
 * Only estimates the server returns reach this component, so a draft can never be shown here. Every
 * amount is `amount + currency`; a line with no recorded price says "Not recorded" and is never a 0.
 * Buttons exist only when the server said `can_decide`: whether the estimate is still open, unexpired,
 * and whether this person is the vehicle's registered owner are the server's rules, not the browser's.
 */

const CATEGORY_LABEL: Record<EstimateLineCategory, string> = {
  labour: 'Labour', part: 'Part', fee: 'Fee', other: 'Other',
}

const STATUS_TONE: Record<string, string> = {
  sent: 'bg-amber-100 text-amber-900 border-amber-300',
  accepted: 'bg-green-100 text-green-900 border-green-300',
  declined: 'bg-red-100 text-red-900 border-red-300',
  superseded: 'bg-gray-100 text-gray-800 border-gray-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
}

/**
 * What an ACCEPTED estimate says about the job's authorization. The estimate was accepted and the
 * authorization is a separate, canonical fact (`work_order_authorization`); when they disagree both are
 * shown, never one inferred from the other.
 */
function authorizationSentence(authorization: OwnerAuthorization | null | undefined): string {
  if (authorization === 'authorized') return 'The work is authorized.'
  if (authorization === 'revoked') return 'Estimate accepted — authorization later withdrawn.'
  if (authorization === 'pending') return 'The work is not authorized yet.'
  if (authorization === 'declined') return 'The work is not authorized.'
  return 'Whether the work is authorized is not available.'
}

/** The server's own reason when it refused, never a generic stand-in. */
function refusalText(err: unknown): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data
  if (typeof data?.error === 'string' && data.error.trim()) return data.error
  if (err instanceof Error && err.message) return err.message
  return 'Your decision could not be saved.'
}

type Props = {
  estimate: CustomerEstimate
  /** Throws with the server's message when the decision is refused. The page refetches either way. */
  onDecide: (estimateId: string, decision: 'accept' | 'decline', reason?: string) => Promise<void>
}

export default function EstimateCard({ estimate: e, onDecide }: Props) {
  const uid = useId()
  const titleId = `${uid}-title`
  const reasonId = `${uid}-reason`
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recorded, setRecorded] = useState<'accept' | 'decline' | null>(null)

  async function submit(decision: 'accept' | 'decline') {
    if (busy) return
    setBusy(decision)
    setError(null)
    try {
      const trimmed = reason.trim()
      if (decision === 'decline' && trimmed) await onDecide(e.id, decision, trimmed)
      else await onDecide(e.id, decision)
      setRecorded(decision)
      setDeclining(false)
    } catch (err) {
      setError(refusalText(err))
    } finally {
      setBusy(null)
    }
  }

  const statusLabel = ESTIMATE_STATUS_LABEL[e.status] ?? e.status
  const showDecision = e.can_decide && recorded === null
  // The server has the decision but the refetch has not landed yet: say what happened, offer nothing.
  const showRecorded = recorded !== null && e.status === 'sent'

  return (
    <article className="rounded-lg border bg-white p-4" aria-labelledby={titleId} data-testid="estimate-card" data-status={e.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={titleId} className="font-semibold text-gray-900">Estimate, version {e.version}</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={`whitespace-normal text-left ${STATUS_TONE[e.status] ?? ''}`} data-testid="estimate-status">{statusLabel}</Badge>
          {e.expired && <Badge variant="outline" className="whitespace-normal bg-gray-100 text-gray-800 border-gray-300" data-testid="estimate-expired">Expired</Badge>}
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-600">
        {e.sent_at ? `Sent ${requestDate(e.sent_at)}` : 'Send date not recorded'}
        {' · '}
        {e.valid_until ? `Valid until ${requestDate(e.valid_until)}` : 'No validity date recorded'}
      </p>

      {e.lines.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">No line items are recorded on this estimate.</p>
      ) : (
        <div className="mt-3">
          <table className="w-full table-fixed border-collapse text-left text-xs sm:text-sm" data-testid="estimate-lines">
            <caption className="sr-only">Lines of estimate version {e.version}</caption>
            <thead>
              <tr className="border-b text-gray-600">
                <th scope="col" className="w-[34%] py-1 pr-2 font-medium">Description</th>
                <th scope="col" className="w-[12%] py-1 pr-2 text-right font-medium">Qty</th>
                <th scope="col" className="w-[27%] py-1 pr-2 text-right font-medium">Unit price</th>
                <th scope="col" className="w-[27%] py-1 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((line) => (
                <tr key={line.line_no} className="border-b align-top last:border-0">
                  <td className="py-2 pr-2 break-words">
                    {line.description}
                    <span className="block text-[11px] text-gray-500">{CATEGORY_LABEL[line.category] ?? line.category}</span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 pr-2 text-right tabular-nums break-words">{formatMoney(line.unit_price, e.currency)}</td>
                  <td className="py-2 text-right tabular-nums break-words">{formatMoney(line.line_total, e.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 text-sm">
        <span className="font-medium text-gray-900">Total</span>
        <span className="font-semibold tabular-nums" data-testid="estimate-total">{formatMoney(e.total_amount, e.currency)}</span>
      </p>

      {e.customer_note && (
        <p className="mt-3 border-l-2 border-gray-200 pl-3 text-sm text-gray-700" data-testid="estimate-note">
          <span className="block text-xs font-medium text-gray-500">Note from the garage</span>
          {e.customer_note}
        </p>
      )}

      {e.status === 'superseded' && (
        <p className="mt-3 text-sm text-gray-700" data-testid="estimate-superseded">
          A newer version replaced this estimate. Nothing needs deciding on this one.
        </p>
      )}
      {e.status === 'sent' && e.expired && (
        <p className="mt-3 text-sm text-gray-700" data-testid="estimate-expired-note">
          This estimate has expired and can no longer be accepted.
        </p>
      )}
      {e.status === 'accepted' && (
        <p className="mt-3 text-sm text-gray-700" data-testid="estimate-decision">
          {e.decided_at ? `Accepted ${requestDate(e.decided_at)}.` : 'Accepted.'}
        </p>
      )}
      {e.status === 'accepted' && (
        <p className="mt-1 text-sm text-gray-700" data-testid="estimate-authorization" data-authorization={e.work_order_authorization ?? 'unknown'}>
          {authorizationSentence(e.work_order_authorization)}
        </p>
      )}
      {e.status === 'declined' && (
        <p className="mt-3 text-sm text-gray-700" data-testid="estimate-decision">
          {e.decided_at ? `Declined ${requestDate(e.decided_at)}.` : 'Declined.'}
          {e.decision_reason ? ` Reason given: ${e.decision_reason}` : ''}
        </p>
      )}
      {e.status === 'cancelled' && (
        <p className="mt-3 text-sm text-gray-700">This estimate was cancelled and can no longer be accepted.</p>
      )}

      {e.awaiting_owner && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" data-testid="estimate-awaiting-owner">
          Only the vehicle&apos;s registered owner can accept or decline this estimate. You can follow it here, but you cannot decide it.
        </p>
      )}

      {showRecorded && (
        <p role="status" className="mt-3 text-sm text-gray-800" data-testid="estimate-recorded">
          {recorded === 'accept' ? 'Your acceptance was recorded.' : 'Your decline was recorded.'}
        </p>
      )}

      {showDecision && (
        <div className="mt-4 space-y-3" data-testid="estimate-decision-controls">
          <p className="text-sm text-gray-700">
            Accepting this estimate lets the garage start the work described here. Declining tells the garage you are not authorizing it.
          </p>

          {declining ? (
            <div className="space-y-3">
              <div>
                <label htmlFor={reasonId} className="text-sm font-medium text-gray-900">Reason for declining (optional)</label>
                <textarea
                  id={reasonId}
                  className="mt-1 w-full min-h-24 rounded-md border bg-white px-3 py-2 text-base sm:text-sm"
                  maxLength={500}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  variant="destructive"
                  disabled={busy !== null}
                  aria-describedby={titleId}
                  onClick={() => void submit('decline')}
                >
                  {busy === 'decline' ? 'Declining…' : 'Confirm decline'}
                </Button>
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => { setDeclining(false); setReason(''); setError(null) }}
                >
                  Go back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="min-h-11 w-full bg-green-700 hover:bg-green-800 sm:w-auto"
                disabled={busy !== null}
                aria-describedby={titleId}
                onClick={() => void submit('accept')}
              >
                {busy === 'accept' ? 'Accepting…' : 'Accept'}
              </Button>
              <Button
                className="min-h-11 w-full sm:w-auto"
                variant="outline"
                disabled={busy !== null}
                aria-describedby={titleId}
                onClick={() => setDeclining(true)}
              >
                Decline
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700" data-testid="estimate-decision-error">{error}</p>
      )}
    </article>
  )
}
