import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { newIdempotencyKey } from '@/lib/garageBusiness'
import { MONEY_ACTION_BUTTON_CLASS, onlineAmountProblem } from '@/lib/pay04GaragePayments'
import {
  PAYNOW_METHOD_HINT, PAYNOW_METHOD_LABEL, needsPhone, pay05ErrorText, paynowOutcomeMessage, paynowStartFailure, paynowStateBadge, paynowStatusLine,
  phoneProblem,
  type PaynowMethod, type PaynowOnlineOption, type PaynowOutcome, type PaynowProviderPayment, type PaynowStartResult, type PaynowView,
} from '@/lib/pay05Paynow'
import PaynowFacts from '@/components/garage/PaynowFacts'
import PaynowPendingPanel from './PaynowPendingPanel'

const TONE = { ok: 'bg-green-50 text-green-900', wait: 'bg-amber-50 text-amber-900', warn: 'bg-amber-50 text-amber-900', error: 'bg-red-50 text-red-900' } as const

/** A live region that is in the page, empty, before its words arrive — so they are announced (W8). */
function LiveText({ text, testId }: { text: string; testId: string }) {
  const [said, setSaid] = useState('')
  // the words arrive one commit after the empty region is in the page: that delay is what makes them announced
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSaid(text) }, [text])
  return <p role="status" aria-live="polite" data-testid={testId}>{said}</p>
}

/**
 * CARUP-PAY-05 — the customer pays the garage through the GARAGE's own Paynow account.
 *
 * Only the methods the garage's Paynow integration enables for this currency are offered. A Paynow page opens in the
 * browser for card and other methods; EcoCash / OneMoney prompt the phone; InnBucks shows its code; O'mari asks for the
 * SMS code. Nothing is called paid until CarUp reads Paynow's own status — and Paynow cannot cancel a request, which the
 * words say plainly.
 */
export default function PaynowCheckout({ invoiceId, option, onChanged, onStarted, onUnconfirmedStart, latest = null }: {
  invoiceId: string
  option: PaynowOnlineOption
  onChanged?: () => void
  /** the request this checkout started (its parent keeps the checkout on screen for it) */
  onStarted?: (collectionId: string) => void
  /** Pay's answer was lost and the request may exist: the refresh may remove this checkout, so the parent keeps the warning */
  onUnconfirmedStart?: (text: string) => void
  /** the invoice's latest read of that request, once a refresh lists it */
  latest?: PaynowProviderPayment | null
}) {
  const { startGarageInvoicePayment, verifyGarageInvoicePayment } = useCarUpApi()
  const uid = useId()
  const [amount, setAmount] = useState(option.max_amount)
  const [method, setMethod] = useState<PaynowMethod>(option.methods.includes('web') ? 'web' : option.methods[0])
  const [phone, setPhone] = useState('')
  // one idempotency key per thing asked for (ICR-W12): editing a field and restoring it after a lost answer retries the SAME
  // request, so the server replays it instead of creating a second one
  const keys = useRef(new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // `state` is the collection's state as last read (unknown until a check or a refresh says it): it, not Paynow's status, sets the tone
  const [pending, setPending] = useState<{
    collectionId: string; amount: string; currency: string; paynow: PaynowView | null; state: string | null; cannotCancel: string
  } | null>(null)
  const [checked, setChecked] = useState<{ outcome: PaynowOutcome | null; failed: boolean } | null>(null)
  // after Pay, focus moves to the request's heading (W8)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusPending = useRef(false)
  useEffect(() => {
    if (!pending || !focusPending.current) return
    focusPending.current = false
    headingRef.current?.focus()
  }, [pending])
  // an accepted O'mari code removes the form that held the focus: it moves to the answer (ICR-W5)
  const outcomeRef = useRef<HTMLParagraphElement>(null)
  const focusOutcome = useRef(false)
  useEffect(() => {
    if (!checked || !focusOutcome.current) return
    focusOutcome.current = false
    outcomeRef.current?.focus()
  }, [checked])

  // a refresh of the invoice is a newer read of the request started here than the one shown: adopt it
  useEffect(() => {
    if (!latest) return
    // the parent's newer read of this request (a prop) replaces the one this checkout holds
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending((p) => (p && p.collectionId === latest.id ? { ...p, paynow: latest.paynow ?? p.paynow, state: latest.state } : p))
  }, [latest])

  const amountProblem = amount.trim() ? onlineAmountProblem(amount, option.max_amount, option.currency) : null
  const phoneIssue = needsPhone(method) && phone.trim() ? phoneProblem(phone) : null
  const ready = Boolean(amount.trim()) && !amountProblem && (!needsPhone(method) || (Boolean(phone.trim()) && !phoneIssue))
  // Pay cannot be pressed without the number: say so, next to the field and on the button
  const phoneMissing = needsPhone(method) && !phone.trim()
  const changed = () => setProblem(null)

  const start = async () => {
    setBusy(true)
    setProblem(null)
    const asked = JSON.stringify([amount.trim(), method, needsPhone(method) ? phone.trim() : ''])
    const key = keys.current.get(asked) ?? newIdempotencyKey()
    keys.current.set(asked, key)
    try {
      const started = await startGarageInvoicePayment(invoiceId, { amount: amount.trim(), method, ...(needsPhone(method) ? { phone: phone.trim() } : {}) }, key) as PaynowStartResult
      if (started.paynow?.initiation === 'refused') {
        // a retry replayed a request Paynow had refused: nothing exists at Paynow, so the next try is a new request
        setProblem(pay05ErrorText('PAY05_PROVIDER_REFUSED'))
        keys.current.delete(asked)
        onChanged?.()
        return
      }
      if (started.checkout_url) {
        // Paynow's own page decides; nothing is paid until CarUp reads Paynow's status
        window.location.assign(started.checkout_url)
        return
      }
      focusPending.current = true
      setPending({ collectionId: started.collection_id, amount: started.amount, currency: started.currency, paynow: started.paynow, state: null,
        cannotCancel: started.cannot_cancel })
      setChecked(null)
      onStarted?.(started.collection_id)
      onChanged?.()
    } catch (err) {
      const failure = paynowStartFailure(err)
      setProblem(failure.text)
      // only a definite refusal makes the next try a new request; after an ambiguous failure the retry replays this one
      if (failure.definite) keys.current.delete(asked)
      else onUnconfirmedStart?.(failure.text)
      // the request may exist even though the answer was lost: re-read the invoice so it shows in its payments
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    if (!pending) return
    setBusy(true)
    setChecked(null) // the outcome region empties, so the same answer twice is still said twice
    try {
      const outcome = await verifyGarageInvoicePayment(pending.collectionId) as PaynowOutcome
      setChecked({ outcome, failed: false })
      setPending((p) => (p ? { ...p, paynow: outcome.paynow ?? p.paynow, state: outcome.collection?.state ?? p.state } : p))
      onChanged?.()
    } catch {
      setChecked({ outcome: null, failed: true })
    } finally {
      setBusy(false)
    }
  }

  // O'mari: Paynow's answer to the code, from the shared panel
  const otpAnswered = (outcome: PaynowOutcome) => {
    focusOutcome.current = true
    setChecked({ outcome, failed: false })
    setPending((p) => (p ? { ...p, paynow: outcome.paynow ?? p.paynow, state: outcome.collection?.state ?? p.state } : p))
    onChanged?.()
  }

  const view = pending?.paynow
  const badge = pending ? paynowStateBadge(pending.state, view?.provider_status ?? null) : null
  const statusText = pending ? (view ? paynowStatusLine(pending.state, view) : 'Waiting for Paynow. Nothing is counted until Paynow confirms it.') : ''
  const outcome = checked ? paynowOutcomeMessage(checked.outcome, checked.failed) : null
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid="paynow-checkout">
      <p className="font-medium">Pay online with Paynow — into the garage’s own Paynow account</p>
      {option.simulation_notice && <Badge variant="outline" className="whitespace-normal" data-testid="paynow-simulated">{option.simulation_notice}</Badge>}
      <p className="text-xs text-gray-700">The money goes to {option.merchant_display_name}, not to CarUp. It counts on the invoice only after Paynow confirms it.</p>
      <p className="text-xs text-gray-700" data-testid="paynow-no-redirect-proof">{option.notices.no_redirect_proof}</p>
      {option.notices.earlier_request && !pending && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="paynow-earlier-request">{option.notices.earlier_request}</p>
      )}

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
                <input type="radio" name={`${uid}-method`} value={m} checked={method === m} className="mt-1 h-5 w-5 shrink-0"
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
                aria-invalid={Boolean(phoneIssue)} aria-describedby={phoneIssue ? `${uid}-phone-problem` : phoneMissing ? `${uid}-phone-hint` : undefined}
                className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-phone" />
              {phoneIssue && <p id={`${uid}-phone-problem`} className="mt-1 text-sm text-red-800" data-testid="paynow-phone-problem">{phoneIssue}</p>}
              {phoneMissing && <p id={`${uid}-phone-hint`} className="mt-1 text-sm text-gray-700" data-testid="paynow-phone-hint">Enter the mobile number to pay from.</p>}
            </div>
          )}
          {problem && <p className="rounded-md bg-red-50 p-2 text-red-900" role="alert" data-testid="paynow-error">{problem}</p>}
          <Button className={`min-h-11 h-auto max-sm:h-auto whitespace-normal py-2 text-left ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || !ready}
            aria-describedby={phoneMissing ? `${uid}-phone-hint` : undefined} onClick={() => void start()} data-testid="paynow-start">
            {busy ? 'Contacting Paynow…' : ready ? `Pay ${amount.trim()} ${option.currency} with ${PAYNOW_METHOD_LABEL[method]}` : 'Pay with Paynow'}
          </Button>
        </>
      )}

      {pending && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="paynow-pending">
          <h6 ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
            data-testid="paynow-pending-heading">
            Your Paynow payment request
          </h6>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pending.amount} {pending.currency} with {view ? PAYNOW_METHOD_LABEL[view.method] : 'Paynow'}</span>
            <Badge variant="outline" className={`whitespace-normal ${badge?.tone ?? ''}`} data-testid="paynow-status-badge">{badge?.label}</Badge>
          </p>
          <LiveText testId="paynow-status" text={statusText} />
          {view?.facts && <PaynowFacts facts={view.facts} />}
          {view && <PaynowPendingPanel collectionId={pending.collectionId} paynow={view} state={pending.state} busy={busy} onOtpOutcome={otpAnswered} />}
          <Button variant="outline" className="min-h-11 bg-white" disabled={busy} onClick={() => void check()} data-testid="paynow-check">
            Check payment status
          </Button>
          <p ref={outcomeRef} tabIndex={-1} role="status" aria-live="polite" className={outcome ? `rounded-md p-2 ${TONE[outcome.tone]}` : ''} data-testid="paynow-outcome"
            data-tone={outcome?.tone}>{outcome?.text ?? ''}</p>
          <p className="text-xs text-amber-950" data-testid="paynow-cannot-cancel">{pending.cannotCancel}</p>
        </div>
      )}
    </div>
  )
}
