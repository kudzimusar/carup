import { useEffect, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { newIdempotencyKey } from '@/lib/garageBusiness'
import { MONEY_ACTION_BUTTON_CLASS, onlineAmountProblem } from '@/lib/pay04GaragePayments'
import {
  PAYNOW_METHOD_HINT, PAYNOW_METHOD_LABEL, PAYNOW_STATUS_SHORT, PAYNOW_STATUS_TONE, needsPhone, pay05ErrorText, paynowOutcomeMessage, paynowStartFailure,
  phoneProblem,
  type PaynowMethod, type PaynowOnlineOption, type PaynowOutcome, type PaynowProviderPayment, type PaynowStartResult, type PaynowView,
} from '@/lib/pay05Paynow'
import PaynowPendingPanel from './PaynowPendingPanel'

const TONE = { ok: 'bg-green-50 text-green-900', wait: 'bg-amber-50 text-amber-900', warn: 'bg-amber-50 text-amber-900', error: 'bg-red-50 text-red-900' } as const

/**
 * CARUP-PAY-05 — the customer pays the garage through the GARAGE's own Paynow account.
 *
 * Only the methods the garage's Paynow integration enables for this currency are offered. A Paynow page opens in the
 * browser for card and other methods; EcoCash / OneMoney prompt the phone; InnBucks shows its code; O'mari asks for the
 * SMS code. Nothing is called paid until CarUp reads Paynow's own status — and Paynow cannot cancel a request, which the
 * words say plainly.
 */
export default function PaynowCheckout({ invoiceId, option, onChanged, onStarted, latest = null }: {
  invoiceId: string
  option: PaynowOnlineOption
  onChanged?: () => void
  /** the request this checkout started (its parent keeps the checkout on screen for it) */
  onStarted?: (collectionId: string) => void
  /** the invoice's latest read of that request, once a refresh lists it */
  latest?: PaynowProviderPayment | null
}) {
  const { startGarageInvoicePayment, verifyGarageInvoicePayment } = useCarUpApi()
  const uid = useId()
  const [amount, setAmount] = useState(option.max_amount)
  const [method, setMethod] = useState<PaynowMethod>(option.methods.includes('web') ? 'web' : option.methods[0])
  const [phone, setPhone] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState<{ collectionId: string; amount: string; currency: string; paynow: PaynowView | null; cannotCancel: string } | null>(null)
  const [checked, setChecked] = useState<{ outcome: PaynowOutcome | null; failed: boolean } | null>(null)

  // a refresh of the invoice is a newer read of the request started here than the one shown: adopt it
  useEffect(() => {
    if (!latest?.paynow) return
    const fresh = latest.paynow
    setPending((p) => (p && p.collectionId === latest.id ? { ...p, paynow: fresh } : p))
  }, [latest])

  const amountProblem = amount.trim() ? onlineAmountProblem(amount, option.max_amount, option.currency) : null
  const phoneIssue = needsPhone(method) && phone.trim() ? phoneProblem(phone) : null
  const ready = Boolean(amount.trim()) && !amountProblem && (!needsPhone(method) || (Boolean(phone.trim()) && !phoneIssue))
  // any change to what is being asked for is a NEW request with its own idempotency key
  const changed = () => { setKey(newIdempotencyKey()); setProblem(null) }

  const start = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const started = await startGarageInvoicePayment(invoiceId, { amount: amount.trim(), method, ...(needsPhone(method) ? { phone: phone.trim() } : {}) }, key) as PaynowStartResult
      if (started.paynow?.initiation === 'refused') {
        // a retry replayed a request Paynow had refused: nothing exists at Paynow, so the next try is a new request
        setProblem(pay05ErrorText('PAY05_PROVIDER_REFUSED'))
        setKey(newIdempotencyKey())
        onChanged?.()
        return
      }
      if (started.checkout_url) {
        // Paynow's own page decides; nothing is paid until CarUp reads Paynow's status
        window.location.assign(started.checkout_url)
        return
      }
      setPending({ collectionId: started.collection_id, amount: started.amount, currency: started.currency, paynow: started.paynow, cannotCancel: started.cannot_cancel })
      setChecked(null)
      onStarted?.(started.collection_id)
      onChanged?.()
    } catch (err) {
      const failure = paynowStartFailure(err)
      setProblem(failure.text)
      // only a definite refusal makes the next try a new request; after an ambiguous failure the retry replays this one
      if (failure.definite) setKey(newIdempotencyKey())
      // the request may exist even though the answer was lost: re-read the invoice so it shows in its payments
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const outcome = await verifyGarageInvoicePayment(pending.collectionId) as PaynowOutcome
      setChecked({ outcome, failed: false })
      if (outcome.paynow) setPending({ ...pending, paynow: outcome.paynow })
      onChanged?.()
    } catch {
      setChecked({ outcome: null, failed: true })
    } finally {
      setBusy(false)
    }
  }

  // O'mari: Paynow's answer to the code, from the shared panel
  const otpAnswered = (outcome: PaynowOutcome) => {
    setChecked({ outcome, failed: false })
    const fresh = outcome.paynow
    if (fresh) setPending((p) => (p ? { ...p, paynow: fresh } : p))
    onChanged?.()
  }

  const view = pending?.paynow
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid="paynow-checkout">
      <p className="font-medium">Pay online with Paynow — into the garage’s own Paynow account</p>
      {option.simulation_notice && <Badge variant="outline" className="whitespace-normal" data-testid="paynow-simulated">{option.simulation_notice}</Badge>}
      <p className="text-xs text-gray-700">The money goes to {option.merchant_display_name}, not to CarUp. It counts on the invoice only after Paynow confirms it.</p>
      <p className="text-xs text-gray-700" data-testid="paynow-no-redirect-proof">{option.notices.no_redirect_proof}</p>

      {!pending && (
        <>
          <div>
            <label htmlFor={`${uid}-amount`} className="block text-sm font-medium">Amount ({option.currency}, up to {option.max_amount})</label>
            <input id={`${uid}-amount`} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); changed() }}
              aria-invalid={Boolean(amountProblem)} aria-describedby={amountProblem ? `${uid}-amount-problem` : undefined}
              className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-amount" />
            {amountProblem && <p id={`${uid}-amount-problem`} className="mt-1 text-sm text-red-800">{amountProblem}</p>}
          </div>
          <fieldset className="space-y-2" data-testid="paynow-methods">
            <legend className="text-sm font-medium">How do you want to pay?</legend>
            {option.methods.map((m) => (
              <label key={m} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-2 ${method === m ? 'border-orange-700 bg-orange-50' : 'border-gray-300'}`}>
                <input type="radio" name={`${uid}-method`} value={m} checked={method === m} className="mt-1 h-5 w-5"
                  onChange={() => { setMethod(m); changed() }} data-testid={`paynow-method-${m}`} />
                <span>
                  <span className="block font-medium">{PAYNOW_METHOD_LABEL[m]}</span>
                  <span className="block text-xs text-gray-700">{PAYNOW_METHOD_HINT[m]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {needsPhone(method) && (
            <div>
              <label htmlFor={`${uid}-phone`} className="block text-sm font-medium">{PAYNOW_METHOD_LABEL[method]} mobile number</label>
              <input id={`${uid}-phone`} type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="0771234567"
                onChange={(e) => { setPhone(e.target.value); changed() }}
                aria-invalid={Boolean(phoneIssue)} aria-describedby={phoneIssue ? `${uid}-phone-problem` : undefined}
                className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-phone" />
              {phoneIssue && <p id={`${uid}-phone-problem`} className="mt-1 text-sm text-red-800" data-testid="paynow-phone-problem">{phoneIssue}</p>}
            </div>
          )}
          {problem && <p className="rounded-md bg-red-50 p-2 text-red-900" role="alert" data-testid="paynow-error">{problem}</p>}
          <Button className={`min-h-11 h-auto whitespace-normal py-2 text-left ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || !ready}
            onClick={() => void start()} data-testid="paynow-start">
            {busy ? 'Contacting Paynow…' : ready ? `Pay ${amount.trim()} ${option.currency} with ${PAYNOW_METHOD_LABEL[method]}` : 'Pay with Paynow'}
          </Button>
        </>
      )}

      {pending && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="paynow-pending">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pending.amount} {pending.currency} with {view ? PAYNOW_METHOD_LABEL[view.method] : 'Paynow'}</span>
            {view?.provider_status && (
              <Badge variant="outline" className={`whitespace-normal ${PAYNOW_STATUS_TONE[view.provider_status]}`} data-testid="paynow-status-badge">{PAYNOW_STATUS_SHORT[view.provider_status]}</Badge>
            )}
          </p>
          <p role="status" aria-live="polite" data-testid="paynow-status">{view?.provider_status_label ?? 'Waiting for Paynow. Nothing is counted until Paynow confirms it.'}</p>
          {view && <PaynowPendingPanel collectionId={pending.collectionId} paynow={view} busy={busy} onOtpOutcome={otpAnswered} />}
          <Button variant="outline" className="min-h-11 bg-white" disabled={busy} onClick={() => void check()} data-testid="paynow-check">
            Check payment status
          </Button>
          {checked && (() => {
            const message = paynowOutcomeMessage(checked.outcome, checked.failed)
            return <p role="status" className={`rounded-md p-2 ${TONE[message.tone]}`} data-testid="paynow-outcome" data-tone={message.tone}>{message.text}</p>
          })()}
          <p className="text-xs text-amber-950" data-testid="paynow-cannot-cancel">{pending.cannotCancel}</p>
        </div>
      )}
    </div>
  )
}
