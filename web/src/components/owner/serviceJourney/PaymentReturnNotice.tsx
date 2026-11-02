import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { returnOutcomeMessage, type CollectionOutcome } from '@/lib/pay04GaragePayments'
import { paynowOutcomeMessage, type PaynowOutcome } from '@/lib/pay05Paynow'

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

  const check = async () => {
    setPhase('checking')
    setFailed(false)
    try {
      setOutcome(await verifyGarageInvoicePayment(collectionId))
    } catch {
      setOutcome(null)
      setFailed(true)
    } finally {
      setPhase('done')
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
  if (phase === 'checking') {
    return (
      <div role="status" className="rounded-lg border border-gray-300 bg-white p-4 text-sm" data-testid="payment-return-checking">
        {paynow
          ? 'Checking your payment with Paynow… Coming back from Paynow is not proof of payment; nothing is shown as paid until Paynow confirms it.'
          : 'Checking your payment with the garage’s payment provider… Nothing is shown as paid until the provider confirms it.'}
      </div>
    )
  }
  const message = paynow ? paynowOutcomeMessage(outcome as PaynowOutcome | null, failed) : returnOutcomeMessage(outcome, failed)
  return (
    <div role="status" className={`rounded-lg border p-4 text-sm ${TONE[message.tone]}`} data-testid="payment-return-outcome" data-tone={message.tone}>
      <p>{message.text}</p>
      {message.tone !== 'ok' && (
        <Button variant="outline" className="mt-2 min-h-11 bg-white" onClick={() => void check()} data-testid="payment-return-recheck">
          Check payment status
        </Button>
      )}
    </div>
  )
}
