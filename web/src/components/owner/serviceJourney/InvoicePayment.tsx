import { useCallback, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney, newIdempotencyKey, type CustomerInvoice } from '@/lib/garageBusiness'
import {
  ONLINE_PAYMENT_REASON_LABEL, PAYMENT_METHOD_OPTIONS, PROVIDER_STATE_TONE, returnOutcomeMessage,
  type CollectionOutcome, type CustomerInvoicePayment,
} from '@/lib/pay04GaragePayments'
import { requestDate } from '@/lib/serviceRequests'

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHOD_OPTIONS.map((m) => [m.value, m.label]))
const TONE = { ok: 'bg-green-50 text-green-900', wait: 'bg-amber-50 text-amber-900', warn: 'bg-amber-50 text-amber-900', error: 'bg-red-50 text-red-900' } as const

/**
 * CARUP-PAY-04 — how the customer pays THIS invoice.
 *
 * The garage is paid, never CarUp: the garage's own instructions (with the disclosure that CarUp does not receive,
 * hold or verify that money), and — only where the server says it exists — online payment through the garage's own
 * provider merchant. Loaded on request; a failed load says so and never renders as "nothing to pay".
 */
export default function InvoicePayment({ invoice }: { invoice: CustomerInvoice }) {
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

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetchGarageInvoicePaymentOptions(invoice.id)
      if (!res || !res.money || !res.online_payment) throw new Error('Unexpected payment options response')
      setData(res)
      setAmount(res.online_payment.available ? res.online_payment.max_amount : '')
      setState('ready')
    } catch {
      setState('error')
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
      setProblem(err instanceof Error ? err.message : 'The payment could not be started. Nothing was charged.')
      setBusy(false)
    }
  }

  const check = async (collectionId: string) => {
    setBusy(true)
    try {
      const outcome = await verifyGarageInvoicePayment(collectionId)
      setChecked({ id: collectionId, outcome, failed: false })
      await load()
    } catch {
      setChecked({ id: collectionId, outcome: null, failed: true })
    } finally {
      setBusy(false)
    }
  }

  const stop = async (collectionId: string) => {
    setBusy(true)
    try {
      await cancelGarageInvoicePayment(collectionId, 'Stopped by the customer')
      setKey(newIdempotencyKey())
      await load()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The checkout could not be stopped.')
    } finally {
      setBusy(false)
    }
  }

  const option = data?.online_payment
  const panelId = `${uid}-pay`
  return (
    <section className="mt-4 border-t pt-3" aria-labelledby={`${uid}-title`} data-testid="invoice-how-to-pay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id={`${uid}-title`} className="text-sm font-semibold text-gray-900">Paying this invoice</h5>
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
                {option?.available ? (
                  <div className="rounded-md border p-3 space-y-2">
                    <p className="font-medium">Pay online through the garage’s payment provider</p>
                    {option.simulation_notice && <Badge variant="outline" className="whitespace-normal" data-testid="online-payment-simulated">{option.simulation_notice}</Badge>}
                    <p className="text-xs text-gray-600">The money goes to {option.merchant_display_name}, not to CarUp. It counts on the invoice only after the provider confirms it.</p>
                    <label htmlFor={`${uid}-amount`} className="block text-sm font-medium">Amount ({option.currency}, up to {option.max_amount})</label>
                    <input
                      id={`${uid}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm bg-white" data-testid="online-payment-amount"
                    />
                    {problem && <p className="rounded-md bg-red-50 p-2 text-red-900" role="alert" data-testid="online-payment-error">{problem}</p>}
                    <Button className="min-h-11 bg-orange-600 text-white hover:bg-orange-700" disabled={busy || !amount.trim()} onClick={() => void pay()} data-testid="online-payment-start">
                      {busy ? 'Opening the provider…' : `Continue to the provider to pay ${amount || '…'} ${option.currency}`}
                    </Button>
                  </div>
                ) : (
                  <p className="text-gray-700" data-testid="online-payment-unavailable">{option ? ONLINE_PAYMENT_REASON_LABEL[option.reason] : ''}</p>
                )}
              </div>

              {data.provider_payments.length > 0 && (
                <div data-testid="my-provider-payments">
                  <p className="font-medium">Your payments through the provider</p>
                  <ul className="mt-2 space-y-2">
                    {data.provider_payments.map((p) => (
                      <li key={p.id} className="rounded-md border bg-gray-50 p-3" data-testid="my-provider-payment" data-state={p.state}>
                        <p className="flex flex-wrap items-baseline justify-between gap-2">
                          <span>{formatMoney(p.amount, p.currency)} · started {requestDate(p.initiated_at)}</span>
                          <Badge variant="outline" className={`whitespace-normal ${PROVIDER_STATE_TONE[p.state] ?? ''}`}>{p.state_label}</Badge>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void check(p.id)} data-testid="my-provider-payment-check">
                            Check payment status
                          </Button>
                          {p.state === 'awaiting_provider' && (
                            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void stop(p.id)} data-testid="my-provider-payment-stop">
                              Stop this checkout
                            </Button>
                          )}
                        </div>
                        {checked?.id === p.id && (() => {
                          const message = returnOutcomeMessage(checked.outcome, checked.failed)
                          return <p role="status" className={`mt-2 rounded-md p-2 ${TONE[message.tone]}`} data-testid="my-provider-payment-outcome">{message.text}</p>
                        })()}
                      </li>
                    ))}
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
