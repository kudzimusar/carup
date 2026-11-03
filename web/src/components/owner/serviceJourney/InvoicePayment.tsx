import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney, newIdempotencyKey, type CustomerInvoice } from '@/lib/garageBusiness'
import {
  MONEY_ACTION_BUTTON_CLASS, ONLINE_PAYMENT_REASON_LABEL, PAYMENT_METHOD_OPTIONS, PROVIDER_STATE_TONE, onlineAmountProblem, pay04ErrorText,
  returnOutcomeMessage,
  type CollectionOutcome, type CustomerInvoicePayment,
} from '@/lib/pay04GaragePayments'
import { requestDate } from '@/lib/serviceRequests'
import {
  PAYNOW_METHOD_LABEL, paynowContinuable, paynowErrorText, paynowOutcomeMessage, paynowStatusLine, type PaynowOnlineOption, type PaynowOutcome, type PaynowProviderPayment,
} from '@/lib/pay05Paynow'
import PaynowFacts from '@/components/garage/PaynowFacts'
import PaynowCheckout from './PaynowCheckout'
import PaynowPendingPanel from './PaynowPendingPanel'

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHOD_OPTIONS.map((m) => [m.value, m.label]))
const TONE = { ok: 'bg-green-50 text-green-900', wait: 'bg-amber-50 text-amber-900', warn: 'bg-amber-50 text-amber-900', error: 'bg-red-50 text-red-900' } as const

/**
 * CARUP-PAY-04 — how the customer pays THIS invoice.
 *
 * The garage is paid, never CarUp: the garage's own instructions (with the disclosure that CarUp does not receive,
 * hold or verify that money), and — only where the server says it exists — online payment through the garage's own
 * provider merchant. Loaded on request; a failed load says so and never renders as "nothing to pay". An amount is
 * checked before it is sent, a changed amount is a new request, stopping a checkout asks first, and anything that
 * changes the payment refreshes the invoice above (`onChanged`).
 */
export default function InvoicePayment({ invoice, onChanged }: { invoice: CustomerInvoice; onChanged?: () => void }) {
  const { fetchGarageInvoicePaymentOptions, startGarageInvoicePayment, verifyGarageInvoicePayment, cancelGarageInvoicePayment } = useCarUpApi()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<CustomerInvoicePayment | null>(null)
  const [amount, setAmount] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [checked, setChecked] = useState<{ id: string; outcome: CollectionOutcome | null; failed: boolean } | null>(null)
  const [stopAsk, setStopAsk] = useState<string | null>(null)
  const [stopError, setStopError] = useState<{ id: string; text: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  // PAY-05: the request PaynowCheckout started. It stays on screen through every refresh — even once the whole balance is
  // reserved and Paynow is no longer offered — so its code, OTP form or instructions never vanish right after "Pay".
  const [paynowStarted, setPaynowStarted] = useState<{ collectionId: string; option: PaynowOnlineOption } | null>(null)
  // Pay's answer was lost: the request may exist, and the refresh that lists it may remove the checkout that said so (ICR-W5)
  const [lostStart, setLostStart] = useState<string | null>(null)
  // a result that is not a Paynow read: said in the row's live region, which is already on the page
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const loaded = useRef(false)
  const reads = useRef(0)

  // after each action the focus moves to the new content, once React has drawn it (ICR-W5)
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId) return
    const target = document.getElementById(focusId)
    if (!target) return
    target.focus()
    // the request is spent once focus has moved
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusId(null)
    // what it points at may be drawn by a later read or answer: each of those tries again
  }, [focusId, data, stopAsk, stopError, notice, lostStart, checked])
  /**
   * The first read shows "Loading"; every later read refreshes IN PLACE: what is on screen stays rendered (a separate
   * `refreshing` flag), because unmounting it would drop the payment the customer is in the middle of. A refresh that
   * fails keeps what is shown and says it may be out of date; an older read never overwrites a newer one.
   */
  const load = useCallback(async () => {
    const read = ++reads.current
    const inPlace = loaded.current
    if (inPlace) setRefreshing(true)
    else setState('loading')
    setRefreshFailed(false)
    try {
      const res = await fetchGarageInvoicePaymentOptions(invoice.id)
      if (!res || !res.money || !res.online_payment) throw new Error('Unexpected payment options response')
      if (read !== reads.current) return
      setData(res)
      setAmount(res.online_payment.available ? res.online_payment.max_amount : '')
      loaded.current = true
      setState('ready')
    } catch {
      if (read !== reads.current) return
      if (inPlace) setRefreshFailed(true)
      else setState('error')
    } finally {
      if (read === reads.current) setRefreshing(false)
    }
  }, [fetchGarageInvoicePaymentOptions, invoice.id])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && state !== 'ready') void load()
  }

  const pay = async () => {
    if (!data?.online_payment.available) return
    setBusy(true)
    setProblem(null)
    try {
      const started = await startGarageInvoicePayment(invoice.id, { amount: amount.trim() }, key)
      if (!started?.checkout_url) throw new Error('No checkout was created')
      // the provider's page decides; nothing is paid until CarUp reads the provider's confirmation
      window.location.assign(started.checkout_url)
    } catch (err) {
      setProblem(err instanceof TypeError ? 'We could not reach CarUp. Your payment may still have been started: check this invoice’s payments before trying again.'
        : err instanceof Error && err.message ? pay04ErrorText(err.message) : 'The payment could not be started. Nothing was charged.')
      setBusy(false)
    }
  }

  const check = async (collectionId: string) => {
    setBusy(true)
    setNotice(null)
    setChecked(null) // the outcome region empties, so the same answer twice is still said twice
    try {
      const outcome = await verifyGarageInvoicePayment(collectionId)
      setChecked({ id: collectionId, outcome, failed: false })
      // the button disables itself while checking, which drops the focus: it moves to the answer (CERT-2)
      setFocusId(`${uid}-outcome-${collectionId}`)
      await load()
      onChanged?.()
    } catch {
      setChecked({ id: collectionId, outcome: null, failed: true })
      setFocusId(`${uid}-outcome-${collectionId}`)
    } finally {
      setBusy(false)
    }
  }

  const stop = async (collectionId: string) => {
    setStopAsk(null)
    setStopError(null)
    setBusy(true)
    try {
      const answer = await cancelGarageInvoicePayment(collectionId, 'Stopped by the customer') as { notice?: string } | null
      setKey(newIdempotencyKey())
      await load()
      onChanged?.()
      setNotice({ id: collectionId, text: answer?.notice
        ? `Stop recorded. ${answer.notice} The amount stays reserved on this invoice until Paynow closes the request or CarUp releases it.`
        : 'Stop recorded. The payment shows what the provider confirms.' })
      setFocusId(`${uid}-outcome-${collectionId}`)
    } catch (err) {
      setStopError({ id: collectionId, text: paynowErrorText(err, 'The checkout could not be stopped. Nothing changed.') })
      setFocusId(`${uid}-stop-error-${collectionId}`)
    } finally {
      setBusy(false)
    }
  }

  const option = data?.online_payment
  // PAY-05: the garage's live merchant is its own Paynow account
  const paynowOption = option?.available && 'gateway' in option && option.gateway === 'paynow_zimbabwe' ? (option as unknown as PaynowOnlineOption) : null
  const checkoutOption = paynowOption ?? paynowStarted?.option ?? null
  // the invoice's latest read of the request the checkout started: the freshest word on it after a refresh
  const startedRow = paynowStarted ? (data?.provider_payments.find((p) => p.id === paynowStarted.collectionId) as PaynowProviderPayment | undefined) ?? null : null
  const amountProblem = option?.available && amount.trim() ? onlineAmountProblem(amount, option.max_amount, option.currency) : null
  const panelId = `${uid}-pay`
  return (
    <section className="mt-4 border-t pt-3" aria-labelledby={`${uid}-title`} data-testid="invoice-how-to-pay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id={`${uid}-title`} className="text-sm font-semibold text-gray-900">Paying this invoice</h5>
        <span role="status" aria-live="polite" className="text-xs text-gray-700" data-testid="how-to-pay-refreshing">
          {open && refreshing ? 'Updating…' : open && refreshFailed ? 'Could not update just now — what is shown may be out of date.' : ''}
        </span>
        <Button variant="outline" className="min-h-11" aria-expanded={open} aria-controls={panelId} onClick={toggle} data-testid="how-to-pay-toggle">
          {open ? 'Hide how to pay' : 'How to pay'}
        </Button>
      </div>
      {open && (
        <div id={panelId} className="mt-3 space-y-3 text-sm">
          {state === 'loading' && <p role="status" data-testid="how-to-pay-loading">Loading how to pay…</p>}
          {state === 'error' && (
            <div className="rounded-md bg-red-50 p-3 text-red-900" role="alert" data-testid="how-to-pay-error">
              <p>How to pay could not be loaded. Nothing here means the invoice is paid or unpaid — the invoice above is the record.</p>
              <Button variant="outline" className="mt-2 min-h-11" onClick={() => void load()}>Try again</Button>
            </div>
          )}
          {state === 'ready' && data && (
            <>
              {refreshFailed && (
                <Button variant="outline" className="min-h-11" disabled={refreshing} onClick={() => void load()} data-testid="how-to-pay-refresh">
                  Update the payments
                </Button>
              )}
              <div data-testid="how-to-pay-instructions">
                {data.payment_instructions ? (
                  <div className="rounded-md border bg-gray-50 p-3">
                    <p className="font-medium">Pay {data.payment_instructions.payee_name}</p>
                    <p className="mt-1 whitespace-pre-line text-gray-800" data-testid="instructions-text">{data.payment_instructions.instructions}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Accepted: {data.payment_instructions.accepted_methods.map((m) => METHOD_LABEL[m] ?? m).join(', ')}
                    </p>
                    <p className="mt-2 text-xs text-gray-700" data-testid="instructions-disclosure">{data.payment_instructions.disclosure}</p>
                  </div>
                ) : (
                  <p className="text-gray-700" data-testid="instructions-missing">{data.instructions_missing_label}</p>
                )}
              </div>

              <div data-testid="online-payment">
                {checkoutOption ? (
                  <PaynowCheckout invoiceId={invoice.id} option={checkoutOption} latest={startedRow}
                    onStarted={(collectionId) => { setLostStart(null); setPaynowStarted({ collectionId, option: checkoutOption }) }}
                    onUnconfirmedStart={(text) => { setLostStart(text); setFocusId(`${uid}-lost-start`) }}
                    onChanged={() => { void load(); onChanged?.() }} />
                ) : option?.available ? (
                  <div className="rounded-md border p-3 space-y-2">
                    <p className="font-medium">Pay online through the garage’s payment provider</p>
                    {option.simulation_notice && <Badge variant="outline" className="whitespace-normal" data-testid="online-payment-simulated">{option.simulation_notice}</Badge>}
                    <p className="text-xs text-gray-600">The money goes to {option.merchant_display_name}, not to CarUp. It counts on the invoice only after the provider confirms it.</p>
                    <label htmlFor={`${uid}-amount`} className="block text-sm font-medium">Amount ({option.currency}, up to {option.max_amount})</label>
                    <input
                      id={`${uid}-amount`} inputMode="decimal" value={amount}
                      // a different amount is a different request: it gets its own idempotency key
                      onChange={(e) => { setAmount(e.target.value); setKey(newIdempotencyKey()); setProblem(null) }}
                      aria-invalid={Boolean(amountProblem)} aria-describedby={amountProblem ? `${uid}-amount-problem` : undefined}
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm bg-white" data-testid="online-payment-amount"
                    />
                    {amountProblem && <p id={`${uid}-amount-problem`} className="text-sm text-red-800" data-testid="online-payment-amount-problem">{amountProblem}</p>}
                    {problem && <p className="rounded-md bg-red-50 p-2 text-red-900" role="alert" data-testid="online-payment-error">{problem}</p>}
                    <Button className={`min-h-11 h-auto max-sm:h-auto whitespace-normal py-2 text-left ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || !amount.trim() || Boolean(amountProblem)}
                      onClick={() => void pay()} data-testid="online-payment-start">
                      {busy ? 'Opening the provider…' : amountProblem || !amount.trim() ? 'Continue to the provider' : `Continue to the provider to pay ${amount.trim()} ${option.currency}`}
                    </Button>
                  </div>
                ) : (
                  <p className="text-gray-700" data-testid="online-payment-unavailable">{option ? ONLINE_PAYMENT_REASON_LABEL[option.reason] : ''}</p>
                )}
              </div>

              {!checkoutOption && lostStart && (
                <p id={`${uid}-lost-start`} tabIndex={-1} role="alert" className="rounded-md bg-amber-50 p-3 text-amber-950" data-testid="paynow-start-lost">{lostStart}</p>
              )}
              {data.provider_payments.length > 0 && (
                <div data-testid="my-provider-payments">
                  <p className="font-medium">Your payments through the provider</p>
                  <ul className="mt-2 space-y-2">
                    {data.provider_payments.map((p) => {
                      const paynow = (p as PaynowProviderPayment).paynow ?? null
                      // PAY-05: an in-progress Paynow request can be continued here (the one the checkout above started is shown there)
                      const continuable = paynow && paynowStarted?.collectionId !== p.id && paynowContinuable(p.state, paynow) ? paynow : null
                      return (
                      <li key={p.id} className="rounded-md border bg-gray-50 p-3" data-testid="my-provider-payment" data-state={p.state}>
                        <p className="flex flex-wrap items-baseline justify-between gap-2">
                          <span>{formatMoney(p.amount, p.currency)} · started {requestDate(p.initiated_at)}{paynow ? ` · Paynow ${PAYNOW_METHOD_LABEL[paynow.method]}` : ''}</span>
                          <Badge variant="outline" className={`whitespace-normal ${PROVIDER_STATE_TONE[p.state] ?? ''}`}>{p.state_label}</Badge>
                        </p>
                        {paynow && <p className="mt-1 text-xs text-gray-700" data-testid="my-provider-payment-paynow">{paynowStatusLine(p.state, paynow)}</p>}
                        {continuable && (
                          <PaynowPendingPanel className="mt-2 rounded-md border border-amber-300 bg-white p-2" collectionId={p.id} paynow={continuable}
                            state={p.state} busy={busy}
                            onOtpOutcome={(outcome) => { setNotice(null); setChecked({ id: p.id, outcome, failed: false }); setFocusId(`${uid}-outcome-${p.id}`); void load(); onChanged?.() }} />
                        )}
                        <PaynowFacts className="mt-2" facts={paynow?.facts} />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void check(p.id)} data-testid="my-provider-payment-check">
                            Check payment status
                          </Button>
                          {p.state === 'awaiting_provider' && stopAsk !== p.id && (!paynow || paynow.provider_status === null || paynow.provider_status === 'created' || paynow.provider_status === 'sent') && (
                            <Button id={`${uid}-stop-${p.id}`} variant="outline" className="min-h-11" disabled={busy}
                              onClick={() => { setStopAsk(p.id); setStopError(null); setFocusId(`${uid}-ask-${p.id}`) }} data-testid="my-provider-payment-stop">
                              {paynow ? 'Stop waiting for this payment' : 'Stop this checkout'}
                            </Button>
                          )}
                        </div>
                        {stopAsk === p.id && (
                          <div id={`${uid}-ask-${p.id}`} tabIndex={-1} className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900" role="group"
                            aria-label="Stop this checkout?" data-testid="my-provider-payment-stop-ask">
                            <p>{paynow
                              ? 'Stop waiting for this Paynow payment? Paynow cannot cancel a payment request, so the amount stays reserved on this invoice until Paynow closes it or CarUp releases it. A payment you complete while it is reserved counts on the invoice.'
                              : 'Stop this checkout? If you already paid at the provider, that payment still counts.'}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy} onClick={() => void stop(p.id)} data-testid="my-provider-payment-stop-confirm">Yes, stop it</Button>
                              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => { setStopAsk(null); setFocusId(`${uid}-stop-${p.id}`) }} data-testid="my-provider-payment-stop-keep">Keep it</Button>
                            </div>
                          </div>
                        )}
                        {stopError?.id === p.id && (
                          <p id={`${uid}-stop-error-${p.id}`} tabIndex={-1} role="alert" className="mt-2 rounded-md bg-red-50 p-2 text-red-900" data-testid="my-provider-payment-stop-error">{stopError.text}</p>
                        )}
                        {(() => {
                          // a live region in the page before its words arrive (W8)
                          const message = notice?.id === p.id ? { tone: 'wait' as const, text: notice.text } : checked?.id !== p.id ? null : paynow
                            ? paynowOutcomeMessage(checked.outcome as PaynowOutcome | null, checked.failed) : returnOutcomeMessage(checked.outcome, checked.failed)
                          return (
                            <p id={`${uid}-outcome-${p.id}`} tabIndex={-1} role="status" aria-live="polite" className={message ? `mt-2 rounded-md p-2 ${TONE[message.tone]}` : ''}
                              data-testid="my-provider-payment-outcome">{message?.text ?? ''}</p>
                          )
                        })()}
                      </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
