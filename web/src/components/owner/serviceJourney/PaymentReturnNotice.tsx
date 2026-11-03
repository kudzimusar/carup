import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { returnOutcomeMessage, type CollectionOutcome } from '@/lib/pay04GaragePayments'
import { paynowContinuable, paynowOutcomeMessage, type PaynowOutcome } from '@/lib/pay05Paynow'
import PaynowFacts from '@/components/garage/PaynowFacts'
import PaynowPendingPanel from './PaynowPendingPanel'

const TONE = { ok: 'border-green-300 bg-green-50 text-green-900', wait: 'border-amber-300 bg-amber-50 text-amber-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', error: 'border-red-300 bg-red-50 text-red-900' } as const
const COLLECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * CARUP-PAY-04 — the customer is back from the garage's payment provider.
 *
 * Coming back is NOT evidence of payment (a redirect proves nothing). The page asks CarUp to read the provider once and
 * says only what that fresh read says: confirmed and counted, still waiting, or under review. Until the read answers,
 * it says it is checking.
 */
export default function PaymentReturnNotice({ onSettled }: { onSettled?: () => void }) {
  const [params] = useSearchParams()
  const { verifyGarageInvoicePayment } = useCarUpApi()
  // PAY-05: back from Paynow's own page (?pay05=returned) — the same rule: coming back proves nothing
  const paynow = params.get('pay05') === 'returned'
  const returned = paynow ? 'returned' : params.get('pay04')
  const collectionId = params.get('collection') || ''
  const valid = (returned === 'returned' || returned === 'cancelled') && COLLECTION_ID.test(collectionId)
  const [phase, setPhase] = useState<'checking' | 'done'>('checking')
  const [outcome, setOutcome] = useState<CollectionOutcome | null>(null)
  const [failed, setFailed] = useState(false)
  const started = useRef<string | null>(null)
  // a person asked: the answer takes the focus, once it is on the page (ICR-W5)
  const outcomeRef = useRef<HTMLParagraphElement>(null)
  const [answered, setAnswered] = useState(0)
  useEffect(() => { if (answered) outcomeRef.current?.focus() }, [answered])
  // while a person's re-check runs its button stays: taking it away would drop their focus (ICR-W5)
  const [rechecking, setRechecking] = useState(false)

  const check = async (asked = false) => {
    setPhase('checking')
    setRechecking(asked)
    setFailed(false)
    try {
      setOutcome(await verifyGarageInvoicePayment(collectionId))
    } catch {
      setOutcome(null)
      setFailed(true)
    } finally {
      setPhase('done')
      if (asked) setAnswered((n) => n + 1)
      onSettled?.()
    }
  }

  useEffect(() => {
    if (!valid || started.current === collectionId) return
    started.current = collectionId
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fresh read per returned collection
  }, [valid, collectionId])

  if (!valid) return null
  const message = phase === 'checking' ? null
    : paynow ? paynowOutcomeMessage(outcome as PaynowOutcome | null, failed) : returnOutcomeMessage(outcome, failed)
  // PAY-05: back from Paynow without finishing — what Paynow gave CarUp to continue the request (its page, a code)
  const view = message && paynow && !failed ? (outcome as PaynowOutcome | null)?.paynow ?? null : null
  const state = outcome?.collection?.state ?? null
  return (
    <div className={`space-y-2 rounded-lg border p-4 text-sm ${message ? TONE[message.tone] : 'border-gray-300 bg-white'}`} data-testid="payment-return">
      {phase === 'checking' && (
        <p data-testid="payment-return-checking">
          {paynow
            ? 'Checking your payment with Paynow… Coming back from Paynow is not proof of payment; nothing is shown as paid until Paynow confirms it.'
            : 'Checking your payment with the garage’s payment provider… Nothing is shown as paid until the provider confirms it.'}
        </p>
      )}
      {/* in the page, empty, while CarUp checks: the words that arrive are announced (W8) */}
      <p ref={outcomeRef} tabIndex={-1} role="status" aria-live="polite" data-testid="payment-return-outcome" data-tone={message?.tone}>{message?.text ?? ''}</p>
      {view?.facts && <PaynowFacts facts={view.facts} />}
      {view && paynowContinuable(state, view) && (
        <PaynowPendingPanel collectionId={collectionId} paynow={view} state={state}
          onOtpOutcome={(answer) => { setOutcome(answer); setFailed(false); setAnswered((n) => n + 1); onSettled?.() }} />
      )}
      {((message && message.tone !== 'ok') || (phase === 'checking' && rechecking)) && (
        <Button variant="outline" className="min-h-11 bg-white" disabled={phase === 'checking'} onClick={() => void check(true)} data-testid="payment-return-recheck">
          Check payment status
        </Button>
      )}
    </div>
  )
}
